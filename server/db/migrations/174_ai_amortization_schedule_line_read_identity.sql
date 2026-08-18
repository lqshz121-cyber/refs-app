BEGIN;

-- The Draft command is line-bound, so the authoritative schedule reader must
-- expose the immutable line identifier.  This does not grant Draft authority;
-- the existing command continues to enforce a distinct maker, permissions,
-- exact proposal hash, OPEN period, and clean source-bound attachments.
DROP FUNCTION refs_read_ai_amortization_schedules(uuid,uuid,integer);
CREATE FUNCTION refs_read_ai_amortization_schedules(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(ai_amortization_schedule_id uuid,source_document_id uuid,source_payload_hash text,source_document_version bigint,
  rule_id text,analysis_mode text,confidence numeric,status text,coverage_start date,coverage_end date,currency char(3),original_amount numeric,
  prepaid_account_code text,expense_account_code text,member_trace jsonb,proposal_reason text,proposal_hash text,created_by text,created_at timestamptz,
  eligible_source_attachment_ids uuid[],schedule_lines jsonb,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.VIEW');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI amortization schedule limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  SELECT s.ai_amortization_schedule_id,s.source_document_id,s.source_payload_hash,s.source_document_version,s.rule_id,s.analysis_mode,s.confidence,s.status,
    s.coverage_start,s.coverage_end,s.currency,s.original_amount,s.prepaid_account_code,s.expense_account_code,s.member_trace,s.proposal_reason,s.proposal_hash,s.created_by,s.created_at,
    COALESCE(ARRAY(SELECT DISTINCT a.attachment_id FROM attachment a JOIN source_link sl ON sl.tenant_id=a.tenant_id AND sl.entity_id=a.entity_id AND sl.attachment_id=a.attachment_id
      WHERE a.tenant_id=s.tenant_id AND a.entity_id=s.entity_id AND sl.source_document_id=s.source_document_id AND sl.link_type='SOURCE_ATTACHMENT'
        AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN' AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL ORDER BY a.attachment_id),'{}'::uuid[]),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('ai_amortization_schedule_line_id',l.ai_amortization_schedule_line_id,'line_no',l.line_no,'amortization_month',l.amortization_month,'amount',l.amount,'status',l.status,'source_payload_hash',l.source_payload_hash) ORDER BY l.line_no)
      FROM ai_amortization_schedule_line l WHERE l.tenant_id=s.tenant_id AND l.entity_id=s.entity_id AND l.ai_amortization_schedule_id=s.ai_amortization_schedule_id),'[]'::jsonb),
    false,false,false,false
  FROM ai_amortization_schedule s WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity ORDER BY s.created_at DESC,s.ai_amortization_schedule_id DESC LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_ai_amortization_schedules(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_amortization_schedules(uuid,uuid,integer) TO refs_app;

COMMIT;
