BEGIN;

CREATE FUNCTION refs_read_ai_invoice_source_support_inputs(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 1000)
RETURNS TABLE(classification_evidence_id uuid,entity_id uuid,accounting_period_id uuid,source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_line_hash text,classification_hash text,classification text,vendor_ref text,vendor_name text,invoice_number text,invoice_date date,currency text,amount text,verified_attachment_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF NOT EXISTS(SELECT 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period) THEN
    RAISE EXCEPTION 'AI invoice source-support period is outside entity scope' USING ERRCODE='22023';
  END IF;
  IF p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'AI invoice source-support limit must be between 1 and 1000' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  SELECT evidence.ai_invoice_accounting_classification_evidence_id,evidence.entity_id,evidence.accounting_period_id,
    evidence.source_document_id,evidence.source_document_line_id,evidence.source_payload_hash,evidence.source_line_hash,
    evidence.classification_hash,evidence.classification,btrim(line.party_ref),
    coalesce(NULLIF(btrim(source.counterparty_name),''),btrim(line.party_ref)),btrim(source.document_no),
    source.business_date,source.currency::text,to_char(line.amount,'FM9999999999999990.0000'),
    count(DISTINCT attachment.attachment_id) FILTER(WHERE link.link_type='SOURCE_ATTACHMENT' AND attachment.finalization_status='VERIFIED_CLEAN' AND attachment.scan_status='CLEAN' AND attachment.verified_at IS NOT NULL AND attachment.finalized_at IS NOT NULL)::integer
  FROM ai_invoice_accounting_classification_evidence evidence
  JOIN source_document source ON (source.tenant_id,source.entity_id,source.source_document_id)=(evidence.tenant_id,evidence.entity_id,evidence.source_document_id)
  JOIN source_document_line line ON (line.tenant_id,line.entity_id,line.source_document_id,line.source_document_line_id)=(source.tenant_id,source.entity_id,source.source_document_id,evidence.source_document_line_id)
  LEFT JOIN source_link link ON link.tenant_id=evidence.tenant_id AND link.entity_id=evidence.entity_id AND link.source_document_id=evidence.source_document_id AND link.source_document_line_id IS NULL AND link.attachment_id IS NOT NULL
  LEFT JOIN attachment ON attachment.tenant_id=link.tenant_id AND attachment.entity_id=link.entity_id AND attachment.attachment_id=link.attachment_id
  WHERE evidence.tenant_id=p_tenant AND evidence.entity_id=p_entity AND evidence.accounting_period_id=p_period
    AND evidence.classification IN('EXPENSE','PREPAID_AMORTIZATION','ACCRUAL_REVIEW','CAPITALIZATION_REVIEW')
    AND source.status IN('PENDING_REVIEW','READY_FOR_DRAFT')
  GROUP BY evidence.ai_invoice_accounting_classification_evidence_id,evidence.entity_id,evidence.accounting_period_id,
    evidence.source_document_id,evidence.source_document_line_id,evidence.source_payload_hash,evidence.source_line_hash,
    evidence.classification_hash,evidence.classification,line.party_ref,source.counterparty_name,source.document_no,
    source.business_date,source.currency,line.amount,evidence.created_at
  ORDER BY evidence.created_at DESC,evidence.ai_invoice_accounting_classification_evidence_id DESC LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_ai_invoice_source_support_inputs(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_invoice_source_support_inputs(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
