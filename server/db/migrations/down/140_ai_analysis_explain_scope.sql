BEGIN;

DO $$
DECLARE target record; definition text;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('refs_read_ai_wbs_exception_findings(uuid,uuid,integer)','WBS.PAYABLE.OPERATOR_ATTEST'),
    ('refs_read_ai_prepaid_coverage_findings(uuid,uuid,integer)','AI.AMORTIZATION.PROPOSE'),
    ('refs_read_ai_duplicate_payable_findings(uuid,uuid,integer)','AI.AMORTIZATION.PROPOSE'),
    ('refs_read_ai_unmatched_bank_payment_findings(uuid,uuid,integer)','AI.AMORTIZATION.PROPOSE'),
    ('refs_read_ai_cost_dimension_findings(uuid,uuid,integer)','AI.AMORTIZATION.PROPOSE'),
    ('refs_read_ai_loan_reference_findings(uuid,uuid,integer)','AI.AMORTIZATION.PROPOSE'),
    ('refs_read_ai_accounting_analysis_summary(uuid,uuid)','AI.AMORTIZATION.PROPOSE'),
    ('refs_begin_ai_accounting_analysis_explanation(uuid,uuid,jsonb,jsonb,text,text)','AI.AMORTIZATION.PROPOSE'),
    ('refs_complete_ai_accounting_analysis_explanation(uuid,uuid,text,text,jsonb)','AI.AMORTIZATION.PROPOSE'),
    ('refs_abandon_ai_accounting_analysis_explanation(uuid,uuid,text,text)','AI.AMORTIZATION.PROPOSE')
  ) AS value(signature,permission) LOOP
    SELECT pg_get_functiondef(target.signature::regprocedure) INTO definition;
    IF definition IS NULL OR position('PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);' IN definition)=0 THEN
      RAISE EXCEPTION 'AI analysis scope rollback target % is not the expected migration definition',target.signature;
    END IF;
    definition:=replace(definition,'PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);',format('PERFORM refs_assert_scope(p_tenant,p_entity,%L);',target.permission));
    IF target.signature='refs_complete_ai_accounting_analysis_explanation(uuid,uuid,text,text,jsonb)' THEN
      definition:=replace(definition,'NULLIF(current_setting(''refs.ai_analysis_permission'',true),'''')','''AI.AMORTIZATION.PROPOSE''');
    END IF;
    EXECUTE definition;
  END LOOP;
END;
$$;

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
  SELECT category,count(*)::bigint,count(*) FILTER(WHERE risk_level='HIGH')::bigint,count(*) FILTER(WHERE risk_level='MEDIUM')::bigint,count(*) FILTER(WHERE risk_level='LOW')::bigint,max(created_at),false,false,false,false FROM retained GROUP BY category ORDER BY CASE category WHEN 'DUPLICATE_PAYABLE' THEN 1 WHEN 'COST_DIMENSION' THEN 2 WHEN 'LOAN_REFERENCE' THEN 3 WHEN 'WBS_EXCEPTION' THEN 4 WHEN 'UNMATCHED_BANK_PAYMENT' THEN 5 WHEN 'PREPAID_COVERAGE' THEN 6 ELSE 99 END;
END;
$$;

DROP FUNCTION refs_assert_ai_analysis_scope(uuid,uuid);
DELETE FROM permission_catalog WHERE permission_code='AI.ANALYSIS.EXPLAIN';

COMMIT;
