BEGIN;

CREATE FUNCTION refs_read_settlement_bank_account_pairs(
  p_tenant uuid,
  p_entity uuid,
  p_kind text,
  p_query text DEFAULT '',
  p_after_ref text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_period uuid DEFAULT NULL,
  p_date date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_rows jsonb;
  v_next text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('AP_PAYMENT','AR_RECEIPT') THEN
    RAISE EXCEPTION 'Unsupported settlement kind' USING ERRCODE='22023';
  END IF;
  PERFORM refs_assert_scope(p_tenant,p_entity,CASE p_kind WHEN 'AP_PAYMENT' THEN 'AP.PAYMENT.CREATE' ELSE 'AR.RECEIPT.CREATE' END);
  IF p_period IS NULL OR p_date IS NULL OR p_query IS NULL OR length(p_query)>128
     OR p_query<>btrim(p_query) OR p_query~'[[:cntrl:]]'
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR (p_after_ref IS NOT NULL AND (length(p_after_ref) NOT BETWEEN 1 AND 512 OR p_after_ref<>btrim(p_after_ref) OR p_after_ref~'[[:cntrl:]]')) THEN
    RAISE EXCEPTION 'Settlement bank-account pair page is invalid' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
      AND status='OPEN' AND p_date BETWEEN starts_on AND ends_on;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement bank-account pair requires the selected OPEN period and date' USING ERRCODE='55000';
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT
      encode(convert_to(jsonb_build_array(m.member_ref,a.account_code,c.currency)::text,'UTF8'),'base64') AS pair_ref,
      m.member_ref,m.member_type,m.display_name,a.account_code,a.account_name,c.currency
    FROM cash_transfer_bank_account_control c
    JOIN member_master m ON m.tenant_id=c.tenant_id AND m.entity_id=c.entity_id AND m.member_ref=c.bank_member_ref
    JOIN account_master a ON a.tenant_id=c.tenant_id AND a.entity_id=c.entity_id AND a.account_code=c.cash_account_code
    WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity
      AND c.mapping_family='CASH_TRANSFER_BANK_ACCOUNT' AND c.status='APPROVED'
      AND c.effective_from<=p_date AND (c.effective_to IS NULL OR c.effective_to>p_date)
      AND m.active AND m.member_type='BANK'
      AND a.active AND a.requires_member AND a.required_member_type='BANK'
      AND (p_after_ref IS NULL OR encode(convert_to(jsonb_build_array(m.member_ref,a.account_code,c.currency)::text,'UTF8'),'base64') COLLATE "C">p_after_ref COLLATE "C")
      AND (p_query='' OR strpos(lower(m.member_ref),lower(p_query))>0 OR strpos(lower(m.display_name),lower(p_query))>0
        OR strpos(lower(a.account_code),lower(p_query))>0 OR strpos(lower(a.account_name),lower(p_query))>0)
    ORDER BY pair_ref COLLATE "C"
    LIMIT p_limit+1
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY pair_ref COLLATE "C" LIMIT p_limit
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'pair_ref',pair_ref,'member_ref',member_ref,'member_type',member_type,'display_name',display_name,
      'cash_account_code',account_code,'cash_account_name',account_name,'currency',currency
    ) ORDER BY pair_ref COLLATE "C") FROM page),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM candidates)>p_limit
      THEN (SELECT pair_ref FROM page ORDER BY pair_ref COLLATE "C" DESC LIMIT 1)
    END
  INTO v_rows,v_next;
  RETURN jsonb_build_object(
    'schema_version','SETTLEMENT_BANK_ACCOUNT_PAIRS_V1','entity_id',p_entity,'settlement_kind',p_kind,
    'period_id',p_period,'settlement_date',p_date,'query',p_query,'after_ref',p_after_ref,'limit',p_limit,
    'rows',v_rows,'next_ref',v_next
  );
END;
$$;

