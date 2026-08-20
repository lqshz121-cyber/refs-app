BEGIN;

-- Full Controller Scan must never use the legacy entity-wide reader: doing so
-- can mix closed or future-period exceptions into the selected period and the
-- legacy function requires an amortization proposal capability.  This reader
-- is explanation-only, period-bound, and performs no materialization or write.
CREATE FUNCTION refs_read_ai_unmatched_bank_payment_findings_for_period(
  p_tenant uuid,
  p_entity uuid,
  p_period uuid,
  p_limit integer DEFAULT 50
) RETURNS TABLE(
  ai_unmatched_bank_payment_finding_id uuid,
  bank_source_id uuid,
  source_document_id uuid,
  source_payload_hash text,
  source_document_version bigint,
  bank_account_ref text,
  external_bank_line_id text,
  transaction_date date,
  accounting_period_id uuid,
  currency char(3),
  amount numeric,
  bank_version bigint,
  rule_id text,
  risk_level text,
  confidence numeric,
  status text,
  current_match_state text,
  reason text,
  suggested_action text,
  suggested_owner text,
  due_date date,
  due_date_status text,
  created_at timestamptz,
  can_create_draft boolean,
  can_review boolean,
  can_approve boolean,
  can_post boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_row accounting_period;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN
    RAISE EXCEPTION 'AI unmatched bank period finding limit must be between 1 and 100' USING ERRCODE='22023';
  END IF;
  SELECT p.* INTO period_row
  FROM accounting_period p
  WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity
    AND p.period_id=p_period AND p.ledger_code='PRIMARY';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  SELECT f.ai_unmatched_bank_payment_finding_id,f.bank_source_id,
    f.source_document_id,f.source_payload_hash,f.source_document_version,
    f.bank_account_ref,f.external_bank_line_id,f.transaction_date,p_period,
    f.currency,f.amount,f.bank_version,f.rule_id,f.risk_level,f.confidence,
    f.status,
    CASE WHEN EXISTS(
      SELECT 1 FROM bank_match m
      WHERE m.tenant_id=f.tenant_id AND m.entity_id=f.entity_id
        AND m.bank_source_id=f.bank_source_id AND m.status='ACTIVE'
    ) THEN 'MATCHED_AFTER_FINDING' ELSE 'OPEN' END,
    f.reason,f.suggested_action,f.suggested_owner,f.due_date,
    f.due_date_status,f.created_at,false,false,false,false
  FROM ai_unmatched_bank_payment_finding f
  WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity
    AND f.transaction_date BETWEEN period_row.starts_on AND period_row.ends_on
  ORDER BY f.transaction_date DESC,f.created_at DESC,
    f.ai_unmatched_bank_payment_finding_id DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_ai_unmatched_bank_payment_findings_for_period(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_unmatched_bank_payment_findings_for_period(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
