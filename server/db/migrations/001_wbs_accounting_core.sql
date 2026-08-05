BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE period_status AS ENUM ('OPEN', 'SOFT_CLOSED', 'CLOSED');
CREATE TYPE import_status AS ENUM ('RECEIVED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');
CREATE TYPE source_event_type AS ENUM ('UPSERT', 'TOMBSTONE');
CREATE TYPE source_status AS ENUM (
  'RECEIVED', 'VALIDATING', 'PENDING_MAPPING', 'PENDING_CODING',
  'PENDING_REVIEW', 'READY_FOR_DRAFT', 'DRAFT_CREATED',
  'PENDING_JE_REVIEW', 'PENDING_JE_APPROVAL', 'APPROVED',
  'POSTED', 'RECONCILED', 'DUPLICATE', 'QUARANTINED',
  'MAPPING_EXCEPTION', 'RULE_EXCEPTION', 'EXCLUDED', 'REJECTED', 'REVERSED'
);
CREATE TYPE journal_status AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'POSTED');
CREATE TYPE exception_status AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'WAIVED');
CREATE TYPE outbox_status AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');
CREATE TYPE match_status AS ENUM ('ACTIVE', 'UNMATCHED', 'REVERSED');
CREATE TYPE reconciliation_status AS ENUM ('DRAFT', 'IN_REVIEW', 'RECONCILED', 'REOPENED');

CREATE TABLE tenant (
  tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL UNIQUE CHECK (tenant_code ~ '^[A-Z0-9_-]{2,32}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entity (
  entity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_code text NOT NULL CHECK (length(btrim(entity_code)) BETWEEN 1 AND 64),
  source_system text NOT NULL DEFAULT 'WBS',
  source_entity_id text NOT NULL CHECK (length(btrim(source_entity_id)) BETWEEN 1 AND 128),
  name text NOT NULL,
  base_currency char(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_code),
  UNIQUE (tenant_id, entity_id),
  UNIQUE (tenant_id, entity_id, source_system, source_entity_id),
  UNIQUE (tenant_id, source_system, source_entity_id)
);

CREATE TABLE accounting_period (
  period_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL REFERENCES entity(entity_id),
  ledger_code text NOT NULL DEFAULT 'PRIMARY',
  period_code text NOT NULL CHECK (period_code ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status period_status NOT NULL DEFAULT 'OPEN',
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  closed_by text,
  closed_at timestamptz,
  CHECK (starts_on <= ends_on),
  CHECK ((status = 'OPEN' AND closed_at IS NULL) OR status <> 'OPEN'),
  UNIQUE (tenant_id, entity_id, ledger_code, period_code),
  UNIQUE (tenant_id, period_id),
  UNIQUE (tenant_id, entity_id, period_id)
);

CREATE TABLE sync_cursor (
  sync_cursor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  connector_code text NOT NULL,
  source_module text NOT NULL,
  source_entity_id text NOT NULL,
  cursor_value jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(cursor_value) = 'object'),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  last_success_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, connector_code, source_module, source_entity_id)
);

CREATE TABLE import_batch (
  import_batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  connector_code text NOT NULL,
  source_module text NOT NULL,
  source_entity_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  status import_status NOT NULL DEFAULT 'RECEIVED',
  cursor_before jsonb NOT NULL DEFAULT '{}'::jsonb,
  cursor_after jsonb,
  request_id text,
  row_count bigint NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  UNIQUE (tenant_id, connector_code, source_module, source_entity_id, idempotency_key),
  UNIQUE (tenant_id, import_batch_id),
  CHECK (cursor_after IS NULL OR jsonb_typeof(cursor_after) = 'object')
);

CREATE TABLE raw_event (
  raw_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  import_batch_id uuid NOT NULL REFERENCES import_batch(import_batch_id),
  source_system text NOT NULL,
  source_module text NOT NULL,
  source_entity_id text NOT NULL,
  source_record_id text NOT NULL,
  source_version text NOT NULL,
  event_type source_event_type NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  payload_ref text NOT NULL CHECK (payload_ref ~ '^(object|s3)://'),
  correlation_id text NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  superseded_at timestamptz,
  UNIQUE (tenant_id, source_system, source_module, source_entity_id, source_record_id, source_version),
  UNIQUE (tenant_id, raw_event_id, source_system, source_module, source_entity_id, source_record_id, source_version),
  UNIQUE (tenant_id, raw_event_id),
  CHECK ((is_current AND superseded_at IS NULL) OR (NOT is_current AND superseded_at IS NOT NULL))
);

