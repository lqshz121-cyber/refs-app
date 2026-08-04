BEGIN;

-- A Bill/Invoice is a subsidiary document backed by a normal Draft JE.  It is
-- deliberately not an alternate posting path: the JE must still be submitted,
-- reviewed, approved and posted by separate actors.
ALTER TABLE business_document
  ADD COLUMN draft_journal_entry_id uuid,
  ADD CONSTRAINT business_document_draft_journal_fk
    FOREIGN KEY (tenant_id,entity_id,draft_journal_entry_id)
    REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id);
CREATE UNIQUE INDEX business_document_draft_journal_uq
  ON business_document(tenant_id,entity_id,draft_journal_entry_id)
  WHERE draft_journal_entry_id IS NOT NULL;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('AP.BILL.CREATE','AP','HIGH','AP_BILL_MAKER'),
  ('AR.INVOICE.CREATE','AR','HIGH','AR_INVOICE_MAKER')
ON CONFLICT (permission_code) DO UPDATE
  SET domain=EXCLUDED.domain,active=true,risk_class=EXCLUDED.risk_class,
      sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

CREATE OR REPLACE FUNCTION refs_create_business_document_hash(
  p_tenant uuid,p_entity uuid,p_kind text,p_period uuid,p_document_number text,p_counterparty_ref text,
  p_counterparty_name text,p_currency char(3),p_accounting_date date,p_due_date date,p_amount numeric,
  p_offset_account_code text,p_description text,p_attachment_ids uuid[]
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'document_kind',upper(p_kind),'period_id',p_period,
    'document_number',btrim(p_document_number),'counterparty_ref',btrim(p_counterparty_ref),
    'counterparty_name',btrim(p_counterparty_name),'currency',upper(p_currency),
    'accounting_date',p_accounting_date,'due_date',p_due_date,'amount',p_amount,
    'offset_account_code',btrim(p_offset_account_code),'description',NULLIF(btrim(p_description),''),
    'attachment_ids',to_jsonb(ARRAY(SELECT value FROM unnest(COALESCE(p_attachment_ids,'{}'::uuid[])) value ORDER BY value))
  ))
$$;

CREATE OR REPLACE FUNCTION refs_create_business_document(
  p_tenant uuid,p_entity uuid,p_kind text,p_period uuid,p_document_number text,p_counterparty_ref text,
  p_counterparty_name text,p_currency char(3),p_accounting_date date,p_due_date date,p_amount numeric,
  p_offset_account_code text,p_description text,p_attachment_ids uuid[],p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); kind text:=upper(p_kind); permission text; counterparty_type text;
