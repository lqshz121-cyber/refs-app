BEGIN;

CREATE FUNCTION refs_create_native_settlement(
  p_tenant uuid,p_entity uuid,p_kind text,p_document uuid,p_period uuid,
  p_number text,p_date date,p_cash_account text,p_bank_member text,p_amount numeric,
  p_reason text,p_attachment_ids uuid[],p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();permission text;request_hash text;receipt idempotency_receipt;
DECLARE document_row business_document;period_row accounting_period;reserved numeric;
DECLARE journal_id uuid:=gen_random_uuid();occurrence_id uuid:=gen_random_uuid();allocation_id uuid:=gen_random_uuid();response jsonb;event_payload jsonb;
BEGIN
  permission:=CASE p_kind WHEN 'AP_PAYMENT' THEN 'AP.PAYMENT.CREATE' WHEN 'AR_RECEIPT' THEN 'AR.RECEIPT.CREATE' END;
  IF permission IS NULL THEN RAISE EXCEPTION 'Unsupported native settlement kind' USING ERRCODE='22023'; END IF;
  PERFORM refs_assert_scope(p_tenant,p_entity,permission);
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_number IS NULL OR length(p_number) NOT BETWEEN 1 AND 128 OR p_number<>btrim(p_number) OR p_number~'[[:cntrl:]]'
     OR p_date IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount>=10000000000000000 OR p_amount<>round(p_amount,4)
     OR p_cash_account IS NULL OR p_cash_account<>btrim(p_cash_account) OR length(p_cash_account) NOT BETWEEN 1 AND 64
     OR p_bank_member IS NULL OR p_bank_member<>btrim(p_bank_member) OR length(p_bank_member) NOT BETWEEN 1 AND 128
     OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 8 AND 2000 OR p_reason<>btrim(p_reason) OR p_reason~'[[:cntrl:]]'
     OR p_idempotency_key IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._:-]{8,128}$'
     OR COALESCE(cardinality(p_attachment_ids),0) NOT BETWEEN 1 AND 25
     OR cardinality(p_attachment_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_attachment_ids) id) THEN
    RAISE EXCEPTION 'Native settlement requires valid number, date, exact positive amount, bank, reason and unique attachment evidence' USING ERRCODE='22023';
  END IF;
  request_hash:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'actor_id',actor,
    'settlement_kind',p_kind,'business_document_id',p_document,'period_id',p_period,'number',p_number,'date',p_date,
    'cash_account_code',p_cash_account,'bank_member_ref',p_bank_member,'amount',p_amount,'reason',p_reason,
    'attachment_ids',to_jsonb(ARRAY(SELECT id FROM unnest(p_attachment_ids) id ORDER BY id))));
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'NATIVE_'||p_kind||':'||p_entity,p_idempotency_key,request_hash,'IN_PROGRESS',actor)
    ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='NATIVE_'||p_kind||':'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Native settlement receipt belongs to another actor' USING ERRCODE='42501'; END IF;
  IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different native settlement' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR UPDATE;
  IF NOT FOUND OR period_row.status<>'OPEN' OR p_date NOT BETWEEN period_row.starts_on AND period_row.ends_on THEN
    RAISE EXCEPTION 'Native settlement date must belong to the selected OPEN payment period' USING ERRCODE='55000';
  END IF;
  SELECT * INTO document_row FROM business_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_document FOR UPDATE;
  IF NOT FOUND OR document_row.document_kind<>(CASE p_kind WHEN 'AP_PAYMENT' THEN 'AP_BILL' ELSE 'AR_INVOICE' END)
     OR document_row.open_balance<=0 OR NOT ((p_kind='AP_PAYMENT' AND document_row.status IN ('APPROVED','OPEN','PARTIALLY_PAID'))
       OR (p_kind='AR_RECEIPT' AND document_row.status IN ('OPEN','PARTIALLY_PAID')))
     OR NOT EXISTS(SELECT 1 FROM journal_entry j WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity
       AND j.journal_entry_id=document_row.posted_journal_entry_id AND j.status='POSTED') THEN
    RAISE EXCEPTION 'Native settlement requires an open posted source document in this company' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM business_allocation WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_document AND status='PENDING'
    ORDER BY business_allocation_id FOR UPDATE;
  SELECT COALESCE(sum(amount),0) INTO reserved FROM business_allocation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_document AND status='PENDING';
  IF p_amount>document_row.open_balance-reserved THEN RAISE EXCEPTION 'Native settlement exceeds available source balance' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=p_cash_account
    AND active AND requires_member AND required_member_type='BANK' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Native settlement requires an active BANK-controlled GL account' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=p_bank_member AND active AND member_type='BANK' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Native settlement requires an active scoped BANK member' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=ANY(p_attachment_ids) ORDER BY attachment_id FOR SHARE;
  IF cardinality(p_attachment_ids)<>(SELECT count(*) FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND attachment_id=ANY(p_attachment_ids) AND finalization_status='VERIFIED_CLEAN' AND scan_status='CLEAN') THEN
    RAISE EXCEPTION 'Native settlement requires verified clean company-scoped attachment evidence' USING ERRCODE='23503';
  END IF;

  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
    VALUES(journal_id,p_tenant,p_entity,p_period,p_number,'MANUAL','DRAFT',p_date,document_row.currency,p_reason,actor);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    VALUES(p_tenant,p_entity,p_period,journal_id,1,CASE p_kind WHEN 'AP_PAYMENT' THEN '291001' ELSE p_cash_account END,p_amount,0,
      CASE p_kind WHEN 'AP_PAYMENT' THEN document_row.counterparty_ref ELSE p_bank_member END,p_reason,'{}'::jsonb),
    (p_tenant,p_entity,p_period,journal_id,2,CASE p_kind WHEN 'AP_PAYMENT' THEN p_cash_account ELSE '120200' END,0,p_amount,
      CASE p_kind WHEN 'AP_PAYMENT' THEN p_bank_member ELSE document_row.counterparty_ref END,p_reason,'{}'::jsonb);
  INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by)
    SELECT p_tenant,p_entity,'JE_ATTACHMENT',journal_id,id,actor FROM unnest(p_attachment_ids) id;
  INSERT INTO payment_occurrence(payment_occurrence_id,tenant_id,entity_id,business_document_id,occurrence_kind,amount,currency,accounting_date,period_id,status,draft_journal_entry_id,idempotency_key,request_hash,created_by)
    VALUES(occurrence_id,p_tenant,p_entity,p_document,p_kind,p_amount,document_row.currency,p_date,p_period,'DRAFT',journal_id,p_idempotency_key,request_hash,actor);
  INSERT INTO business_allocation(business_allocation_id,tenant_id,entity_id,business_document_id,payment_occurrence_id,amount,currency,status,created_by)
    VALUES(allocation_id,p_tenant,p_entity,p_document,occurrence_id,p_amount,document_row.currency,'PENDING',actor);
  response:=jsonb_build_object('payment_occurrence_id',occurrence_id,'business_allocation_id',allocation_id,'business_document_id',p_document,
    'journal_entry_id',journal_id,'status','DRAFT','allocation_status','PENDING','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(p_tenant,p_entity,p_kind||'_DRAFT_CREATED','PAYMENT_OCCURRENCE',occurrence_id,'CREATE_NATIVE_'||p_kind,actor,'USER',permission,
      p_idempotency_key,p_idempotency_key,p_idempotency_key,request_hash,p_reason);
  event_payload:=jsonb_build_object('payment_occurrence_id',occurrence_id,'business_allocation_id',allocation_id,'business_document_id',p_document,'journal_entry_id',journal_id,'status','DRAFT');
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'PAYMENT_OCCURRENCE',occurrence_id,p_kind||'_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='NATIVE_'||p_kind||':'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION refs_create_native_settlement(uuid,uuid,text,uuid,uuid,text,date,text,text,numeric,text,uuid[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_native_settlement(uuid,uuid,text,uuid,uuid,text,date,text,text,numeric,text,uuid[],text) TO refs_app;

COMMIT;