CREATE UNIQUE INDEX raw_event_one_current_uq
  ON raw_event (tenant_id, source_system, source_module, source_entity_id, source_record_id)
  WHERE is_current;
CREATE INDEX raw_event_import_idx ON raw_event(import_batch_id, received_at, raw_event_id);

CREATE TABLE attachment (
  attachment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 255 AND name !~ '[/\\]'),
  media_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  storage_ref text NOT NULL CHECK (storage_ref ~ '^(object|s3)://'),
  storage_version text NOT NULL,
  uploaded_by text NOT NULL,
  uploaded_at timestamptz NOT NULL,
  verified_at timestamptz,
  scan_status text NOT NULL DEFAULT 'PENDING' CHECK (scan_status IN ('PENDING', 'CLEAN', 'REJECTED', 'ERROR')),
  finalization_status text NOT NULL DEFAULT 'PENDING' CHECK (finalization_status IN ('PENDING', 'VERIFIED_CLEAN', 'REJECTED')),
  finalized_at timestamptz,
  CHECK ((finalization_status = 'VERIFIED_CLEAN' AND verified_at IS NOT NULL AND finalized_at IS NOT NULL AND scan_status = 'CLEAN') OR finalization_status <> 'VERIFIED_CLEAN'),
  UNIQUE (tenant_id, attachment_id),
  UNIQUE (tenant_id, storage_ref, storage_version)
);

CREATE TABLE source_document (
  source_document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL REFERENCES entity(entity_id),
  raw_event_id uuid NOT NULL REFERENCES raw_event(raw_event_id),
  source_system text NOT NULL,
  source_module text NOT NULL,
  source_entity_id text NOT NULL,
  source_record_id text NOT NULL,
  source_version text NOT NULL,
  document_type text NOT NULL,
  document_no text,
  business_date date NOT NULL,
  accounting_date date NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  gross_amount numeric(20,4) NOT NULL,
  status source_status NOT NULL DEFAULT 'RECEIVED',
  source_ref text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, raw_event_id),
  UNIQUE (tenant_id, source_document_id),
  UNIQUE (tenant_id, entity_id, source_document_id),
  UNIQUE (tenant_id, source_system, source_module, source_entity_id, source_record_id, source_version),
  CHECK (source_module IN ('bankFeed', 'payable', 'cost', 'loan', 'pmCharge', 'closing'))
);
COMMENT ON COLUMN source_document.source_module IS 'Normalized accounting sources are allowlisted. Reports and display/read-model modules remain raw evidence only and must be quarantined with REPORT_AS_SOURCE_REJECTED.';

CREATE TABLE source_document_line (
  source_document_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  source_document_id uuid NOT NULL REFERENCES source_document(source_document_id),
  source_line_id text NOT NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  amount numeric(20,4) NOT NULL CHECK (amount >= 0),
  direction text NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT', 'INFLOW', 'OUTFLOW', 'NONE')),
  description text,
  party_ref text,
  bank_account_ref text,
  project_ref text,
  property_ref text,
  phase_ref text,
  unit_ref text,
  loan_ref text,
  cost_code_ref text,
  external_dimension_refs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(external_dimension_refs) = 'object'),
  UNIQUE (tenant_id, source_document_id, source_line_id),
  UNIQUE (tenant_id, source_document_line_id),
  UNIQUE (tenant_id, entity_id, source_document_line_id),
  UNIQUE (tenant_id, source_document_id, source_document_line_id),
  UNIQUE (tenant_id, entity_id, source_document_id, source_document_line_id),
  UNIQUE (tenant_id, source_document_id, line_no)
);