DECLARE receipt idempotency_receipt; journal_id uuid:=gen_random_uuid(); document_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;
BEGIN
  permission:=CASE kind WHEN 'AP_BILL' THEN 'AP.BILL.CREATE' WHEN 'AR_INVOICE' THEN 'AR.INVOICE.CREATE' ELSE NULL END;
  IF permission IS NULL THEN RAISE EXCEPTION 'Unsupported business document kind' USING ERRCODE='22023'; END IF;
  PERFORM refs_assert_scope(p_tenant,p_entity,permission);
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_create_business_document_hash(p_tenant,p_entity,kind,p_period,p_document_number,p_counterparty_ref,p_counterparty_name,p_currency,p_accounting_date,p_due_date,p_amount,p_offset_account_code,p_description,p_attachment_ids) THEN
    RAISE EXCEPTION 'Business document request hash is not canonical' USING ERRCODE='22023';
  END IF;
  IF COALESCE(length(btrim(p_document_number)),0)=0 OR COALESCE(length(btrim(p_counterparty_ref)),0)=0
     OR COALESCE(length(btrim(p_counterparty_name)),0)=0 OR p_currency !~ '^[A-Z]{3}$'
     OR p_accounting_date IS NULL OR p_amount<=0 OR COALESCE(length(btrim(p_offset_account_code)),0)=0
     OR COALESCE(cardinality(p_attachment_ids),0)=0 THEN
    RAISE EXCEPTION 'Business document requires number, counterparty, currency, date, positive amount, offset account and attachment evidence' USING ERRCODE='22023';
  END IF;
  IF p_due_date IS NOT NULL AND p_due_date<p_accounting_date THEN RAISE EXCEPTION 'Due date cannot precede accounting date' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'CREATE_'||kind||':'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='CREATE_'||kind||':'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
    AND status='OPEN' AND p_accounting_date BETWEEN starts_on AND ends_on FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business document date must belong to the selected OPEN period' USING ERRCODE='55000'; END IF;
  SELECT member_type INTO counterparty_type FROM member_master
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=btrim(p_counterparty_ref) AND active FOR SHARE;
  IF (kind='AP_BILL' AND counterparty_type<>'VENDOR') OR (kind='AR_INVOICE' AND counterparty_type NOT IN ('CUSTOMER','AFFILIATE')) THEN
    RAISE EXCEPTION 'Business document counterparty is missing or has an incompatible type' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_offset_account_code) AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business document offset account is inactive or missing' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND account_code=CASE WHEN kind='AP_BILL' THEN '291001' ELSE '120200' END AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Required AP/AR control account is inactive or missing' USING ERRCODE='23514'; END IF;
  IF COALESCE(cardinality(p_attachment_ids),0)<>(SELECT count(DISTINCT attachment_id) FROM attachment
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=ANY(p_attachment_ids) AND finalization_status='VERIFIED_CLEAN') THEN
    RAISE EXCEPTION 'Business document requires verified clean entity-scoped attachment evidence' USING ERRCODE='23503';
  END IF;
  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
    VALUES(journal_id,p_tenant,p_entity,p_period,btrim(p_document_number),'MANUAL','DRAFT',p_accounting_date,p_currency,
      COALESCE(NULLIF(btrim(p_description),''),kind||' '||btrim(p_document_number)),actor);
  INSERT INTO business_document(business_document_id,tenant_id,entity_id,draft_journal_entry_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES(document_id,p_tenant,p_entity,journal_id,kind,btrim(p_document_number),btrim(p_counterparty_ref),btrim(p_counterparty_name),p_currency,p_accounting_date,p_due_date,p_amount,p_amount,'DRAFT',actor);
  IF kind='AP_BILL' THEN
    INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
      VALUES(p_tenant,p_entity,p_period,journal_id,1,btrim(p_offset_account_code),p_amount,0,NULL,kind||' '||btrim(p_document_number),'{}'::jsonb),
            (p_tenant,p_entity,p_period,journal_id,2,'291001',0,p_amount,btrim(p_counterparty_ref),kind||' '||btrim(p_document_number),'{}'::jsonb);
  ELSE
    INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
      VALUES(p_tenant,p_entity,p_period,journal_id,1,'120200',p_amount,0,btrim(p_counterparty_ref),kind||' '||btrim(p_document_number),'{}'::jsonb),
            (p_tenant,p_entity,p_period,journal_id,2,btrim(p_offset_account_code),0,p_amount,NULL,kind||' '||btrim(p_document_number),'{}'::jsonb);
  END IF;
  INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by)
    SELECT p_tenant,p_entity,'JE_ATTACHMENT',journal_id,value,actor FROM unnest(p_attachment_ids) value;
  response:=jsonb_build_object('business_document_id',document_id,'journal_entry_id',journal_id,'document_kind',kind,'status','DRAFT','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash)
    VALUES(p_tenant,p_entity,kind||'_DRAFT_CREATED','BUSINESS_DOCUMENT',document_id,'CREATE_'||kind,actor,'USER',permission,p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash);
  event_payload:=jsonb_build_object('business_document_id',document_id,'journal_entry_id',journal_id,'document_kind',kind,'status','DRAFT');
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'BUSINESS_DOCUMENT',document_id,kind||'_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='CREATE_'||kind||':'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

CREATE OR REPLACE FUNCTION refs_activate_posted_business_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE document_row business_document; event_payload jsonb;
BEGIN
  IF TG_OP<>'UPDATE' OR NEW.status<>'POSTED' OR OLD.status='POSTED' THEN RETURN NEW; END IF;
  SELECT * INTO document_row FROM business_document
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND draft_journal_entry_id=NEW.journal_entry_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF document_row.status<>'DRAFT' OR document_row.open_balance<>document_row.gross_amount THEN
    RAISE EXCEPTION 'Business document cannot be activated from current state' USING ERRCODE='23514';
  END IF;
  UPDATE business_document SET status='OPEN',posted_journal_entry_id=NEW.journal_entry_id,draft_journal_entry_id=NULL,
    version=version+1,updated_at=clock_timestamp()
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=document_row.business_document_id;
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash)
    VALUES(NEW.tenant_id,NEW.entity_id,document_row.document_kind||'_POSTED','BUSINESS_DOCUMENT',document_row.business_document_id,
      'POST_'||document_row.document_kind,NEW.posted_by,'USER','GL.JE.POST',NEW.journal_entry_id::text,NEW.journal_entry_id::text,NEW.journal_entry_id::text,refs_jsonb_hash(to_jsonb(NEW)));
  event_payload:=jsonb_build_object('business_document_id',document_row.business_document_id,'journal_entry_id',NEW.journal_entry_id,'document_kind',document_row.document_kind,'status','OPEN','open_balance',document_row.open_balance);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(NEW.tenant_id,NEW.entity_id,'BUSINESS_DOCUMENT',document_row.business_document_id,document_row.document_kind||'_POSTED',event_payload,refs_jsonb_hash(event_payload));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION refs_create_business_document_hash(uuid,uuid,text,uuid,text,text,text,char(3),date,date,numeric,text,text,uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_create_business_document(uuid,uuid,text,uuid,text,text,text,char(3),date,date,numeric,text,text,uuid[],text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_activate_posted_business_document() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_business_document_hash(uuid,uuid,text,uuid,text,text,text,char(3),date,date,numeric,text,text,uuid[]) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_business_document(uuid,uuid,text,uuid,text,text,text,char(3),date,date,numeric,text,text,uuid[],text,text) TO refs_app;
DROP TRIGGER IF EXISTS business_document_posted_reducer ON journal_entry;
CREATE TRIGGER business_document_posted_reducer AFTER UPDATE OF status ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION refs_activate_posted_business_document();

COMMIT;
