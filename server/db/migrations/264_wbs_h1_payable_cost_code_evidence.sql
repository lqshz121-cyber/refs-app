BEGIN;

CREATE TABLE wbs_h1_payable_cost_code_stage(
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  company_code text NOT NULL CHECK(company_code ~ '^[A-Z0-9][A-Z0-9_:-]{0,63}$'),
  source_record_hash text NOT NULL CHECK(source_record_hash ~ '^sha256:[0-9a-f]{64}$'),
  cost_code text NOT NULL CHECK(length(cost_code) BETWEEN 1 AND 128 AND cost_code !~ '[[:cntrl:]]'),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  staged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,entity_id,source_record_hash),
  UNIQUE(tenant_id,entity_id,evidence_hash),
  FOREIGN KEY(tenant_id,entity_id,source_record_hash)
    REFERENCES wbs_h1_payable_mapping_source_stage(tenant_id,entity_id,source_record_hash)
);

CREATE INDEX wbs_h1_payable_cost_code_stage_scope_idx
  ON wbs_h1_payable_cost_code_stage(tenant_id,company_code,source_record_hash);

CREATE TRIGGER wbs_h1_payable_cost_code_stage_append_only
  BEFORE UPDATE OR DELETE ON wbs_h1_payable_cost_code_stage
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

REVOKE ALL ON TABLE wbs_h1_payable_cost_code_stage FROM PUBLIC,refs_app;

COMMIT;