CREATE TABLE setting_snapshot (
  setting_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid REFERENCES entity(entity_id),
  family text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('TENANT', 'ENTITY', 'SHARED_TEMPLATE')),
  scope_key text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  status text NOT NULL CHECK (status IN ('DRAFT', 'APPROVED', 'RETIRED')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK ((status = 'APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR status <> 'APPROVED'),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  UNIQUE (tenant_id, family, scope_type, scope_key, version),
  UNIQUE (tenant_id, setting_snapshot_id)
);

CREATE TABLE mapping_snapshot (
  mapping_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid REFERENCES entity(entity_id),
  family text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('TENANT', 'ENTITY', 'SHARED_TEMPLATE')),
  scope_key text NOT NULL,
  input_key_hash text NOT NULL CHECK (input_key_hash ~ '^sha256:[0-9a-f]{64}$'),
  version bigint NOT NULL CHECK (version > 0),
  priority integer NOT NULL DEFAULT 0,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  status text NOT NULL CHECK (status IN ('DRAFT', 'APPROVED', 'RETIRED')),
  input_keys jsonb NOT NULL CHECK (jsonb_typeof(input_keys) = 'object'),
  output_rules jsonb NOT NULL CHECK (jsonb_typeof(output_rules) = 'object'),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK ((status = 'APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR status <> 'APPROVED'),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  UNIQUE (tenant_id, family, scope_type, scope_key, input_key_hash, version),
  UNIQUE (tenant_id, mapping_snapshot_id)
);
ALTER TABLE mapping_snapshot ADD CONSTRAINT mapping_approved_equal_priority_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =, family WITH =, scope_type WITH =, scope_key WITH =,
    input_key_hash WITH =, priority WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (status = 'APPROVED');
COMMENT ON TABLE mapping_snapshot IS 'Resolver must return exactly one highest-priority APPROVED effective candidate; zero or tied candidates fail closed as MAPPING_MISSING/MAPPING_AMBIGUOUS.';

CREATE TABLE rule_evaluation (
  rule_evaluation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  source_document_id uuid NOT NULL REFERENCES source_document(source_document_id),
  setting_snapshot_id uuid REFERENCES setting_snapshot(setting_snapshot_id),
  mapping_snapshot_id uuid REFERENCES mapping_snapshot(mapping_snapshot_id),
  rule_code text NOT NULL,
  rule_version bigint NOT NULL CHECK (rule_version > 0),
  matched_facts jsonb NOT NULL CHECK (jsonb_typeof(matched_facts) = 'object'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  confidence numeric(6,5) CHECK (confidence BETWEEN 0 AND 1),
  reason text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_document_id, rule_code, rule_version, input_digest),
  UNIQUE (tenant_id, rule_evaluation_id)
);

CREATE TABLE ai_decision (
  ai_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  source_document_id uuid NOT NULL REFERENCES source_document(source_document_id),
  model_id text NOT NULL,
  prompt_version text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_list jsonb NOT NULL CHECK (jsonb_typeof(candidate_list) = 'array'),
  risk jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(risk) = 'object'),
  human_required boolean NOT NULL DEFAULT true,
  human_actor text,
  human_decision_at timestamptz,
  override_diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_document_id, model_id, prompt_version, input_digest),
  UNIQUE (tenant_id, ai_decision_id),
  CHECK ((human_actor IS NULL AND human_decision_at IS NULL) OR (human_actor IS NOT NULL AND human_decision_at IS NOT NULL))
);

CREATE TABLE staging_item (
  staging_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL REFERENCES entity(entity_id),
  source_document_id uuid NOT NULL REFERENCES source_document(source_document_id),
  setting_snapshot_id uuid REFERENCES setting_snapshot(setting_snapshot_id),
  mapping_snapshot_id uuid REFERENCES mapping_snapshot(mapping_snapshot_id),
  rule_evaluation_id uuid REFERENCES rule_evaluation(rule_evaluation_id),
  ai_decision_id uuid REFERENCES ai_decision(ai_decision_id),
  status source_status NOT NULL,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  assigned_to text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_document_id),
  UNIQUE (tenant_id, staging_item_id),
  UNIQUE (tenant_id, entity_id, staging_item_id)
);

