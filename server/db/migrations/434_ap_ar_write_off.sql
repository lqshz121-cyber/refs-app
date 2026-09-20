BEGIN;

-- X02: controlled AP/AR write-off.
--
-- Why this exists: before this migration the only way to clear an uncollectible receivable or an
-- unpayable payable was a generic manual journal. A manual journal moves 291001/120200 but never
-- touches business_document.open_balance, so the document keeps ageing forever and
-- refs_ap_ar_control_reconciliation flips out of balance. Migration 428:6 already describes that
-- state as "an exception the Controller must explain (... manual JE on 291001 without a
-- document ...)". This is therefore not a missing convenience: it is a control break that occurs
-- on every write-off performed today.
--
-- Design: a write-off is modelled as a business_adjustment that carries a business_allocation
-- against the target document, exactly like AP_VENDOR_CREDIT. That choice is what makes the
-- ledger and the subledger move together by construction rather than by convention:
--
--   documents side of refs_ap_ar_control_reconciliation = sum(open_balance)
--   ledger side                                          = 291001 (credit-debit) / 120200 (debit-credit)
--
--   AP write-off of X: allocation reduces open_balance by X; the journal debits 291001 by X.
--   AR write-off of X: allocation reduces open_balance by X; the journal credits 120200 by X.
--
-- Both sides move by X, so the reconciliation stays in balance without any compensating update.
-- The write-off is also deliberately NOT added to the "available credit" leg of refs_ap_ar_aging
-- (046 enumerates AR_CREDIT_MEMO / AP_VENDOR_CREDIT / AR_REFUND): it reduces the balance directly,
-- so counting it as an available credit as well would double-count it.
--
-- Accounting policy stays out of the code. The command takes the write-off account as an argument
-- and validates it; whether the entity books direct write-off (bad debt expense) or uses an
-- allowance account is therefore a chart-of-accounts/settings decision, not a code change.

-- 1. Permissions. Maker/approver split mirrors AP.BILL.VOID.CREATE / .APPROVE, the only existing
--    two-eyes pair in the AP/AR surface.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('AP.BILL.WRITE_OFF.CREATE','AP','HIGH','AP_WRITE_OFF_MAKER'),
  ('AP.BILL.WRITE_OFF.APPROVE','AP','CRITICAL','AP_WRITE_OFF_APPROVER'),
  ('AR.INVOICE.WRITE_OFF.CREATE','AR','HIGH','AR_WRITE_OFF_MAKER'),
  ('AR.INVOICE.WRITE_OFF.APPROVE','AR','CRITICAL','AR_WRITE_OFF_APPROVER')
ON CONFLICT (permission_code) DO NOTHING;

INSERT INTO runtime_human_permission_authority(permission_code,authority_class) VALUES
  ('AP.BILL.WRITE_OFF.CREATE','DRAFT'),
  ('AP.BILL.WRITE_OFF.APPROVE','APPROVE'),
  ('AR.INVOICE.WRITE_OFF.CREATE','DRAFT'),
  ('AR.INVOICE.WRITE_OFF.APPROVE','APPROVE')
ON CONFLICT (permission_code) DO NOTHING;

-- 2. Widen the closed adjustment_kind enumeration.
ALTER TABLE business_adjustment DROP CONSTRAINT IF EXISTS business_adjustment_adjustment_kind_check;
ALTER TABLE business_adjustment ADD CONSTRAINT business_adjustment_adjustment_kind_check
  CHECK (adjustment_kind IN ('AP_BILL_VOID','AP_VENDOR_CREDIT','AP_PAYMENT_REVERSAL','AR_CREDIT_MEMO','AR_REFUND','AR_RECEIPT_REVERSAL','AP_BILL_WRITE_OFF','AR_INVOICE_WRITE_OFF'));

-- 004 also carries an unnamed per-kind shape CHECK (generated name business_adjustment_check)
-- saying which of business_document_id / source_adjustment_id / source_occurrence_id each kind
-- must populate. A write-off always targets exactly one document, so it joins the AP_BILL_VOID
-- branch. Rebuilt in full rather than patched so the existing branches stay verbatim.
ALTER TABLE business_adjustment DROP CONSTRAINT IF EXISTS business_adjustment_check;
ALTER TABLE business_adjustment ADD CONSTRAINT business_adjustment_check CHECK (
  (adjustment_kind IN ('AP_VENDOR_CREDIT','AR_CREDIT_MEMO') AND business_document_id IS NULL)
  OR (adjustment_kind = 'AP_BILL_VOID' AND business_document_id IS NOT NULL)
  OR (adjustment_kind IN ('AP_BILL_WRITE_OFF','AR_INVOICE_WRITE_OFF') AND business_document_id IS NOT NULL)
  OR (adjustment_kind = 'AR_REFUND' AND source_adjustment_id IS NOT NULL)
  OR (adjustment_kind IN ('AP_PAYMENT_REVERSAL','AR_RECEIPT_REVERSAL') AND source_occurrence_id IS NOT NULL)
);

