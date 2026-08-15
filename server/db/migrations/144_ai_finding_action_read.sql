BEGIN;

-- The assignment command stores accountability separately from immutable
-- findings.  These reads expose only the exact finding hash needed for a
-- controller to make that accountable assignment, followed by the retained
-- action state.  Neither read can create a Journal, alter a source, or close
-- an accounting period.
CREATE FUNCTION refs_read_ai_finding_assignment_candidates(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 100)
RETURNS TABLE(finding_kind text,finding_id uuid,finding_hash text,rule_id text,risk_level text,reason text,suggested_action text,suggested_owner text,created_at timestamptz,
  can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.FINDING.ASSIGN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI finding assignment candidate limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  SELECT * FROM (
    SELECT 'WBS_EXCEPTION'::text,f.ai_finding_id,f.finding_hash,f.rule_id,f.risk_level,f.reason,f.suggested_action,f.suggested_owner,f.created_at,false,false,false,false FROM ai_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity
    UNION ALL SELECT 'PREPAID_COVERAGE',f.ai_prepaid_coverage_finding_id,f.finding_hash,f.rule_id,f.risk_level,f.reason,f.suggested_action,f.suggested_owner,f.created_at,false,false,false,false FROM ai_prepaid_coverage_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity
    UNION ALL SELECT 'DUPLICATE_PAYABLE',f.ai_duplicate_payable_finding_id,f.finding_hash,f.rule_id,f.risk_level,f.reason,f.suggested_action,f.suggested_owner,f.created_at,false,false,false,false FROM ai_duplicate_payable_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity
    UNION ALL SELECT 'UNMATCHED_BANK_PAYMENT',f.ai_unmatched_bank_payment_finding_id,f.finding_hash,f.rule_id,f.risk_level,f.reason,f.suggested_action,f.suggested_owner,f.created_at,false,false,false,false FROM ai_unmatched_bank_payment_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity
    UNION ALL SELECT 'COST_DIMENSION',f.ai_cost_dimension_finding_id,f.finding_hash,f.rule_id,f.risk_level,f.reason,f.suggested_action,f.suggested_owner,f.created_at,false,false,false,false FROM ai_cost_dimension_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity
    UNION ALL SELECT 'LOAN_REFERENCE',f.ai_loan_reference_finding_id,f.finding_hash,f.rule_id,f.risk_level,f.reason,f.suggested_action,f.suggested_owner,f.created_at,false,false,false,false FROM ai_loan_reference_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity
  ) candidates
  ORDER BY created_at DESC,finding_id DESC
  LIMIT p_limit;
END;
$$;

CREATE FUNCTION refs_read_ai_finding_actions(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 100)
RETURNS TABLE(ai_finding_action_id uuid,finding_kind text,finding_id uuid,finding_hash text,owner text,due_date text,revision integer,assigned_by text,assigned_at timestamptz,
  can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.FINDING.ASSIGN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI finding action limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT a.ai_finding_action_id,a.finding_kind,a.finding_id,a.finding_hash,a.owner,to_char(a.due_date,'YYYY-MM-DD'),a.revision,a.assigned_by,a.assigned_at,false,false,false,false
  FROM ai_finding_action a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
  ORDER BY a.assigned_at DESC,a.ai_finding_action_id DESC LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_ai_finding_assignment_candidates(uuid,uuid,integer),refs_read_ai_finding_actions(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_finding_assignment_candidates(uuid,uuid,integer),refs_read_ai_finding_actions(uuid,uuid,integer) TO refs_app;

COMMIT;
