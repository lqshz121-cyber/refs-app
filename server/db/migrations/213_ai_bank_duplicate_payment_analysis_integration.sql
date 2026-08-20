BEGIN;

-- Promote retained duplicate-payment evidence into the unified Controller AI
-- summary and explanation input. This migration exposes no accounting command.
CREATE FUNCTION refs_read_ai_bank_duplicate_payment_findings(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 20)
RETURNS TABLE(ai_bank_duplicate_payment_finding_id uuid,rule_id text,risk_level text,confidence numeric,reason text,suggested_action text,
  source_document_id uuid,candidate_source_document_id uuid,external_bank_line_id text,source_payload_hash text,candidate_payload_hash text,match_key_hash text,created_at timestamptz,
  can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI bank duplicate-payment finding limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  SELECT f.ai_bank_duplicate_payment_finding_id,f.finding->>'rule_id',f.finding->>'risk_level',(f.finding->>'confidence')::numeric,
    f.finding->>'reason',f.finding->>'suggested_action',s1.source_document_id,s2.source_document_id,s1.external_bank_line_id,
    s1.source_payload_hash,s2.source_payload_hash,f.finding_hash,f.created_at,false,false,false,false
  FROM ai_bank_duplicate_payment_finding f
  JOIN ai_bank_duplicate_payment_source s1 ON s1.tenant_id=f.tenant_id AND s1.entity_id=f.entity_id AND s1.ai_bank_duplicate_payment_finding_id=f.ai_bank_duplicate_payment_finding_id AND s1.source_ordinal=1
  JOIN ai_bank_duplicate_payment_source s2 ON s2.tenant_id=f.tenant_id AND s2.entity_id=f.entity_id AND s2.ai_bank_duplicate_payment_finding_id=f.ai_bank_duplicate_payment_finding_id AND s2.source_ordinal=2
  WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND f.status='OPEN'
  ORDER BY f.created_at DESC,f.ai_bank_duplicate_payment_finding_id DESC LIMIT p_limit;
END;
$$;

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
  ) SELECT retained.category,count(*)::bigint,count(*) FILTER(WHERE retained.risk_level='HIGH')::bigint,count(*) FILTER(WHERE retained.risk_level='MEDIUM')::bigint,count(*) FILTER(WHERE retained.risk_level='LOW')::bigint,max(retained.created_at),false,false,false,false
  FROM retained GROUP BY retained.category ORDER BY CASE retained.category WHEN 'BANK_DUPLICATE_PAYMENT' THEN 1 WHEN 'DUPLICATE_PAYABLE' THEN 2 WHEN 'COST_DIMENSION' THEN 3 WHEN 'LOAN_REFERENCE' THEN 4 WHEN 'WBS_EXCEPTION' THEN 5 WHEN 'UNMATCHED_BANK_PAYMENT' THEN 6 WHEN 'PREPAID_COVERAGE' THEN 7 ELSE 99 END;
END;
$$;

DO $$ DECLARE definition text; BEGIN
  SELECT pg_get_functiondef('refs_assert_ai_accounting_analysis_summary(jsonb)'::regprocedure) INTO definition;
  definition:=replace(definition,'jsonb_array_length(p_summary)>6','jsonb_array_length(p_summary)>7');
  definition:=replace(definition,'''DUPLICATE_PAYABLE'',''UNMATCHED_BANK_PAYMENT''','''DUPLICATE_PAYABLE'',''BANK_DUPLICATE_PAYMENT'',''UNMATCHED_BANK_PAYMENT''');
  IF position('BANK_DUPLICATE_PAYMENT' IN definition)=0 OR position('jsonb_array_length(p_summary)>7' IN definition)=0 THEN RAISE EXCEPTION 'AI summary category integration failed'; END IF; EXECUTE definition;
  SELECT pg_get_functiondef('refs_assert_ai_accounting_analysis_evidence(jsonb)'::regprocedure) INTO definition;
  definition:=replace(definition,'''DUPLICATE_PAYABLE'',''UNMATCHED_BANK_PAYMENT''','''DUPLICATE_PAYABLE'',''BANK_DUPLICATE_PAYMENT'',''UNMATCHED_BANK_PAYMENT''');
  IF position('BANK_DUPLICATE_PAYMENT' IN definition)=0 THEN RAISE EXCEPTION 'AI evidence category integration failed'; END IF; EXECUTE definition;
  SELECT pg_get_functiondef('refs_complete_ai_accounting_analysis_explanation(uuid,uuid,text,text,jsonb)'::regprocedure) INTO definition;
  definition:=replace(definition,'''DUPLICATE_PAYABLE'',''UNMATCHED_BANK_PAYMENT''','''DUPLICATE_PAYABLE'',''BANK_DUPLICATE_PAYMENT'',''UNMATCHED_BANK_PAYMENT''');
  IF position('BANK_DUPLICATE_PAYMENT' IN definition)=0 THEN RAISE EXCEPTION 'AI explanation category integration failed'; END IF; EXECUTE definition;
END $$;

REVOKE ALL ON FUNCTION refs_read_ai_bank_duplicate_payment_findings(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_bank_duplicate_payment_findings(uuid,uuid,integer) TO refs_app;
COMMIT;
