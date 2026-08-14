BEGIN;

-- A controlled demonstration uses a real tenant boundary, never a flag on a
-- production entity or browser-held state. The absence of a row means the
-- tenant remains a normal, non-demo tenant.
CREATE TABLE controlled_demo_tenant (
  tenant_id uuid PRIMARY KEY REFERENCES tenant(tenant_id),
  scenario_code text NOT NULL CHECK(scenario_code ~ '^[A-Z0-9_]{3,64}$'),
  display_label text NOT NULL CHECK(length(btrim(display_label)) BETWEEN 3 AND 160),
  created_by text NOT NULL CHECK(length(btrim(created_by)) BETWEEN 2 AND 128),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK(expires_at>created_at)
);
COMMENT ON TABLE controlled_demo_tenant IS
  'Explicit isolated DEMO tenant marker. Its absence is production/default. It never authorizes provider admission or relaxes accounting workflow controls.';

CREATE TABLE controlled_demo_tenant_retirement (
  controlled_demo_tenant_retirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES controlled_demo_tenant(tenant_id),
  retired_by text NOT NULL CHECK(length(btrim(retired_by)) BETWEEN 2 AND 128),
  retirement_reason text NOT NULL CHECK(length(btrim(retirement_reason)) BETWEEN 8 AND 1000),
  retired_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE controlled_demo_tenant_retirement IS
  'Append-only cleanup record. Retirement disables the DEMO marker but does not delete journals, source evidence, audit events, or ledger data.';

ALTER TABLE controlled_demo_tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE controlled_demo_tenant_retirement ENABLE ROW LEVEL SECURITY;
CREATE POLICY controlled_demo_tenant_scope_policy ON controlled_demo_tenant
  USING(tenant_id=refs_current_tenant()) WITH CHECK(tenant_id=refs_current_tenant());
CREATE POLICY controlled_demo_tenant_retirement_scope_policy ON controlled_demo_tenant_retirement
  USING(tenant_id=refs_current_tenant()) WITH CHECK(tenant_id=refs_current_tenant());
CREATE TRIGGER controlled_demo_tenant_append_only BEFORE UPDATE OR DELETE ON controlled_demo_tenant
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER controlled_demo_tenant_retirement_append_only BEFORE UPDATE OR DELETE ON controlled_demo_tenant_retirement
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_validate_controlled_demo_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE code text;
BEGIN
  SELECT tenant_code INTO code FROM tenant WHERE tenant_id=NEW.tenant_id FOR SHARE;
  IF code IS NULL OR code !~ '^DEMO_[A-Z0-9_]{2,27}$' THEN
    RAISE EXCEPTION 'Controlled DEMO tenant code must use the DEMO_ namespace' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER controlled_demo_tenant_namespace_guard BEFORE INSERT ON controlled_demo_tenant
  FOR EACH ROW EXECUTE FUNCTION refs_validate_controlled_demo_tenant();

-- Runtime callers receive exactly one status for their own tenant. A DEMO
-- tenant expires without a destructive cleanup job; the separate retirement
-- record can additionally disable it early.
CREATE FUNCTION refs_read_controlled_demo_tenant(p_tenant uuid)
RETURNS TABLE(tenant_id uuid,is_demo boolean,lifecycle_status text,scenario_code text,display_label text,expires_at timestamptz,retired_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_tenant IS NULL OR refs_current_tenant() IS DISTINCT FROM p_tenant THEN
    RAISE EXCEPTION 'Controlled DEMO tenant scope denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT t.tenant_id,
      COALESCE(d.tenant_id IS NOT NULL AND d.expires_at>clock_timestamp() AND r.tenant_id IS NULL,false),
      CASE
        WHEN d.tenant_id IS NULL THEN 'PRODUCTION'
        WHEN r.tenant_id IS NOT NULL THEN 'RETIRED'
        WHEN d.expires_at<=clock_timestamp() THEN 'EXPIRED'
        ELSE 'ACTIVE_DEMO'
      END,
      d.scenario_code,d.display_label,d.expires_at,r.retired_at
    FROM tenant t
    LEFT JOIN controlled_demo_tenant d ON d.tenant_id=t.tenant_id
    LEFT JOIN controlled_demo_tenant_retirement r ON r.tenant_id=d.tenant_id
    WHERE t.tenant_id=p_tenant;
END;
$$;

-- This is the non-destructive cleanup capability for a provisioned DEMO
-- tenant. It is intentionally not granted to refs_app: an API/owner layer
-- must later supply the explicit administrator authorization.
CREATE FUNCTION refs_retire_controlled_demo_tenant(p_tenant uuid,p_reason text,p_retired_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE marker controlled_demo_tenant; retirement_id uuid:=gen_random_uuid(); actor text:=COALESCE(NULLIF(btrim(p_retired_by),''),refs_current_actor(),'SYSTEM'); payload jsonb;
BEGIN
  IF p_tenant IS NULL OR length(btrim(COALESCE(p_reason,'')))<8 THEN
    RAISE EXCEPTION 'Controlled DEMO retirement requires tenant and reason' USING ERRCODE='22023';
  END IF;
  SELECT * INTO marker FROM controlled_demo_tenant WHERE tenant_id=p_tenant FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Controlled DEMO tenant is absent' USING ERRCODE='23503'; END IF;
  INSERT INTO controlled_demo_tenant_retirement(controlled_demo_tenant_retirement_id,tenant_id,retired_by,retirement_reason)
  VALUES(retirement_id,p_tenant,actor,btrim(p_reason)) ON CONFLICT(tenant_id) DO NOTHING
  RETURNING controlled_demo_tenant_retirement_id INTO retirement_id;
  IF retirement_id IS NULL THEN
    SELECT controlled_demo_tenant_retirement_id INTO retirement_id FROM controlled_demo_tenant_retirement WHERE tenant_id=p_tenant;
    RETURN jsonb_build_object('tenant_id',p_tenant,'retirement_id',retirement_id,'retired',true,'idempotent',true);
  END IF;
  payload:=jsonb_build_object('schema_version','CONTROLLED_DEMO_TENANT_V1','tenant_id',p_tenant,
    'retirement_id',retirement_id,'scenario_code',marker.scenario_code,'reason',btrim(p_reason),'retired_by',actor);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,
    request_id,correlation_id,after_hash,metadata)
  VALUES(p_tenant,NULL,'CONTROLLED_DEMO_RETIRED','CONTROLLED_DEMO_TENANT',retirement_id,'RETIRE',actor,'SYSTEM',
    'CONTROLLED_DEMO_RETIRE:'||retirement_id,'CONTROLLED_DEMO_RETIRE:'||retirement_id,refs_jsonb_hash(payload),payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,NULL,'CONTROLLED_DEMO_TENANT',retirement_id,'CONTROLLED_DEMO_RETIRED',payload,refs_jsonb_hash(payload));
  RETURN jsonb_build_object('tenant_id',p_tenant,'retirement_id',retirement_id,'retired',true,'idempotent',false);
END;
$$;

REVOKE ALL ON TABLE controlled_demo_tenant,controlled_demo_tenant_retirement FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_retire_controlled_demo_tenant(uuid,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_validate_controlled_demo_tenant() FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_read_controlled_demo_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_controlled_demo_tenant(uuid) TO refs_app;

COMMIT;
