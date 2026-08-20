BEGIN;

CREATE FUNCTION refs_read_ai_closing_settlement_source(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 500)
RETURNS TABLE(source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_line_hash text,entity_id uuid,accounting_period_id uuid,settlement_type text,closing_date date,line_code text,description text,side text,amount text,currency text,property_ref text,project_ref text,counterparty_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'AI closing settlement source limit must be between 1 and 500' USING ERRCODE='22023';END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ledger_code='PRIMARY') THEN RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023';END IF;
  IF (SELECT count(*) FROM source_document_line l JOIN source_document d ON d.tenant_id=l.tenant_id AND d.entity_id=l.entity_id AND d.source_document_id=l.source_document_id JOIN accounting_period p ON p.tenant_id=d.tenant_id AND p.entity_id=d.entity_id AND p.period_id=p_period WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.source_module='closing' AND d.accounting_date BETWEEN p.starts_on AND p.ends_on AND d.status NOT IN('RECEIVED','VALIDATING','QUARANTINED','REJECTED','EXCLUDED','DUPLICATE'))>p_limit THEN RAISE EXCEPTION 'Complete closing settlement population exceeds the bounded analysis limit' USING ERRCODE='54000';END IF;
  RETURN QUERY
  SELECT d.source_document_id,l.source_document_line_id,d.payload_hash,
    refs_jsonb_hash(jsonb_build_object('source_document_id',d.source_document_id,'source_document_line_id',l.source_document_line_id,'line_no',l.line_no,'amount',to_char(l.amount,'FM999999999999999990.0000'),'direction',l.direction,'description',l.description,'party_ref',l.party_ref,'project_ref',l.project_ref,'property_ref',l.property_ref,'external_dimension_refs',l.external_dimension_refs)),
    p_entity,p_period,upper(coalesce(nullif(l.external_dimension_refs->>'signed_settlement_type',''),CASE WHEN d.document_type ILIKE '%SALE%' THEN 'SALE' ELSE 'PURCHASE' END)),
    coalesce(nullif(l.external_dimension_refs->>'signed_closing_date','')::date,d.business_date),coalesce(nullif(l.external_dimension_refs->>'signed_line_code',''),l.source_line_id),coalesce(nullif(l.description,''),l.source_line_id),
    CASE WHEN l.direction IN('DEBIT','OUTFLOW') THEN 'DEBIT' WHEN l.direction IN('CREDIT','INFLOW') THEN 'CREDIT' ELSE 'INFORMATIONAL' END,to_char(l.amount,'FM999999999999999990.0000'),d.currency::text,l.property_ref,l.project_ref,coalesce(nullif(l.external_dimension_refs->>'signed_counterparty_name',''),nullif(l.party_ref,''))
  FROM source_document d JOIN source_document_line l ON l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id
  JOIN accounting_period p ON p.tenant_id=d.tenant_id AND p.entity_id=d.entity_id AND p.period_id=p_period
  WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.source_module='closing' AND d.accounting_date BETWEEN p.starts_on AND p.ends_on AND d.status NOT IN('RECEIVED','VALIDATING','QUARANTINED','REJECTED','EXCLUDED','DUPLICATE')
  ORDER BY d.accounting_date,d.source_document_id,l.line_no,l.source_document_line_id LIMIT p_limit;
END;$$;

REVOKE ALL ON FUNCTION refs_read_ai_closing_settlement_source(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_closing_settlement_source(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;

