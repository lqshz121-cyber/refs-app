BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('AP.BILL.VOID.CREATE','AP','CRITICAL','AP_ADJUSTMENT_MAKER'),
  ('AP.BILL.VOID.APPROVE','AP','CRITICAL','AP_ADJUSTMENT_APPROVE'),
  ('AP.VENDOR_CREDIT.CREATE','AP','HIGH','AP_ADJUSTMENT_MAKER'),
  ('AP.VENDOR_CREDIT.APPLY','AP','HIGH','AP_ALLOCATION_MAKER'),
  ('AP.PAYMENT.REVERSE','AP','CRITICAL','AP_REVERSAL_MAKER'),
  ('AR.CREDIT_MEMO.CREATE','AR','HIGH','AR_ADJUSTMENT_MAKER'),
  ('AR.CREDIT_MEMO.APPLY','AR','HIGH','AR_ALLOCATION_MAKER'),
  ('AR.REFUND.CREATE','AR','CRITICAL','AR_REFUND_MAKER'),
  ('AR.RECEIPT.REVERSE','AR','CRITICAL','AR_REVERSAL_MAKER')
ON CONFLICT (permission_code) DO UPDATE
  SET domain=EXCLUDED.domain,
      active=true,
      risk_class=EXCLUDED.risk_class,
      sod_class=EXCLUDED.sod_class,
      version=permission_catalog.version+1,
      effective_to=NULL;

CREATE TABLE business_document (
  business_document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  source_document_id uuid,
  document_kind text NOT NULL CHECK (document_kind IN ('AP_BILL','AR_INVOICE')),
  document_number text NOT NULL CHECK (length(btrim(document_number)) BETWEEN 1 AND 128),
  counterparty_ref text NOT NULL CHECK (length(btrim(counterparty_ref)) BETWEEN 1 AND 128),
  counterparty_name text NOT NULL CHECK (length(btrim(counterparty_name)) BETWEEN 1 AND 255),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  accounting_date date NOT NULL,
  due_date date,
  gross_amount numeric(20,4) NOT NULL CHECK (gross_amount > 0),
  posted_debit_adjustments numeric(20,4) NOT NULL DEFAULT 0 CHECK (posted_debit_adjustments >= 0),
  posted_credit_adjustments numeric(20,4) NOT NULL DEFAULT 0 CHECK (posted_credit_adjustments >= 0),
  open_balance numeric(20,4) NOT NULL CHECK (open_balance >= 0),
  status text NOT NULL CHECK (status IN ('DRAFT','PENDING_POST','APPROVED','OPEN','PARTIALLY_PAID','PAID','VOID','REVERSED')),
  posted_journal_entry_id uuid,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (open_balance <= gross_amount + posted_debit_adjustments),
  UNIQUE (tenant_id, entity_id, business_document_id),
  UNIQUE (tenant_id, entity_id, document_kind, document_number),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id),
  FOREIGN KEY (tenant_id, entity_id, source_document_id) REFERENCES source_document(tenant_id, entity_id, source_document_id),
  FOREIGN KEY (tenant_id, entity_id, posted_journal_entry_id) REFERENCES journal_entry(tenant_id, entity_id, journal_entry_id)
);
COMMENT ON TABLE business_document IS 'AP/AR subsidiary document state is derived from posted allocations; Draft/Pending adjustments never change open_balance.';

CREATE TABLE payment_occurrence (
  payment_occurrence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  business_document_id uuid NOT NULL,
  occurrence_kind text NOT NULL CHECK (occurrence_kind IN ('AP_PAYMENT','AR_RECEIPT')),
  source_document_id uuid,
  amount numeric(20,4) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  accounting_date date NOT NULL,
  period_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','PENDING_POST','POSTED','REVERSAL_PENDING','REVERSED')),
  draft_journal_entry_id uuid,
  posted_journal_entry_id uuid,
  reversed_by_occurrence_id uuid,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, entity_id, payment_occurrence_id),
  UNIQUE (tenant_id, entity_id, occurrence_kind, idempotency_key),
  UNIQUE (tenant_id, entity_id, posted_journal_entry_id),
  FOREIGN KEY (tenant_id, entity_id, business_document_id) REFERENCES business_document(tenant_id, entity_id, business_document_id),
  FOREIGN KEY (tenant_id, entity_id, period_id) REFERENCES accounting_period(tenant_id, entity_id, period_id),
  FOREIGN KEY (tenant_id, entity_id, source_document_id) REFERENCES source_document(tenant_id, entity_id, source_document_id),
  FOREIGN KEY (tenant_id, entity_id, draft_journal_entry_id) REFERENCES journal_entry(tenant_id, entity_id, journal_entry_id),
  FOREIGN KEY (tenant_id, entity_id, posted_journal_entry_id) REFERENCES journal_entry(tenant_id, entity_id, journal_entry_id),
  FOREIGN KEY (tenant_id, entity_id, reversed_by_occurrence_id) REFERENCES payment_occurrence(tenant_id, entity_id, payment_occurrence_id)
);

