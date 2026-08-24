BEGIN;
REVOKE ALL ON FUNCTION refs_reconcile_actor_grants_v2(uuid,text,uuid,text[],text,timestamptz,bigint,text,text) FROM refs_grant_sync;
REVOKE ALL ON FUNCTION refs_grant_request_hash_v2(uuid,text,uuid,text[],text,timestamptz,bigint) FROM refs_grant_sync;
LOCK TABLE runtime_grant_sync_receipt IN SHARE MODE;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM runtime_grant_sync_receipt WHERE grant_policy_version='SOD_FINITE_V1') THEN
    RAISE EXCEPTION 'Refusing migration 274 rollback: finite-expiry grant evidence exists';
  END IF;
END;
$$;
DROP TRIGGER IF EXISTS runtime_auth_context_sod_guard ON runtime_auth_context;
DROP FUNCTION IF EXISTS refs_guard_runtime_context_sod();
CREATE OR REPLACE FUNCTION refs_entity_allowed(candidate uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(EXISTS(
    SELECT 1 FROM runtime_auth_context
    WHERE token_hash=current_setting('refs.context_hash',true)
      AND bound_login=session_user AND bound_backend_pid=pg_backend_pid() AND bound_txid=txid_current()
      AND revoked_at IS NULL AND expires_at>clock_timestamp()
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(grants) g WHERE (g->>'entity_id')::uuid=candidate)
  ),false)
$$;
CREATE OR REPLACE FUNCTION refs_has_permission(required_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(EXISTS(
    SELECT 1 FROM runtime_auth_context
    WHERE token_hash=current_setting('refs.context_hash',true)
      AND bound_login=session_user AND bound_backend_pid=pg_backend_pid() AND bound_txid=txid_current()
      AND revoked_at IS NULL AND expires_at>clock_timestamp()
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(grants) g WHERE g->>'permission' IN (required_permission,'*'))
  ),false)
$$;
CREATE OR REPLACE FUNCTION refs_entity_has_permission(candidate uuid,required_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(EXISTS(
    SELECT 1 FROM runtime_auth_context c, LATERAL jsonb_array_elements(c.grants) g
    WHERE c.token_hash=current_setting('refs.context_hash',true)
      AND c.bound_login=session_user AND c.bound_backend_pid=pg_backend_pid() AND c.bound_txid=txid_current()
      AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
      AND (g->>'entity_id')::uuid=candidate AND g->>'permission' IN (required_permission,'*')
  ),false)
$$;
DROP FUNCTION IF EXISTS refs_reconcile_actor_grants_v2(uuid,text,uuid,text[],text,timestamptz,bigint,text,text);
DROP FUNCTION IF EXISTS refs_grant_request_hash_v2(uuid,text,uuid,text[],text,timestamptz,bigint);
GRANT EXECUTE ON FUNCTION refs_reconcile_actor_grants(uuid,text,uuid,text[],bigint,text,text) TO refs_grant_sync;
GRANT EXECUTE ON FUNCTION refs_upgrade_stage1_wbs_autorec_read(uuid,text,uuid,text,text,bigint) TO refs_grant_sync;
GRANT EXECUTE ON FUNCTION refs_upgrade_stage1_wbs_operator_attest(uuid,text,uuid,text,text,bigint) TO refs_grant_sync;
GRANT EXECUTE ON FUNCTION refs_upgrade_stage1_controlled_test_workflow(uuid,text,uuid,text,text,bigint) TO refs_grant_sync;
DROP TABLE IF EXISTS runtime_human_permission_authority;
DROP TABLE IF EXISTS runtime_service_only_permission;
ALTER TABLE runtime_grant_sync_receipt DROP CONSTRAINT runtime_grant_sync_policy_ck,
  DROP COLUMN grant_policy_version,DROP COLUMN authority_class,DROP COLUMN valid_until;
ALTER TABLE runtime_actor_grant DROP COLUMN authority_class;
COMMIT;
