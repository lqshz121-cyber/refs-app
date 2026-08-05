BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES ('AP.PAYMENT.CREATE','AP','HIGH','AP_PAYMENT_MAKER')
ON CONFLICT (permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

CREATE OR REPLACE FUNCTION refs_ap_payment_hash(
  p_tenant uuid,p_entity uuid,p_bill uuid,p_period uuid,p_payment_number text,p_payment_date date,
  p_cash_account_code text,p_bank_member_ref text,p_amount numeric,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'business_document_id',p_bill,'period_id',p_period,
    'payment_number',btrim(p_payment_number),'payment_date',p_payment_date,'cash_account_code',btrim(p_cash_account_code),
    'bank_member_ref',NULLIF(btrim(p_bank_member_ref),''),'amount',p_amount,'reason',p_reason
  ))
$$;

CREATE OR REPLACE FUNCTION refs_create_ap_payment(
  p_tenant uuid,p_entity uuid,p_bill uuid,p_period uuid,p_payment_number text,p_payment_date date,
  p_cash_account_code text,p_bank_member_ref text,p_amount numeric,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; computed_hash text;
DECLARE bill business_document; period_row accounting_period; journal_id uuid:=gen_random_uuid(); occurrence_id uuid:=gen_random_uuid(); allocation_id uuid:=gen_random_uuid();
DECLARE reserved numeric(20,4); response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.PAYMENT.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_ap_payment_hash(p_tenant,p_entity,p_bill,p_period,p_payment_number,p_payment_date,p_cash_account_code,p_bank_member_ref,p_amount,p_reason);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'AP payment request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF COALESCE(length(btrim(p_payment_number)),0)=0 OR COALESCE(length(btrim(p_cash_account_code)),0)=0 OR p_amount<=0 OR COALESCE(length(btrim(p_reason)),0)<8 THEN
    RAISE EXCEPTION 'AP payment requires number, cash account, positive amount and reason' USING ERRCODE='22023';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AP_PAYMENT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='AP_PAYMENT:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR UPDATE;
  IF NOT FOUND OR period_row.status<>'OPEN' OR p_payment_date NOT BETWEEN period_row.starts_on AND period_row.ends_on THEN
    RAISE EXCEPTION 'AP payment period must be OPEN and own the payment date' USING ERRCODE='55000';
  END IF;
  SELECT * INTO bill FROM business_document
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_bill FOR UPDATE;
  IF NOT FOUND OR bill.document_kind<>'AP_BILL' OR bill.status NOT IN ('APPROVED','OPEN','PARTIALLY_PAID') OR bill.open_balance<=0 THEN
    RAISE EXCEPTION 'AP payment requires an open AP bill' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM business_allocation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_bill AND status IN ('PENDING','ACTIVE')
    ORDER BY business_allocation_id FOR UPDATE;
  SELECT COALESCE(sum(amount),0) INTO reserved FROM business_allocation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_bill AND status IN ('PENDING','ACTIVE');
  IF p_amount>bill.open_balance-reserved THEN RAISE EXCEPTION 'AP payment exceeds available bill open balance' USING ERRCODE='23514'; END IF;

  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
    VALUES(journal_id,p_tenant,p_entity,p_period,btrim(p_payment_number),'AUTO','DRAFT',p_payment_date,bill.currency,'AP payment '||btrim(p_payment_number),actor);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    VALUES(p_tenant,p_entity,p_period,journal_id,1,'291001',p_amount,0,bill.counterparty_ref,'AP payment '||bill.document_number,'{}'::jsonb),
          (p_tenant,p_entity,p_period,journal_id,2,btrim(p_cash_account_code),0,p_amount,NULLIF(btrim(p_bank_member_ref),''),'AP payment '||bill.document_number,'{}'::jsonb);
  INSERT INTO payment_occurrence(payment_occurrence_id,tenant_id,entity_id,business_document_id,occurrence_kind,amount,currency,accounting_date,period_id,status,draft_journal_entry_id,idempotency_key,request_hash,created_by)
    VALUES(occurrence_id,p_tenant,p_entity,p_bill,'AP_PAYMENT',p_amount,bill.currency,p_payment_date,p_period,'DRAFT',journal_id,p_idempotency_key,p_request_hash,actor);
  INSERT INTO business_allocation(business_allocation_id,tenant_id,entity_id,business_document_id,payment_occurrence_id,amount,currency,status,created_by)
    VALUES(allocation_id,p_tenant,p_entity,p_bill,occurrence_id,p_amount,bill.currency,'PENDING',actor);
  response:=jsonb_build_object('payment_occurrence_id',occurrence_id,'business_allocation_id',allocation_id,'business_document_id',p_bill,'journal_entry_id',journal_id,'status','DRAFT','allocation_status','PENDING','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(p_tenant,p_entity,'AP_PAYMENT_DRAFT_CREATED','PAYMENT_OCCURRENCE',occurrence_id,'CREATE_AP_PAYMENT',actor,'USER','AP.PAYMENT.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,p_reason);
  event_payload:=jsonb_build_object('payment_occurrence_id',occurrence_id,'business_allocation_id',allocation_id,'business_document_id',p_bill,'journal_entry_id',journal_id,'status','DRAFT');
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'PAYMENT_OCCURRENCE',occurrence_id,'AP_PAYMENT_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='AP_PAYMENT:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

REVOKE EXECUTE ON FUNCTION refs_ap_payment_hash(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_create_ap_payment(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ap_payment_hash(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_ap_payment(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text,text,text) TO refs_app;

COMMIT;
