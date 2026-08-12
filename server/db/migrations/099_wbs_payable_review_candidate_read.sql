BEGIN;

CREATE FUNCTION refs_read_wbs_payable_review_candidates(
  p_tenant uuid,p_entity uuid,p_row uuid DEFAULT NULL,p_limit integer DEFAULT 50
)
RETURNS TABLE(
  wbs_inbound_row_id uuid,source_version text,receipt_hash text,evidence_hash text,revision bigint,
  period_id uuid,document_number text,invoice_date text,due_date text,accounting_date text,currency text,
  gross_amount numeric(20,4),vendor_name text,offset_account_code text,
  setting_snapshot_id uuid,mapping_snapshot_id uuid,attachment_choices jsonb,
  review_readiness text,can_review boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'WBS.PAYABLE.REVIEW');
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN
    RAISE EXCEPTION 'WBS Payable review-candidate limit must be between 1 and 50' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT r.*,receipt.receipt_hash,receipt.payload_ref,imp.wbs_snapshot_import_id,imp.created_by AS imported_by,
      normalized.company_key,normalized.currency,normalized.accounting_date,normalized.business_date,
      normalized.vendor_ref,normalized.direction,normalized.amount_money4,normalized.cost_code_ref,
      public.refs_wbs_payable_iso_date(NULLIF(btrim(r.raw->'external_trace'->>'invoice_date'),'')) invoice_on,
      public.refs_wbs_payable_iso_date(NULLIF(btrim(r.raw->'external_trace'->>'pay_due_date'),'')) due_on,
      NULLIF(btrim(r.raw->'external_trace'->>'invoice_no'),'') document_no,
      public.refs_wbs_payable_review_evidence_hash(r.wbs_inbound_row_id,r.source_record_id,r.source_version,receipt.receipt_hash,r.raw,r.normalized,r.outcome,r.outcome_kind) evidence_digest,
      EXISTS(SELECT 1 FROM public.wbs_payable_review_evidence existing WHERE existing.tenant_id=r.tenant_id AND existing.entity_id=r.entity_id AND existing.wbs_inbound_row_id=r.wbs_inbound_row_id) already_reviewed
    FROM public.wbs_inbound_row r
    JOIN public.wbs_inbound_receipt receipt ON receipt.tenant_id=r.tenant_id AND receipt.entity_id=r.entity_id AND receipt.receipt_id=r.receipt_id
    JOIN public.wbs_snapshot_import imp ON imp.tenant_id=r.tenant_id AND imp.entity_id=r.entity_id AND imp.import_batch_id=receipt.import_batch_id AND imp.environment='PRODUCTION'
    JOIN public.wbs_snapshot_delivery_attestation delivery ON delivery.tenant_id=imp.tenant_id AND delivery.entity_id=imp.entity_id AND delivery.wbs_snapshot_import_id=imp.wbs_snapshot_import_id
    JOIN public.wbs_snapshot_receipt snapshot_receipt ON snapshot_receipt.tenant_id=r.tenant_id AND snapshot_receipt.entity_id=r.entity_id
      AND snapshot_receipt.wbs_snapshot_import_id=imp.wbs_snapshot_import_id AND snapshot_receipt.source_module='BGDATA.payable'
      AND snapshot_receipt.ingestion_kind='TRANSACTION_CANDIDATE' AND snapshot_receipt.source_record_id=r.source_record_id
      AND snapshot_receipt.source_version=r.source_version AND snapshot_receipt.payload_hash=receipt.receipt_hash AND snapshot_receipt.payload_ref=receipt.payload_ref
    CROSS JOIN LATERAL (SELECT
      btrim(r.normalized->>'company_key') company_key,upper(btrim(r.normalized->>'currency')) currency,
      public.refs_wbs_payable_iso_date(r.normalized->>'accounting_date') accounting_date,
      public.refs_wbs_payable_iso_date(r.normalized->>'business_date') business_date,
      btrim(r.normalized->>'vendor_ref') vendor_ref,upper(btrim(r.normalized->>'direction')) direction,
      r.normalized->>'amount_money4' amount_money4,r.normalized->'cost_code_ref' cost_code_ref
    ) normalized
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND (p_row IS NULL OR r.wbs_inbound_row_id=p_row)
      AND r.outcome_kind='STAGING' AND r.outcome->>'stage'='STAGING_REVIEW_REQUIRED'
      AND r.normalized->>'source_system'='WBS' AND r.normalized->>'source_type'='PAYABLE'
      AND r.normalized->>'source_record_id'=r.source_record_id AND r.normalized->>'source_version'=r.source_version
      AND r.normalized->>'receipt_hash'=receipt.receipt_hash
  ), scoped AS (
    SELECT b.*,entity_row.base_currency,entity_row.source_entity_id,
      period_choice.period_count,period_choice.period_id,
      setting_choice.setting_count,setting_choice.setting_snapshot_id,setting_choice.setting_created_by,setting_choice.setting_approved_by,
      mapping_choice.mapping_count,mapping_choice.mapping_snapshot_id,mapping_choice.mapping_created_by,mapping_choice.mapping_approved_by,
      mapping_choice.offset_account_code,mapping_choice.mapped_vendor_ref,mapping_choice.source_direction,mapping_choice.amount_multiplier,
      vendor_choice.vendor_name,vendor_choice.vendor_ready,offset_choice.offset_ready,control_choice.control_ready,
      attachments.attachment_choices,attachments.attachment_count,
      CASE WHEN b.amount_money4~'^-?(0|[1-9][0-9]*)(\.[0-9]{4})$' AND mapping_choice.amount_multiplier IN ('1','-1')
        THEN (b.amount_money4::numeric(20,4)*mapping_choice.amount_multiplier::numeric)::numeric(20,4) END reviewed_amount
    FROM base b
    JOIN public.entity entity_row ON entity_row.tenant_id=b.tenant_id AND entity_row.entity_id=b.entity_id AND entity_row.active
    LEFT JOIN LATERAL (
      SELECT count(*)::integer period_count,(array_agg(ap.period_id ORDER BY ap.period_id))[1] period_id
      FROM public.accounting_period ap WHERE ap.tenant_id=b.tenant_id AND ap.entity_id=b.entity_id AND ap.status='OPEN' AND b.accounting_date BETWEEN ap.starts_on AND ap.ends_on
    ) period_choice ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer setting_count,(array_agg(s.setting_snapshot_id ORDER BY s.setting_snapshot_id))[1] setting_snapshot_id,
        (array_agg(s.created_by ORDER BY s.setting_snapshot_id))[1] setting_created_by,(array_agg(s.approved_by ORDER BY s.setting_snapshot_id))[1] setting_approved_by
      FROM public.setting_snapshot s WHERE s.tenant_id=b.tenant_id AND s.entity_id=b.entity_id AND s.family='WBS_PAYABLE_AP_REVIEW'
        AND s.scope_type='ENTITY' AND s.scope_key=b.entity_id::text AND s.status='APPROVED'
        AND b.accounting_date::timestamptz>=s.effective_from AND (s.effective_to IS NULL OR b.accounting_date::timestamptz<s.effective_to)
        AND clock_timestamp()>=s.effective_from AND (s.effective_to IS NULL OR clock_timestamp()<s.effective_to)
        AND s.snapshot_hash=public.refs_jsonb_hash(s.snapshot)
    ) setting_choice ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer mapping_count,(array_agg(m.mapping_snapshot_id ORDER BY m.mapping_snapshot_id))[1] mapping_snapshot_id,
        (array_agg(m.created_by ORDER BY m.mapping_snapshot_id))[1] mapping_created_by,(array_agg(m.approved_by ORDER BY m.mapping_snapshot_id))[1] mapping_approved_by,
        (array_agg(m.output_rules->>'offset_account_code' ORDER BY m.mapping_snapshot_id))[1] offset_account_code,
        (array_agg(m.output_rules->>'vendor_ref' ORDER BY m.mapping_snapshot_id))[1] mapped_vendor_ref,
        (array_agg(m.output_rules->>'source_direction' ORDER BY m.mapping_snapshot_id))[1] source_direction,
        (array_agg(m.output_rules->>'amount_multiplier' ORDER BY m.mapping_snapshot_id))[1] amount_multiplier
      FROM public.mapping_snapshot m
      WHERE m.tenant_id=b.tenant_id AND m.entity_id=b.entity_id AND m.family='WBS_PAYABLE_AP'
        AND m.scope_type='ENTITY' AND m.scope_key=b.entity_id::text AND m.status='APPROVED'
        AND m.input_keys=jsonb_build_object('company_key',b.company_key,'currency',b.currency,'vendor_ref',b.vendor_ref,'cost_code_ref',b.cost_code_ref)
        AND m.input_key_hash=public.refs_jsonb_hash(jsonb_build_object('company_key',b.company_key,'currency',b.currency,'vendor_ref',b.vendor_ref,'cost_code_ref',b.cost_code_ref))
        AND b.accounting_date::timestamptz>=m.effective_from AND (m.effective_to IS NULL OR b.accounting_date::timestamptz<m.effective_to)
        AND clock_timestamp()>=m.effective_from AND (m.effective_to IS NULL OR clock_timestamp()<m.effective_to)
        AND m.snapshot_hash=public.refs_jsonb_hash(jsonb_build_object('input_keys',m.input_keys,'output_rules',m.output_rules))
        AND m.priority=(SELECT max(x.priority) FROM public.mapping_snapshot x WHERE x.tenant_id=m.tenant_id AND x.entity_id=m.entity_id
          AND x.family=m.family AND x.scope_type=m.scope_type AND x.scope_key=m.scope_key AND x.status='APPROVED'
          AND x.input_keys=m.input_keys AND x.input_key_hash=m.input_key_hash
          AND b.accounting_date::timestamptz>=x.effective_from AND (x.effective_to IS NULL OR b.accounting_date::timestamptz<x.effective_to)
          AND clock_timestamp()>=x.effective_from AND (x.effective_to IS NULL OR clock_timestamp()<x.effective_to))
    ) mapping_choice ON true
    LEFT JOIN LATERAL (SELECT (array_agg(mm.display_name ORDER BY mm.member_ref))[1] vendor_name,count(*)=1 vendor_ready FROM public.member_master mm
      WHERE mm.tenant_id=b.tenant_id AND mm.entity_id=b.entity_id AND mm.member_ref=b.vendor_ref AND mm.member_type='VENDOR' AND mm.active) vendor_choice ON true
    LEFT JOIN LATERAL (SELECT count(*)=1 offset_ready FROM public.account_master am WHERE am.tenant_id=b.tenant_id AND am.entity_id=b.entity_id AND am.account_code=mapping_choice.offset_account_code AND am.active) offset_choice ON true
    LEFT JOIN LATERAL (SELECT count(*)=1 control_ready FROM public.account_master am WHERE am.tenant_id=b.tenant_id AND am.entity_id=b.entity_id AND am.account_code='291001' AND am.active AND am.requires_member AND am.required_member_type='VENDOR') control_choice ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(jsonb_agg(jsonb_build_object('attachment_id',a.attachment_id,'name',a.name,'media_type',a.media_type,'verified_at',a.verified_at) ORDER BY a.verified_at DESC,a.attachment_id) FILTER (WHERE a.attachment_id IS NOT NULL),'[]'::jsonb) attachment_choices,
        count(a.attachment_id)::integer attachment_count
      FROM (SELECT * FROM public.attachment candidate WHERE candidate.tenant_id=b.tenant_id AND candidate.entity_id=b.entity_id
        AND candidate.finalization_status='VERIFIED_CLEAN' AND candidate.scan_status='CLEAN' AND candidate.verified_at IS NOT NULL AND candidate.finalized_at IS NOT NULL
        ORDER BY candidate.verified_at DESC,candidate.attachment_id LIMIT 25) a
    ) attachments ON true
  ), final AS (
    SELECT s.*,
      CASE WHEN s.already_reviewed THEN 'ALREADY_REVIEWED'
        WHEN s.source_entity_id IS DISTINCT FROM s.company_key OR s.base_currency::text IS DISTINCT FROM s.currency THEN 'ENTITY_SCOPE_MISMATCH'
        WHEN s.accounting_date IS NULL OR s.business_date IS NULL OR s.invoice_on IS NULL OR s.due_on IS NOT NULL AND s.due_on<s.invoice_on THEN 'PAYABLE_FACTS_INCOMPLETE'
        WHEN s.period_count<>1 THEN 'OPEN_PERIOD_REQUIRED'
        WHEN s.setting_count<>1 THEN 'APPROVED_SETTING_REQUIRED'
        WHEN s.mapping_count<>1 THEN 'APPROVED_MAPPING_REQUIRED'
        WHEN s.mapped_vendor_ref IS DISTINCT FROM s.vendor_ref OR s.source_direction IS DISTINCT FROM s.direction OR s.amount_multiplier NOT IN ('1','-1') OR COALESCE(s.reviewed_amount,0)<=0 THEN 'MAPPING_SCOPE_MISMATCH'
        WHEN NOT s.vendor_ready OR NOT s.offset_ready OR NOT s.control_ready THEN 'LOCAL_MASTER_DATA_REQUIRED'
        WHEN public.refs_current_actor() IN (s.imported_by,s.setting_created_by,s.setting_approved_by,s.mapping_created_by,s.mapping_approved_by) THEN 'REVIEWER_SOD_BLOCKED'
        WHEN s.attachment_count=0 THEN 'VERIFIED_ATTACHMENT_REQUIRED'
        ELSE 'READY_FOR_REVIEW' END readiness
    FROM scoped s
  )
  SELECT f.wbs_inbound_row_id,f.source_version,f.receipt_hash,f.evidence_digest,0::bigint,f.period_id,f.document_no,
    CASE WHEN f.invoice_on IS NULL THEN NULL ELSE to_char(f.invoice_on,'YYYY-MM-DD') END,
    CASE WHEN f.due_on IS NULL THEN NULL ELSE to_char(f.due_on,'YYYY-MM-DD') END,
    CASE WHEN f.accounting_date IS NULL THEN NULL ELSE to_char(f.accounting_date,'YYYY-MM-DD') END,
    f.currency::text,f.reviewed_amount,f.vendor_name,f.offset_account_code,
    f.setting_snapshot_id,f.mapping_snapshot_id,f.attachment_choices,f.readiness,f.readiness='READY_FOR_REVIEW'
  FROM final f ORDER BY f.created_at DESC,f.wbs_inbound_row_id DESC LIMIT p_limit;

  IF p_row IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'WBS Payable review candidate was not found' USING ERRCODE='P0002'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_wbs_payable_review_candidates(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_wbs_payable_review_candidates(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
