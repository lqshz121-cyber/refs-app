BEGIN;

-- Budget facts are admitted only from an already approved immutable snapshot.
-- This read does not manufacture a budget from a project name, WBS status,
-- prior-year actual, cost code, or a browser fixture.  A budget line states
-- its comparison polarity explicitly, so report arithmetic never infers a
-- sign from an account number or label.
CREATE TABLE budget_snapshot (
  budget_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  period_id uuid NOT NULL,
  version bigint NOT NULL CHECK(version>0),
  currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
  source_ref text NOT NULL CHECK(length(btrim(source_ref)) BETWEEN 1 AND 500),
  source_version text NOT NULL CHECK(length(btrim(source_version)) BETWEEN 1 AND 160),
  receipt_hash text NOT NULL CHECK(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  snapshot_hash text NOT NULL CHECK(snapshot_hash~'^sha256:[0-9a-f]{64}$'),
  prepared_by text NOT NULL CHECK(length(btrim(prepared_by))>0),
  approved_by text NOT NULL CHECK(length(btrim(approved_by))>0 AND approved_by<>prepared_by),
  approved_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  UNIQUE(tenant_id,entity_id,period_id,version),
  UNIQUE(budget_snapshot_id,tenant_id,entity_id,period_id)
);

CREATE TABLE budget_line (
  budget_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_snapshot_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  period_id uuid NOT NULL,
  account_code text NOT NULL CHECK(account_code~'^[0-9A-Za-z._-]{1,64}$'),
  comparison_side text NOT NULL CHECK(comparison_side IN ('DEBIT','CREDIT')),
  budget_amount numeric(20,4) NOT NULL CHECK(budget_amount>=0),
  budget_line_hash text NOT NULL CHECK(budget_line_hash~'^sha256:[0-9a-f]{64}$'),
  FOREIGN KEY(budget_snapshot_id,tenant_id,entity_id,period_id) REFERENCES budget_snapshot(budget_snapshot_id,tenant_id,entity_id,period_id),
  UNIQUE(budget_snapshot_id,account_code)
);

CREATE INDEX budget_snapshot_read_idx ON budget_snapshot(tenant_id,entity_id,period_id,version DESC);
CREATE INDEX budget_line_read_idx ON budget_line(tenant_id,entity_id,period_id,budget_snapshot_id,account_code);

ALTER TABLE budget_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY budget_snapshot_scope_policy ON budget_snapshot
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY budget_line_scope_policy ON budget_line
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER budget_snapshot_append_only BEFORE UPDATE OR DELETE ON budget_snapshot
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER budget_line_append_only BEFORE UPDATE OR DELETE ON budget_line
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_get_budget_vs_actual(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS TABLE(
  period_id uuid,period_code text,period_start text,period_end text,
  account_code text,account_name text,currency text,comparison_side text,
  report_status text,classification_basis text,budget_amount numeric(20,4),
  actual_amount numeric(20,4),variance_amount numeric(20,4),
  budget_snapshot_id uuid,budget_version text,budget_snapshot_hash text,
  budget_receipt_hash text,budget_source_ref text,budget_source_version text,
  journal_entry_ids uuid[],journal_line_ids uuid[],ledger_line_ids uuid[],source_document_ids uuid[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_period record; v_currency text;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  SELECT ap.period_id,ap.period_code,ap.starts_on,ap.ends_on,e.base_currency INTO v_period
  FROM public.accounting_period ap JOIN public.entity e ON e.tenant_id=ap.tenant_id AND e.entity_id=ap.entity_id
  WHERE ap.tenant_id=p_tenant AND ap.entity_id=p_entity AND ap.period_id=p_period;
  IF NOT FOUND OR v_period.period_id IS NULL THEN RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023'; END IF;
  v_currency:=v_period.base_currency;
  RETURN QUERY
  WITH current_budget AS (
    SELECT bs.* FROM public.budget_snapshot bs
    WHERE bs.tenant_id=p_tenant AND bs.entity_id=p_entity AND bs.period_id=p_period
    ORDER BY bs.version DESC,bs.budget_snapshot_id DESC LIMIT 1
  ), posted AS (
    SELECT l.ledger_line_id,l.journal_entry_id,l.journal_line_id,l.account_code,l.debit_amount,l.credit_amount,j.currency
    FROM public.ledger_line l JOIN public.journal_entry j
      ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.period_id=p_period
  ), evidence AS (
    SELECT bl.*,bs.version,bs.currency AS budget_currency,bs.snapshot_hash,bs.receipt_hash,bs.source_ref,bs.source_version,
      a.account_name,a.active,
      count(p.ledger_line_id)::integer actual_line_count,count(DISTINCT p.currency)::integer actual_currency_count,
      max(p.currency) actual_currency,
      COALESCE(sum(CASE bl.comparison_side WHEN 'DEBIT' THEN p.debit_amount-p.credit_amount ELSE p.credit_amount-p.debit_amount END),0)::numeric(20,4) actual_amount,
      array_agg(DISTINCT p.journal_entry_id ORDER BY p.journal_entry_id) FILTER(WHERE p.ledger_line_id IS NOT NULL) journal_entry_ids,
      array_agg(DISTINCT p.journal_line_id ORDER BY p.journal_line_id) FILTER(WHERE p.ledger_line_id IS NOT NULL) journal_line_ids,
      array_agg(DISTINCT p.ledger_line_id ORDER BY p.ledger_line_id) FILTER(WHERE p.ledger_line_id IS NOT NULL) ledger_line_ids
    FROM current_budget bs JOIN public.budget_line bl ON bl.budget_snapshot_id=bs.budget_snapshot_id
    LEFT JOIN public.account_master a ON a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.account_code=bl.account_code
    LEFT JOIN posted p ON p.account_code=bl.account_code
    GROUP BY bl.budget_line_id,bl.budget_snapshot_id,bl.account_code,bl.comparison_side,bl.budget_amount,bs.version,bs.currency,bs.snapshot_hash,bs.receipt_hash,bs.source_ref,bs.source_version,a.account_name,a.active
  ), retained AS (
    SELECT e.*,ARRAY(SELECT DISTINCT sl.source_document_id FROM public.source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id IS NOT NULL AND sl.journal_entry_id=ANY(COALESCE(e.journal_entry_ids,ARRAY[]::uuid[])) ORDER BY sl.source_document_id)::uuid[] source_document_ids
    FROM evidence e
  )
  SELECT v_period.period_id,v_period.period_code,to_char(v_period.starts_on,'YYYY-MM-DD'),to_char(v_period.ends_on,'YYYY-MM-DD'),
    e.account_code,COALESCE(e.account_name,'Unmapped account'),e.budget_currency,e.comparison_side,
    CASE WHEN NOT COALESCE(e.active,false) THEN 'BLOCKED_ACCOUNT_REQUIRED'
      WHEN e.budget_currency<>v_currency THEN 'BLOCKED_BUDGET_CURRENCY_REQUIRED'
      WHEN e.actual_line_count=0 THEN 'BLOCKED_POSTED_ACTUAL_EVIDENCE_REQUIRED'
      WHEN e.actual_currency_count<>1 OR e.actual_currency<>e.budget_currency THEN 'BLOCKED_ACTUAL_CURRENCY_REQUIRED'
      ELSE 'APPROVED_BUDGET_VS_ACTUAL' END,
    CASE WHEN COALESCE(e.active,false) AND e.budget_currency=v_currency AND e.actual_line_count>0 AND e.actual_currency_count=1 AND e.actual_currency=e.budget_currency THEN 'APPROVED_IMMUTABLE_BUDGET_SNAPSHOT_AND_POSTED_LEDGER_EXACT' ELSE 'APPROVED_BUDGET_SNAPSHOT_AND_POSTED_ACTUAL_EVIDENCE_REQUIRED' END,
    CASE WHEN COALESCE(e.active,false) AND e.budget_currency=v_currency AND e.actual_line_count>0 AND e.actual_currency_count=1 AND e.actual_currency=e.budget_currency THEN e.budget_amount ELSE NULL END,
    CASE WHEN COALESCE(e.active,false) AND e.budget_currency=v_currency AND e.actual_line_count>0 AND e.actual_currency_count=1 AND e.actual_currency=e.budget_currency THEN e.actual_amount ELSE NULL END,
    CASE WHEN COALESCE(e.active,false) AND e.budget_currency=v_currency AND e.actual_line_count>0 AND e.actual_currency_count=1 AND e.actual_currency=e.budget_currency THEN e.budget_amount-e.actual_amount ELSE NULL END,
    e.budget_snapshot_id,e.version::text,e.snapshot_hash,e.receipt_hash,e.source_ref,e.source_version,e.journal_entry_ids,e.journal_line_ids,e.ledger_line_ids,e.source_document_ids
  FROM retained e ORDER BY e.account_code;
END;$$;

REVOKE ALL ON budget_snapshot,budget_line FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_get_budget_vs_actual(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_budget_vs_actual(uuid,uuid,uuid) TO refs_app;
COMMIT;
