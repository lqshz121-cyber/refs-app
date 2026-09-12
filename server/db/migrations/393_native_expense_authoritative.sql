BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES('AP.EXPENSE.CREATE','AP','HIGH','AP_EXPENSE_MAKER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;
INSERT INTO runtime_human_permission_authority(permission_code,authority_class)
VALUES('AP.EXPENSE.CREATE','DRAFT')
ON CONFLICT(permission_code) DO UPDATE SET authority_class=EXCLUDED.authority_class;

CREATE TABLE expense (
  expense_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  period_id uuid NOT NULL,
  expense_number text NOT NULL CHECK(length(expense_number) BETWEEN 1 AND 128 AND expense_number=btrim(expense_number)),
  vendor_ref text NOT NULL,
  vendor_name text NOT NULL,
  bank_member_ref text NOT NULL,
  cash_account_code text NOT NULL,
  expense_account_code text NOT NULL,
  accounting_date date NOT NULL,
  currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  amount numeric(20,4) NOT NULL CHECK(amount>0),
  description text NOT NULL CHECK(length(description) BETWEEN 8 AND 2000),
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED')),
  journal_entry_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  posted_at timestamptz,
  CHECK((status='POSTED')=(posted_at IS NOT NULL)),
  CHECK(cash_account_code<>expense_account_code),
  UNIQUE(tenant_id,entity_id,expense_id),
  UNIQUE(tenant_id,entity_id,expense_number),
  UNIQUE(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id,vendor_ref) REFERENCES member_master(tenant_id,entity_id,member_ref),
  FOREIGN KEY(tenant_id,entity_id,bank_member_ref) REFERENCES member_master(tenant_id,entity_id,member_ref),
  FOREIGN KEY(tenant_id,entity_id,cash_account_code) REFERENCES account_master(tenant_id,entity_id,account_code),
  FOREIGN KEY(tenant_id,entity_id,expense_account_code) REFERENCES account_master(tenant_id,entity_id,account_code)
);
CREATE INDEX expense_period_created_idx ON expense(tenant_id,entity_id,period_id,created_at DESC,expense_id DESC);
ALTER TABLE expense ENABLE ROW LEVEL SECURITY;
CREATE POLICY expense_scope ON expense USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
REVOKE ALL ON expense FROM PUBLIC,refs_app;
COMMENT ON TABLE expense IS 'Direct bank-paid expense. The normal journal retains workflow approval; only POSTED ledger represents the expense.';

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
    RAISE EXCEPTION 'Expense requires a valid vendor, bank, expense account, date, exact amount and supporting evidence' USING ERRCODE='22023';
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
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=p_expense_account
    AND active AND NOT requires_member AND account_class='EXPENSE' FOR SHARE;
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

CREATE FUNCTION refs_activate_posted_expense() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE expense_row expense;event_payload jsonb;
BEGIN
  IF NEW.status<>'POSTED' OR OLD.status='POSTED' THEN RETURN NEW; END IF;
  SELECT * INTO expense_row FROM expense WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF expense_row.status<>'DRAFT' OR NEW.period_id<>expense_row.period_id OR NEW.journal_date<>expense_row.accounting_date OR NEW.currency<>expense_row.currency
     OR NEW.journal_number<>expense_row.expense_number
     OR (SELECT count(*) FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id)<>2
     OR NOT EXISTS(SELECT 1 FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id
       AND account_code=expense_row.expense_account_code AND member_ref=expense_row.vendor_ref AND debit_amount=expense_row.amount AND credit_amount=0)
     OR NOT EXISTS(SELECT 1 FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id
       AND account_code=expense_row.cash_account_code AND member_ref=expense_row.bank_member_ref AND debit_amount=0 AND credit_amount=expense_row.amount) THEN
    RAISE EXCEPTION 'Expense journal no longer matches its vendor, bank, expense category, amount or period' USING ERRCODE='23514';
  END IF;
  UPDATE expense SET status='POSTED',version=version+1,posted_at=NEW.posted_at WHERE expense_id=expense_row.expense_id;
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash)
    VALUES(NEW.tenant_id,NEW.entity_id,'EXPENSE_POSTED','EXPENSE',expense_row.expense_id,'POST_EXPENSE',NEW.posted_by,'USER','GL.JE.POST',NEW.journal_entry_id::text,NEW.journal_entry_id::text,NEW.journal_entry_id::text,refs_jsonb_hash(to_jsonb(NEW)));
  event_payload:=jsonb_build_object('expense_id',expense_row.expense_id,'journal_entry_id',NEW.journal_entry_id,'status','POSTED','revision',expense_row.version+1);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(NEW.tenant_id,NEW.entity_id,'EXPENSE',expense_row.expense_id,'EXPENSE_POSTED',event_payload,refs_jsonb_hash(event_payload));
  RETURN NEW;
END;
$$;
CREATE TRIGGER expense_posted AFTER UPDATE OF status ON journal_entry FOR EACH ROW EXECUTE FUNCTION refs_activate_posted_expense();
REVOKE ALL ON FUNCTION refs_create_native_expense(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text),refs_activate_posted_expense() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_native_expense(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text) TO refs_app;
COMMIT;
