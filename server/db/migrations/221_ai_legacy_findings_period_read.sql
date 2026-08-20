BEGIN;

-- Explanation-only readers for immutable findings created by the original AI
-- controls.  The legacy readers are entity-wide and require proposal authority;
-- Full Controller Scan instead needs an exact primary-period population.
CREATE FUNCTION refs_read_ai_prepaid_coverage_findings_for_period(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(ai_prepaid_coverage_finding_id uuid,source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_document_version bigint,source_line_hash text,accounting_period_id uuid,rule_id text,risk_level text,confidence numeric,status text,reason text,suggested_action text,suggested_owner text,due_date date,due_date_status text,created_at timestamptz,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI prepaid coverage period finding limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ledger_code='PRIMARY') THEN RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT f.ai_prepaid_coverage_finding_id,f.source_document_id,f.source_document_line_id,f.source_payload_hash,f.source_document_version,f.source_line_hash,p_period,f.rule_id,f.risk_level,f.confidence,f.status,f.reason,f.suggested_action,f.suggested_owner,f.due_date,f.due_date_status,f.created_at,false,false,false,false
  FROM ai_prepaid_coverage_finding f JOIN source_document d ON d.tenant_id=f.tenant_id AND d.entity_id=f.entity_id AND d.source_document_id=f.source_document_id JOIN accounting_period p ON p.tenant_id=d.tenant_id AND p.entity_id=d.entity_id AND p.period_id=p_period AND p.ledger_code='PRIMARY' AND d.accounting_date BETWEEN p.starts_on AND p.ends_on
  WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity ORDER BY d.accounting_date DESC,f.created_at DESC,f.ai_prepaid_coverage_finding_id DESC LIMIT p_limit;
END; $$;

CREATE FUNCTION refs_read_ai_duplicate_payable_findings_for_period(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(ai_duplicate_payable_finding_id uuid,source_document_id uuid,candidate_source_document_id uuid,source_payload_hash text,source_document_version bigint,candidate_payload_hash text,candidate_document_version bigint,match_key_hash text,accounting_period_id uuid,rule_id text,risk_level text,confidence numeric,status text,reason text,suggested_action text,suggested_owner text,due_date date,due_date_status text,created_at timestamptz,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'AI duplicate payable period finding limit must be between 1 and 500' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ledger_code='PRIMARY') THEN RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT f.ai_duplicate_payable_finding_id,f.source_document_id,f.candidate_source_document_id,f.source_payload_hash,f.source_document_version,f.candidate_payload_hash,f.candidate_document_version,f.match_key_hash,p_period,f.rule_id,f.risk_level,f.confidence,f.status,f.reason,f.suggested_action,f.suggested_owner,f.due_date,f.due_date_status,f.created_at,false,false,false,false
  FROM ai_duplicate_payable_finding f JOIN source_document d1 ON d1.tenant_id=f.tenant_id AND d1.entity_id=f.entity_id AND d1.source_document_id=f.source_document_id JOIN source_document d2 ON d2.tenant_id=f.tenant_id AND d2.entity_id=f.entity_id AND d2.source_document_id=f.candidate_source_document_id JOIN accounting_period p ON p.tenant_id=f.tenant_id AND p.entity_id=f.entity_id AND p.period_id=p_period AND p.ledger_code='PRIMARY'
  WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND (d1.accounting_date BETWEEN p.starts_on AND p.ends_on OR d2.accounting_date BETWEEN p.starts_on AND p.ends_on) ORDER BY GREATEST(d1.accounting_date,d2.accounting_date) DESC,f.created_at DESC,f.ai_duplicate_payable_finding_id DESC LIMIT p_limit;
END; $$;

CREATE FUNCTION refs_read_ai_cost_dimension_findings_for_period(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(ai_cost_dimension_finding_id uuid,source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_document_version bigint,source_line_hash text,missing_project boolean,missing_property boolean,accounting_period_id uuid,rule_id text,risk_level text,confidence numeric,status text,reason text,suggested_action text,suggested_owner text,due_date date,due_date_status text,created_at timestamptz,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI cost dimension period finding limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ledger_code='PRIMARY') THEN RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT f.ai_cost_dimension_finding_id,f.source_document_id,f.source_document_line_id,f.source_payload_hash,f.source_document_version,f.source_line_hash,f.missing_project,f.missing_property,p_period,f.rule_id,f.risk_level,f.confidence,f.status,f.reason,f.suggested_action,f.suggested_owner,f.due_date,f.due_date_status,f.created_at,false,false,false,false
  FROM ai_cost_dimension_finding f JOIN source_document d ON d.tenant_id=f.tenant_id AND d.entity_id=f.entity_id AND d.source_document_id=f.source_document_id JOIN accounting_period p ON p.tenant_id=d.tenant_id AND p.entity_id=d.entity_id AND p.period_id=p_period AND p.ledger_code='PRIMARY' AND d.accounting_date BETWEEN p.starts_on AND p.ends_on
  WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity ORDER BY d.accounting_date DESC,f.created_at DESC,f.ai_cost_dimension_finding_id DESC LIMIT p_limit;
END; $$;

CREATE FUNCTION refs_read_ai_loan_reference_findings_for_period(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(ai_loan_reference_finding_id uuid,source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_document_version bigint,source_line_hash text,accounting_period_id uuid,rule_id text,risk_level text,confidence numeric,status text,reason text,suggested_action text,suggested_owner text,due_date date,due_date_status text,created_at timestamptz,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI loan reference period finding limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ledger_code='PRIMARY') THEN RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT f.ai_loan_reference_finding_id,f.source_document_id,f.source_document_line_id,f.source_payload_hash,f.source_document_version,f.source_line_hash,p_period,f.rule_id,f.risk_level,f.confidence,f.status,f.reason,f.suggested_action,f.suggested_owner,f.due_date,f.due_date_status,f.created_at,false,false,false,false
  FROM ai_loan_reference_finding f JOIN source_document d ON d.tenant_id=f.tenant_id AND d.entity_id=f.entity_id AND d.source_document_id=f.source_document_id JOIN accounting_period p ON p.tenant_id=d.tenant_id AND p.entity_id=d.entity_id AND p.period_id=p_period AND p.ledger_code='PRIMARY' AND d.accounting_date BETWEEN p.starts_on AND p.ends_on
  WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity ORDER BY d.accounting_date DESC,f.created_at DESC,f.ai_loan_reference_finding_id DESC LIMIT p_limit;
END; $$;

REVOKE ALL ON FUNCTION refs_read_ai_prepaid_coverage_findings_for_period(uuid,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_ai_duplicate_payable_findings_for_period(uuid,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_ai_cost_dimension_findings_for_period(uuid,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_ai_loan_reference_findings_for_period(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_prepaid_coverage_findings_for_period(uuid,uuid,uuid,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_ai_duplicate_payable_findings_for_period(uuid,uuid,uuid,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_ai_cost_dimension_findings_for_period(uuid,uuid,uuid,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_ai_loan_reference_findings_for_period(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