CREATE TABLE accounting_exception (
  exception_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid REFERENCES entity(entity_id),
  raw_event_id uuid REFERENCES raw_event(raw_event_id),
  source_document_id uuid REFERENCES source_document(source_document_id),
  staging_item_id uuid REFERENCES staging_item(staging_item_id),
  exception_code text NOT NULL,
  status exception_status NOT NULL DEFAULT 'OPEN',
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  owner text,
  resolved_by text,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK (num_nonnulls(raw_event_id, source_document_id, staging_item_id) >= 1),
  CHECK ((status = 'RESOLVED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL) OR status <> 'RESOLVED')
);
CREATE UNIQUE INDEX accounting_exception_active_uq
  ON accounting_exception (tenant_id, exception_code, COALESCE(raw_event_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(source_document_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(staging_item_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('OPEN', 'IN_REVIEW');

CREATE TABLE journal_entry (
  journal_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL REFERENCES entity(entity_id),
  period_id uuid NOT NULL REFERENCES accounting_period(period_id),
  journal_number text NOT NULL,
  journal_type text NOT NULL CHECK (journal_type IN ('MANUAL', 'AUTO', 'REVERSAL', 'RECLASS')),
  status journal_status NOT NULL DEFAULT 'DRAFT',
  journal_date date NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  description text,
  created_by text NOT NULL,
  reviewed_by text,
  approved_by text,
  posted_by text,
  posted_at timestamptz,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  reversal_of_id uuid REFERENCES journal_entry(journal_entry_id),
  reclass_of_id uuid REFERENCES journal_entry(journal_entry_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (journal_entry_id IS DISTINCT FROM reversal_of_id),
  CHECK (journal_entry_id IS DISTINCT FROM reclass_of_id),
  CHECK ((status = 'POSTED' AND posted_by IS NOT NULL AND posted_at IS NOT NULL) OR status <> 'POSTED'),
  CHECK ((status IN ('PENDING_APPROVAL', 'APPROVED', 'POSTED') AND reviewed_by IS NOT NULL) OR status NOT IN ('PENDING_APPROVAL', 'APPROVED', 'POSTED')),
  CHECK ((status IN ('APPROVED', 'POSTED') AND approved_by IS NOT NULL) OR status NOT IN ('APPROVED', 'POSTED')),
  CHECK (reviewed_by IS NULL OR reviewed_by <> created_by),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK (approved_by IS NULL OR reviewed_by IS NULL OR approved_by <> reviewed_by),
  CHECK (posted_by IS NULL OR posted_by <> created_by),
  CHECK (posted_by IS NULL OR approved_by IS NULL OR posted_by <> approved_by),
  CHECK (posted_by IS NULL OR reviewed_by IS NULL OR posted_by <> reviewed_by),
  UNIQUE (tenant_id, entity_id, journal_number),
  UNIQUE (tenant_id, journal_entry_id),
  UNIQUE (tenant_id, entity_id, journal_entry_id),
  UNIQUE (tenant_id, entity_id, period_id, journal_entry_id)
);

CREATE TABLE journal_line (
  journal_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  period_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL REFERENCES journal_entry(journal_entry_id),
  line_no integer NOT NULL CHECK (line_no > 0),
  account_code text NOT NULL,
  debit_amount numeric(20,4) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount numeric(20,4) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  member_ref text,
  description text,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dimensions) = 'object'),
  CHECK ((debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)),
  UNIQUE (tenant_id, journal_entry_id, line_no),
  UNIQUE (tenant_id, journal_line_id),
  UNIQUE (tenant_id, entity_id, journal_line_id),
  UNIQUE (tenant_id, entity_id, journal_entry_id, journal_line_id),
  UNIQUE (tenant_id, entity_id, period_id, journal_line_id)
);

CREATE TABLE posting_batch (
  posting_batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL REFERENCES entity(entity_id),
  period_id uuid NOT NULL REFERENCES accounting_period(period_id),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  posted_by text NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_id, idempotency_key),
  UNIQUE (tenant_id, posting_batch_id),
  UNIQUE (tenant_id, entity_id, posting_batch_id),
  UNIQUE (tenant_id, entity_id, period_id, posting_batch_id)
);

CREATE TABLE ledger_line (
  ledger_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL REFERENCES entity(entity_id),
  period_id uuid NOT NULL REFERENCES accounting_period(period_id),
  posting_batch_id uuid NOT NULL REFERENCES posting_batch(posting_batch_id),
  journal_entry_id uuid NOT NULL REFERENCES journal_entry(journal_entry_id),
  journal_line_id uuid NOT NULL REFERENCES journal_line(journal_line_id),
  account_code text NOT NULL,
  member_ref text,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  debit_amount numeric(20,4) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount numeric(20,4) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dimensions) = 'object'),
  posted_at timestamptz NOT NULL,
  CHECK ((debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)),
  UNIQUE (tenant_id, journal_line_id),
  UNIQUE (tenant_id, ledger_line_id),
  UNIQUE (tenant_id, entity_id, ledger_line_id),
  UNIQUE (tenant_id, posting_batch_id, journal_entry_id, journal_line_id)
);

CREATE TABLE bank_source (
  bank_source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL REFERENCES entity(entity_id),
  source_document_id uuid NOT NULL REFERENCES source_document(source_document_id),
  source_line_id uuid REFERENCES source_document_line(source_document_line_id),
  bank_account_ref text NOT NULL,
  external_bank_line_id text NOT NULL,
  transaction_date date NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount numeric(20,4) NOT NULL CHECK (amount <> 0),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  UNIQUE (tenant_id, entity_id, bank_account_ref, external_bank_line_id),
  UNIQUE (tenant_id, bank_source_id)
);

CREATE TABLE bank_match (
  bank_match_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL REFERENCES entity(entity_id),
  bank_source_id uuid NOT NULL REFERENCES bank_source(bank_source_id),
  business_source_document_id uuid NOT NULL REFERENCES source_document(source_document_id),
  journal_entry_id uuid REFERENCES journal_entry(journal_entry_id),
  journal_line_id uuid REFERENCES journal_line(journal_line_id),
  candidate_rule_code text,
  amount_delta numeric(20,4) NOT NULL DEFAULT 0,
  currency_match boolean NOT NULL,
  date_delta_days integer,
  status match_status NOT NULL DEFAULT 'ACTIVE',
  matched_by text NOT NULL,
  matched_at timestamptz NOT NULL DEFAULT now(),
  unmatched_by text,
  unmatched_at timestamptz,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK ((status = 'UNMATCHED' AND unmatched_by IS NOT NULL AND unmatched_at IS NOT NULL) OR status <> 'UNMATCHED'),
  CHECK (journal_line_id IS NULL OR journal_entry_id IS NOT NULL),
  UNIQUE (tenant_id, bank_match_id),
  UNIQUE (tenant_id, entity_id, bank_match_id)
);
CREATE UNIQUE INDEX bank_match_one_active_bank_line_uq
  ON bank_match (tenant_id, bank_source_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX bank_match_one_active_business_source_uq
  ON bank_match (tenant_id, business_source_document_id)
  WHERE status = 'ACTIVE' AND business_source_document_id IS NOT NULL;
CREATE UNIQUE INDEX bank_match_one_active_journal_line_uq
  ON bank_match (tenant_id, journal_line_id)
  WHERE status = 'ACTIVE' AND journal_line_id IS NOT NULL;
COMMENT ON TABLE bank_match IS 'ACTIVE matches are one-to-one: a bank line, business source document, or non-null journal line can participate in at most one ACTIVE match.';

CREATE TABLE reconciliation (
  reconciliation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL REFERENCES entity(entity_id),
  bank_account_ref text NOT NULL,
  statement_ending_date date NOT NULL,
  statement_ending_balance numeric(20,4) NOT NULL,
  difference numeric(20,4) NOT NULL DEFAULT 0,
  status reconciliation_status NOT NULL DEFAULT 'DRAFT',
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  reconciled_by text,
  reconciled_at timestamptz,
  reopened_by text,
  reopened_at timestamptz,
  CHECK ((status = 'RECONCILED' AND difference = 0 AND reconciled_by IS NOT NULL AND reconciled_at IS NOT NULL) OR status <> 'RECONCILED'),
  UNIQUE (tenant_id, entity_id, bank_account_ref, statement_ending_date),
  UNIQUE (tenant_id, reconciliation_id),
  UNIQUE (tenant_id, entity_id, reconciliation_id)
);

-- Tenant-scoped foreign keys prevent a valid UUID from being linked across tenants.
ALTER TABLE accounting_period ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);
ALTER TABLE raw_event ADD FOREIGN KEY (tenant_id, import_batch_id) REFERENCES import_batch(tenant_id, import_batch_id);
ALTER TABLE source_document ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);
ALTER TABLE source_document ADD FOREIGN KEY (tenant_id, entity_id, source_system, source_entity_id) REFERENCES entity(tenant_id, entity_id, source_system, source_entity_id);
ALTER TABLE source_document ADD FOREIGN KEY (tenant_id, raw_event_id, source_system, source_module, source_entity_id, source_record_id, source_version) REFERENCES raw_event(tenant_id, raw_event_id, source_system, source_module, source_entity_id, source_record_id, source_version);
ALTER TABLE source_document_line ADD FOREIGN KEY (tenant_id, entity_id, source_document_id) REFERENCES source_document(tenant_id, entity_id, source_document_id);
ALTER TABLE setting_snapshot ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);
ALTER TABLE mapping_snapshot ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);
ALTER TABLE rule_evaluation ADD FOREIGN KEY (tenant_id, source_document_id) REFERENCES source_document(tenant_id, source_document_id);
ALTER TABLE rule_evaluation ADD FOREIGN KEY (tenant_id, setting_snapshot_id) REFERENCES setting_snapshot(tenant_id, setting_snapshot_id);
ALTER TABLE rule_evaluation ADD FOREIGN KEY (tenant_id, mapping_snapshot_id) REFERENCES mapping_snapshot(tenant_id, mapping_snapshot_id);
ALTER TABLE ai_decision ADD FOREIGN KEY (tenant_id, source_document_id) REFERENCES source_document(tenant_id, source_document_id);
ALTER TABLE staging_item ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);
ALTER TABLE staging_item ADD FOREIGN KEY (tenant_id, entity_id, source_document_id) REFERENCES source_document(tenant_id, entity_id, source_document_id);
ALTER TABLE staging_item ADD FOREIGN KEY (tenant_id, setting_snapshot_id) REFERENCES setting_snapshot(tenant_id, setting_snapshot_id);
ALTER TABLE staging_item ADD FOREIGN KEY (tenant_id, mapping_snapshot_id) REFERENCES mapping_snapshot(tenant_id, mapping_snapshot_id);
ALTER TABLE staging_item ADD FOREIGN KEY (tenant_id, rule_evaluation_id) REFERENCES rule_evaluation(tenant_id, rule_evaluation_id);
ALTER TABLE staging_item ADD FOREIGN KEY (tenant_id, ai_decision_id) REFERENCES ai_decision(tenant_id, ai_decision_id);
ALTER TABLE accounting_exception ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);
ALTER TABLE accounting_exception ADD FOREIGN KEY (tenant_id, raw_event_id) REFERENCES raw_event(tenant_id, raw_event_id);
ALTER TABLE accounting_exception ADD FOREIGN KEY (tenant_id, source_document_id) REFERENCES source_document(tenant_id, source_document_id);
ALTER TABLE accounting_exception ADD FOREIGN KEY (tenant_id, staging_item_id) REFERENCES staging_item(tenant_id, staging_item_id);
ALTER TABLE journal_entry ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);
ALTER TABLE journal_entry ADD FOREIGN KEY (tenant_id, entity_id, period_id) REFERENCES accounting_period(tenant_id, entity_id, period_id);
ALTER TABLE journal_entry ADD FOREIGN KEY (tenant_id, entity_id, reversal_of_id) REFERENCES journal_entry(tenant_id, entity_id, journal_entry_id);
ALTER TABLE journal_entry ADD FOREIGN KEY (tenant_id, entity_id, reclass_of_id) REFERENCES journal_entry(tenant_id, entity_id, journal_entry_id);
ALTER TABLE journal_line ADD FOREIGN KEY (tenant_id, entity_id, period_id, journal_entry_id) REFERENCES journal_entry(tenant_id, entity_id, period_id, journal_entry_id);
ALTER TABLE posting_batch ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);
ALTER TABLE posting_batch ADD FOREIGN KEY (tenant_id, entity_id, period_id) REFERENCES accounting_period(tenant_id, entity_id, period_id);
ALTER TABLE ledger_line ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);
ALTER TABLE ledger_line ADD FOREIGN KEY (tenant_id, entity_id, period_id) REFERENCES accounting_period(tenant_id, entity_id, period_id);
ALTER TABLE ledger_line ADD FOREIGN KEY (tenant_id, entity_id, period_id, posting_batch_id) REFERENCES posting_batch(tenant_id, entity_id, period_id, posting_batch_id);
ALTER TABLE ledger_line ADD FOREIGN KEY (tenant_id, entity_id, period_id, journal_entry_id) REFERENCES journal_entry(tenant_id, entity_id, period_id, journal_entry_id);
ALTER TABLE ledger_line ADD FOREIGN KEY (tenant_id, entity_id, period_id, journal_line_id) REFERENCES journal_line(tenant_id, entity_id, period_id, journal_line_id);
ALTER TABLE bank_source ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);
ALTER TABLE bank_source ADD FOREIGN KEY (tenant_id, entity_id, source_document_id) REFERENCES source_document(tenant_id, entity_id, source_document_id);
ALTER TABLE bank_source ADD FOREIGN KEY (tenant_id, entity_id, source_document_id, source_line_id) REFERENCES source_document_line(tenant_id, entity_id, source_document_id, source_document_line_id);
ALTER TABLE bank_match ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);
ALTER TABLE bank_source ADD CONSTRAINT bank_source_tenant_entity_id_uq UNIQUE (tenant_id, entity_id, bank_source_id);
ALTER TABLE bank_match ADD FOREIGN KEY (tenant_id, entity_id, bank_source_id) REFERENCES bank_source(tenant_id, entity_id, bank_source_id);
ALTER TABLE bank_match ADD FOREIGN KEY (tenant_id, entity_id, business_source_document_id) REFERENCES source_document(tenant_id, entity_id, source_document_id);
ALTER TABLE bank_match ADD FOREIGN KEY (tenant_id, entity_id, journal_entry_id) REFERENCES journal_entry(tenant_id, entity_id, journal_entry_id);
ALTER TABLE bank_match ADD FOREIGN KEY (tenant_id, entity_id, journal_entry_id, journal_line_id) REFERENCES journal_line(tenant_id, entity_id, journal_entry_id, journal_line_id);
ALTER TABLE reconciliation ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);

