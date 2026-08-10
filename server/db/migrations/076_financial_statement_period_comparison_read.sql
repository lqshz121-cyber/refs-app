BEGIN;

CREATE FUNCTION refs_get_financial_statement_period_comparison(
  p_tenant uuid,
  p_entity uuid,
  p_current_period uuid,
  p_prior_period uuid
)
RETURNS TABLE(
  current_period_id uuid,
  current_period_code text,
  current_period_start date,
  current_period_end date,
  prior_period_id uuid,
  prior_period_code text,
  prior_period_start date,
  prior_period_end date,
  statement_type text,
  statement_section text,
  classification_basis text,
  account_code text,
  account_name text,
  comparison_status text,
  current_display_balance numeric(20,4),
  prior_display_balance numeric(20,4),
  current_journal_entry_ids uuid[],
  current_journal_line_ids uuid[],
  current_ledger_line_ids uuid[],
  current_source_document_ids uuid[],
  prior_journal_entry_ids uuid[],
  prior_journal_line_ids uuid[],
  prior_ledger_line_ids uuid[],
  prior_source_document_ids uuid[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_current public.accounting_period%ROWTYPE;
  v_prior public.accounting_period%ROWTYPE;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF p_current_period=p_prior_period THEN
    RAISE EXCEPTION 'Current and prior accounting periods must differ' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_current FROM public.accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_current_period;
  SELECT * INTO v_prior FROM public.accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_prior_period;
  IF NOT FOUND OR v_current.period_id IS NULL OR v_prior.period_id IS NULL THEN
    RAISE EXCEPTION 'Two valid entity-scoped accounting periods are required' USING ERRCODE='22023';
  END IF;
  IF v_prior.ends_on>=v_current.starts_on THEN
    RAISE EXCEPTION 'Prior accounting period must end before the current accounting period starts' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH current_rows AS (
    SELECT * FROM public.refs_get_financial_statements(p_tenant,p_entity,p_current_period)
  ), prior_rows AS (
    SELECT * FROM public.refs_get_financial_statements(p_tenant,p_entity,p_prior_period)
  )
  SELECT
    v_current.period_id,v_current.period_code,v_current.starts_on,v_current.ends_on,
    v_prior.period_id,v_prior.period_code,v_prior.starts_on,v_prior.ends_on,
    COALESCE(c.statement_type,q.statement_type),
    COALESCE(c.statement_section,q.statement_section),
    COALESCE(c.classification_basis,q.classification_basis),
    COALESCE(c.account_code,q.account_code),
    COALESCE(c.account_name,q.account_name),
    CASE WHEN c.account_code IS NULL THEN 'MISSING_CURRENT_EVIDENCE'
         WHEN q.account_code IS NULL THEN 'MISSING_PRIOR_EVIDENCE'
         ELSE 'COMPARABLE_POSTED_EVIDENCE' END,
    c.display_balance,q.display_balance,
    c.journal_entry_ids,c.journal_line_ids,c.ledger_line_ids,c.source_document_ids,
    q.journal_entry_ids,q.journal_line_ids,q.ledger_line_ids,q.source_document_ids
  FROM current_rows c
  FULL OUTER JOIN prior_rows q
    ON c.statement_type=q.statement_type AND c.account_code=q.account_code
  ORDER BY 9,10,12;
END;
$$;

REVOKE ALL ON FUNCTION refs_get_financial_statement_period_comparison(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_financial_statement_period_comparison(uuid,uuid,uuid,uuid) TO refs_app;

COMMIT;
