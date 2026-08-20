BEGIN;

CREATE FUNCTION refs_read_ai_property_rent_revenue_review(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 100)
RETURNS TABLE(
  wbs_property_rent_source_admission_id uuid,source_document_id uuid,journal_entry_id uuid,
  property_ref text,unit_ref text,lease_ref text,tenant_ref text,accounting_date date,currency char(3),
  expected_rent_amount text,posted_revenue_amount text,variance_amount text,review_status text,
  rule_id text,risk_level text,reason text,suggested_action text,source_version text,receipt_hash text,
  source_evidence_hash text,mapping_snapshot_id uuid,mapping_snapshot_hash text,created_at timestamptz,
  can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean
) LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN
    RAISE EXCEPTION 'AI Property Rent revenue review limit must be between 1 and 500' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period) THEN
    RAISE EXCEPTION 'AI Property Rent revenue review period is outside entity scope' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  WITH scoped AS(
    SELECT a.*,sd.accounting_date,sd.currency,sd.gross_amount,r.period_id,r.mapping_snapshot_id,
      ms.snapshot_hash AS mapping_snapshot_hash,re.result->>'revenue_account_code' AS revenue_account_code,
      d.journal_entry_id,je.status AS journal_status,je.posted_at,
      COALESCE(sum(jl.credit_amount-jl.debit_amount) FILTER(WHERE jl.account_code=re.result->>'revenue_account_code' AND je.status='POSTED'),0)::numeric(20,4) AS posted_revenue
    FROM wbs_property_rent_source_admission a
    JOIN source_document sd ON sd.tenant_id=a.tenant_id AND sd.entity_id=a.entity_id AND sd.source_document_id=a.source_document_id
    JOIN wbs_property_rent_review_evidence r ON r.tenant_id=a.tenant_id AND r.entity_id=a.entity_id AND r.wbs_property_rent_source_admission_id=a.wbs_property_rent_source_admission_id
    JOIN rule_evaluation re ON re.tenant_id=r.tenant_id AND re.rule_evaluation_id=r.rule_evaluation_id
    JOIN mapping_snapshot ms ON ms.tenant_id=r.tenant_id AND ms.mapping_snapshot_id=r.mapping_snapshot_id
    LEFT JOIN wbs_property_rent_draft_evidence d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.wbs_property_rent_review_evidence_id=r.wbs_property_rent_review_evidence_id
    LEFT JOIN journal_entry je ON je.tenant_id=d.tenant_id AND je.entity_id=d.entity_id AND je.journal_entry_id=d.journal_entry_id
    LEFT JOIN journal_line jl ON jl.tenant_id=je.tenant_id AND jl.entity_id=je.entity_id AND jl.period_id=je.period_id AND jl.journal_entry_id=je.journal_entry_id
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND r.period_id=p_period
    GROUP BY a.wbs_property_rent_source_admission_id,a.tenant_id,a.entity_id,a.wbs_inbound_row_id,a.receipt_id,a.wbs_snapshot_import_id,a.wbs_snapshot_receipt_id,a.raw_event_id,a.source_document_id,a.staging_item_id,a.source_version,a.receipt_hash,a.evidence_hash,a.property_ref,a.unit_ref,a.lease_ref,a.tenant_ref,a.admitted_by,a.admitted_at,a.request_hash,a.idempotency_key,sd.accounting_date,sd.currency,sd.gross_amount,r.period_id,r.mapping_snapshot_id,ms.snapshot_hash,re.result,d.journal_entry_id,je.status,je.posted_at
  )
  SELECT s.wbs_property_rent_source_admission_id,s.source_document_id,s.journal_entry_id,
    s.property_ref,s.unit_ref,s.lease_ref,s.tenant_ref,s.accounting_date,s.currency,
    to_char(s.gross_amount,'FM9999999999999990.0000'),to_char(s.posted_revenue,'FM9999999999999990.0000'),to_char(s.gross_amount-s.posted_revenue,'FM9999999999999990.0000'),
    CASE WHEN s.journal_status='POSTED' THEN 'POSTED_REVENUE_MISMATCH' ELSE 'UNPOSTED_RENT_CUTOFF_REVIEW' END,
    CASE WHEN s.journal_status='POSTED' THEN 'AI_PROPERTY_RENT_POSTED_REVENUE_TIE_OUT_V1' ELSE 'AI_PROPERTY_RENT_PERIOD_CUTOFF_V1' END,
    'HIGH',
    CASE WHEN s.journal_status='POSTED' THEN 'The exact source-bound Property Rent charge does not equal net credit activity in its mapped revenue account on the linked Posted Journal.' ELSE 'A reviewed Property Rent charge remains without a linked Posted Journal and requires period-cutoff review.' END,
    CASE WHEN s.journal_status='POSTED' THEN 'Reconcile the source charge, approved mapping, complete Journal lines, and Posted ledger impact; retain a human conclusion before any correction.' ELSE 'Confirm whether rent was earned in this period and complete the authorized human workflow or document a cutoff exception; AI cannot create or post the entry.' END,
    s.source_version,s.receipt_hash,s.evidence_hash,s.mapping_snapshot_id,s.mapping_snapshot_hash,COALESCE(s.posted_at,s.admitted_at),false,false,false,false
  FROM scoped s
  WHERE (s.journal_status='POSTED' AND s.posted_revenue<>s.gross_amount)
     OR (s.journal_status IS DISTINCT FROM 'POSTED' AND EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ends_on<current_date))
  ORDER BY COALESCE(s.posted_at,s.admitted_at) DESC,s.wbs_property_rent_source_admission_id DESC LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION refs_read_ai_property_rent_revenue_review(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_property_rent_revenue_review(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