CREATE TABLE business_adjustment (
  business_adjustment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  adjustment_kind text NOT NULL CHECK (adjustment_kind IN ('AP_BILL_VOID','AP_VENDOR_CREDIT','AP_PAYMENT_REVERSAL','AR_CREDIT_MEMO','AR_REFUND','AR_RECEIPT_REVERSAL')),
  business_document_id uuid,
  source_occurrence_id uuid,
  source_adjustment_id uuid,
  amount numeric(20,4) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  accounting_date date NOT NULL,
  period_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  status text NOT NULL CHECK (status IN ('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED_PENDING_POST','POSTED','REJECTED','CANCELLED')),
  draft_journal_entry_id uuid,
  posted_journal_entry_id uuid,
  original_journal_entry_id uuid,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, entity_id, business_adjustment_id),
  UNIQUE (tenant_id, entity_id, adjustment_kind, idempotency_key),
  UNIQUE (tenant_id, entity_id, posted_journal_entry_id),
  CHECK (
    (adjustment_kind IN ('AP_VENDOR_CREDIT','AR_CREDIT_MEMO') AND business_document_id IS NULL)
    OR (adjustment_kind = 'AP_BILL_VOID' AND business_document_id IS NOT NULL)
    OR (adjustment_kind = 'AR_REFUND' AND source_adjustment_id IS NOT NULL)
    OR (adjustment_kind IN ('AP_PAYMENT_REVERSAL','AR_RECEIPT_REVERSAL') AND source_occurrence_id IS NOT NULL)
  ),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id),
  FOREIGN KEY (tenant_id, entity_id, business_document_id) REFERENCES business_document(tenant_id, entity_id, business_document_id),
  FOREIGN KEY (tenant_id, entity_id, source_occurrence_id) REFERENCES payment_occurrence(tenant_id, entity_id, payment_occurrence_id),
  FOREIGN KEY (tenant_id, entity_id, source_adjustment_id) REFERENCES business_adjustment(tenant_id, entity_id, business_adjustment_id),
  FOREIGN KEY (tenant_id, entity_id, period_id) REFERENCES accounting_period(tenant_id, entity_id, period_id),
  FOREIGN KEY (tenant_id, entity_id, draft_journal_entry_id) REFERENCES journal_entry(tenant_id, entity_id, journal_entry_id),
  FOREIGN KEY (tenant_id, entity_id, posted_journal_entry_id) REFERENCES journal_entry(tenant_id, entity_id, journal_entry_id),
  FOREIGN KEY (tenant_id, entity_id, original_journal_entry_id) REFERENCES journal_entry(tenant_id, entity_id, journal_entry_id)
);

CREATE TABLE business_allocation (
  business_allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  business_document_id uuid NOT NULL,
  payment_occurrence_id uuid,
  business_adjustment_id uuid,
  amount numeric(20,4) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL CHECK (status IN ('PENDING','ACTIVE','REVERSED')),
  posted_journal_entry_id uuid,
  reversed_by_allocation_id uuid,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (num_nonnulls(payment_occurrence_id,business_adjustment_id)=1),
  CHECK ((status='PENDING' AND posted_journal_entry_id IS NULL) OR (status<>'PENDING' AND posted_journal_entry_id IS NOT NULL)),
  UNIQUE (tenant_id, entity_id, business_allocation_id),
  UNIQUE (tenant_id, entity_id, payment_occurrence_id, business_document_id, business_allocation_id),
  UNIQUE (tenant_id, entity_id, business_adjustment_id, business_document_id, business_allocation_id),
  FOREIGN KEY (tenant_id, entity_id, business_document_id) REFERENCES business_document(tenant_id, entity_id, business_document_id),
  FOREIGN KEY (tenant_id, entity_id, payment_occurrence_id) REFERENCES payment_occurrence(tenant_id, entity_id, payment_occurrence_id),
  FOREIGN KEY (tenant_id, entity_id, business_adjustment_id) REFERENCES business_adjustment(tenant_id, entity_id, business_adjustment_id),
  FOREIGN KEY (tenant_id, entity_id, posted_journal_entry_id) REFERENCES journal_entry(tenant_id, entity_id, journal_entry_id),
  FOREIGN KEY (tenant_id, entity_id, reversed_by_allocation_id) REFERENCES business_allocation(tenant_id, entity_id, business_allocation_id)
);
CREATE INDEX business_allocation_document_active_idx ON business_allocation(tenant_id,entity_id,business_document_id,status);
COMMENT ON TABLE business_allocation IS 'Only ACTIVE allocations reduce open balance; PENDING allocations are reservations for transaction-time validation and never affect aging.';

CREATE TABLE je_reversal_link (
  je_reversal_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  original_journal_entry_id uuid NOT NULL,
  reversal_journal_entry_id uuid NOT NULL,
  business_adjustment_id uuid,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, entity_id, original_journal_entry_id),
  UNIQUE (tenant_id, entity_id, reversal_journal_entry_id),
  CHECK (original_journal_entry_id IS DISTINCT FROM reversal_journal_entry_id),
  FOREIGN KEY (tenant_id, entity_id, original_journal_entry_id) REFERENCES journal_entry(tenant_id, entity_id, journal_entry_id),
  FOREIGN KEY (tenant_id, entity_id, reversal_journal_entry_id) REFERENCES journal_entry(tenant_id, entity_id, journal_entry_id),
  FOREIGN KEY (tenant_id, entity_id, business_adjustment_id) REFERENCES business_adjustment(tenant_id, entity_id, business_adjustment_id)
);
COMMENT ON TABLE je_reversal_link IS 'Original Posted JE and ledger remain immutable; business reversals append a Draft/Posted reversal JE and link here.';

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['business_document','payment_occurrence','business_adjustment','business_allocation','je_reversal_link'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY %I_scope_policy ON %I USING (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))',table_name,table_name);
  END LOOP;
END;
$$;

GRANT SELECT ON business_document,payment_occurrence,business_adjustment,business_allocation,je_reversal_link TO refs_app;

COMMIT;
