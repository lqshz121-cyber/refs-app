BEGIN;

-- Exact-period, explanation-only population for deterministic construction
-- loan transaction classification. Lender closing-balance rows are handled by
-- the independent loan-balance review and are not transaction candidates.
CREATE FUNCTION refs_read_ai_construction_loan_source(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 100)
RETURNS TABLE(source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_line_hash text,loan_ref text,currency text,amount text,direction text,description text,bank_account_ref text,project_ref text,property_ref text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_row accounting_period; population_count bigint;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'AI construction loan source limit must be between 1 and 500' USING ERRCODE='22023'; END IF;
  SELECT * INTO period_row FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ledger_code='PRIMARY';
  IF period_row.period_id IS NULL THEN RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO population_count
    FROM source_document d JOIN source_document_line l ON l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id
   WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.source_module='loan' AND d.status='READY_FOR_DRAFT'
     AND d.accounting_date BETWEEN period_row.starts_on AND period_row.ends_on
     AND coalesce(l.external_dimension_refs->>'statement_balance_kind','')<>'CLOSING_PRINCIPAL_BALANCE';
  IF population_count>p_limit THEN RAISE EXCEPTION 'Complete construction loan population exceeds the bounded classification limit' USING ERRCODE='54000'; END IF;
  RETURN QUERY
  SELECT d.source_document_id,l.source_document_line_id,d.payload_hash,
         refs_jsonb_hash(jsonb_build_object('schema_version','AI_CONSTRUCTION_LOAN_SOURCE_LINE_V1','source_document_line_id',l.source_document_line_id,'source_line_id',l.source_line_id,'line_no',l.line_no,'amount',l.amount,'direction',l.direction,'description',l.description,'loan_ref',l.loan_ref,'bank_account_ref',l.bank_account_ref,'project_ref',l.project_ref,'property_ref',l.property_ref)),
         l.loan_ref,d.currency::text,l.amount::text,l.direction,l.description,l.bank_account_ref,l.project_ref,l.property_ref
    FROM source_document d JOIN source_document_line l ON l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id
   WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.source_module='loan' AND d.status='READY_FOR_DRAFT'
     AND d.accounting_date BETWEEN period_row.starts_on AND period_row.ends_on
     AND coalesce(l.external_dimension_refs->>'statement_balance_kind','')<>'CLOSING_PRINCIPAL_BALANCE'
   ORDER BY d.accounting_date,d.source_document_id,l.line_no,l.source_document_line_id LIMIT p_limit;
END; $$;

REVOKE ALL ON FUNCTION refs_read_ai_construction_loan_source(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_construction_loan_source(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
