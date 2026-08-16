BEGIN;

CREATE OR REPLACE FUNCTION refs_get_wbs_autorec_match_review(p_tenant uuid,p_entity uuid,p_review uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
  SELECT jsonb_build_object(
    'wbs_autorec_match_review_id',r.wbs_autorec_match_review_id,'tenant_id',r.tenant_id,'entity_id',r.entity_id,
    'review_candidate_id',r.review_candidate_id,'candidate_hash',r.candidate_hash,
    'candidate_execution_receipt_id',r.candidate_execution_receipt_id,'candidate_execution_version',r.candidate_execution_version,
    'bank_match_id',r.bank_match_id,'bank_match_revision',r.bank_match_revision,'evidence_hash',r.evidence_hash,
    'decision',r.decision,'decision_reason',r.decision_reason,'candidate_prepared_by',r.candidate_prepared_by,
    'matched_by',r.matched_by,'reviewed_by',r.reviewed_by,'reviewed_at',r.reviewed_at,
    'sod_verified',(r.reviewed_by<>r.matched_by AND r.reviewed_by<>r.candidate_prepared_by),
    'g11_linked',false,'incurred',false
  ) INTO result FROM wbs_autorec_match_review r
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_autorec_match_review_id=p_review;
  IF result IS NULL THEN RAISE EXCEPTION 'AutoRec Bank Match review was not found in the selected entity' USING ERRCODE='P0002'; END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_get_wbs_autorec_g11_evidence(p_tenant uuid,p_entity uuid,p_review uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
  SELECT jsonb_build_object('completion',to_jsonb(c),'review',to_jsonb(r),
    'released_candidate',release.intent->'review_candidate','incur_event',to_jsonb(incur),
    'accounting_events',(SELECT jsonb_agg(to_jsonb(ae) ORDER BY ae.event_type) FROM accounting_event ae WHERE ae.tenant_id=c.tenant_id AND ae.entity_id=c.entity_id AND ae.wbs_autorec_match_review_id=c.wbs_autorec_match_review_id),
    'lines',(SELECT jsonb_agg(to_jsonb(line) ORDER BY line.event_type,line.line_role) FROM wbs_autorec_g11_completion_line line WHERE line.tenant_id=c.tenant_id AND line.entity_id=c.entity_id AND line.wbs_autorec_g11_completion_id=c.wbs_autorec_g11_completion_id),
    'g11_linked',true,'incurred',true) INTO result
  FROM wbs_autorec_g11_completion c JOIN wbs_autorec_match_review r USING(tenant_id,entity_id,wbs_autorec_match_review_id)
    JOIN wbs_autorec_execution_event release ON release.execution_receipt_id=c.release_execution_receipt_id
    JOIN wbs_autorec_execution_event incur ON incur.execution_receipt_id=c.incur_execution_receipt_id
  WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity AND c.wbs_autorec_match_review_id=p_review
    AND incur.command='INCUR' AND incur.next_state='INCURRED';
  IF result IS NULL THEN RAISE EXCEPTION 'Completed G11 evidence was not found in the selected entity' USING ERRCODE='P0002'; END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION refs_get_wbs_autorec_match_review(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_get_wbs_autorec_g11_evidence(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_wbs_autorec_match_review(uuid,uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_get_wbs_autorec_g11_evidence(uuid,uuid,uuid) TO refs_app;

COMMIT;
