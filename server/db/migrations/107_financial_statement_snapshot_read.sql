BEGIN;

-- A statement snapshot is an approved, immutable presentation of already-posted
-- ledger evidence.  It deliberately does not create or alter a journal.
CREATE TABLE financial_statement_snapshot (
  financial_statement_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  period_id uuid NOT NULL,
  version bigint NOT NULL CHECK(version>0),
  currency char(3) NOT NULL,
  snapshot_hash text NOT NULL CHECK(snapshot_hash~'^sha256:[0-9a-f]{64}$'),
  ledger_evidence_hash text NOT NULL CHECK(ledger_evidence_hash~'^sha256:[0-9a-f]{64}$'),
  prepared_by text NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(prepared_by<>approved_by),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  UNIQUE(tenant_id,entity_id,period_id,version),
  UNIQUE(financial_statement_snapshot_id,tenant_id,entity_id,period_id)
);

CREATE TABLE financial_statement_snapshot_row (
  financial_statement_snapshot_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  period_id uuid NOT NULL,
  statement_type text NOT NULL CHECK(statement_type IN ('TRIAL_BALANCE','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW')),
  statement_section text NOT NULL,
  classification_basis text NOT NULL,
  account_code text NOT NULL CHECK(account_code~'^[0-9A-Za-z._-]{1,64}$'),
  account_name text NOT NULL,
  opening_debit numeric(20,4) NOT NULL,
  opening_credit numeric(20,4) NOT NULL,
  period_debit numeric(20,4) NOT NULL,
  period_credit numeric(20,4) NOT NULL,
  ending_debit numeric(20,4) NOT NULL,
  ending_credit numeric(20,4) NOT NULL,
  display_balance numeric(20,4) NOT NULL,
  journal_entry_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  journal_line_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ledger_line_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  source_document_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  row_hash text NOT NULL CHECK(row_hash~'^sha256:[0-9a-f]{64}$'),
  PRIMARY KEY(financial_statement_snapshot_id,statement_type,account_code),
  FOREIGN KEY(financial_statement_snapshot_id,tenant_id,entity_id,period_id) REFERENCES financial_statement_snapshot(financial_statement_snapshot_id,tenant_id,entity_id,period_id)
);

CREATE INDEX financial_statement_snapshot_read_idx ON financial_statement_snapshot(tenant_id,entity_id,period_id,version DESC);
ALTER TABLE financial_statement_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_statement_snapshot_row ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_statement_snapshot_scope_policy ON financial_statement_snapshot
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY financial_statement_snapshot_row_scope_policy ON financial_statement_snapshot_row
  USING(EXISTS(SELECT 1 FROM financial_statement_snapshot s WHERE s.financial_statement_snapshot_id=financial_statement_snapshot_row.financial_statement_snapshot_id AND s.tenant_id=refs_current_tenant() AND refs_entity_allowed(s.entity_id)))
  WITH CHECK(false);
CREATE TRIGGER financial_statement_snapshot_append_only BEFORE UPDATE OR DELETE ON financial_statement_snapshot FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER financial_statement_snapshot_row_append_only BEFORE UPDATE OR DELETE ON financial_statement_snapshot_row FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_get_financial_statement_snapshot(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS TABLE(
  financial_statement_snapshot_id uuid,version text,currency char(3),snapshot_hash text,ledger_evidence_hash text,
  prepared_by text,approved_by text,approved_at timestamptz,captured_at timestamptz,
  statement_type text,statement_section text,classification_basis text,account_code text,account_name text,
  opening_debit numeric(20,4),opening_credit numeric(20,4),period_debit numeric(20,4),period_credit numeric(20,4),
  ending_debit numeric(20,4),ending_credit numeric(20,4),display_balance numeric(20,4),
  journal_entry_ids uuid[],journal_line_ids uuid[],ledger_line_ids uuid[],source_document_ids uuid[],row_hash text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF NOT EXISTS(SELECT 1 FROM public.accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period) THEN
    RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH latest AS (
    SELECT s.* FROM public.financial_statement_snapshot s
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.period_id=p_period
    ORDER BY s.version DESC,s.financial_statement_snapshot_id DESC LIMIT 1
  )
  SELECT s.financial_statement_snapshot_id,s.version::text,s.currency,s.snapshot_hash,s.ledger_evidence_hash,
    s.prepared_by,s.approved_by,s.approved_at,s.captured_at,
    r.statement_type,r.statement_section,r.classification_basis,r.account_code,r.account_name,
    r.opening_debit,r.opening_credit,r.period_debit,r.period_credit,r.ending_debit,r.ending_credit,r.display_balance,
    r.journal_entry_ids,r.journal_line_ids,r.ledger_line_ids,r.source_document_ids,r.row_hash
  FROM latest s JOIN public.financial_statement_snapshot_row r ON r.financial_statement_snapshot_id=s.financial_statement_snapshot_id
  ORDER BY r.statement_type,r.statement_section,r.account_code;
END;$$;

REVOKE ALL ON financial_statement_snapshot,financial_statement_snapshot_row FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_get_financial_statement_snapshot(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_financial_statement_snapshot(uuid,uuid,uuid) TO refs_app;

COMMIT;
