BEGIN;

-- Exact-period, explanation-only population for deterministic invoice
-- accounting classification. This avoids granting the AI Controller generic
-- GL/source-document browsing authority and never returns immutable raw bytes.
CREATE FUNCTION refs_read_ai_invoice_classification_source(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 100)
RETURNS TABLE(source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_line_hash text,entity_id uuid,accounting_period_id uuid,vendor_name text,invoice_no text,invoice_date date,currency text,amount text,service_period_start date,service_period_end date,description text,project_ref text,property_ref text,charge_code text,accounting_status text,posted_debit_account_classes text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'AI invoice classification source limit must be between 1 and 500' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ledger_code='PRIMARY') THEN RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM wbs_final1_retained_source_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.accounting_period_id=p_period AND r.domain='PAYABLES')>p_limit THEN
    RAISE EXCEPTION 'Complete invoice population exceeds the bounded classification limit' USING ERRCODE='54000';
  END IF;
  RETURN QUERY
  SELECT d.source_document_id,l.source_document_line_id,d.payload_hash,r.raw_row_hash,p_entity,p_period,
         l.party_ref,d.document_no,(l.external_dimension_refs->>'signed_invoice_date')::date,d.currency::text,
         abs(l.amount)::text,NULLIF(l.external_dimension_refs->>'signed_service_period_start','')::date,
         NULLIF(l.external_dimension_refs->>'signed_service_period_end','')::date,
         NULLIF(l.external_dimension_refs->>'signed_invoice_description',''),l.project_ref,l.property_ref,
         NULLIF(l.external_dimension_refs->>'signed_charge_code',''),
         CASE WHEN EXISTS(SELECT 1 FROM source_link sl JOIN journal_entry j ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=d.source_document_id AND j.status='POSTED') THEN 'POSTED' ELSE 'NOT_RECORDED' END,
         ARRAY(SELECT DISTINCT CASE WHEN jl.account_code LIKE '1%' THEN 'ASSET' WHEN jl.account_code LIKE '2%' THEN 'LIABILITY' WHEN jl.account_code LIKE '3%' THEN 'EQUITY' WHEN jl.account_code LIKE '4%' THEN 'REVENUE' WHEN jl.account_code~'^[5-9]' THEN 'EXPENSE' ELSE 'UNCLASSIFIED' END
                 FROM source_link sl JOIN journal_entry j ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id
                 JOIN journal_line jl ON jl.tenant_id=j.tenant_id AND jl.entity_id=j.entity_id AND jl.journal_entry_id=j.journal_entry_id AND (sl.journal_line_id IS NULL OR sl.journal_line_id=jl.journal_line_id)
                WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=d.source_document_id AND j.status='POSTED' AND jl.debit_amount>0 ORDER BY 1)
    FROM wbs_final1_retained_source_row r
    JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id
    JOIN source_document_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id AND l.source_document_line_id=r.source_document_line_id AND l.source_document_id=r.source_document_id
   WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.accounting_period_id=p_period AND r.domain='PAYABLES'
   ORDER BY d.accounting_date,d.source_document_id,l.line_no,l.source_document_line_id
   LIMIT p_limit;
END; $$;

REVOKE ALL ON FUNCTION refs_read_ai_invoice_classification_source(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_invoice_classification_source(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