-- 3. Retained evidence: which account absorbed the write-off, and what the balance was when the
--    Draft was cut. Append-only, so the decision basis cannot be rewritten after the fact.
CREATE TABLE ap_ar_write_off_binding (
  ap_ar_write_off_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  business_adjustment_id uuid NOT NULL,
  business_document_id uuid NOT NULL,
  document_kind text NOT NULL CHECK (document_kind IN ('AP_BILL','AR_INVOICE')),
  write_off_account_code text NOT NULL CHECK (length(btrim(write_off_account_code)) BETWEEN 1 AND 64),
  control_account_code text NOT NULL CHECK (length(btrim(control_account_code)) BETWEEN 1 AND 64),
  counterparty_ref text NOT NULL,
  amount numeric(20,4) NOT NULL CHECK (amount > 0),
  open_balance_before numeric(20,4) NOT NULL CHECK (open_balance_before > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (amount <= open_balance_before),
  UNIQUE (tenant_id, business_adjustment_id),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id),
  FOREIGN KEY (tenant_id, entity_id, business_document_id) REFERENCES business_document(tenant_id, entity_id, business_document_id)
);
CREATE INDEX ap_ar_write_off_binding_scope_idx ON ap_ar_write_off_binding(tenant_id,entity_id,business_document_id);
ALTER TABLE ap_ar_write_off_binding ENABLE ROW LEVEL SECURITY;
CREATE POLICY ap_ar_write_off_binding_scope ON ap_ar_write_off_binding
  USING (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ap_ar_write_off_binding_append_only
  BEFORE UPDATE OR DELETE ON ap_ar_write_off_binding FOR EACH ROW EXECUTE FUNCTION reject_mutation();
REVOKE ALL ON ap_ar_write_off_binding FROM PUBLIC, refs_app;

-- 4. Canonical request hash.
CREATE OR REPLACE FUNCTION refs_ap_ar_write_off_hash(
  p_tenant uuid,p_entity uuid,p_document uuid,p_period uuid,p_journal_number text,p_journal_date date,
  p_amount numeric,p_write_off_account text,p_attachment_ids uuid[],p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'business_document_id',p_document,'period_id',p_period,
    'journal_number',btrim(p_journal_number),'journal_date',p_journal_date,
    'amount',to_char(p_amount,'FM999999999999990.0000'),
    'write_off_account_code',btrim(p_write_off_account),
    'attachment_ids',(SELECT COALESCE(jsonb_agg(x ORDER BY x),'[]'::jsonb) FROM unnest(p_attachment_ids) AS x),
    'reason',p_reason))
$$;

