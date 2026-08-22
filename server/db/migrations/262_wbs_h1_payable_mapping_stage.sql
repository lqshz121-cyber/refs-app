BEGIN;

CREATE TABLE wbs_h1_payable_mapping_source_stage(
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  company_code text NOT NULL CHECK(company_code ~ '^[A-Z0-9][A-Z0-9_:-]{0,63}$'),
  period_code text NOT NULL CHECK(period_code ~ '^2026-0[1-6]$'),
  wbs_uuid text NOT NULL CHECK(length(wbs_uuid) BETWEEN 1 AND 128 AND wbs_uuid !~ '[[:cntrl:]]'),
  source_record_hash text NOT NULL CHECK(source_record_hash ~ '^sha256:[0-9a-f]{64}$'),
  accounting_date date NOT NULL CHECK(accounting_date BETWEEN DATE '2026-01-01' AND DATE '2026-06-30'),
  amount numeric(24,4) NOT NULL CHECK(amount > 0),
  project_code text,
  cost_code text,
  vendor_no text,
  source_fact_hash text NOT NULL CHECK(source_fact_hash ~ '^sha256:[0-9a-f]{64}$'),
  provider_content_hash text NOT NULL CHECK(provider_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  captured_at timestamptz NOT NULL,
  staged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,entity_id,source_record_hash),
  UNIQUE(tenant_id,entity_id,wbs_uuid),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  CHECK(project_code IS NULL OR length(project_code) BETWEEN 1 AND 128 AND project_code !~ '[[:cntrl:]]'),
  CHECK(cost_code IS NULL OR length(cost_code) BETWEEN 1 AND 128 AND cost_code !~ '[[:cntrl:]]'),
  CHECK(vendor_no IS NULL OR length(vendor_no) BETWEEN 1 AND 128 AND vendor_no !~ '[[:cntrl:]]')
);

CREATE TABLE wbs_h1_accounting_setting_stage(
  tenant_id uuid NOT NULL,
  company_code text NOT NULL CHECK(company_code ~ '^[A-Z0-9][A-Z0-9_:-]{0,63}$'),
  setting_id bigint NOT NULL CHECK(setting_id > 0),
  setting_type text NOT NULL CHECK(length(setting_type) BETWEEN 1 AND 64),
  category text NOT NULL CHECK(length(category) BETWEEN 1 AND 64),
  business_type integer NOT NULL,
  detail text NOT NULL CHECK(length(detail) <= 128),
  project_codes text NOT NULL CHECK(length(project_codes) <= 4000),
  journal_code text NOT NULL CHECK(journal_code='' OR journal_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  account_name text NOT NULL CHECK(length(account_name) <= 255),
  supplementary text NOT NULL CHECK(length(supplementary) <= 64),
  effective_from date NOT NULL,
  effective_to date NOT NULL,
  setting_hash text NOT NULL CHECK(setting_hash ~ '^sha256:[0-9a-f]{64}$'),
  staged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,company_code,setting_id,setting_hash),
  CHECK(effective_from <= effective_to)
);

CREATE INDEX wbs_h1_payable_mapping_source_stage_scope_idx
  ON wbs_h1_payable_mapping_source_stage(tenant_id,company_code,period_code,source_record_hash);
CREATE INDEX wbs_h1_accounting_setting_stage_match_idx
  ON wbs_h1_accounting_setting_stage(tenant_id,company_code,business_type,category,setting_type,detail,effective_from,effective_to);

CREATE TRIGGER wbs_h1_payable_mapping_source_stage_append_only
  BEFORE UPDATE OR DELETE ON wbs_h1_payable_mapping_source_stage
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_h1_accounting_setting_stage_append_only
  BEFORE UPDATE OR DELETE ON wbs_h1_accounting_setting_stage
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

REVOKE ALL ON TABLE wbs_h1_payable_mapping_source_stage FROM PUBLIC,refs_app;
REVOKE ALL ON TABLE wbs_h1_accounting_setting_stage FROM PUBLIC,refs_app;

COMMIT;
