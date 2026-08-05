BEGIN;

CREATE OR REPLACE FUNCTION refs_ar_receipt_reversal_hash(
  p_tenant uuid,p_entity uuid,p_source_occurrence uuid,p_period uuid,p_journal_number text,p_journal_date date,p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'source_occurrence_id',p_source_occurrence,'period_id',p_period,'journal_number',btrim(p_journal_number),'journal_date',p_journal_date,'reason',btrim(p_reason)))
$$;

CREATE OR REPLACE FUNCTION refs_create_ar_receipt_reversal(
  p_tenant uuid,p_entity uuid,p_source_occurrence uuid,p_period uuid,p_journal_number text,p_journal_date date,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); occ payment_occurrence; source_je journal_entry; journal_id uuid:=gen_random_uuid(); adjustment_id uuid:=gen_random_uuid(); computed_hash text; receipt idempotency_receipt; response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AR.RECEIPT.REVERSE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_ar_receipt_reversal_hash(p_tenant,p_entity,p_source_occurrence,p_period,p_journal_number,p_journal_date,p_reason);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'AR receipt reversal request hash is not canonical' USING ERRCODE='22023'; END IF;
  receipt:=refs_reserve_idempotency(p_tenant,'AR_RECEIPT_REVERSAL:'||p_entity,p_idempotency_key,p_request_hash,actor);
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  IF length(btrim(p_journal_number))=0 OR COALESCE(length(btrim(p_reason)),0)<8 THEN RAISE EXCEPTION 'AR receipt reversal requires number and reason' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN' AND p_journal_date BETWEEN starts_on AND ends_on FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reversal date must belong to selected OPEN period' USING ERRCODE='55000'; END IF;
  SELECT * INTO occ FROM payment_occurrence WHERE tenant_id=p_tenant AND entity_id=p_entity AND payment_occurrence_id=p_source_occurrence FOR UPDATE;
  IF NOT FOUND OR occ.occurrence_kind<>'AR_RECEIPT' OR occ.status<>'POSTED' OR occ.posted_journal_entry_id IS NULL THEN RAISE EXCEPTION 'Only a Posted AR receipt may be reversed' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM business_adjustment WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_occurrence_id=p_source_occurrence AND adjustment_kind='AR_RECEIPT_REVERSAL' AND status<>'REJECTED') THEN RAISE EXCEPTION 'AR receipt already has a reversal' USING ERRCODE='23505'; END IF;
  SELECT * INTO source_je FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=occ.posted_journal_entry_id FOR SHARE;
  IF NOT FOUND OR source_je.status<>'POSTED' THEN RAISE EXCEPTION 'Posted receipt journal is missing' USING ERRCODE='55000'; END IF;
  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by,reversal_of_id)
    VALUES(journal_id,p_tenant,p_entity,p_period,btrim(p_journal_number),'REVERSAL','DRAFT',p_journal_date,source_je.currency,'AR receipt reversal',actor,source_je.journal_entry_id);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    SELECT p_tenant,p_entity,p_period,journal_id,line_no,account_code,credit_amount,debit_amount,member_ref,description,dimensions FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=source_je.journal_entry_id ORDER BY line_no;
  INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,source_occurrence_id,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,original_journal_entry_id,idempotency_key,request_hash,created_by)
    VALUES(adjustment_id,p_tenant,p_entity,'AR_RECEIPT_REVERSAL',p_source_occurrence,occ.amount,occ.currency,p_journal_date,p_period,btrim(p_reason),'DRAFT',journal_id,source_je.journal_entry_id,p_idempotency_key,p_request_hash,actor);
  response:=jsonb_build_object('business_adjustment_id',adjustment_id,'source_occurrence_id',p_source_occurrence,'journal_entry_id',journal_id,'status','DRAFT','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(p_tenant,p_entity,'AR_RECEIPT_REVERSAL_DRAFT_CREATED','BUSINESS_ADJUSTMENT',adjustment_id,'CREATE_AR_RECEIPT_REVERSAL',actor,'USER','AR.RECEIPT.REVERSE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,btrim(p_reason));
  event_payload:=jsonb_build_object('business_adjustment_id',adjustment_id,'source_occurrence_id',p_source_occurrence,'journal_entry_id',journal_id,'status','DRAFT');
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'BUSINESS_ADJUSTMENT',adjustment_id,'AR_RECEIPT_REVERSAL_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='AR_RECEIPT_REVERSAL:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

REVOKE EXECUTE ON FUNCTION refs_ar_receipt_reversal_hash(uuid,uuid,uuid,uuid,text,date,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_create_ar_receipt_reversal(uuid,uuid,uuid,uuid,text,date,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ar_receipt_reversal_hash(uuid,uuid,uuid,uuid,text,date,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_ar_receipt_reversal(uuid,uuid,uuid,uuid,text,date,text,text,text) TO refs_app;

COMMIT;