CREATE TABLE source_link (
  source_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  link_type text NOT NULL,
  raw_event_id uuid REFERENCES raw_event(raw_event_id),
  source_document_id uuid REFERENCES source_document(source_document_id),
  source_document_line_id uuid REFERENCES source_document_line(source_document_line_id),
  staging_item_id uuid REFERENCES staging_item(staging_item_id),
  journal_entry_id uuid REFERENCES journal_entry(journal_entry_id),
  journal_line_id uuid REFERENCES journal_line(journal_line_id),
  posting_batch_id uuid REFERENCES posting_batch(posting_batch_id),
  ledger_line_id uuid REFERENCES ledger_line(ledger_line_id),
  bank_source_id uuid REFERENCES bank_source(bank_source_id),
  bank_match_id uuid REFERENCES bank_match(bank_match_id),
  reconciliation_id uuid REFERENCES reconciliation(reconciliation_id),
  attachment_id uuid REFERENCES attachment(attachment_id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(raw_event_id, source_document_id, source_document_line_id, staging_item_id, journal_entry_id, journal_line_id, posting_batch_id, ledger_line_id, bank_source_id, bank_match_id, reconciliation_id, attachment_id) >= 2),
  UNIQUE NULLS NOT DISTINCT (tenant_id, entity_id, link_type, raw_event_id, source_document_id, source_document_line_id, staging_item_id, journal_entry_id, journal_line_id, posting_batch_id, ledger_line_id, bank_source_id, bank_match_id, reconciliation_id, attachment_id)
);
COMMENT ON TABLE source_link IS 'Trace links use immutable IDs only; descriptions, document numbers and journal numbers are never link keys.';

