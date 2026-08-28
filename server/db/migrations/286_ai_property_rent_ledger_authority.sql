BEGIN;

CREATE TABLE ai_property_rent_revenue_reader_function_backup(
  function_identity text PRIMARY KEY,
  function_definition text NOT NULL
);
INSERT INTO ai_property_rent_revenue_reader_function_backup
VALUES(
  'refs_read_ai_property_rent_revenue_review(uuid,uuid,uuid,integer)',
  pg_get_functiondef('refs_read_ai_property_rent_revenue_review(uuid,uuid,uuid,integer)'::regprocedure)
);
REVOKE ALL ON ai_property_rent_revenue_reader_function_backup FROM PUBLIC,refs_app;

CREATE OR REPLACE FUNCTION refs_read_ai_property_rent_revenue_review(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 100)
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
    SELECT a.wbs_property_rent_source_admission_id,a.source_document_id,a.staging_item_id,
      a.property_ref,a.unit_ref,a.lease_ref,a.tenant_ref,a.source_version,a.receipt_hash,a.evidence_hash,a.admitted_at,
      sd.accounting_date,sd.currency,sd.gross_amount,r.period_id,r.mapping_snapshot_id,
      ms.snapshot_hash AS mapping_snapshot_hash,re.result->>'revenue_account_code' AS revenue_account_code,
      d.journal_entry_id,je.status AS journal_status,je.posted_at,
      je.status='POSTED'
        AND EXISTS(
          SELECT 1 FROM source_link source_trace
          WHERE source_trace.tenant_id=a.tenant_id AND source_trace.entity_id=a.entity_id
            AND source_trace.link_type='SOURCE_TO_JE'
            AND source_trace.source_document_id=a.source_document_id
            AND source_trace.staging_item_id=a.staging_item_id
            AND source_trace.journal_entry_id=d.journal_entry_id
        )
        AND EXISTS(
          SELECT 1 FROM journal_line required_line
          WHERE required_line.tenant_id=je.tenant_id AND required_line.entity_id=je.entity_id
            AND required_line.period_id=je.period_id AND required_line.journal_entry_id=je.journal_entry_id
        )
        AND NOT EXISTS(
          SELECT 1
          FROM journal_line required_line
          LEFT JOIN ledger_line posted_line
            ON posted_line.tenant_id=required_line.tenant_id
           AND posted_line.entity_id=required_line.entity_id
           AND posted_line.period_id=required_line.period_id
           AND posted_line.journal_entry_id=required_line.journal_entry_id
           AND posted_line.journal_line_id=required_line.journal_line_id
          WHERE required_line.tenant_id=je.tenant_id AND required_line.entity_id=je.entity_id
            AND required_line.period_id=je.period_id AND required_line.journal_entry_id=je.journal_entry_id
            AND (
              posted_line.ledger_line_id IS NULL
              OR posted_line.account_code IS DISTINCT FROM required_line.account_code
              OR posted_line.currency IS DISTINCT FROM je.currency
              OR posted_line.debit_amount IS DISTINCT FROM required_line.debit_amount
              OR posted_line.credit_amount IS DISTINCT FROM required_line.credit_amount
              OR NOT EXISTS(
                SELECT 1 FROM source_link ledger_trace
                WHERE ledger_trace.tenant_id=posted_line.tenant_id AND ledger_trace.entity_id=posted_line.entity_id
                  AND ledger_trace.link_type='JE_LINE_TO_LEDGER'
                  AND ledger_trace.journal_entry_id=posted_line.journal_entry_id
                  AND ledger_trace.journal_line_id=posted_line.journal_line_id
                  AND ledger_trace.posting_batch_id=posted_line.posting_batch_id
                  AND ledger_trace.ledger_line_id=posted_line.ledger_line_id
              )
            )
        ) AS ledger_lineage_complete,
      COALESCE((
        SELECT sum(posted_line.credit_amount-posted_line.debit_amount)
        FROM ledger_line posted_line
        WHERE posted_line.tenant_id=je.tenant_id AND posted_line.entity_id=je.entity_id
          AND posted_line.period_id=je.period_id AND posted_line.journal_entry_id=je.journal_entry_id
          AND posted_line.currency=je.currency
          AND posted_line.account_code=re.result->>'revenue_account_code'
      ),0)::numeric(20,4) AS ledger_revenue
    FROM wbs_property_rent_source_admission a
    JOIN source_document sd ON sd.tenant_id=a.tenant_id AND sd.entity_id=a.entity_id AND sd.source_document_id=a.source_document_id
    JOIN wbs_property_rent_review_evidence r ON r.tenant_id=a.tenant_id AND r.entity_id=a.entity_id AND r.wbs_property_rent_source_admission_id=a.wbs_property_rent_source_admission_id
    JOIN rule_evaluation re ON re.tenant_id=r.tenant_id AND re.rule_evaluation_id=r.rule_evaluation_id
    JOIN mapping_snapshot ms ON ms.tenant_id=r.tenant_id AND ms.mapping_snapshot_id=r.mapping_snapshot_id
    LEFT JOIN wbs_property_rent_draft_evidence d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.wbs_property_rent_review_evidence_id=r.wbs_property_rent_review_evidence_id
    LEFT JOIN journal_entry je ON je.tenant_id=d.tenant_id AND je.entity_id=d.entity_id AND je.period_id=r.period_id AND je.journal_entry_id=d.journal_entry_id
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND r.period_id=p_period
  ), authoritative AS(
    SELECT s.*,CASE WHEN s.ledger_lineage_complete THEN s.ledger_revenue ELSE 0::numeric(20,4) END AS posted_revenue
    FROM scoped s
  )
  SELECT s.wbs_property_rent_source_admission_id,s.source_document_id,s.journal_entry_id,
    s.property_ref,s.unit_ref,s.lease_ref,s.tenant_ref,s.accounting_date,s.currency,
    to_char(s.gross_amount,'FM9999999999999990.0000'),to_char(s.posted_revenue,'FM9999999999999990.0000'),to_char(s.gross_amount-s.posted_revenue,'FM9999999999999990.0000'),
    CASE WHEN s.journal_status='POSTED' THEN 'POSTED_REVENUE_MISMATCH' ELSE 'UNPOSTED_RENT_CUTOFF_REVIEW' END,
    CASE WHEN s.journal_status='POSTED' THEN 'AI_PROPERTY_RENT_POSTED_REVENUE_TIE_OUT_V1' ELSE 'AI_PROPERTY_RENT_PERIOD_CUTOFF_V1' END,
    'HIGH',
    CASE
      WHEN s.journal_status='POSTED' AND NOT s.ledger_lineage_complete THEN 'The exact source-bound Property Rent charge does not have a complete matching Posted ledger lineage for every linked Journal line.'
      WHEN s.journal_status='POSTED' THEN 'The exact source-bound Property Rent charge does not equal net credit activity in its mapped revenue account in the authoritative Posted ledger.'
      ELSE 'A reviewed Property Rent charge remains without a linked Posted Journal and requires period-cutoff review.'
    END,
    CASE WHEN s.journal_status='POSTED' THEN 'Reconcile the source charge, approved mapping, complete Journal lines, posting batch, immutable ledger lines, and source links; retain a human conclusion before any correction.' ELSE 'Confirm whether rent was earned in this period and complete the authorized human workflow or document a cutoff exception; AI cannot create or post the entry.' END,
    s.source_version,s.receipt_hash,s.evidence_hash,s.mapping_snapshot_id,s.mapping_snapshot_hash,COALESCE(s.posted_at,s.admitted_at),false,false,false,false
  FROM authoritative s
  WHERE (s.journal_status='POSTED' AND (NOT s.ledger_lineage_complete OR s.posted_revenue<>s.gross_amount))
     OR (s.journal_status IS DISTINCT FROM 'POSTED' AND EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ends_on<current_date))
  ORDER BY COALESCE(s.posted_at,s.admitted_at) DESC,s.wbs_property_rent_source_admission_id DESC LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION refs_read_ai_property_rent_revenue_review(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_property_rent_revenue_review(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
