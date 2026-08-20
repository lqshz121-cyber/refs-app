BEGIN;
CREATE FUNCTION refs_read_ai_fixed_asset_posted_reconciliation(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  RETURN QUERY WITH p AS (
    SELECT period_id,period_code,starts_on,ends_on FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY'
  ), expected AS (
    SELECT r.*,p.period_id,p.period_code,p.starts_on,p.ends_on,round((r.cost_basis-r.salvage_value)/r.useful_life_months,4) monthly,greatest(0,least(r.useful_life_months,((extract(year from p.ends_on)::int-extract(year from r.placed_in_service_date)::int)*12+extract(month from p.ends_on)::int-extract(month from r.placed_in_service_date)::int+1))) elapsed
    FROM fixed_asset_register_evidence r CROSS JOIN p WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.status='ACTIVE'
  ), posted AS (
    SELECT e.fixed_asset_register_evidence_id,
      COALESCE(sum(CASE WHEN j.journal_date BETWEEN e.starts_on AND e.ends_on AND l.account_code=e.depreciation_expense_account_code THEN l.debit_amount-l.credit_amount ELSE 0 END),0)::numeric(20,4) period_expense,
      COALESCE(sum(CASE WHEN j.journal_date<=e.ends_on AND l.account_code=e.accumulated_depreciation_account_code THEN l.credit_amount-l.debit_amount ELSE 0 END),0)::numeric(20,4) accumulated,
      array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id) FILTER(WHERE j.journal_entry_id IS NOT NULL) je_ids,
      array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id) FILTER(WHERE j.journal_entry_id IS NOT NULL) jl_ids,
      array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) FILTER(WHERE j.journal_entry_id IS NOT NULL) ll_ids
    FROM expected e LEFT JOIN ledger_line l ON l.tenant_id=e.tenant_id AND l.entity_id=e.entity_id AND l.dimensions->>'fixed_asset_register_evidence_id'=e.fixed_asset_register_evidence_id::text AND l.account_code IN(e.accumulated_depreciation_account_code,e.depreciation_expense_account_code)
    LEFT JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    GROUP BY e.fixed_asset_register_evidence_id
  ), calc AS (
    SELECT e.*,COALESCE(p.period_expense,0) posted_period,COALESCE(p.accumulated,0) posted_accumulated,COALESCE(p.je_ids,ARRAY[]::uuid[]) je_ids,COALESCE(p.jl_ids,ARRAY[]::uuid[]) jl_ids,COALESCE(p.ll_ids,ARRAY[]::uuid[]) ll_ids,
      CASE WHEN e.starts_on>=(e.placed_in_service_date-extract(day from e.placed_in_service_date)::int+1) AND e.elapsed BETWEEN 1 AND e.useful_life_months THEN least(e.monthly,(e.cost_basis-e.salvage_value)-e.monthly*(e.elapsed-1)) ELSE 0 END expected_period,
      least(e.cost_basis-e.salvage_value,e.monthly*e.elapsed) expected_accumulated FROM expected e JOIN posted p USING(fixed_asset_register_evidence_id)
  )
  SELECT jsonb_build_object('period_id',period_id,'period_code',period_code,'fixed_asset_register_evidence_id',fixed_asset_register_evidence_id,'register_evidence_hash',register_evidence_hash,'asset_tag',asset_tag,'currency',currency,'expected_period_depreciation',to_char(expected_period,'FM999999999999990.0000'),'expected_accumulated_depreciation',to_char(expected_accumulated,'FM999999999999990.0000'),'posted_period_depreciation_expense',to_char(posted_period,'FM999999999999990.0000'),'posted_accumulated_depreciation',to_char(posted_accumulated,'FM999999999999990.0000'),'period_variance',to_char(posted_period-expected_period,'FM999999999999990.0000'),'accumulated_variance',to_char(posted_accumulated-expected_accumulated,'FM999999999999990.0000'),'journal_entry_ids',je_ids,'journal_line_ids',jl_ids,'ledger_line_ids',ll_ids,'lineage_status','ASSET_ID_BOUND_POSTED') FROM calc ORDER BY asset_tag;
END;$$;
REVOKE EXECUTE ON FUNCTION refs_read_ai_fixed_asset_posted_reconciliation(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_fixed_asset_posted_reconciliation(uuid,uuid,uuid) TO refs_app;
COMMIT;