ALTER TABLE source_link ADD FOREIGN KEY (tenant_id, raw_event_id) REFERENCES raw_event(tenant_id, raw_event_id);
ALTER TABLE source_link ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);
ALTER TABLE source_link ADD FOREIGN KEY (tenant_id, entity_id, source_document_id) REFERENCES source_document(tenant_id, entity_id, source_document_id);
ALTER TABLE source_link ADD FOREIGN KEY (tenant_id, entity_id, source_document_line_id) REFERENCES source_document_line(tenant_id, entity_id, source_document_line_id);
ALTER TABLE source_link ADD FOREIGN KEY (tenant_id, entity_id, staging_item_id) REFERENCES staging_item(tenant_id, entity_id, staging_item_id);
ALTER TABLE source_link ADD FOREIGN KEY (tenant_id, entity_id, journal_entry_id) REFERENCES journal_entry(tenant_id, entity_id, journal_entry_id);
ALTER TABLE source_link ADD FOREIGN KEY (tenant_id, entity_id, journal_line_id) REFERENCES journal_line(tenant_id, entity_id, journal_line_id);
ALTER TABLE source_link ADD FOREIGN KEY (tenant_id, entity_id, posting_batch_id) REFERENCES posting_batch(tenant_id, entity_id, posting_batch_id);
ALTER TABLE source_link ADD FOREIGN KEY (tenant_id, entity_id, ledger_line_id) REFERENCES ledger_line(tenant_id, entity_id, ledger_line_id);
ALTER TABLE source_link ADD FOREIGN KEY (tenant_id, entity_id, bank_source_id) REFERENCES bank_source(tenant_id, entity_id, bank_source_id);
ALTER TABLE source_link ADD FOREIGN KEY (tenant_id, entity_id, bank_match_id) REFERENCES bank_match(tenant_id, entity_id, bank_match_id);
ALTER TABLE source_link ADD FOREIGN KEY (tenant_id, entity_id, reconciliation_id) REFERENCES reconciliation(tenant_id, entity_id, reconciliation_id);
ALTER TABLE source_link ADD FOREIGN KEY (tenant_id, attachment_id) REFERENCES attachment(tenant_id, attachment_id);

