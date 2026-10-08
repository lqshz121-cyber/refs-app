BEGIN;
CREATE TABLE wbs_test_payable_original_sign_evidence (
  tenant_id uuid NOT NULL, entity_id uuid NOT NULL, source_receipt_id uuid NOT NULL,
  receipt_hash text NOT NULL CHECK(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  original_amount numeric(20,4) NOT NULL CHECK(original_amount>0),
  source_facts jsonb NOT NULL CHECK(jsonb_typeof(source_facts)='object'),
  source_fact_hash text NOT NULL CHECK(source_fact_hash~'^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,entity_id,source_receipt_id),
  FOREIGN KEY(tenant_id,entity_id,source_receipt_id) REFERENCES wbs_test_payable_source_receipt(tenant_id,entity_id,wbs_test_payable_source_receipt_id)
);
ALTER TABLE wbs_test_payable_original_sign_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_test_payable_original_sign_scope ON wbs_test_payable_original_sign_evidence
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_test_payable_original_sign_append_only BEFORE UPDATE OR DELETE ON wbs_test_payable_original_sign_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

ALTER FUNCTION refs_retain_wbs_test_payable_source(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  RENAME TO refs_retain_wbs_test_payable_source_455;
CREATE FUNCTION refs_retain_wbs_test_payable_source(
  p_tenant uuid,p_entity uuid,p_period uuid,p_observation jsonb,p_row jsonb,p_row_index integer,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE retained jsonb; receipt wbs_test_payable_source_receipt; facts jsonb; fact_hash text; saved wbs_test_payable_original_sign_evidence; inserted integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  retained:=refs_retain_wbs_test_payable_source_455(p_tenant,p_entity,p_period,p_observation,p_row,p_row_index,p_idempotency_key,p_request_hash);
  SELECT * INTO receipt FROM wbs_test_payable_source_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND wbs_test_payable_source_receipt_id=(retained->>'wbs_test_payable_source_receipt_id')::uuid FOR SHARE;
  IF NOT FOUND OR receipt.receipt_hash IS DISTINCT FROM retained->>'receipt_hash'
    OR receipt.source_record_hash IS DISTINCT FROM p_row->>'source_record_hash'
    OR receipt.observation_hash IS DISTINCT FROM p_observation->>'observation_hash'
    OR receipt.provider_content_sha256 IS DISTINCT FROM p_observation->>'provider_content_sha256'
    OR receipt.amount IS DISTINCT FROM (p_row->>'amount')::numeric OR receipt.period_id<>p_period THEN
    RAISE EXCEPTION 'Original Payable facts differ from exact retained receipt' USING ERRCODE='23505';
  END IF;
  facts:=jsonb_build_object('schema_version','WBS_TEST_PAYABLE_ORIGINAL_SIGN_V1','tenant_id',p_tenant,'entity_id',p_entity,
    'source_receipt_id',receipt.wbs_test_payable_source_receipt_id,'receipt_hash',receipt.receipt_hash,'period_id',p_period,
    'observation_hash',receipt.observation_hash,'provider_content_sha256',receipt.provider_content_sha256,'row',p_row,
    'test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY');
  fact_hash:=refs_jsonb_hash(facts);
  INSERT INTO wbs_test_payable_original_sign_evidence(tenant_id,entity_id,source_receipt_id,receipt_hash,original_amount,source_facts,source_fact_hash,created_by)
    VALUES(p_tenant,p_entity,receipt.wbs_test_payable_source_receipt_id,receipt.receipt_hash,(p_row->>'amount')::numeric,facts,fact_hash,refs_current_actor()) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  SELECT * INTO saved FROM wbs_test_payable_original_sign_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_receipt_id=receipt.wbs_test_payable_source_receipt_id;
  IF saved.source_fact_hash IS DISTINCT FROM fact_hash THEN RAISE EXCEPTION 'Immutable original sign evidence conflict' USING ERRCODE='23505'; END IF;
  IF inserted=1 THEN
    INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
      VALUES(p_tenant,p_entity,'WBS_TEST_PAYABLE_ORIGINAL_SIGN_RETAINED','WBS_TEST_PAYABLE_SOURCE_RECEIPT',receipt.wbs_test_payable_source_receipt_id,'RETAIN_SIGN',refs_current_actor(),'SERVICE_ACCOUNT','WBS.TEST.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,fact_hash,'Exact unsigned TEST_ONLY original amount retained; not formal admission',facts);
    INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
      VALUES(p_tenant,p_entity,'WBS_TEST_PAYABLE_SOURCE_RECEIPT',receipt.wbs_test_payable_source_receipt_id,'WBS_TEST_PAYABLE_ORIGINAL_SIGN_RETAINED',facts,fact_hash);
  END IF;
  RETURN retained;
END;
$$;

ALTER FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,text,text,text) RENAME TO refs_create_wbs_test_payable_draft_455;
CREATE FUNCTION refs_create_wbs_test_payable_draft(p_tenant uuid,p_entity uuid,p_source_receipt uuid,p_expected_receipt_hash text,p_idempotency_key text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.BILL.CREATE');
  PERFORM 1 FROM wbs_test_payable_original_sign_evidence f JOIN wbs_test_payable_source_receipt r
    ON r.tenant_id=f.tenant_id AND r.entity_id=f.entity_id AND r.wbs_test_payable_source_receipt_id=f.source_receipt_id
    WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND f.source_receipt_id=p_source_receipt
      AND f.receipt_hash=p_expected_receipt_hash AND r.receipt_hash=f.receipt_hash AND f.original_amount=r.amount
      AND f.original_amount>0 AND f.source_fact_hash=refs_jsonb_hash(f.source_facts) FOR SHARE OF f,r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exact original Payable sign evidence required before Draft; legacy amounts cannot be inferred' USING ERRCODE='55000'; END IF;
  RETURN refs_create_wbs_test_payable_draft_455(p_tenant,p_entity,p_source_receipt,p_expected_receipt_hash,p_idempotency_key,p_request_hash);
END;
$$;
REVOKE ALL ON FUNCTION refs_retain_wbs_test_payable_source_455(uuid,uuid,uuid,jsonb,jsonb,integer,text,text),refs_create_wbs_test_payable_draft_455(uuid,uuid,uuid,text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_retain_wbs_test_payable_source(uuid,uuid,uuid,jsonb,jsonb,integer,text,text),refs_create_wbs_test_payable_draft(uuid,uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_test_payable_source(uuid,uuid,uuid,jsonb,jsonb,integer,text,text),refs_create_wbs_test_payable_draft(uuid,uuid,uuid,text,text,text) TO refs_app;
COMMIT;
