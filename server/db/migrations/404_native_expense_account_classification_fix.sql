BEGIN;

-- account_master stores a controlled chart code, not a separate account_class column.
-- Preserve the prior implementation for a guarded rollback.
ALTER FUNCTION refs_create_native_expense(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text)
  RENAME TO refs_create_native_expense_403;
ALTER FUNCTION refs_read_native_expense_create_options(uuid,uuid,uuid)
  RENAME TO refs_read_native_expense_create_options_403;

CREATE FUNCTION refs_create_native_expense(
  p_tenant uuid,p_entity uuid,p_period uuid,p_number text,p_vendor text,p_bank text,
  p_cash_account text,p_expense_account text,p_date date,p_currency char(3),p_amount numeric,
  p_reason text,p_attachment_ids uuid[],p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();request_hash text;receipt idempotency_receipt;vendor_name text;
DECLARE journal_id uuid:=gen_random_uuid();expense_row_id uuid:=gen_random_uuid();response jsonb;event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.EXPENSE.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_number IS NULL OR length(p_number) NOT BETWEEN 1 AND 128 OR p_number<>btrim(p_number) OR p_number~'[[:cntrl:]]'
     OR p_vendor IS NULL OR length(p_vendor) NOT BETWEEN 1 AND 128 OR p_vendor<>btrim(p_vendor)
     OR p_bank IS NULL OR length(p_bank) NOT BETWEEN 1 AND 128 OR p_bank<>btrim(p_bank)
     OR p_cash_account IS NULL OR length(p_cash_account) NOT BETWEEN 1 AND 64 OR p_cash_account<>btrim(p_cash_account)
     OR p_expense_account IS NULL OR length(p_expense_account) NOT BETWEEN 1 AND 64 OR p_expense_account<>btrim(p_expense_account)
     OR p_cash_account=p_expense_account OR p_date IS NULL OR p_currency IS NULL OR p_currency!~'^[A-Z]{3}$'
     OR p_amount IS NULL OR p_amount<=0 OR p_amount>=10000000000000000 OR p_amount<>round(p_amount,4)
     OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 8 AND 2000 OR p_reason<>btrim(p_reason) OR p_reason~'[[:cntrl:]]'
     OR p_idempotency_key IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._:-]{8,128}$'
     OR COALESCE(cardinality(p_attachment_ids),0) NOT BETWEEN 1 AND 25
     OR cardinality(p_attachment_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_attachment_ids) id) THEN
    RAISE EXCEPTION 'Expense requires a valid vendor, controlled bank account, date, exact amount and supporting evidence' USING ERRCODE='22023';
  END IF;
  request_hash:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'actor_id',actor,
    'period_id',p_period,'number',p_number,'vendor_ref',p_vendor,'bank_member_ref',p_bank,
    'cash_account_code',p_cash_account,'expense_account_code',p_expense_account,'date',p_date,'currency',p_currency,'amount',p_amount,
    'reason',p_reason,'attachment_ids',to_jsonb(ARRAY(SELECT id FROM unnest(p_attachment_ids) id ORDER BY id))));
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'NATIVE_EXPENSE:'||p_entity,p_idempotency_key,request_hash,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='NATIVE_EXPENSE:'||p_entity
    AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Native expense receipt belongs to another actor' USING ERRCODE='42501'; END IF;
  IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different expense' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
    AND status='OPEN' AND p_date BETWEEN starts_on AND ends_on FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense requires the selected OPEN period' USING ERRCODE='55000'; END IF;
  SELECT display_name INTO vendor_name FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND member_ref=p_vendor AND active AND member_type='VENDOR' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense vendor is unavailable in this company' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=p_bank AND active AND member_type='BANK' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense bank is unavailable in this company' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=p_cash_account
    AND active AND requires_member AND required_member_type='BANK' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense requires a BANK-controlled cash account' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM cash_transfer_bank_account_control WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND mapping_family='CASH_TRANSFER_BANK_ACCOUNT' AND bank_member_ref=p_bank AND cash_account_code=p_cash_account
    AND currency=p_currency AND status='APPROVED' AND effective_from<=p_date AND (effective_to IS NULL OR effective_to>p_date) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense requires an exact approved effective bank-to-cash-GL control' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=p_expense_account
    AND active AND NOT requires_member AND account_code~'^[5-9]' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense category must be an active non-member EXPENSE account' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=ANY(p_attachment_ids) ORDER BY attachment_id FOR SHARE;
  IF cardinality(p_attachment_ids)<>(SELECT count(*) FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND attachment_id=ANY(p_attachment_ids) AND finalization_status='VERIFIED_CLEAN' AND scan_status='CLEAN') THEN
    RAISE EXCEPTION 'Expense requires verified clean company-scoped support' USING ERRCODE='23503';
  END IF;
  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
    VALUES(journal_id,p_tenant,p_entity,p_period,p_number,'MANUAL','DRAFT',p_date,p_currency,p_reason,actor);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    VALUES(p_tenant,p_entity,p_period,journal_id,1,p_expense_account,p_amount,0,p_vendor,p_reason,'{}'::jsonb),
          (p_tenant,p_entity,p_period,journal_id,2,p_cash_account,0,p_amount,p_bank,p_reason,'{}'::jsonb);
  INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by)
    SELECT p_tenant,p_entity,'JE_ATTACHMENT',journal_id,id,actor FROM unnest(p_attachment_ids) id;
  INSERT INTO expense(expense_id,tenant_id,entity_id,period_id,expense_number,vendor_ref,vendor_name,bank_member_ref,
    cash_account_code,expense_account_code,accounting_date,currency,amount,description,journal_entry_id,created_by)
    VALUES(expense_row_id,p_tenant,p_entity,p_period,p_number,p_vendor,vendor_name,p_bank,p_cash_account,p_expense_account,p_date,p_currency,p_amount,p_reason,journal_id,actor);
  response:=jsonb_build_object('expense_id',expense_row_id,'journal_entry_id',journal_id,'status','DRAFT','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash)
    VALUES(p_tenant,p_entity,'EXPENSE_DRAFT_CREATED','EXPENSE',expense_row_id,'CREATE_EXPENSE',actor,'USER','AP.EXPENSE.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,request_hash);
  event_payload:=response-'idempotent';
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'EXPENSE',expense_row_id,'EXPENSE_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='NATIVE_EXPENSE:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;


CREATE FUNCTION refs_read_native_expense_create_options(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.EXPENSE.CREATE');
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN';
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense creation requires an OPEN company period' USING ERRCODE='55000'; END IF;
  SELECT jsonb_build_object(
    'schema_version','NATIVE_EXPENSE_CREATE_OPTIONS_V1','entity_id',p_entity,'period_id',p_period,
    'vendors',COALESCE((SELECT jsonb_agg(jsonb_build_object('vendor_ref',member_ref,'vendor_name',display_name) ORDER BY member_ref)
      FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND active AND member_type='VENDOR'),'[]'::jsonb),
    'bank_cash_accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('bank_member_ref',m.member_ref,'bank_name',m.display_name,'cash_account_code',a.account_code,'cash_account_name',a.account_name,'currency',c.currency) ORDER BY m.member_ref,a.account_code,c.currency)
      FROM cash_transfer_bank_account_control c JOIN accounting_period p ON p.tenant_id=c.tenant_id AND p.entity_id=c.entity_id AND p.period_id=p_period
      JOIN member_master m ON m.tenant_id=c.tenant_id AND m.entity_id=c.entity_id AND m.member_ref=c.bank_member_ref
      JOIN account_master a ON a.tenant_id=c.tenant_id AND a.entity_id=c.entity_id AND a.account_code=c.cash_account_code
      WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity AND c.mapping_family='CASH_TRANSFER_BANK_ACCOUNT' AND c.status='APPROVED'
        AND c.effective_from<=p.ends_on AND (c.effective_to IS NULL OR c.effective_to>p.starts_on)
        AND m.active AND m.member_type='BANK' AND a.active AND a.requires_member AND a.required_member_type='BANK'),'[]'::jsonb),
    'expense_accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('expense_account_code',account_code,'expense_account_name',account_name) ORDER BY account_code)
      FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND active AND NOT requires_member AND account_code~'^[5-9]'),'[]'::jsonb),
    'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('attachment_id',attachment_id,'name',name,'media_type',media_type,'size_bytes',size_bytes::text,'content_hash',content_hash,'verified_at',to_char(verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY verified_at DESC,attachment_id DESC)
      FROM (SELECT attachment_id,name,media_type,size_bytes,content_hash,verified_at FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND finalization_status='VERIFIED_CLEAN' AND scan_status='CLEAN' AND verified_at IS NOT NULL AND finalized_at IS NOT NULL ORDER BY verified_at DESC,attachment_id DESC LIMIT 100) verified_attachment),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;


REVOKE ALL ON FUNCTION refs_create_native_expense_403(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text),refs_read_native_expense_create_options_403(uuid,uuid,uuid) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_create_native_expense(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text),refs_read_native_expense_create_options(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_native_expense(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text),refs_read_native_expense_create_options(uuid,uuid,uuid) TO refs_app;

COMMIT;
