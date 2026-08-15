BEGIN;

CREATE FUNCTION refs_read_wbs_cost_cwip_review_evidence(
  p_tenant uuid,p_entity uuid,p_review uuid DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS TABLE(
  wbs_cost_cwip_review_evidence_id uuid,wbs_inbound_row_id uuid,source_document_id uuid,staging_item_id uuid,
  period_id uuid,document_number text,accounting_date text,currency char(3),gross_amount numeric(20,4),
  project_ref text,cost_code_ref text,cwip_account_code text,offset_account_code text,mapping_snapshot_id uuid,
  receipt_hash text,evidence_hash text,review_reason text,reviewed_by text,reviewed_at timestamptz,
  journal_entry_id uuid,journal_status text,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'WBS.COST.CWIP.REVIEW');
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN
    RAISE EXCEPTION 'WBS Cost-to-CWIP review evidence limit must be between 1 and 50' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  SELECT e.wbs_cost_cwip_review_evidence_id,e.wbs_inbound_row_id,e.source_document_id,e.staging_item_id,
    e.period_id,d.document_no,to_char(d.accounting_date,'YYYY-MM-DD'),d.currency,d.gross_amount,
    r.matched_facts->>'project_ref',r.matched_facts->>'cost_code_ref',m.output_rules->>'cwip_account_code',m.output_rules->>'offset_account_code',
    e.mapping_snapshot_id,e.receipt_hash,e.evidence_hash,e.review_reason,e.reviewed_by,e.reviewed_at,
    linked.journal_entry_id,j.status::text,false,false,false,false
  FROM public.wbs_cost_cwip_review_evidence e
  JOIN public.source_document d ON d.tenant_id=e.tenant_id AND d.entity_id=e.entity_id AND d.source_document_id=e.source_document_id
  JOIN public.rule_evaluation r ON r.tenant_id=e.tenant_id AND r.rule_evaluation_id=e.rule_evaluation_id
  JOIN public.mapping_snapshot m ON m.tenant_id=e.tenant_id AND m.mapping_snapshot_id=e.mapping_snapshot_id
  LEFT JOIN LATERAL (
    SELECT sl.journal_entry_id FROM public.source_link sl
    WHERE sl.tenant_id=e.tenant_id AND sl.entity_id=e.entity_id AND sl.staging_item_id=e.staging_item_id
      AND sl.journal_entry_id IS NOT NULL
    ORDER BY sl.journal_entry_id LIMIT 1
  ) linked ON true
  LEFT JOIN public.journal_entry j ON j.tenant_id=e.tenant_id AND j.entity_id=e.entity_id AND j.journal_entry_id=linked.journal_entry_id
  WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity
    AND (p_review IS NULL OR e.wbs_cost_cwip_review_evidence_id=p_review)
  ORDER BY e.reviewed_at DESC,e.wbs_cost_cwip_review_evidence_id DESC LIMIT p_limit;
  IF p_review IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'WBS Cost-to-CWIP review evidence was not found' USING ERRCODE='P0002'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_wbs_cost_cwip_review_evidence(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_wbs_cost_cwip_review_evidence(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
