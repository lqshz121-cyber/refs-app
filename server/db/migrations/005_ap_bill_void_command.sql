BEGIN;

CREATE OR REPLACE FUNCTION refs_ap_bill_void_hash(
  p_tenant uuid,p_entity uuid,p_bill uuid,p_period uuid,p_journal_number text,p_journal_date date,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,
    'entity_id',p_entity,
    'business_document_id',p_bill,
    'period_id',p_period,
    'journal_number',btrim(p_journal_number),
    'journal_date',p_journal_date,
    'reason',p_reason
  ))
$$;

CREATE OR REPLACE FUNCTION refs_create_ap_bill_void(
  p_tenant uuid,p_entity uuid,p_bill uuid,p_period uuid,p_journal_number text,p_journal_date date,
  p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; computed_hash text;
DECLARE bill business_document; period_row accounting_period; original journal_entry;
DECLARE journal_id uuid:=gen_random_uuid(); adjustment_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.BILL.VOID.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_ap_bill_void_hash(p_tenant,p_entity,p_bill,p_period,p_journal_number,p_journal_date,p_reason);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'AP bill void request hash is not canonical' USING ERRCODE='22023'; END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AP_BILL_VOID:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='AP_BILL_VOID:'||p_entity AND idempotency_key=p_idempotency_key
    FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO period_row FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR UPDATE;
  IF NOT FOUND OR period_row.status<>'OPEN' OR p_journal_date NOT BETWEEN period_row.starts_on AND period_row.ends_on THEN
    RAISE EXCEPTION 'AP bill void period must be OPEN and own the journal date' USING ERRCODE='55000';
  END IF;

  SELECT * INTO bill FROM business_document
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_bill FOR UPDATE;
  IF NOT FOUND OR bill.document_kind<>'AP_BILL' OR bill.status<>'APPROVED' OR bill.open_balance<>bill.gross_amount OR bill.source_document_id IS NULL OR bill.posted_journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Only fully-open posted AP bills with source trace can be voided' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM business_allocation WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_bill AND status='ACTIVE') THEN
    RAISE EXCEPTION 'AP bill void is blocked after active allocations' USING ERRCODE='23514';
  END IF;

  SELECT * INTO original FROM journal_entry
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=bill.posted_journal_entry_id FOR SHARE;
  IF NOT FOUND OR original.status<>'POSTED' THEN RAISE EXCEPTION 'AP bill original JE must be POSTED' USING ERRCODE='23514'; END IF;

  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
    VALUES(journal_id,p_tenant,p_entity,p_period,btrim(p_journal_number),'AUTO','DRAFT',p_journal_date,bill.currency,'Void AP bill '||bill.document_number,actor);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    SELECT p_tenant,p_entity,p_period,journal_id,line_no,account_code,credit_amount,debit_amount,member_ref,'Void AP bill '||bill.document_number,dimensions
      FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=original.journal_entry_id ORDER BY line_no;
  IF NOT EXISTS (SELECT 1 FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=journal_id)
     OR (SELECT COALESCE(sum(debit_amount),0)<>COALESCE(sum(credit_amount),0) FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=journal_id) THEN
    RAISE EXCEPTION 'AP bill void Draft JE must be balanced and non-empty' USING ERRCODE='23514';
  END IF;

  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by)
    VALUES(p_tenant,p_entity,'SOURCE_TO_JE',bill.source_document_id,journal_id,actor);
  INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,business_document_id,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,original_journal_entry_id,idempotency_key,request_hash,created_by)
    VALUES(adjustment_id,p_tenant,p_entity,'AP_BILL_VOID',p_bill,bill.gross_amount,bill.currency,p_journal_date,p_period,p_reason,'DRAFT',journal_id,original.journal_entry_id,p_idempotency_key,p_request_hash,actor);

  response:=jsonb_build_object('business_adjustment_id',adjustment_id,'business_document_id',p_bill,'journal_entry_id',journal_id,'status','DRAFT','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(p_tenant,p_entity,'AP_BILL_VOID_DRAFT_CREATED','BUSINESS_ADJUSTMENT',adjustment_id,'CREATE_AP_BILL_VOID',actor,'USER','AP.BILL.VOID.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,p_reason);
  event_payload:=jsonb_build_object('business_adjustment_id',adjustment_id,'business_document_id',p_bill,'journal_entry_id',journal_id,'status','DRAFT');
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'BUSINESS_ADJUSTMENT',adjustment_id,'AP_BILL_VOID_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='AP_BILL_VOID:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

REVOKE EXECUTE ON FUNCTION refs_ap_bill_void_hash(uuid,uuid,uuid,uuid,text,date,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_create_ap_bill_void(uuid,uuid,uuid,uuid,text,date,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ap_bill_void_hash(uuid,uuid,uuid,uuid,text,date,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_ap_bill_void(uuid,uuid,uuid,uuid,text,date,text,text,text) TO refs_app;

COMMIT;
