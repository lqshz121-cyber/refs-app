BEGIN;

CREATE FUNCTION refs_read_wbs_payable_review_evidence(
  p_tenant uuid,p_entity uuid,p_review uuid DEFAULT NULL,p_limit integer DEFAULT 50
)
RETURNS TABLE(
  wbs_payable_review_evidence_id uuid,wbs_inbound_row_id uuid,source_document_id uuid,staging_item_id uuid,
  period_id uuid,document_number text,invoice_date text,due_date text,accounting_date text,currency char(3),
  gross_amount numeric(20,4),vendor_ref text,vendor_name text,offset_account_code text,mapping_snapshot_id uuid,
  attachment_ids uuid[],evidence_hash text,review_reason text,reviewed_by text,reviewed_at timestamptz,
  revision bigint,evidence_status text,draft_readiness text,can_create_draft boolean,
  business_document_id uuid,journal_entry_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN
    RAISE EXCEPTION 'WBS Payable review evidence limit must be between 1 and 50' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH evidence_rows AS (
    SELECT e.*,s.status::text AS staging_status,s.version AS staging_version,s.source_document_id AS staging_source_document_id,
      s.mapping_snapshot_id AS staging_mapping_snapshot_id,d.status AS source_status,d.document_type,d.source_system,d.source_module,
      d.accounting_date,d.currency AS source_currency,d.gross_amount AS source_gross_amount,
      r.source_document_id AS rule_source_document_id,r.mapping_snapshot_id AS rule_mapping_snapshot_id,r.setting_snapshot_id AS rule_setting_snapshot_id,
      r.rule_code,r.rule_version,r.matched_facts,r.result,r.input_digest,r.evaluation_digest,
      m.input_keys,m.output_rules,m.snapshot_hash,
      draft.business_document_id,draft.journal_entry_id,
      ARRAY(SELECT a.attachment_id FROM public.wbs_payable_review_attachment a
        WHERE a.tenant_id=e.tenant_id AND a.entity_id=e.entity_id
          AND a.wbs_payable_review_evidence_id=e.wbs_payable_review_evidence_id ORDER BY a.attachment_id) AS frozen_attachments
    FROM public.wbs_payable_review_evidence e
    JOIN public.staging_item s ON s.tenant_id=e.tenant_id AND s.entity_id=e.entity_id AND s.staging_item_id=e.staging_item_id
    JOIN public.source_document d ON d.tenant_id=e.tenant_id AND d.entity_id=e.entity_id AND d.source_document_id=e.source_document_id
    JOIN public.rule_evaluation r ON r.tenant_id=e.tenant_id AND r.rule_evaluation_id=e.rule_evaluation_id
    JOIN public.mapping_snapshot m ON m.tenant_id=e.tenant_id AND m.mapping_snapshot_id=e.mapping_snapshot_id
    LEFT JOIN public.wbs_payable_draft_evidence draft ON draft.tenant_id=e.tenant_id AND draft.entity_id=e.entity_id
      AND draft.wbs_payable_review_evidence_id=e.wbs_payable_review_evidence_id
    WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity
      AND (p_review IS NULL OR e.wbs_payable_review_evidence_id=p_review)
  ), checked AS (
    SELECT x.*,
      public.refs_entity_has_permission(p_entity,'AP.BILL.CREATE') AS maker_authorized,
      public.refs_current_actor() IS DISTINCT FROM x.reviewed_by AS maker_separated,
      EXISTS(SELECT 1 FROM public.accounting_period ap WHERE ap.tenant_id=p_tenant AND ap.entity_id=p_entity
        AND ap.period_id=x.period_id AND ap.status='OPEN' AND x.accounting_date BETWEEN ap.starts_on AND ap.ends_on) AS period_ready,
      EXISTS(SELECT 1 FROM public.member_master mm WHERE mm.tenant_id=p_tenant AND mm.entity_id=p_entity
        AND mm.member_ref=x.result->>'vendor_ref' AND mm.member_type='VENDOR' AND mm.active) AS vendor_ready,
      EXISTS(SELECT 1 FROM public.account_master am WHERE am.tenant_id=p_tenant AND am.entity_id=p_entity
        AND am.account_code=x.result->>'offset_account_code' AND am.active) AS offset_ready,
      EXISTS(SELECT 1 FROM public.account_master am WHERE am.tenant_id=p_tenant AND am.entity_id=p_entity
        AND am.account_code='291001' AND am.active AND am.requires_member AND am.required_member_type='VENDOR') AS control_ready,
      cardinality(x.frozen_attachments)>0
        AND cardinality(x.frozen_attachments)=(SELECT count(*) FROM public.attachment a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
          AND a.attachment_id=ANY(x.frozen_attachments) AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN'
          AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL)
        AND cardinality(x.frozen_attachments)=(SELECT count(*) FROM public.source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity
          AND sl.link_type='SOURCE_ATTACHMENT' AND sl.source_document_id=x.source_document_id AND sl.staging_item_id=x.staging_item_id
          AND sl.attachment_id=ANY(x.frozen_attachments)) AS attachments_ready,
      x.staging_version=0 AND x.staging_status='READY_FOR_DRAFT'
        AND x.staging_source_document_id=x.source_document_id AND x.staging_mapping_snapshot_id=x.mapping_snapshot_id
        AND x.source_status='READY_FOR_DRAFT' AND x.document_type='WBS_PAYABLE' AND x.source_system='WBS' AND x.source_module='payable'
        AND x.rule_source_document_id=x.source_document_id AND x.rule_mapping_snapshot_id=x.mapping_snapshot_id
        AND x.period_id=(x.result->>'period_id')::uuid
        AND x.snapshot_hash=public.refs_jsonb_hash(jsonb_build_object('input_keys',x.input_keys,'output_rules',x.output_rules))
        AND x.setting_snapshot_id=x.rule_setting_snapshot_id
        AND x.evaluation_digest=public.refs_rule_evaluation_hash(x.rule_source_document_id,x.rule_setting_snapshot_id,x.rule_mapping_snapshot_id,x.rule_code,x.rule_version,x.matched_facts,x.result,x.input_digest)
        AND NULLIF(btrim(x.document_number),'') IS NOT NULL
        AND NULLIF(btrim(x.result->>'vendor_ref'),'') IS NOT NULL
        AND NULLIF(btrim(x.result->>'vendor_name'),'') IS NOT NULL
        AND NULLIF(btrim(x.result->>'offset_account_code'),'') IS NOT NULL
        AND COALESCE(x.result->>'gross_amount','') ~ '^(0|[1-9][0-9]*)(\.[0-9]{4})$'
        AND (x.result->>'gross_amount')::numeric(20,4)=x.source_gross_amount AND x.source_gross_amount>0
        AND x.result->>'currency' IS NOT DISTINCT FROM x.source_currency::text
        AND x.result->>'vendor_ref' IS NOT DISTINCT FROM x.output_rules->>'vendor_ref'
        AND x.result->>'offset_account_code' IS NOT DISTINCT FROM x.output_rules->>'offset_account_code'
        AND x.result->>'invoice_date' IS NOT DISTINCT FROM x.invoice_date::text
        AND x.result->>'due_date' IS NOT DISTINCT FROM to_jsonb(x.due_date)#>>'{}'
        AND (x.due_date IS NULL OR x.due_date>=x.invoice_date) AS chain_ready
    FROM evidence_rows x
  )
  SELECT c.wbs_payable_review_evidence_id,c.wbs_inbound_row_id,c.source_document_id,c.staging_item_id,c.period_id,
    c.document_number,to_char(c.invoice_date,'YYYY-MM-DD'),CASE WHEN c.due_date IS NULL THEN NULL ELSE to_char(c.due_date,'YYYY-MM-DD') END,
    to_char(c.accounting_date,'YYYY-MM-DD'),c.source_currency,c.source_gross_amount,
    c.result->>'vendor_ref',c.result->>'vendor_name',c.result->>'offset_account_code',c.mapping_snapshot_id,c.frozen_attachments,
    c.evidence_hash,c.review_reason,c.reviewed_by,c.reviewed_at,c.staging_version,
    CASE WHEN c.business_document_id IS NULL THEN 'READY_FOR_DRAFT_EVIDENCE_ONLY' ELSE 'DRAFT_CREATED' END,
    CASE WHEN c.business_document_id IS NOT NULL THEN 'ALREADY_DRAFTED'
      WHEN NOT c.maker_authorized THEN 'MAKER_PERMISSION_REQUIRED'
      WHEN NOT c.maker_separated THEN 'MAKER_REVIEWER_SOD'
      WHEN NOT c.period_ready THEN 'PERIOD_NOT_OPEN'
      WHEN NOT c.attachments_ready THEN 'ATTACHMENT_EVIDENCE_CHANGED'
      WHEN NOT c.vendor_ready OR NOT c.offset_ready OR NOT c.control_ready OR NOT c.chain_ready THEN 'EVIDENCE_REVALIDATION_FAILED'
      ELSE 'READY_FOR_AP_DRAFT' END,
    c.business_document_id IS NULL AND c.maker_authorized AND c.maker_separated AND c.period_ready AND c.attachments_ready
      AND c.vendor_ready AND c.offset_ready AND c.control_ready AND c.chain_ready,
    c.business_document_id,c.journal_entry_id
  FROM checked c ORDER BY c.reviewed_at DESC,c.wbs_payable_review_evidence_id DESC LIMIT p_limit;

  IF p_review IS NOT NULL AND NOT FOUND THEN
    RAISE EXCEPTION 'WBS Payable review evidence was not found' USING ERRCODE='P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_wbs_payable_review_evidence(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_wbs_payable_review_evidence(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