CREATE TABLE idempotency_receipt (
  idempotency_receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  operation_scope text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED')),
  response_status integer,
  response_body jsonb,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, operation_scope, idempotency_key)
);
COMMENT ON COLUMN idempotency_receipt.request_hash IS 'A repeated key with a different request_hash is rejected; it never creates a second receipt.';

CREATE TABLE audit_event (
  audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid REFERENCES entity(entity_id),
  event_type text NOT NULL,
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  action text NOT NULL,
  actor_id text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('USER', 'SERVICE_ACCOUNT', 'SYSTEM')),
  permission_used text,
  request_id text NOT NULL,
  correlation_id text NOT NULL,
  idempotency_key text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  before_hash text CHECK (before_hash IS NULL OR before_hash ~ '^sha256:[0-9a-f]{64}$'),
  after_hash text CHECK (after_hash IS NULL OR after_hash ~ '^sha256:[0-9a-f]{64}$'),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object')
);
ALTER TABLE audit_event ADD FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id);

CREATE TABLE outbox_event (
  outbox_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  status outbox_status NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, aggregate_type, aggregate_id, event_type, payload_hash)
);

CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION protect_posted_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted journal entries are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_posted_journal_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_parent_status journal_status; new_parent_status journal_status; locked_parent record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- A stable tenant/UUID lock order prevents two concurrent parent swaps from deadlocking.
    FOR locked_parent IN
      SELECT tenant_id, journal_entry_id, status
      FROM journal_entry
      WHERE (tenant_id = OLD.tenant_id AND journal_entry_id = OLD.journal_entry_id)
         OR (tenant_id = NEW.tenant_id AND journal_entry_id = NEW.journal_entry_id)
      ORDER BY tenant_id, journal_entry_id
      FOR UPDATE
    LOOP
      IF locked_parent.tenant_id = OLD.tenant_id AND locked_parent.journal_entry_id = OLD.journal_entry_id THEN
        old_parent_status := locked_parent.status;
      END IF;
      IF locked_parent.tenant_id = NEW.tenant_id AND locked_parent.journal_entry_id = NEW.journal_entry_id THEN
        new_parent_status := locked_parent.status;
      END IF;
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT status INTO old_parent_status
      FROM journal_entry
      WHERE tenant_id = OLD.tenant_id AND journal_entry_id = OLD.journal_entry_id
      FOR UPDATE;
  ELSE
    SELECT status INTO new_parent_status
      FROM journal_entry
      WHERE tenant_id = NEW.tenant_id AND journal_entry_id = NEW.journal_entry_id
      FOR UPDATE;
  END IF;
  IF old_parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'Lines of a Posted journal are immutable' USING ERRCODE = '55000';
  END IF;
  IF new_parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'Lines of a Posted journal are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION protect_posted_journal_line() IS 'Locks OLD and NEW parent JE rows in tenant/UUID order. Posting must lock JE FOR UPDATE first, then its lines in journal_line_id order, validate, insert ledger/audit/outbox, and only then mark the JE POSTED.';