-- 5. The command. One function serves both sides; the document kind selects the control account
--    and the debit/credit orientation, so the two paths cannot drift apart.
CREATE OR REPLACE FUNCTION refs_create_ap_ar_write_off(
  p_tenant uuid,p_entity uuid,p_document uuid,p_period uuid,p_journal_number text,p_journal_date date,
  p_amount numeric,p_write_off_account text,p_attachment_ids uuid[],p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; computed_hash text;
DECLARE doc business_document; period_row accounting_period; control_account text; write_off_row account_master;
DECLARE control_row account_master; kind text; permission text; scope text;
DECLARE journal_id uuid:=gen_random_uuid(); adjustment_id uuid:=gen_random_uuid(); allocation_id uuid:=gen_random_uuid();
DECLARE binding_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb; evidence jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;

  SELECT * INTO doc FROM business_document
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_document FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Write-off target document not found' USING ERRCODE='P0002'; END IF;

  IF doc.document_kind='AP_BILL' THEN
    kind:='AP_BILL_WRITE_OFF'; permission:='AP.BILL.WRITE_OFF.CREATE'; control_account:='291001'; scope:='AP_WRITE_OFF:'||p_entity;
  ELSE
    kind:='AR_INVOICE_WRITE_OFF'; permission:='AR.INVOICE.WRITE_OFF.CREATE'; control_account:='120200'; scope:='AR_WRITE_OFF:'||p_entity;
  END IF;
  PERFORM refs_assert_scope(p_tenant,p_entity,permission);

  computed_hash:=refs_ap_ar_write_off_hash(p_tenant,p_entity,p_document,p_period,p_journal_number,p_journal_date,p_amount,p_write_off_account,p_attachment_ids,p_reason);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'Write-off request hash is not canonical' USING ERRCODE='22023'; END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,scope,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope=scope AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Idempotency key belongs to another actor' USING ERRCODE='42501'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  -- Period control. Same rule as every other accounting command: OPEN and owning the date.
  SELECT * INTO period_row FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR UPDATE;
  IF NOT FOUND OR period_row.status<>'OPEN' OR p_journal_date NOT BETWEEN period_row.starts_on AND period_row.ends_on THEN
    RAISE EXCEPTION 'Write-off period must be OPEN and own the journal date' USING ERRCODE='55000';
  END IF;

  -- The document must still owe something, and the amount must fit inside what it owes. Partial
  -- and full write-offs are both legal; over-writing off is not.
  IF doc.status NOT IN ('APPROVED','OPEN','PARTIALLY_PAID') OR doc.open_balance<=0 OR doc.posted_journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Only a posted document with an open balance can be written off' USING ERRCODE='23514';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_amount>doc.open_balance THEN
    RAISE EXCEPTION 'Write-off amount must be positive and within the open balance' USING ERRCODE='23514';
  END IF;

  -- Accounts are validated, never invented. The control account must be the member-bearing one the
  -- reconciliation reads; the write-off account must exist, be active, and must not be the control
  -- account itself (which would be a no-op that silently unbalances the subledger).
  SELECT * INTO write_off_row FROM account_master
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_write_off_account);
  IF NOT FOUND OR NOT write_off_row.active OR write_off_row.requires_member THEN
    RAISE EXCEPTION 'Write-off account must exist, be active, and must not require a member' USING ERRCODE='23514';
  END IF;
  IF btrim(p_write_off_account)=control_account THEN
    RAISE EXCEPTION 'Write-off account must differ from the control account' USING ERRCODE='23514';
  END IF;
  SELECT * INTO control_row FROM account_master
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=control_account;
  IF NOT FOUND OR NOT control_row.active THEN
    RAISE EXCEPTION 'Control account is unavailable for this entity' USING ERRCODE='23514';
  END IF;

  -- Evidence. refs_transition_journal requires a MANUAL journal to carry attachment evidence
  -- before Submit, and a write-off is exactly the decision that should be documented. This gate is
  -- deliberately STRICTER than refs_create_manual_journal (002:1041-1043), which accepts any
  -- tenant-owned attachment: here the attachment must also be VERIFIED_CLEAN and must belong to
  -- THIS entity, closing the two gaps recorded as D-N21-1.
  IF COALESCE(cardinality(p_attachment_ids),0)=0 THEN
    RAISE EXCEPTION 'Write-off requires attachment evidence' USING ERRCODE='23503';
  END IF;
  IF COALESCE(cardinality(p_attachment_ids),0)<>(
    SELECT count(DISTINCT a.attachment_id) FROM attachment a
     WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
       AND a.attachment_id=ANY(p_attachment_ids) AND a.finalization_status='VERIFIED_CLEAN'
  ) THEN
    RAISE EXCEPTION 'Write-off evidence must be VERIFIED_CLEAN and owned by this entity' USING ERRCODE='23503';
  END IF;

  -- One open write-off per document at a time, so two Drafts cannot together exceed the balance.
  IF EXISTS (
    SELECT 1 FROM business_adjustment
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_document
      AND adjustment_kind IN ('AP_BILL_WRITE_OFF','AR_INVOICE_WRITE_OFF')
      AND status NOT IN ('POSTED','REJECTED','CANCELLED')
  ) THEN RAISE EXCEPTION 'An open write-off already exists for this document' USING ERRCODE='23514'; END IF;

  -- Draft journal. AP: Dr control / Cr write-off. AR: Dr write-off / Cr control.
  --
  -- journal_type is MANUAL, not AUTO, on purpose. In this schema AUTO means "derived from an
  -- ingested staging item": refs_transition_journal (002:1134-1140) requires every AUTO journal to
  -- carry a staging_item source_link and refuses with 23514 otherwise. A write-off has no staging
  -- item -- it is a controller decision about an existing document. AP_BILL_VOID chose AUTO and
  -- then needed migration 032 to text-patch an exemption into refs_transition_journal; choosing
  -- the correct type here avoids adding a second exemption to that already-patched function.
  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
    VALUES(journal_id,p_tenant,p_entity,p_period,btrim(p_journal_number),'MANUAL','DRAFT',p_journal_date,doc.currency,'Write off '||doc.document_kind||' '||doc.document_number,actor);
  IF doc.document_kind='AP_BILL' THEN
    INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions) VALUES
      (p_tenant,p_entity,p_period,journal_id,1,control_account,p_amount,0,doc.counterparty_ref,'Write off '||doc.document_number,'{}'::jsonb),
      (p_tenant,p_entity,p_period,journal_id,2,btrim(p_write_off_account),0,p_amount,NULL,'Write off '||doc.document_number,'{}'::jsonb);
  ELSE
    INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions) VALUES
      (p_tenant,p_entity,p_period,journal_id,1,btrim(p_write_off_account),p_amount,0,NULL,'Write off '||doc.document_number,'{}'::jsonb),
      (p_tenant,p_entity,p_period,journal_id,2,control_account,0,p_amount,doc.counterparty_ref,'Write off '||doc.document_number,'{}'::jsonb);
  END IF;

  IF doc.source_document_id IS NOT NULL THEN
    INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by)
      VALUES(p_tenant,p_entity,'SOURCE_TO_JE',doc.source_document_id,journal_id,actor);
  END IF;

  INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by)
    SELECT p_tenant,p_entity,'JE_ATTACHMENT',journal_id,x,actor FROM unnest(p_attachment_ids) AS x;

  INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,business_document_id,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,original_journal_entry_id,idempotency_key,request_hash,created_by)
    VALUES(adjustment_id,p_tenant,p_entity,kind,p_document,p_amount,doc.currency,p_journal_date,p_period,p_reason,'DRAFT',journal_id,doc.posted_journal_entry_id,p_idempotency_key,p_request_hash,actor);

  -- The allocation is what makes the subledger follow the ledger when the journal posts.
  INSERT INTO business_allocation(business_allocation_id,tenant_id,entity_id,business_document_id,business_adjustment_id,amount,currency,status,created_by)
    VALUES(allocation_id,p_tenant,p_entity,p_document,adjustment_id,p_amount,doc.currency,'PENDING',actor);

  evidence:=jsonb_build_object('business_document_id',p_document,'document_kind',doc.document_kind,
    'amount',to_char(p_amount,'FM999999999999990.0000'),'open_balance_before',to_char(doc.open_balance,'FM999999999999990.0000'),
    'write_off_account_code',btrim(p_write_off_account),'control_account_code',control_account,'counterparty_ref',doc.counterparty_ref);
  INSERT INTO ap_ar_write_off_binding(ap_ar_write_off_binding_id,tenant_id,entity_id,business_adjustment_id,business_document_id,document_kind,write_off_account_code,control_account_code,counterparty_ref,amount,open_balance_before,currency,evidence_hash,created_by)
    VALUES(binding_id,p_tenant,p_entity,adjustment_id,p_document,doc.document_kind,btrim(p_write_off_account),control_account,doc.counterparty_ref,p_amount,doc.open_balance,doc.currency,refs_jsonb_hash(evidence),actor);

  response:=jsonb_build_object('business_adjustment_id',adjustment_id,'ap_ar_write_off_binding_id',binding_id,
    'business_document_id',p_document,'document_kind',doc.document_kind,'journal_entry_id',journal_id,
    'amount',to_char(p_amount,'FM999999999999990.0000'),'status','DRAFT','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(p_tenant,p_entity,kind||'_DRAFT_CREATED','BUSINESS_ADJUSTMENT',adjustment_id,'CREATE_WRITE_OFF',actor,'USER',permission,p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,p_reason);
  event_payload:=jsonb_build_object('business_adjustment_id',adjustment_id,'business_document_id',p_document,'journal_entry_id',journal_id,'status','DRAFT');
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'BUSINESS_ADJUSTMENT',adjustment_id,kind||'_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope=scope AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

REVOKE EXECUTE ON FUNCTION refs_ap_ar_write_off_hash(uuid,uuid,uuid,uuid,text,date,numeric,text,uuid[],text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_create_ap_ar_write_off(uuid,uuid,uuid,uuid,text,date,numeric,text,uuid[],text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ap_ar_write_off_hash(uuid,uuid,uuid,uuid,text,date,numeric,text,uuid[],text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_ap_ar_write_off(uuid,uuid,uuid,uuid,text,date,numeric,text,uuid[],text,text,text) TO refs_app;

COMMIT;
