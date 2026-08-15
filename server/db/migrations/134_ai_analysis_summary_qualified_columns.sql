BEGIN;

-- PostgreSQL resolves RETURNS TABLE output names as PL/pgSQL variables.
-- Qualify each retained CTE column so a non-empty summary cannot fail with
-- SQLSTATE 42702 (ambiguous column) at the authoritative read boundary.
CREATE OR REPLACE FUNCTION refs_read_ai_accounting_analysis_summary(p_tenant uuid,p_entity uuid) RETURNS TABLE(category text,total_findings bigint,high_findings bigint,medium_findings bigint,low_findings bigint,latest_materialized_at timestamptz,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.PROPOSE');
  RETURN QUERY
  WITH retained AS (
    SELECT 'WBS_EXCEPTION'::text category,risk_level,created_at FROM ai_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'PREPAID_COVERAGE',risk_level,created_at FROM ai_prepaid_coverage_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'DUPLICATE_PAYABLE',risk_level,created_at FROM ai_duplicate_payable_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'UNMATCHED_BANK_PAYMENT',risk_level,created_at FROM ai_unmatched_bank_payment_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'COST_DIMENSION',risk_level,created_at FROM ai_cost_dimension_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'LOAN_REFERENCE',risk_level,created_at FROM ai_loan_reference_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
  )
  SELECT retained.category,count(*)::bigint,count(*) FILTER(WHERE retained.risk_level='HIGH')::bigint,count(*) FILTER(WHERE retained.risk_level='MEDIUM')::bigint,count(*) FILTER(WHERE retained.risk_level='LOW')::bigint,max(retained.created_at),false,false,false,false
  FROM retained GROUP BY retained.category
  ORDER BY CASE retained.category WHEN 'DUPLICATE_PAYABLE' THEN 1 WHEN 'COST_DIMENSION' THEN 2 WHEN 'LOAN_REFERENCE' THEN 3 WHEN 'WBS_EXCEPTION' THEN 4 WHEN 'UNMATCHED_BANK_PAYMENT' THEN 5 WHEN 'PREPAID_COVERAGE' THEN 6 ELSE 99 END;
END; $$;
REVOKE ALL ON FUNCTION refs_read_ai_accounting_analysis_summary(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_accounting_analysis_summary(uuid,uuid) TO refs_app;

COMMIT;