CREATE OR REPLACE FUNCTION enforce_source_link_entity_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.raw_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM raw_event r
    JOIN entity e
      ON e.tenant_id = r.tenant_id
     AND e.source_system = r.source_system
     AND e.source_entity_id = r.source_entity_id
    WHERE r.tenant_id = NEW.tenant_id
      AND r.raw_event_id = NEW.raw_event_id
      AND e.entity_id = NEW.entity_id
  ) THEN
    RAISE EXCEPTION 'Raw event does not belong to the source link entity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION require_finalized_source_link_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attachment_state text;
BEGIN
  IF NEW.attachment_id IS NOT NULL THEN
    SELECT finalization_status INTO attachment_state
      FROM attachment
      WHERE tenant_id = NEW.tenant_id AND attachment_id = NEW.attachment_id;
    IF attachment_state IS DISTINCT FROM 'VERIFIED_CLEAN' THEN
      RAISE EXCEPTION 'Attachment must be VERIFIED_CLEAN before it enters the trace graph' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_entry_posted_immutable
  BEFORE UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION protect_posted_journal();
CREATE TRIGGER journal_line_posted_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION protect_posted_journal_line();
CREATE TRIGGER ledger_line_append_only
  BEFORE UPDATE OR DELETE ON ledger_line
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER source_link_append_only
  BEFORE UPDATE OR DELETE ON source_link
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER source_link_attachment_finalized
  BEFORE INSERT ON source_link
  FOR EACH ROW EXECUTE FUNCTION require_finalized_source_link_attachment();
CREATE TRIGGER source_link_entity_scope
  BEFORE INSERT ON source_link
  FOR EACH ROW EXECUTE FUNCTION enforce_source_link_entity_scope();

COMMENT ON TABLE posting_batch IS 'Posting transaction lock order: accounting_period FOR UPDATE; journal_entry FOR UPDATE; journal_line rows FOR UPDATE ordered by journal_line_id; then validate RBAC/SoD/account/member/balance, reserve idempotency, insert posting batch/ledger/source links/audit/outbox, mark JE POSTED, and commit.';
COMMENT ON TRIGGER journal_line_posted_immutable ON journal_line IS 'Required two-connection test: A locks JE then lines and posts; B line UPDATE blocks on the parent lock and after A COMMIT fails with SQLSTATE 55000. Reverse scheduling (B locks parent through line trigger first) makes A wait, then A revalidates the changed lines before posting.';
COMMENT ON TABLE raw_event IS 'WBS payloads are ingested read-only; no schema object authorizes writes back to WBS.';

COMMIT;
