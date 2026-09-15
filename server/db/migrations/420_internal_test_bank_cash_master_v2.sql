BEGIN;

-- The internal test workspace needs two visibly test-only cash legs and a
-- historical source leg for the fixed test period.  This migration changes
-- neither WBS data nor any non-test master data.
CREATE OR REPLACE FUNCTION refs_ensure_internal_test_bank_cash_master(
  p_tenant uuid,p_entity uuid,p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; expected text; response jsonb; audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.CONFIGURE');
  IF actor IS NULL OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$' THEN RAISE EXCEPTION 'Internal test bank/cash master requires an authenticated configured maker and idempotency key' USING ERRCODE='22023'; END IF;
  expected:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'masters',jsonb_build_array(jsonb_build_object('bank_member_ref','INTERNAL_TEST_BANK','cash_account_code','111990','currency','USD','effective_from','2026-01-01','effective_to','2026-09-14'),jsonb_build_object('bank_member_ref','INTERNAL_TEST_BANK_DESTINATION','cash_account_code','111991','currency','USD','effective_from','2026-01-01','effective_to',null)),'classification','INTERNAL_TEST_ONLY_V2'));
  PERFORM pg_advisory_xact_lock(hashtextextended('refs-internal-test-bank-cash-v2:'||p_tenant::text||':'||p_entity::text,0));
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'INTERNAL_TEST_BANK_CASH_MASTER_V2:'||p_entity,p_idempotency_key,expected,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='INTERNAL_TEST_BANK_CASH_MASTER_V2:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash IS DISTINCT FROM expected OR receipt.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Internal test bank/cash master idempotency conflict' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name,active) VALUES (p_tenant,p_entity,'INTERNAL_TEST_BANK','BANK','INTERNAL TEST ONLY Bank',true),(p_tenant,p_entity,'INTERNAL_TEST_BANK_DESTINATION','BANK','INTERNAL TEST ONLY Destination Bank',true) ON CONFLICT DO NOTHING;
  INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type,active) VALUES (p_tenant,p_entity,'111990','INTERNAL TEST ONLY Bank Cash',true,'BANK',true),(p_tenant,p_entity,'111991','INTERNAL TEST ONLY Destination Bank Cash',true,'BANK',true) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref='INTERNAL_TEST_BANK' AND member_type='BANK' AND display_name='INTERNAL TEST ONLY Bank' AND active FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Internal test source bank master conflicts with existing company data' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref='INTERNAL_TEST_BANK_DESTINATION' AND member_type='BANK' AND display_name='INTERNAL TEST ONLY Destination Bank' AND active FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Internal test destination bank master conflicts with existing company data' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='111990' AND account_name='INTERNAL TEST ONLY Bank Cash' AND requires_member AND required_member_type='BANK' AND active FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Internal test source cash master conflicts with existing company data' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='111991' AND account_name='INTERNAL TEST ONLY Destination Bank Cash' AND requires_member AND required_member_type='BANK' AND active FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Internal test destination cash master conflicts with existing company data' USING ERRCODE='23514'; END IF;
  response:=jsonb_build_object('schema_version','INTERNAL_TEST_BANK_CASH_MASTER_V2','bank_member_refs',jsonb_build_array('INTERNAL_TEST_BANK','INTERNAL_TEST_BANK_DESTINATION'),'cash_account_codes',jsonb_build_array('111990','111991'),'currency','USD','classification','INTERNAL_TEST_ONLY','idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,audit_event_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_entity,audit_id,'INTERNAL_TEST_BANK_CASH_MASTER_V2_READY','INTERNAL_TEST_BANK_CASH_MASTER',audit_id,'ENSURE',actor,'USER','CASH.TRANSFER.CONFIGURE',p_idempotency_key,p_idempotency_key,p_idempotency_key,expected,response);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'INTERNAL_TEST_BANK_CASH_MASTER',audit_id,'INTERNAL_TEST_BANK_CASH_MASTER_V2_READY',response,refs_jsonb_hash(response));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN response;
END;
$$;
REVOKE ALL ON FUNCTION refs_ensure_internal_test_bank_cash_master(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ensure_internal_test_bank_cash_master(uuid,uuid,text) TO refs_app;

COMMIT;
