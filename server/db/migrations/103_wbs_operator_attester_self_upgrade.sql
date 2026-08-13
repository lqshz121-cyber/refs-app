BEGIN;

-- Upgrade only the exact Stage 1 WBS evidence reader produced by 087.  This
-- adds one exception-evidence command and cannot replace a broader grant set.
CREATE OR REPLACE FUNCTION refs_upgrade_stage1_wbs_operator_attest(
  p_tenant uuid,p_actor text,p_entity uuid,p_idempotency_key text,p_request_hash text,p_expected_version bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  prior text[];
  expected_prior text[]:=ARRAY['AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW','WBS.AUTOREC.VIEW'];
  desired text[]:=ARRAY['AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW','WBS.AUTOREC.VIEW','WBS.PAYABLE.OPERATOR_ATTEST'];
  receipt runtime_grant_sync_receipt;
BEGIN
  IF session_user<>'refs_grant_sync' THEN RAISE EXCEPTION 'Grant sync identity denied' USING ERRCODE='42501'; END IF;
  IF p_expected_version<>2 OR length(btrim(coalesce(p_actor,'')))=0 OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$' THEN RAISE EXCEPTION 'Stage 1 WBS operator upgrade request is invalid' USING ERRCODE='22023'; END IF;
  IF p_request_hash<>refs_grant_request_hash(p_tenant,p_actor,p_entity,desired,p_expected_version) THEN RAISE EXCEPTION 'Grant request hash is not canonical' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_actor||':'||p_entity::text,0));
  SELECT * INTO receipt FROM runtime_grant_sync_receipt WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Grant idempotency key reused with different request' USING ERRCODE='23505'; END IF;
    IF receipt.completed_at IS NOT NULL THEN
      PERFORM 1 FROM runtime_actor_grant_set WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity AND version=3 FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Completed operator upgrade no longer matches current grant version' USING ERRCODE='40001'; END IF;
      SELECT coalesce(array_agg(permission ORDER BY permission),'{}'::text[]) INTO prior FROM runtime_actor_grant WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity AND revoked_at IS NULL;
      IF prior<>desired THEN RAISE EXCEPTION 'Completed operator upgrade no longer matches current grants' USING ERRCODE='42501'; END IF;
      RETURN receipt.response_body||jsonb_build_object('idempotent',true);
    END IF;
  END IF;
  PERFORM 1 FROM runtime_actor_grant_set WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity AND version=p_expected_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stage 1 WBS operator upgrade requires the exact reader grant at version 2' USING ERRCODE='40001'; END IF;
  SELECT coalesce(array_agg(permission ORDER BY permission),'{}'::text[]) INTO prior FROM runtime_actor_grant
    WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity AND revoked_at IS NULL;
  IF prior<>expected_prior THEN RAISE EXCEPTION 'Stage 1 WBS operator upgrade requires exactly the six evidence-read permissions' USING ERRCODE='42501'; END IF;
  RETURN refs_reconcile_actor_grants(p_tenant,p_actor,p_entity,desired,p_expected_version,p_idempotency_key,p_request_hash);
END $$;

REVOKE ALL ON FUNCTION refs_upgrade_stage1_wbs_operator_attest(uuid,text,uuid,text,text,bigint) FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer;
GRANT EXECUTE ON FUNCTION refs_upgrade_stage1_wbs_operator_attest(uuid,text,uuid,text,text,bigint) TO refs_grant_sync;

COMMIT;
