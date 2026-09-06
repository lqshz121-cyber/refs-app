BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES('AR.SALES_RECEIPT.CREATE','AR','HIGH','AR_SALES_RECEIPT_MAKER');
INSERT INTO runtime_human_permission_authority(permission_code,authority_class)
VALUES('AR.SALES_RECEIPT.CREATE','DRAFT');

CREATE TABLE sales_receipt (
  sales_receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  period_id uuid NOT NULL,
  receipt_number text NOT NULL CHECK(length(receipt_number) BETWEEN 1 AND 128 AND receipt_number=btrim(receipt_number)),
  customer_ref text NOT NULL,
  customer_name text NOT NULL,
  bank_member_ref text NOT NULL,
  cash_account_code text NOT NULL,
  category_account_code text NOT NULL,
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
  CHECK(cash_account_code<>category_account_code),
  UNIQUE(tenant_id,entity_id,sales_receipt_id),
  UNIQUE(tenant_id,entity_id,receipt_number),
  UNIQUE(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id,customer_ref) REFERENCES member_master(tenant_id,entity_id,member_ref),
  FOREIGN KEY(tenant_id,entity_id,bank_member_ref) REFERENCES member_master(tenant_id,entity_id,member_ref),
  FOREIGN KEY(tenant_id,entity_id,cash_account_code) REFERENCES account_master(tenant_id,entity_id,account_code),
  FOREIGN KEY(tenant_id,entity_id,category_account_code) REFERENCES account_master(tenant_id,entity_id,account_code)
);
CREATE INDEX sales_receipt_period_created_idx ON sales_receipt(tenant_id,entity_id,period_id,created_at DESC,sales_receipt_id DESC);
ALTER TABLE sales_receipt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_receipt FROM PUBLIC,refs_app;
COMMENT ON TABLE sales_receipt IS 'Cash sale with a normal approval-controlled journal. No business_document or AR allocation is manufactured; workflow stages live on the linked journal, and only POSTED ledger represents the sale.';

