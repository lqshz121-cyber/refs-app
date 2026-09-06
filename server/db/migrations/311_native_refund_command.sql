BEGIN;

CREATE FUNCTION refs_create_native_refund(
  p_tenant uuid,p_entity uuid,p_source_adjustment uuid,p_period uuid,
  p_number text,p_date date,p_cash_account text,p_bank_member text,p_amount numeric,
  p_reason text,p_attachment_ids uuid[],p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();permission text;request_hash text;receipt idempotency_receipt;
DECLARE credit_row business_adjustment;period_row accounting_period;allocated numeric;refunded numeric;customer_ref text;
DECLARE journal_id uuid:=gen_random_uuid();adjustment_id uuid:=gen_random_uuid();response jsonb;event_payload jsonb;
BEGIN
  permission:='AR.REFUND.CREATE';
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
    RAISE EXCEPTION 'Native refund requires valid number, date, exact positive amount, bank, reason and unique attachment evidence' USING ERRCODE='22023';
  END IF;
  request_hash:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'actor_id',actor,
    'adjustment_kind','AR_REFUND','source_adjustment_id',p_source_adjustment,'period_id',p_period,'number',p_number,'date',p_date,
    'cash_account_code',p_cash_account,'bank_member_ref',p_bank_member,'amount',p_amount,'reason',p_reason,
    'attachment_ids',to_jsonb(ARRAY(SELECT id FROM unnest(p_attachment_ids) id ORDER BY id))));
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'NATIVE_AR_REFUND:'||p_entity,p_idempotency_key,request_hash,'IN_PROGRESS',actor)
    ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='NATIVE_AR_REFUND:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Native refund receipt belongs to another actor' USING ERRCODE='42501'; END IF;
  IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different native settlement' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR UPDATE;
  IF NOT FOUND OR period_row.status<>'OPEN' OR p_date NOT BETWEEN period_row.starts_on AND period_row.ends_on THEN
    RAISE EXCEPTION 'Native refund date must belong to the selected OPEN payment period' USING ERRCODE='55000';
  END IF;
  -- Serialize all uses through the same posted source-credit row as legacy
  -- refund and allocation commands. Recompute capacity after acquiring the lock.
  SELECT * INTO credit_row FROM business_adjustment WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND business_adjustment_id=p_source_adjustment FOR UPDATE;
  IF NOT FOUND OR credit_row.adjustment_kind<>'AR_CREDIT_MEMO' OR credit_row.status<>'POSTED'
    OR NOT EXISTS(SELECT 1 FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND journal_entry_id=credit_row.posted_journal_entry_id AND period_id=credit_row.period_id
      AND status='POSTED' AND currency=credit_row.currency) THEN
    RAISE EXCEPTION 'Native refund requires a posted customer credit in this company' USING ERRCODE='23514';
  END IF;
  SELECT min(member_ref) INTO customer_ref FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND journal_entry_id=credit_row.posted_journal_entry_id AND account_code='120200'
    HAVING count(*)=1 AND bool_and(member_ref IS NOT NULL AND btrim(member_ref)<>''
      AND credit_amount=credit_row.amount AND debit_amount=0);
  IF customer_ref IS NULL THEN RAISE EXCEPTION 'Refund credit lacks exact posted customer control evidence' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(amount),0) INTO allocated FROM business_allocation WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND business_adjustment_id=p_source_adjustment AND status IN ('PENDING','ACTIVE');
  SELECT COALESCE(sum(amount),0) INTO refunded FROM business_adjustment WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND source_adjustment_id=p_source_adjustment AND adjustment_kind='AR_REFUND'
    AND status IN ('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED_PENDING_POST','POSTED');
  IF allocated+refunded+p_amount>credit_row.amount THEN RAISE EXCEPTION 'Native refund exceeds available posted credit' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=p_cash_account
    AND active AND requires_member AND required_member_type='BANK' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Native refund requires an active BANK-controlled GL account' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=p_bank_member AND active AND member_type='BANK' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Native refund requires an active scoped BANK member' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=ANY(p_attachment_ids) ORDER BY attachment_id FOR SHARE;
  IF cardinality(p_attachment_ids)<>(SELECT count(*) FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND attachment_id=ANY(p_attachment_ids) AND finalization_status='VERIFIED_CLEAN' AND scan_status='CLEAN') THEN
    RAISE EXCEPTION 'Native refund requires verified clean company-scoped attachment evidence' USING ERRCODE='23503';
  END IF;

  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
    VALUES(journal_id,p_tenant,p_entity,p_period,p_number,'MANUAL','DRAFT',p_date,credit_row.currency,p_reason,actor);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    VALUES(p_tenant,p_entity,p_period,journal_id,1,'120200',p_amount,0,customer_ref,p_reason,'{}'::jsonb),
    (p_tenant,p_entity,p_period,journal_id,2,p_cash_account,0,p_amount,p_bank_member,p_reason,'{}'::jsonb);
  INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by)
    SELECT p_tenant,p_entity,'JE_ATTACHMENT',journal_id,id,actor FROM unnest(p_attachment_ids) id;
  INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,source_adjustment_id,
    amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,idempotency_key,request_hash,created_by)
    VALUES(adjustment_id,p_tenant,p_entity,'AR_REFUND',p_source_adjustment,p_amount,credit_row.currency,p_date,p_period,
      p_reason,'DRAFT',journal_id,p_idempotency_key,request_hash,actor);
  response:=jsonb_build_object('business_adjustment_id',adjustment_id,'source_adjustment_id',p_source_adjustment,
    'journal_entry_id',journal_id,'status','DRAFT','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(p_tenant,p_entity,'AR_REFUND_DRAFT_CREATED','BUSINESS_ADJUSTMENT',adjustment_id,'CREATE_NATIVE_AR_REFUND',actor,'USER',permission,
      p_idempotency_key,p_idempotency_key,p_idempotency_key,request_hash,p_reason);
  event_payload:=jsonb_build_object('business_adjustment_id',adjustment_id,'source_adjustment_id',p_source_adjustment,'journal_entry_id',journal_id,'status','DRAFT');
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'BUSINESS_ADJUSTMENT',adjustment_id,'AR_REFUND_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='NATIVE_AR_REFUND:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION refs_create_native_refund(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text,uuid[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_native_refund(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text,uuid[],text) TO refs_app;

COMMIT;
