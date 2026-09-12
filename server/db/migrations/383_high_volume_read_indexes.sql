BEGIN;
-- High-volume readers must reach their bounded page through tenant/entity scoped
-- ordered indexes. These indexes do not alter evidence, permissions, or row shape.
CREATE INDEX bank_source_read_scope_keyset_idx
  ON bank_source(tenant_id,entity_id,bank_account_ref,transaction_date DESC,external_bank_line_id DESC,bank_source_id DESC);
CREATE INDEX bank_match_reader_latest_idx
  ON bank_match(tenant_id,entity_id,bank_source_id,matched_at DESC,bank_match_id DESC);
CREATE INDEX ledger_line_gl_snapshot_join_idx
  ON ledger_line(tenant_id,entity_id,journal_entry_id,posted_at,ledger_line_id);
CREATE INDEX financial_statement_snapshot_proposal_queue_idx
  ON financial_statement_snapshot_proposal(tenant_id,entity_id,period_id,prepared_at DESC,financial_statement_snapshot_proposal_id DESC);
CREATE INDEX wbs_h1_payable_mapping_source_stage_page_idx
  ON wbs_h1_payable_mapping_source_stage(tenant_id,entity_id,company_code,period_code,accounting_date,source_record_hash);
COMMIT;