CREATE FUNCTION refs_create_native_sales_receipt(
  p_tenant uuid,p_entity uuid,p_period uuid,p_number text,p_customer text,p_bank text,
  p_cash_account text,p_category_account text,p_date date,p_currency char(3),p_amount numeric,
  p_reason text,p_attachment_ids uuid[],p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();request_hash text;receipt idempotency_receipt;customer_name text;
DECLARE journal_id uuid:=gen_random_uuid();sale_id uuid:=gen_random_uuid();response jsonb;event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AR.SALES_RECEIPT.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_number IS NULL OR length(p_number) NOT BETWEEN 1 AND 128 OR p_number<>btrim(p_number) OR p_number~'[[:cntrl:]]'
     OR p_customer IS NULL OR length(p_customer) NOT BETWEEN 1 AND 128 OR p_customer<>btrim(p_customer)
     OR p_bank IS NULL OR length(p_bank) NOT BETWEEN 1 AND 128 OR p_bank<>btrim(p_bank)
     OR p_cash_account IS NULL OR length(p_cash_account) NOT BETWEEN 1 AND 64 OR p_cash_account<>btrim(p_cash_account)
     OR p_category_account IS NULL OR length(p_category_account) NOT BETWEEN 1 AND 64 OR p_category_account<>btrim(p_category_account)
     OR p_cash_account=p_category_account OR p_date IS NULL OR p_currency IS NULL OR p_currency!~'^[A-Z]{3}$'
     OR p_amount IS NULL OR p_amount<=0 OR p_amount>=10000000000000000 OR p_amount<>round(p_amount,4)
     OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 8 AND 2000 OR p_reason<>btrim(p_reason) OR p_reason~'[[:cntrl:]]'
     OR p_idempotency_key IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._:-]{8,128}$'
     OR COALESCE(cardinality(p_attachment_ids),0) NOT BETWEEN 1 AND 25
     OR cardinality(p_attachment_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_attachment_ids) id) THEN
    RAISE EXCEPTION 'Sales receipt requires a valid customer, bank, category, date, exact amount and supporting evidence' USING ERRCODE='22023';
  END IF;
  request_hash:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'actor_id',actor,
    'period_id',p_period,'number',p_number,'customer_ref',p_customer,'bank_member_ref',p_bank,
    'cash_account_code',p_cash_account,'category_account_code',p_category_account,'date',p_date,'currency',p_currency,'amount',p_amount,
    'reason',p_reason,'attachment_ids',to_jsonb(ARRAY(SELECT id FROM unnest(p_attachment_ids) id ORDER BY id))));
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'NATIVE_SALES_RECEIPT:'||p_entity,p_idempotency_key,request_hash,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='NATIVE_SALES_RECEIPT:'||p_entity
    AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different sales receipt' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
    AND status='OPEN' AND p_date BETWEEN starts_on AND ends_on FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales receipt requires the selected OPEN period' USING ERRCODE='55000'; END IF;
  SELECT display_name INTO customer_name FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND member_ref=p_customer AND active AND member_type IN ('CUSTOMER','AFFILIATE') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales receipt customer is unavailable in this company' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=p_bank AND active AND member_type='BANK' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales receipt bank is unavailable in this company' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=p_cash_account
    AND active AND requires_member AND required_member_type='BANK' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales receipt requires a BANK-controlled cash account' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=p_category_account
    AND active AND NOT requires_member FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales receipt category is unavailable or requires a separate member' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=ANY(p_attachment_ids) ORDER BY attachment_id FOR SHARE;
  IF cardinality(p_attachment_ids)<>(SELECT count(*) FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND attachment_id=ANY(p_attachment_ids) AND finalization_status='VERIFIED_CLEAN' AND scan_status='CLEAN') THEN
    RAISE EXCEPTION 'Sales receipt requires verified clean company-scoped support' USING ERRCODE='23503';
  END IF;
  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
    VALUES(journal_id,p_tenant,p_entity,p_period,p_number,'MANUAL','DRAFT',p_date,p_currency,p_reason,actor);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    VALUES(p_tenant,p_entity,p_period,journal_id,1,p_cash_account,p_amount,0,p_bank,p_reason,'{}'::jsonb),
          (p_tenant,p_entity,p_period,journal_id,2,p_category_account,0,p_amount,p_customer,p_reason,'{}'::jsonb);
  INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by)
    SELECT p_tenant,p_entity,'JE_ATTACHMENT',journal_id,id,actor FROM unnest(p_attachment_ids) id;
  INSERT INTO sales_receipt(sales_receipt_id,tenant_id,entity_id,period_id,receipt_number,customer_ref,customer_name,bank_member_ref,
    cash_account_code,category_account_code,accounting_date,currency,amount,description,journal_entry_id,created_by)
    VALUES(sale_id,p_tenant,p_entity,p_period,p_number,p_customer,customer_name,p_bank,p_cash_account,p_category_account,p_date,p_currency,p_amount,p_reason,journal_id,actor);
  response:=jsonb_build_object('sales_receipt_id',sale_id,'journal_entry_id',journal_id,'status','DRAFT','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash)
    VALUES(p_tenant,p_entity,'SALES_RECEIPT_DRAFT_CREATED','SALES_RECEIPT',sale_id,'CREATE_SALES_RECEIPT',actor,'USER','AR.SALES_RECEIPT.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,request_hash);
  event_payload:=response-'idempotent';
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'SALES_RECEIPT',sale_id,'SALES_RECEIPT_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='NATIVE_SALES_RECEIPT:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

CREATE FUNCTION refs_activate_posted_sales_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE sale sales_receipt;event_payload jsonb;
BEGIN
  IF NEW.status<>'POSTED' OR OLD.status='POSTED' THEN RETURN NEW; END IF;
  SELECT * INTO sale FROM sales_receipt WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF sale.status<>'DRAFT' OR NEW.period_id<>sale.period_id OR NEW.journal_date<>sale.accounting_date OR NEW.currency<>sale.currency
     OR NEW.journal_number<>sale.receipt_number
     OR (SELECT count(*) FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id)<>2
     OR NOT EXISTS(SELECT 1 FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id
       AND account_code=sale.cash_account_code AND member_ref=sale.bank_member_ref AND debit_amount=sale.amount AND credit_amount=0)
     OR NOT EXISTS(SELECT 1 FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id
       AND account_code=sale.category_account_code AND member_ref=sale.customer_ref AND debit_amount=0 AND credit_amount=sale.amount) THEN
    RAISE EXCEPTION 'Sales receipt journal no longer matches its bank, customer, category, amount or period' USING ERRCODE='23514';
  END IF;
  UPDATE sales_receipt SET status='POSTED',version=version+1,posted_at=NEW.posted_at WHERE sales_receipt_id=sale.sales_receipt_id;
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash)
    VALUES(NEW.tenant_id,NEW.entity_id,'SALES_RECEIPT_POSTED','SALES_RECEIPT',sale.sales_receipt_id,'POST_SALES_RECEIPT',NEW.posted_by,'USER','GL.JE.POST',NEW.journal_entry_id::text,NEW.journal_entry_id::text,NEW.journal_entry_id::text,refs_jsonb_hash(to_jsonb(NEW)));
  event_payload:=jsonb_build_object('sales_receipt_id',sale.sales_receipt_id,'journal_entry_id',NEW.journal_entry_id,'status','POSTED','revision',sale.version+1);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(NEW.tenant_id,NEW.entity_id,'SALES_RECEIPT',sale.sales_receipt_id,'SALES_RECEIPT_POSTED',event_payload,refs_jsonb_hash(event_payload));
  RETURN NEW;
END;
$$;
CREATE TRIGGER sales_receipt_posted AFTER UPDATE OF status ON journal_entry FOR EACH ROW EXECUTE FUNCTION refs_activate_posted_sales_receipt();
REVOKE ALL ON FUNCTION refs_create_native_sales_receipt(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text),refs_activate_posted_sales_receipt() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_native_sales_receipt(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text) TO refs_app;
COMMIT;
