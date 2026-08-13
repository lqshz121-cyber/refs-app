BEGIN;

-- Lot profitability is a separate read contract.  It accepts only an exact
-- lot_ref retained on a POSTED ledger line; it never derives a lot from a
-- property, project, unit, memo, source document, or browser state.
CREATE FUNCTION refs_get_lot_profitability(
  p_tenant uuid,p_entity uuid,p_period uuid,p_lot_ref text
)
RETURNS TABLE(
  period_id uuid,period_code text,period_start text,period_end text,
  lot_ref text,statement_type text,statement_section text,classification_basis text,
  account_code text,account_name text,period_debit numeric(20,4),period_credit numeric(20,4),display_balance numeric(20,4),
  journal_entry_ids uuid[],journal_line_ids uuid[],ledger_line_ids uuid[],source_document_ids uuid[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF p_lot_ref IS NULL OR p_lot_ref<>btrim(p_lot_ref) OR length(p_lot_ref) NOT BETWEEN 1 AND 160 OR p_lot_ref ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Lot profitability reference is invalid' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period) THEN
    RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH selected_period AS (
    SELECT p.period_id,p.period_code,p.starts_on,p.ends_on FROM public.accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period
  ), posted_lot_lines AS (
    SELECT l.ledger_line_id,l.journal_entry_id,l.journal_line_id,l.account_code,l.debit_amount,l.credit_amount
    FROM public.ledger_line l JOIN public.journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id CROSS JOIN selected_period p
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED' AND j.journal_date BETWEEN p.starts_on AND p.ends_on AND l.dimensions @> jsonb_build_object('lot_ref',p_lot_ref)
  ), classified_lines AS (
    SELECT l.*,CASE WHEN l.account_code LIKE '4%' THEN 'REVENUE' WHEN l.account_code ~ '^[5-9]' THEN 'EXPENSES' ELSE NULL END AS statement_section FROM posted_lot_lines l
  ), account_totals AS (
    SELECT l.account_code,a.account_name,l.statement_section,COALESCE(sum(l.debit_amount),0)::numeric(20,4) AS period_debit,COALESCE(sum(l.credit_amount),0)::numeric(20,4) AS period_credit,
      array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id) AS journal_entry_ids,array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id) AS journal_line_ids,array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) AS ledger_line_ids
    FROM classified_lines l LEFT JOIN public.account_master a ON a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.account_code=l.account_code AND a.active WHERE l.statement_section IS NOT NULL GROUP BY l.account_code,a.account_name,l.statement_section
  ), evidence AS (
    SELECT a.*,ARRAY(SELECT DISTINCT sl.source_document_id FROM public.source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id IS NOT NULL AND sl.journal_entry_id=ANY(a.journal_entry_ids) ORDER BY sl.source_document_id)::uuid[] AS source_document_ids FROM account_totals a
  )
  SELECT p.period_id,p.period_code,to_char(p.starts_on,'YYYY-MM-DD'),to_char(p.ends_on,'YYYY-MM-DD'),p_lot_ref,'LOT_PROFITABILITY'::text,r.statement_section,'POSTED_LEDGER_DIMENSION_EXACT'::text,r.account_code,COALESCE(r.account_name,'Unmapped account'),r.period_debit,r.period_credit,CASE WHEN r.statement_section='REVENUE' THEN r.period_credit-r.period_debit ELSE r.period_debit-r.period_credit END::numeric(20,4),r.journal_entry_ids,r.journal_line_ids,r.ledger_line_ids,r.source_document_ids
  FROM evidence r CROSS JOIN selected_period p ORDER BY r.statement_section,r.account_code;
END;
$$;

REVOKE ALL ON FUNCTION refs_get_lot_profitability(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_lot_profitability(uuid,uuid,uuid,text) TO refs_app;
COMMIT;
