BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM wbs_h1_payable_reclass_draft_evidence) THEN
    RAISE EXCEPTION 'Refusing to drop retained WBS H1 Payable reclassification Draft evidence' USING ERRCODE='55000';
  END IF;
END $$;
DROP FUNCTION refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text);
DROP FUNCTION refs_create_wbs_h1_payable_reclass_draft_hash(uuid,uuid,uuid,text,text,text);
DROP TABLE wbs_h1_payable_reclass_draft_evidence;
UPDATE permission_catalog SET active=false,effective_to=clock_timestamp(),version=version+1
  WHERE permission_code='WBS.H1.PAYABLE.DRAFT';
CREATE OR REPLACE FUNCTION refs_reserve_idempotency(p_tenant uuid,p_scope text,p_key text,p_request_hash text,p_actor text) RETURNS idempotency_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt idempotency_receipt;
BEGIN
  IF refs_current_tenant() IS DISTINCT FROM p_tenant THEN RAISE EXCEPTION 'Idempotency tenant scope denied' USING ERRCODE='42501'; END IF;
  IF refs_current_actor() IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Actor must come from the authenticated session' USING ERRCODE='42501'; END IF;
  IF p_scope NOT LIKE 'POST_JOURNAL:%' AND p_scope NOT LIKE 'EDIT_JOURNAL:%' AND p_scope NOT LIKE 'CLOSE_PERIOD:%' AND p_scope NOT LIKE 'RETIRE_CONFIG:%' AND p_scope NOT LIKE 'CREATE_MANUAL_JOURNAL:%' AND p_scope NOT LIKE 'CREATE_AUTO_JOURNAL:%' AND p_scope NOT LIKE 'CREATE_REVERSAL:%' AND p_scope NOT LIKE 'CREATE_RECLASS:%' AND p_scope NOT LIKE 'JOURNAL_SUBMIT:%' AND p_scope NOT LIKE 'JOURNAL_REVIEW:%' AND p_scope NOT LIKE 'JOURNAL_APPROVE:%' AND p_scope NOT LIKE 'JOURNAL_REJECT:%' AND p_scope NOT LIKE 'AR_RECEIPT_REVERSAL:%' AND p_scope NOT LIKE 'AP_PAYMENT_REVERSAL:%' AND p_scope NOT LIKE 'PREPARE_STATEMENT_SNAPSHOT:%' AND p_scope NOT LIKE 'APPROVE_STATEMENT_SNAPSHOT:%' THEN RAISE EXCEPTION 'Idempotency operation scope denied' USING ERRCODE='42501'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,p_scope,p_key,p_request_hash,'IN_PROGRESS',p_actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=p_scope AND idempotency_key=p_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  RETURN receipt;
END $$;
COMMIT;