CREATE OR REPLACE FUNCTION refs_create_native_settlement(
  p_tenant uuid,p_entity uuid,p_kind text,p_document uuid,p_period uuid,p_number text,p_date date,
  p_cash_account text,p_bank_member text,p_amount numeric,p_reason text,p_attachment_ids uuid[],p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  actor text:=refs_current_actor(); permission text; request_hash text; receipt idempotency_receipt;
  document_row business_document; period_row accounting_period; reserved numeric;
  journal_id uuid:=gen_random_uuid(); occurrence_id uuid:=gen_random_uuid(); allocation_id uuid:=gen_random_uuid();
  response jsonb; event_payload jsonb;
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
    RAISE EXCEPTION 'Native settlement requires valid number, date, exact positive amount, approved bank-account pair, reason and unique attachment evidence' USING ERRCODE='22023';
  END IF;
  request_hash:=refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'actor_id',actor,'settlement_kind',p_kind,
    'business_document_id',p_document,'period_id',p_period,'number',p_number,'date',p_date,
    'cash_account_code',p_cash_account,'bank_member_ref',p_bank_member,'amount',p_amount,'reason',p_reason,
    'attachment_ids',to_jsonb(ARRAY(SELECT id FROM unnest(p_attachment_ids) id ORDER BY id))
  ));
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'NATIVE_'||p_kind||':'||p_entity,p_idempotency_key,request_hash,'IN_PROGRESS',actor)
    ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='NATIVE_'||p_kind||':'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Native settlement receipt belongs to another actor' USING ERRCODE='42501'; END IF;
  IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different native settlement' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO period_row FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR UPDATE;
  IF NOT FOUND OR period_row.status<>'OPEN' OR p_date NOT BETWEEN period_row.starts_on AND period_row.ends_on THEN
    RAISE EXCEPTION 'Native settlement date must belong to the selected OPEN payment period' USING ERRCODE='55000';
  END IF;
  SELECT * INTO document_row FROM business_document
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_document FOR UPDATE;
  IF NOT FOUND OR document_row.document_kind<>(CASE p_kind WHEN 'AP_PAYMENT' THEN 'AP_BILL' ELSE 'AR_INVOICE' END)
     OR document_row.open_balance<=0
     OR NOT ((p_kind='AP_PAYMENT' AND document_row.status IN ('APPROVED','OPEN','PARTIALLY_PAID')) OR (p_kind='AR_RECEIPT' AND document_row.status IN ('OPEN','PARTIALLY_PAID')))
     OR NOT EXISTS(SELECT 1 FROM journal_entry j WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity AND j.journal_entry_id=document_row.posted_journal_entry_id AND j.status='POSTED') THEN
    RAISE EXCEPTION 'Native settlement requires an open posted source document in this company' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM business_allocation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_document AND status='PENDING'
    ORDER BY business_allocation_id FOR UPDATE;
  SELECT COALESCE(sum(amount),0) INTO reserved FROM business_allocation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_document AND status='PENDING';
  IF p_amount>document_row.open_balance-reserved THEN RAISE EXCEPTION 'Native settlement exceeds available source balance' USING ERRCODE='23514'; END IF;
  PERFORM 1
    FROM cash_transfer_bank_account_control c
    JOIN member_master m ON m.tenant_id=c.tenant_id AND m.entity_id=c.entity_id AND m.member_ref=c.bank_member_ref
    JOIN account_master a ON a.tenant_id=c.tenant_id AND a.entity_id=c.entity_id AND a.account_code=c.cash_account_code
    WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity AND c.mapping_family='CASH_TRANSFER_BANK_ACCOUNT'
      AND c.bank_member_ref=p_bank_member AND c.cash_account_code=p_cash_account AND c.currency=document_row.currency
      AND c.status='APPROVED' AND c.effective_from<=p_date AND (c.effective_to IS NULL OR c.effective_to>p_date)
      AND m.active AND m.member_type='BANK' AND a.active AND a.requires_member AND a.required_member_type='BANK'
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Native settlement requires an exact approved effective active bank-to-cash-GL control' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=ANY(p_attachment_ids) ORDER BY attachment_id FOR SHARE;
  IF cardinality(p_attachment_ids)<>(SELECT count(*) FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=ANY(p_attachment_ids) AND finalization_status='VERIFIED_CLEAN' AND scan_status='CLEAN') THEN
    RAISE EXCEPTION 'Native settlement requires verified clean company-scoped attachment evidence' USING ERRCODE='23503';
  END IF;
  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
    VALUES(journal_id,p_tenant,p_entity,p_period,p_number,'MANUAL','DRAFT',p_date,document_row.currency,p_reason,actor);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    VALUES
      (p_tenant,p_entity,p_period,journal_id,1,CASE p_kind WHEN 'AP_PAYMENT' THEN '291001' ELSE p_cash_account END,p_amount,0,CASE p_kind WHEN 'AP_PAYMENT' THEN document_row.counterparty_ref ELSE p_bank_member END,p_reason,'{}'::jsonb),
      (p_tenant,p_entity,p_period,journal_id,2,CASE p_kind WHEN 'AP_PAYMENT' THEN p_cash_account ELSE '120200' END,0,p_amount,CASE p_kind WHEN 'AP_PAYMENT' THEN p_bank_member ELSE document_row.counterparty_ref END,p_reason,'{}'::jsonb);
  INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by)
    SELECT p_tenant,p_entity,'JE_ATTACHMENT',journal_id,id,actor FROM unnest(p_attachment_ids) id;
  INSERT INTO payment_occurrence(payment_occurrence_id,tenant_id,entity_id,business_document_id,occurrence_kind,amount,currency,accounting_date,period_id,status,draft_journal_entry_id,idempotency_key,request_hash,created_by)
    VALUES(occurrence_id,p_tenant,p_entity,p_document,p_kind,p_amount,document_row.currency,p_date,p_period,'DRAFT',journal_id,p_idempotency_key,request_hash,actor);
  INSERT INTO business_allocation(business_allocation_id,tenant_id,entity_id,business_document_id,payment_occurrence_id,amount,currency,status,created_by)
    VALUES(allocation_id,p_tenant,p_entity,p_document,occurrence_id,p_amount,document_row.currency,'PENDING',actor);
  response:=jsonb_build_object('payment_occurrence_id',occurrence_id,'business_allocation_id',allocation_id,'business_document_id',p_document,'journal_entry_id',journal_id,'status','DRAFT','allocation_status','PENDING','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(p_tenant,p_entity,p_kind||'_DRAFT_CREATED','PAYMENT_OCCURRENCE',occurrence_id,'CREATE_NATIVE_'||p_kind,actor,'USER',permission,p_idempotency_key,p_idempotency_key,p_idempotency_key,request_hash,p_reason);
  event_payload:=jsonb_build_object('payment_occurrence_id',occurrence_id,'business_allocation_id',allocation_id,'business_document_id',p_document,'journal_entry_id',journal_id,'status','DRAFT');
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'PAYMENT_OCCURRENCE',occurrence_id,p_kind||'_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='NATIVE_'||p_kind||':'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_settlement_bank_account_pairs(uuid,uuid,text,text,text,integer,uuid,date),refs_create_native_settlement(uuid,uuid,text,uuid,uuid,text,date,text,text,numeric,text,uuid[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_settlement_bank_account_pairs(uuid,uuid,text,text,text,integer,uuid,date),refs_create_native_settlement(uuid,uuid,text,uuid,uuid,text,date,text,text,numeric,text,uuid[],text) TO refs_app;

COMMIT;
