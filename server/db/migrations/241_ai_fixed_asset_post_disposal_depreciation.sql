BEGIN;
CREATE FUNCTION refs_read_ai_fixed_asset_post_disposal_depreciation(p_tenant uuid,p_entity uuid,p_period uuid) RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  RETURN QUERY WITH p AS (SELECT period_id,period_code,starts_on,ends_on FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY'), posted AS (
    SELECT r.fixed_asset_register_evidence_id,d.fixed_asset_disposal_evidence_id,r.register_evidence_hash,d.disposal_evidence_hash,r.asset_tag,d.disposal_date,r.currency,
      sum(CASE WHEN l.account_code=r.depreciation_expense_account_code THEN l.debit_amount-l.credit_amount ELSE 0 END)::numeric(20,4) expense,
      sum(CASE WHEN l.account_code=r.accumulated_depreciation_account_code THEN l.credit_amount-l.debit_amount ELSE 0 END)::numeric(20,4) accumulated,
      array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id) je_ids,array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id) jl_ids,array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) ll_ids
    FROM fixed_asset_disposal_evidence d JOIN fixed_asset_register_evidence r ON r.fixed_asset_register_evidence_id=d.fixed_asset_register_evidence_id AND r.tenant_id=d.tenant_id AND r.entity_id=d.entity_id CROSS JOIN p
    JOIN ledger_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id AND l.dimensions->>'fixed_asset_register_evidence_id'=r.fixed_asset_register_evidence_id::text AND l.account_code IN(r.depreciation_expense_account_code,r.accumulated_depreciation_account_code)
    JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.status='REVIEWED' AND j.journal_date BETWEEN p.starts_on AND p.ends_on AND j.journal_date>d.disposal_date
    GROUP BY r.fixed_asset_register_evidence_id,d.fixed_asset_disposal_evidence_id,r.register_evidence_hash,d.disposal_evidence_hash,r.asset_tag,d.disposal_date,r.currency
    HAVING sum(CASE WHEN l.account_code=r.depreciation_expense_account_code THEN l.debit_amount-l.credit_amount ELSE 0 END)>0 OR sum(CASE WHEN l.account_code=r.accumulated_depreciation_account_code THEN l.credit_amount-l.debit_amount ELSE 0 END)>0
  ) SELECT jsonb_build_object('period_id',p.period_id,'period_code',p.period_code,'fixed_asset_register_evidence_id',x.fixed_asset_register_evidence_id,'fixed_asset_disposal_evidence_id',x.fixed_asset_disposal_evidence_id,'register_evidence_hash',x.register_evidence_hash,'disposal_evidence_hash',x.disposal_evidence_hash,'asset_tag',x.asset_tag,'disposal_date',to_char(x.disposal_date,'YYYY-MM-DD'),'currency',x.currency,'posted_depreciation_expense_after_disposal',to_char(x.expense,'FM999999999999990.0000'),'posted_accumulated_depreciation_after_disposal',to_char(x.accumulated,'FM999999999999990.0000'),'journal_entry_ids',x.je_ids,'journal_line_ids',x.jl_ids,'ledger_line_ids',x.ll_ids,'lineage_status','ASSET_ID_BOUND_POSTED_AFTER_DISPOSAL') FROM posted x CROSS JOIN p ORDER BY x.asset_tag;
END;$$;
REVOKE EXECUTE ON FUNCTION refs_read_ai_fixed_asset_post_disposal_depreciation(uuid,uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION refs_read_ai_fixed_asset_post_disposal_depreciation(uuid,uuid,uuid) TO refs_app;
COMMIT;
