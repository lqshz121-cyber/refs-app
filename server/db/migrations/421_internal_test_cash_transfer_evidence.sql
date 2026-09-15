BEGIN;

-- A fixed, content-addressed receipt is retained solely for the isolated
-- internal-test tenant/entity. It creates no object, accepts no browser input,
-- and keeps the normal attachment immutability, audit, outbox and evidence
-- graph controls intact.
CREATE OR REPLACE FUNCTION refs_ensure_internal_test_cash_transfer_evidence(
  p_tenant uuid,p_entity uuid,p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  actor text:=refs_current_actor();
  receipt idempotency_receipt;
  attachment_uuid uuid:= '42100000-0000-4000-8000-000000000001'::uuid;
  content_sha text:= 'sha256:60b071bfd60e6e06a014a29f2fe5ce7fa57387254cc77e50b8cf931a135b7888';
  expected text;
  response jsonb;
  audit_id uuid:=gen_random_uuid();
  existing attachment;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.CREATE');
  IF actor IS NULL OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    RAISE EXCEPTION 'Internal test cash-transfer evidence requires a configured maker and idempotency key' USING ERRCODE='22023';
  END IF;
  expected:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'attachment_id',attachment_uuid,'content_hash',content_sha,'classification','INTERNAL_TEST_ONLY_CASH_TRANSFER_EVIDENCE_V1'));
  PERFORM pg_advisory_xact_lock(hashtextextended('refs-internal-test-cash-evidence:'||p_tenant::text||':'||p_entity::text,0));
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'INTERNAL_TEST_CASH_TRANSFER_EVIDENCE:'||p_entity,p_idempotency_key,expected,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='INTERNAL_TEST_CASH_TRANSFER_EVIDENCE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash IS DISTINCT FROM expected OR receipt.actor_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Internal test cash-transfer evidence idempotency conflict' USING ERRCODE='23505';
  END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO existing FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=attachment_uuid FOR SHARE;
  IF FOUND AND (existing.name<>'internal-test-cash-transfer-receipt.txt' OR existing.media_type<>'text/csv' OR existing.size_bytes<>64 OR existing.content_hash<>content_sha OR existing.finalization_status<>'VERIFIED_CLEAN' OR existing.scan_status<>'CLEAN') THEN
    RAISE EXCEPTION 'Internal test cash-transfer evidence conflicts with retained evidence' USING ERRCODE='23514';
  END IF;
  IF NOT FOUND THEN
    PERFORM set_config('refs.attachment_finalize','authorized',true);
    INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,reserved_at,upload_expires_at,verified_at,scan_status,finalization_status,finalized_at)
      VALUES(attachment_uuid,p_tenant,p_entity,'internal-test-cash-transfer-receipt.txt','text/csv',64,content_sha,'object://internal-test/cash-transfer-receipt-v1','internal-test-evidence-v1',actor,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '15 minutes',clock_timestamp(),'CLEAN','VERIFIED_CLEAN',clock_timestamp());
    PERFORM set_config('refs.attachment_finalize','',true);
  END IF;
  response:=jsonb_build_object('schema_version','INTERNAL_TEST_CASH_TRANSFER_EVIDENCE_V1','attachment_id',attachment_uuid,'name','internal-test-cash-transfer-receipt.txt','media_type','text/csv','status','VERIFIED_CLEAN','classification','INTERNAL_TEST_ONLY','idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,audit_event_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,audit_id,'INTERNAL_TEST_CASH_TRANSFER_EVIDENCE_READY','ATTACHMENT',attachment_uuid,'ENSURE',actor,'SERVICE_ACCOUNT','CASH.TRANSFER.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,expected,response);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'ATTACHMENT',attachment_uuid,'INTERNAL_TEST_CASH_TRANSFER_EVIDENCE_READY',response,refs_jsonb_hash(response));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN response;
END;
$$;
REVOKE ALL ON FUNCTION refs_ensure_internal_test_cash_transfer_evidence(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ensure_internal_test_cash_transfer_evidence(uuid,uuid,text) TO refs_app;

COMMIT;
