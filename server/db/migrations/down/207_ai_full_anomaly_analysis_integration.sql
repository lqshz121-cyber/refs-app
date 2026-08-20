BEGIN;
DO $$ DECLARE definition text;categories text:='''BANK_DUPLICATE_PAYMENT'', ''VENDOR_INVOICE_AMOUNT_SPIKE'', ''VENDOR_INVOICE_FREQUENCY_SPIKE'', ''VENDOR_INVOICE_AMOUNT_DROP'', ''VENDOR_INVOICE_NEAR_DUPLICATE'', ''MANUAL_JOURNAL_RISK'', ''UNMATCHED_BANK_PAYMENT''';BEGIN
  SELECT pg_get_functiondef('refs_assert_ai_accounting_analysis_summary(jsonb)'::regprocedure) INTO definition;definition:=replace(definition,'jsonb_array_length(p_summary)>12','jsonb_array_length(p_summary)>7');definition:=replace(definition,categories,'''BANK_DUPLICATE_PAYMENT'',''UNMATCHED_BANK_PAYMENT''');IF position('MANUAL_JOURNAL_RISK' IN definition)>0 OR position('jsonb_array_length(p_summary)>7' IN definition)=0 THEN RAISE EXCEPTION 'Full AI summary rollback failed';END IF;EXECUTE definition;
  SELECT pg_get_functiondef('refs_assert_ai_accounting_analysis_evidence(jsonb)'::regprocedure) INTO definition;definition:=replace(definition,categories,'''BANK_DUPLICATE_PAYMENT'',''UNMATCHED_BANK_PAYMENT''');IF position('MANUAL_JOURNAL_RISK' IN definition)>0 THEN RAISE EXCEPTION 'Full AI evidence rollback failed';END IF;EXECUTE definition;
  SELECT pg_get_functiondef('refs_complete_ai_accounting_analysis_explanation(uuid,uuid,text,text,jsonb)'::regprocedure) INTO definition;definition:=replace(definition,categories,'''BANK_DUPLICATE_PAYMENT'',''UNMATCHED_BANK_PAYMENT''');IF position('MANUAL_JOURNAL_RISK' IN definition)>0 THEN RAISE EXCEPTION 'Full AI explanation rollback failed';END IF;EXECUTE definition;
END $$;

CREATE OR REPLACE FUNCTION refs_read_ai_accounting_analysis_summary(p_tenant uuid,p_entity uuid) RETURNS TABLE(category text,total_findings bigint,high_findings bigint,medium_findings bigint,low_findings bigint,latest_materialized_at timestamptz,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  RETURN QUERY WITH retained AS (
    SELECT 'WBS_EXCEPTION'::text category,risk_level,created_at FROM ai_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'PREPAID_COVERAGE',risk_level,created_at FROM ai_prepaid_coverage_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'DUPLICATE_PAYABLE',risk_level,created_at FROM ai_duplicate_payable_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'BANK_DUPLICATE_PAYMENT',finding->>'risk_level',created_at FROM ai_bank_duplicate_payment_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'UNMATCHED_BANK_PAYMENT',risk_level,created_at FROM ai_unmatched_bank_payment_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'COST_DIMENSION',risk_level,created_at FROM ai_cost_dimension_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'LOAN_REFERENCE',risk_level,created_at FROM ai_loan_reference_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
  ) SELECT retained.category,count(*)::bigint,count(*) FILTER(WHERE retained.risk_level='HIGH')::bigint,count(*) FILTER(WHERE retained.risk_level='MEDIUM')::bigint,count(*) FILTER(WHERE retained.risk_level='LOW')::bigint,max(retained.created_at),false,false,false,false FROM retained GROUP BY retained.category ORDER BY CASE retained.category WHEN 'BANK_DUPLICATE_PAYMENT' THEN 1 WHEN 'DUPLICATE_PAYABLE' THEN 2 WHEN 'COST_DIMENSION' THEN 3 WHEN 'LOAN_REFERENCE' THEN 4 WHEN 'WBS_EXCEPTION' THEN 5 WHEN 'UNMATCHED_BANK_PAYMENT' THEN 6 WHEN 'PREPAID_COVERAGE' THEN 7 ELSE 99 END;
END $$;

DROP FUNCTION refs_read_ai_manual_journal_risk_findings(uuid,uuid,integer);
DROP FUNCTION refs_read_ai_vendor_invoice_near_duplicate_findings(uuid,uuid,integer);
DROP FUNCTION refs_read_ai_vendor_invoice_amount_drop_findings(uuid,uuid,integer);
DROP FUNCTION refs_read_ai_vendor_invoice_frequency_spike_findings(uuid,uuid,integer);
DROP FUNCTION refs_read_ai_vendor_invoice_amount_spike_findings(uuid,uuid,integer);
COMMIT;
