-- Consumer DB ONLY. This is not an accounting migration and is never run by db:up.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE refs_outbox_consumer_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA refs_outbox_consumer;
REVOKE ALL ON SCHEMA refs_outbox_consumer FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE refs_outbox_consumer.configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  database_name text NOT NULL, tenant_id uuid NOT NULL, entity_id uuid NOT NULL,
  bootstrap_sha256 text NOT NULL
);
CREATE TABLE refs_outbox_consumer.event_ledger (
  outbox_event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL, entity_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  envelope jsonb NOT NULL,
  first_attempt_count integer NOT NULL CHECK (first_attempt_count>0),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(outbox_event_id,payload_hash)
);
CREATE FUNCTION refs_outbox_consumer.reject_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='OUTBOX_CONSUMER_APPEND_ONLY'; END;
$$;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON refs_outbox_consumer.event_ledger
FOR EACH STATEMENT EXECUTE FUNCTION refs_outbox_consumer.reject_change();
CREATE TRIGGER configuration_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON refs_outbox_consumer.configuration
FOR EACH STATEMENT EXECUTE FUNCTION refs_outbox_consumer.reject_change();

CREATE FUNCTION refs_outbox_consumer.ready(p_database text,p_tenant uuid,p_entity uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog AS $$
  SELECT current_database()=p_database
    AND EXISTS(SELECT 1 FROM refs_outbox_consumer.configuration c WHERE c.database_name=p_database AND c.tenant_id=p_tenant AND c.entity_id=p_entity)
    AND pg_has_role(session_user,'refs_outbox_consumer_runtime','MEMBER')
    AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls))
    AND session_user<>(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())
    AND NOT has_database_privilege(session_user,current_database(),'CREATE')
    AND NOT has_schema_privilege(session_user,'refs_outbox_consumer','CREATE')
    AND NOT has_table_privilege(session_user,'refs_outbox_consumer.event_ledger','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_table_privilege(session_user,'refs_outbox_consumer.configuration','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND to_regclass('public.journal_entry') IS NULL AND to_regclass('public.refs_schema_migration') IS NULL
$$;

CREATE FUNCTION refs_outbox_consumer.accept(e jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c refs_outbox_consumer.configuration; old refs_outbox_consumer.event_ledger; stable jsonb; computed text;
BEGIN
  SELECT * INTO STRICT c FROM refs_outbox_consumer.configuration;
  IF NOT refs_outbox_consumer.ready(c.database_name,c.tenant_id,c.entity_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='OUTBOX_CONSUMER_AUTHORITY_INVALID';
  END IF;
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->>'schema_version' IS DISTINCT FROM 'REFS_OUTBOX_EVENT_V1'
    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) <> ARRAY['aggregate_id','aggregate_type','attempt_count','created_at','entity_id','event_type','outbox_event_id','payload','payload_hash','schema_version','tenant_id']
    OR e->>'tenant_id' IS DISTINCT FROM c.tenant_id::text OR e->>'entity_id' IS DISTINCT FROM c.entity_id::text
    OR jsonb_typeof(e->'payload') IS DISTINCT FROM 'object'
    OR octet_length(e::text)>1000000
    OR coalesce(e->>'aggregate_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR coalesce(e->>'outbox_event_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR coalesce(e->>'event_type','') !~ '^[A-Za-z][A-Za-z0-9_.:-]{0,127}$'
    OR coalesce(e->>'aggregate_type','') !~ '^[A-Za-z][A-Za-z0-9_.:-]{0,127}$'
    OR jsonb_typeof(e->'attempt_count') IS DISTINCT FROM 'number'
    OR coalesce(e->>'attempt_count','') !~ '^[1-9][0-9]{0,8}$'
    OR coalesce(e->>'created_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR (e->'payload')::text ~* '"([a-z_]*_)?(authorization|api_key|access_token|refresh_token|private_key|password|credential|client_secret|session_token)(_[a-z_]*)?"[[:space:]]*:'
    OR (e->'payload')::text ~* '(Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{8,}|(sk|rk|pk)-[A-Za-z0-9_-]{12,})' THEN
    RAISE EXCEPTION USING ERRCODE='P0400', MESSAGE='OUTBOX_EVENT_INVALID';
  END IF;
  IF to_char((e->>'created_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>e->>'created_at' THEN
    RAISE EXCEPTION USING ERRCODE='P0400', MESSAGE='OUTBOX_EVENT_INVALID';
  END IF;
  computed := 'sha256:'||encode(public.digest(convert_to((e->'payload')::text,'UTF8'),'sha256'),'hex');
  IF computed IS DISTINCT FROM e->>'payload_hash' THEN
    RAISE EXCEPTION USING ERRCODE='P0400', MESSAGE='OUTBOX_PAYLOAD_HASH_INVALID';
  END IF;
  -- attempt_count changes on retry; all immutable event coordinates must match.
  stable := e-'attempt_count';
  INSERT INTO refs_outbox_consumer.event_ledger(outbox_event_id,tenant_id,entity_id,payload_hash,envelope,first_attempt_count)
    VALUES((e->>'outbox_event_id')::uuid,c.tenant_id,c.entity_id,computed,stable,(e->>'attempt_count')::integer)
    ON CONFLICT(outbox_event_id) DO NOTHING;
  SELECT * INTO STRICT old FROM refs_outbox_consumer.event_ledger WHERE outbox_event_id=(e->>'outbox_event_id')::uuid;
  IF old.payload_hash<>computed OR old.envelope<>stable THEN
    RAISE EXCEPTION USING ERRCODE='P0409', MESSAGE='OUTBOX_EVENT_CONFLICT';
  END IF;
  RETURN jsonb_build_object('schema_version','REFS_OUTBOX_PUBLISH_RECEIPT_V1','accepted',true,'outbox_event_id',old.outbox_event_id,'payload_hash',computed);
END;
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA refs_outbox_consumer FROM PUBLIC,refs_outbox_consumer_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA refs_outbox_consumer FROM PUBLIC;
GRANT USAGE ON SCHEMA refs_outbox_consumer TO refs_outbox_consumer_runtime;
GRANT EXECUTE ON FUNCTION refs_outbox_consumer.ready(text,uuid,uuid), refs_outbox_consumer.accept(jsonb) TO refs_outbox_consumer_runtime;
