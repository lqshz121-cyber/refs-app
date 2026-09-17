BEGIN;

-- O11: entity identity changes (name, source binding, active) left no trace:
-- `entity` has no updated_at and no audit trigger, so a direct UPDATE of a
-- company name (the path that replaced 196 placeholders on staging) is invisible
-- afterwards.  This migration records every such change with the database
-- session identity and the REFS actor (when a request context exists), and
-- takes a baseline fingerprint (sha256 of the current name) for every entity so
-- later reconciliation against the WBS catalog probe has an exact "as of" point.
-- It changes no name and grants no new authority.
CREATE TABLE entity_identity_change (
  entity_identity_change_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  change_kind text NOT NULL CHECK (change_kind IN ('BASELINE','UPDATE','DELETE')),
  db_session_user text NOT NULL,
  refs_actor text,
  transaction_id bigint NOT NULL,
  name_before text,
  name_after text,
  name_after_sha256 text CHECK (name_after_sha256 IS NULL OR name_after_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  source_system_before text,
  source_system_after text,
  source_entity_id_before text,
  source_entity_id_after text,
  active_before boolean,
  active_after boolean
);
CREATE INDEX entity_identity_change_entity_idx ON entity_identity_change(tenant_id,entity_id,changed_at DESC);

CREATE FUNCTION refs_entity_identity_change_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text;
BEGIN
  BEGIN actor:=refs_current_actor(); EXCEPTION WHEN OTHERS THEN actor:=NULL; END;
  IF TG_OP='DELETE' THEN
    INSERT INTO entity_identity_change(tenant_id,entity_id,change_kind,db_session_user,refs_actor,transaction_id,name_before,source_system_before,source_entity_id_before,active_before)
      VALUES(OLD.tenant_id,OLD.entity_id,'DELETE',session_user,actor,txid_current(),OLD.name,OLD.source_system,OLD.source_entity_id,OLD.active);
    RETURN OLD;
  END IF;
  IF OLD.name IS DISTINCT FROM NEW.name OR OLD.source_system IS DISTINCT FROM NEW.source_system
     OR OLD.source_entity_id IS DISTINCT FROM NEW.source_entity_id OR OLD.active IS DISTINCT FROM NEW.active THEN
    INSERT INTO entity_identity_change(tenant_id,entity_id,change_kind,db_session_user,refs_actor,transaction_id,
      name_before,name_after,name_after_sha256,source_system_before,source_system_after,source_entity_id_before,source_entity_id_after,active_before,active_after)
      VALUES(NEW.tenant_id,NEW.entity_id,'UPDATE',session_user,actor,txid_current(),
        OLD.name,NEW.name,'sha256:'||encode(sha256(convert_to(NEW.name,'UTF8')),'hex'),
        OLD.source_system,NEW.source_system,OLD.source_entity_id,NEW.source_entity_id,OLD.active,NEW.active);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER entity_identity_change_audit AFTER UPDATE OR DELETE ON entity
  FOR EACH ROW EXECUTE FUNCTION refs_entity_identity_change_trigger();

-- Baseline fingerprint of every entity as of this migration (names hashed, not copied).
INSERT INTO entity_identity_change(tenant_id,entity_id,change_kind,db_session_user,refs_actor,transaction_id,name_after_sha256,source_system_after,source_entity_id_after,active_after)
SELECT tenant_id,entity_id,'BASELINE',session_user,NULL,txid_current(),'sha256:'||encode(sha256(convert_to(name,'UTF8')),'hex'),source_system,source_entity_id,active FROM entity;

-- History is append-only for everyone, including the migrator role.
CREATE FUNCTION refs_entity_identity_change_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'entity_identity_change is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER entity_identity_change_append_only BEFORE UPDATE OR DELETE ON entity_identity_change
  FOR EACH ROW EXECUTE FUNCTION refs_entity_identity_change_append_only();

-- Read model for operators: no names, only hashes/lengths; identity of who changed what and when.
CREATE FUNCTION refs_read_entity_identity_changes(p_tenant uuid,p_entity uuid,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>200 OR p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'paging is invalid' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object(
    'schema_version','ENTITY_IDENTITY_CHANGES_V1','entity_id',p_entity,'limit',p_limit,'offset',p_offset,
    'total',(SELECT count(*) FROM entity_identity_change c WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity),
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'changed_at',to_char(c.changed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'change_kind',c.change_kind,'db_session_user',c.db_session_user,'refs_actor',c.refs_actor,
        'name_before_sha256',CASE WHEN c.name_before IS NULL THEN NULL ELSE 'sha256:'||encode(sha256(convert_to(c.name_before,'UTF8')),'hex') END,
        'name_after_sha256',c.name_after_sha256,
        'name_after_length',CASE WHEN c.name_after IS NULL THEN NULL ELSE length(c.name_after) END,
        'source_binding_before',CASE WHEN c.source_system_before IS NULL THEN NULL ELSE c.source_system_before||':'||coalesce(c.source_entity_id_before,'') END,
        'source_binding_after',CASE WHEN c.source_system_after IS NULL THEN NULL ELSE c.source_system_after||':'||coalesce(c.source_entity_id_after,'') END,
        'active_before',c.active_before,'active_after',c.active_after
      ) ORDER BY c.changed_at DESC,c.entity_identity_change_id)
      FROM (SELECT * FROM entity_identity_change c WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity ORDER BY c.changed_at DESC,c.entity_identity_change_id LIMIT p_limit OFFSET p_offset) c),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION refs_read_entity_identity_changes(uuid,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_entity_identity_changes(uuid,uuid,integer,integer) TO refs_app;

COMMIT;
