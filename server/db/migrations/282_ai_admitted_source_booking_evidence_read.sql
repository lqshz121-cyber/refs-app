BEGIN;

CREATE FUNCTION refs_read_ai_admitted_source_booking_evidence(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 501)
RETURNS TABLE(
  tenant_id uuid,entity_id uuid,company_code text,accounting_period_id uuid,
  admission_id uuid,admission_hash text,source_document_id uuid,source_document_line_id uuid,
  source_payload_hash text,source_line_hash text,vendor_ref text,business_date date,accounting_date date,
  currency text,amount text,retained_outcome text,exception_codes jsonb,source_status text,queried_at text,
  ap_document_ids uuid[],journal_entry_ids uuid[],ledger_line_ids uuid[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit IS NULL OR p_limit<2 OR p_limit>501 THEN
    RAISE EXCEPTION 'AI admitted source booking evidence limit must be between 2 and 501' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ledger_code='PRIMARY') THEN
    RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  SELECT r.tenant_id,r.entity_id,a.company_code,r.accounting_period_id,
         r.wbs_final1_retained_evidence_admission_id,a.receipt_hash,
         d.source_document_id,l.source_document_line_id,d.payload_hash,r.raw_row_hash,
         l.party_ref,d.business_date,d.accounting_date,d.currency::text,abs(l.amount)::text,
         r.outcome,r.exception_codes,d.status::text,
         to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         COALESCE((SELECT array_agg(b.business_document_id ORDER BY b.business_document_id)
                     FROM business_document b WHERE b.tenant_id=r.tenant_id AND b.entity_id=r.entity_id
                       AND b.source_document_id=r.source_document_id AND b.document_kind='AP_BILL'),ARRAY[]::uuid[]),
         COALESCE((SELECT array_agg(x.journal_entry_id ORDER BY x.journal_entry_id) FROM(
                     SELECT DISTINCT sl.journal_entry_id FROM source_link sl
                      WHERE sl.tenant_id=r.tenant_id AND sl.entity_id=r.entity_id
                        AND sl.source_document_id=r.source_document_id AND sl.journal_entry_id IS NOT NULL) x),ARRAY[]::uuid[]),
         COALESCE((SELECT array_agg(x.ledger_line_id ORDER BY x.ledger_line_id) FROM(
                     SELECT DISTINCT ll.ledger_line_id FROM source_link sl JOIN ledger_line ll
                       ON ll.tenant_id=sl.tenant_id AND ll.entity_id=sl.entity_id AND ll.journal_entry_id=sl.journal_entry_id
                      WHERE sl.tenant_id=r.tenant_id AND sl.entity_id=r.entity_id AND sl.source_document_id=r.source_document_id
                     UNION SELECT DISTINCT sl.ledger_line_id FROM source_link sl
                      WHERE sl.tenant_id=r.tenant_id AND sl.entity_id=r.entity_id
                        AND sl.source_document_id=r.source_document_id AND sl.ledger_line_id IS NOT NULL) x),ARRAY[]::uuid[])
    FROM wbs_final1_retained_source_row r
    JOIN wbs_final1_retained_evidence_admission a ON a.tenant_id=r.tenant_id AND a.entity_id=r.entity_id
      AND a.wbs_final1_retained_evidence_admission_id=r.wbs_final1_retained_evidence_admission_id AND a.domain=r.domain
    JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id
    JOIN source_document_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id
      AND l.source_document_id=r.source_document_id AND l.source_document_line_id=r.source_document_line_id
   WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.accounting_period_id=p_period AND r.domain='PAYABLES'
     AND r.outcome IN ('STAGING_REVIEW_REQUIRED','EXCEPTION_REVIEW_REQUIRED')
     AND d.status IN ('QUARANTINED','PENDING_REVIEW','READY_FOR_DRAFT')
   ORDER BY d.accounting_date,d.source_document_id,l.line_no,l.source_document_line_id
   LIMIT p_limit;
END;$$;

REVOKE ALL ON FUNCTION refs_read_ai_admitted_source_booking_evidence(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_admitted_source_booking_evidence(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
