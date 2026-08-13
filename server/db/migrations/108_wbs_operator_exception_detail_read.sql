BEGIN;

-- Closed, display-only reader for retained operator-attested Payable rows.
-- The retained payload remains immutable exception evidence. A matching later
-- signed inbound row is only a pointer to the separate signed review queue; it
-- never promotes this operator-attested row or grants an accounting command.
CREATE FUNCTION refs_read_wbs_operator_payable_exception_rows(
  p_tenant uuid,p_entity uuid,p_attestation uuid,p_limit integer DEFAULT 10
) RETURNS TABLE(
  wbs_operator_payable_attestation_id uuid,wbs_operator_payable_evidence_row_id uuid,
  captured_at timestamptz,provider_content_hash text,observation_hash text,
  company_code text,company_scope_status text,source_record_id text,source_version text,row_hash text,
  document_number text,accounting_date text,currency text,observed_amount text,provider_status text,
  signed_link_status text,signed_wbs_inbound_row_id uuid,next_owner text,next_action text,
  evidence_status text,signature_verified boolean,can_review boolean,can_create_draft boolean,can_post boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'WBS.PAYABLE.OPERATOR_ATTEST');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>10 THEN
    RAISE EXCEPTION 'WBS operator exception-row limit must be between 1 and 10' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.wbs_operator_payable_attestation a
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
      AND a.wbs_operator_payable_attestation_id=p_attestation
  ) THEN
    RAISE EXCEPTION 'WBS operator-attested evidence was not found' USING ERRCODE='P0002';
  END IF;

  RETURN QUERY
  SELECT a.wbs_operator_payable_attestation_id,e.wbs_operator_payable_evidence_row_id,
    a.captured_at,a.provider_content_hash,a.observation_hash,
    CASE
      WHEN btrim(COALESCE(e.raw->>'company_code',''))~'^[A-Za-z0-9][A-Za-z0-9_:-]{0,63}$' THEN btrim(e.raw->>'company_code')
      WHEN jsonb_array_length(a.company_codes)=1 THEN a.company_codes->>0
      ELSE NULL
    END,
    a.company_scope_status,e.source_record_id,e.source_version,e.row_hash,
    CASE WHEN length(btrim(COALESCE(e.raw->>'invoice_no',''))) BETWEEN 1 AND 128
      AND btrim(e.raw->>'invoice_no')!~'[[:cntrl:]]' THEN btrim(e.raw->>'invoice_no') END,
    CASE
      WHEN public.refs_wbs_payable_iso_date(NULLIF(btrim(e.raw->>'posting_date'),'')) IS NOT NULL
        THEN to_char(public.refs_wbs_payable_iso_date(NULLIF(btrim(e.raw->>'posting_date'),'')),'YYYY-MM-DD')
      WHEN public.refs_wbs_payable_iso_date(NULLIF(btrim(e.raw->>'incurred_date'),'')) IS NOT NULL
        THEN to_char(public.refs_wbs_payable_iso_date(NULLIF(btrim(e.raw->>'incurred_date'),'')),'YYYY-MM-DD')
    END,
    CASE WHEN upper(btrim(COALESCE(e.raw->>'currency','')))~'^[A-Z]{3}$' THEN upper(btrim(e.raw->>'currency')) END,
    CASE WHEN btrim(COALESCE(e.raw->>'amount',''))~'^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,5})?$' THEN btrim(e.raw->>'amount') END,
    CASE WHEN length(btrim(COALESCE(e.raw->>'pay_status',e.raw->>'review_status',''))) BETWEEN 1 AND 64
      AND btrim(COALESCE(e.raw->>'pay_status',e.raw->>'review_status'))!~'[[:cntrl:]]'
      THEN btrim(COALESCE(e.raw->>'pay_status',e.raw->>'review_status')) END,
    CASE WHEN signed.wbs_inbound_row_id IS NULL THEN 'EXCEPTION_REVIEW_REQUIRED' ELSE 'ELIGIBLE_FOR_SIGNED_REVIEW' END,
    signed.wbs_inbound_row_id,
    CASE
      WHEN signed.wbs_inbound_row_id IS NOT NULL THEN 'WBS Payable reviewer'
      WHEN a.company_scope_status='ENTITY_SCOPE_MATCHED' THEN 'WBS provider administrator'
      ELSE 'Accounting data steward'
    END,
    CASE
      WHEN signed.wbs_inbound_row_id IS NOT NULL THEN 'Open the separate signed Payable review queue for attachment and mapping checks.'
      WHEN a.company_scope_status='ENTITY_SCOPE_MATCHED' THEN 'Supply a signed provider package and replay-safe receipt for this exact source row.'
      ELSE 'Assign this row to one approved WBS company, then obtain a signed provider package.'
    END,
    'EXCEPTION_REVIEW_REQUIRED'::text,false,false,false,false
  FROM public.wbs_operator_payable_attestation a
  JOIN public.wbs_operator_payable_evidence_row e
    ON e.tenant_id=a.tenant_id AND e.entity_id=a.entity_id
    AND e.wbs_operator_payable_attestation_id=a.wbs_operator_payable_attestation_id
  LEFT JOIN LATERAL (
    SELECT r.wbs_inbound_row_id
    FROM public.wbs_inbound_row r
    JOIN public.wbs_inbound_receipt receipt
      ON receipt.tenant_id=r.tenant_id AND receipt.entity_id=r.entity_id AND receipt.receipt_id=r.receipt_id
    JOIN public.wbs_snapshot_import imp
      ON imp.tenant_id=r.tenant_id AND imp.entity_id=r.entity_id
      AND imp.import_batch_id=receipt.import_batch_id AND imp.environment='PRODUCTION'
    JOIN public.wbs_snapshot_delivery_attestation delivery
      ON delivery.tenant_id=imp.tenant_id AND delivery.entity_id=imp.entity_id
      AND delivery.wbs_snapshot_import_id=imp.wbs_snapshot_import_id
    JOIN public.wbs_snapshot_receipt snapshot_receipt
      ON snapshot_receipt.tenant_id=r.tenant_id AND snapshot_receipt.entity_id=r.entity_id
      AND snapshot_receipt.wbs_snapshot_import_id=imp.wbs_snapshot_import_id
      AND snapshot_receipt.source_module='BGDATA.payable'
      AND snapshot_receipt.ingestion_kind='TRANSACTION_CANDIDATE'
      AND snapshot_receipt.source_record_id=r.source_record_id
      AND snapshot_receipt.source_version=r.source_version
      AND snapshot_receipt.payload_hash=receipt.receipt_hash
      AND snapshot_receipt.payload_ref=receipt.payload_ref
    WHERE r.tenant_id=a.tenant_id AND r.entity_id=a.entity_id
      AND r.source_record_id=e.source_record_id
      AND public.refs_jsonb_hash(r.raw)=e.row_hash
      AND r.outcome_kind='STAGING' AND r.outcome->>'stage'='STAGING_REVIEW_REQUIRED'
      AND r.normalized->>'source_system'='WBS' AND r.normalized->>'source_type'='PAYABLE'
      AND r.normalized->>'source_record_id'=r.source_record_id
      AND r.normalized->>'source_version'=r.source_version
      AND r.normalized->>'receipt_hash'=receipt.receipt_hash
    ORDER BY r.created_at DESC,r.wbs_inbound_row_id DESC LIMIT 1
  ) signed ON true
  WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
    AND a.wbs_operator_payable_attestation_id=p_attestation
  ORDER BY e.created_at,e.wbs_operator_payable_evidence_row_id LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_wbs_operator_payable_exception_rows(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_wbs_operator_payable_exception_rows(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
