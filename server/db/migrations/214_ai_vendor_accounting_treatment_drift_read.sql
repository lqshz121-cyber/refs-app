BEGIN;

CREATE FUNCTION refs_read_ai_vendor_accounting_treatment_history(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 1000)
RETURNS TABLE(entity_id uuid,accounting_period_id uuid,classification_evidence_id uuid,source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_line_hash text,classification_hash text,vendor_ref text,vendor_name text,classification text,is_current_period boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected_period accounting_period;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'AI vendor treatment history limit must be between 1 and 1000' USING ERRCODE='22023';END IF;
  SELECT period.* INTO selected_period FROM accounting_period period WHERE period.tenant_id=p_tenant AND period.entity_id=p_entity AND period.period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI vendor treatment current accounting period was not found' USING ERRCODE='23503';END IF;
  IF EXISTS(
    SELECT 1 FROM ai_invoice_accounting_classification_evidence evidence
    JOIN accounting_period period ON period.tenant_id=evidence.tenant_id AND period.entity_id=evidence.entity_id AND period.period_id=evidence.accounting_period_id
    JOIN source_document source ON source.tenant_id=evidence.tenant_id AND source.entity_id=evidence.entity_id AND source.source_document_id=evidence.source_document_id
    JOIN source_document_line line ON line.tenant_id=evidence.tenant_id AND line.entity_id=evidence.entity_id AND line.source_document_id=evidence.source_document_id AND line.source_document_line_id=evidence.source_document_line_id
    WHERE evidence.tenant_id=p_tenant AND evidence.entity_id=p_entity AND period.ends_on<=selected_period.ends_on
      AND evidence.classification IN('EXPENSE','PREPAID_AMORTIZATION','ACCRUAL_REVIEW','CAPITALIZATION_REVIEW')
      AND (source.payload_hash IS DISTINCT FROM evidence.source_payload_hash OR NULLIF(btrim(line.party_ref),'') IS NULL)
  ) THEN RAISE EXCEPTION 'AI vendor treatment history contains drifted source hashes or missing retained vendor identity' USING ERRCODE='23514';END IF;
  RETURN QUERY
  SELECT evidence.entity_id,evidence.accounting_period_id,evidence.ai_invoice_accounting_classification_evidence_id,evidence.source_document_id,evidence.source_document_line_id,evidence.source_payload_hash,evidence.source_line_hash,evidence.classification_hash,btrim(line.party_ref),coalesce(NULLIF(btrim(source.counterparty_name),''),btrim(line.party_ref)),evidence.classification,(evidence.accounting_period_id=p_period)
  FROM ai_invoice_accounting_classification_evidence evidence
  JOIN accounting_period period ON period.tenant_id=evidence.tenant_id AND period.entity_id=evidence.entity_id AND period.period_id=evidence.accounting_period_id
  JOIN source_document source ON source.tenant_id=evidence.tenant_id AND source.entity_id=evidence.entity_id AND source.source_document_id=evidence.source_document_id AND source.payload_hash=evidence.source_payload_hash
  JOIN source_document_line line ON line.tenant_id=evidence.tenant_id AND line.entity_id=evidence.entity_id AND line.source_document_id=evidence.source_document_id AND line.source_document_line_id=evidence.source_document_line_id
  WHERE evidence.tenant_id=p_tenant AND evidence.entity_id=p_entity AND period.ends_on<=selected_period.ends_on
    AND evidence.classification IN('EXPENSE','PREPAID_AMORTIZATION','ACCRUAL_REVIEW','CAPITALIZATION_REVIEW') AND NULLIF(btrim(line.party_ref),'') IS NOT NULL
  ORDER BY period.ends_on DESC,evidence.created_at DESC,evidence.ai_invoice_accounting_classification_evidence_id
  LIMIT p_limit;
END;$$;

REVOKE ALL ON FUNCTION refs_read_ai_vendor_accounting_treatment_history(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_vendor_accounting_treatment_history(uuid,uuid,uuid,integer) TO refs_app;
COMMIT;
