BEGIN;

CREATE OR REPLACE FUNCTION refs_create_wbs_autorec_event_draft_private(
  p_event_type text,p_tenant uuid,p_entity uuid,p_review uuid,p_period uuid,
  p_expected_evidence_hash text,p_reason text,p_idempotency text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); review_row wbs_autorec_match_review;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.AUTOREC.G11.DRAFT');
  IF actor IS NULL OR p_event_type NOT IN ('PAYABLE_INCUR','AUTOC')
     OR p_request_hash<>refs_wbs_autorec_event_draft_hash(p_tenant,p_entity,p_review,p_period,p_expected_evidence_hash,p_reason)
     OR coalesce(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'AutoRec accounting-event Draft request is invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO review_row FROM wbs_autorec_match_review
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_autorec_match_review_id=p_review AND decision='ACCEPTED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'An exact ACCEPTED AutoRec review is required' USING ERRCODE='P0002'; END IF;
  IF review_row.evidence_hash<>p_expected_evidence_hash THEN RAISE EXCEPTION 'AutoRec review evidence hash changed' USING ERRCODE='40001'; END IF;
  IF actor IN (review_row.reviewed_by,review_row.matched_by,review_row.candidate_prepared_by) THEN
    RAISE EXCEPTION 'AutoRec accounting-event Draft maker SoD violation' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AutoRec accounting-event Draft requires an OPEN period' USING ERRCODE='55000'; END IF;
  RAISE EXCEPTION 'Server-derived G11 event mapping is not implemented; no accounting event or Draft was written' USING ERRCODE='23514';
END $$;

REVOKE ALL ON FUNCTION refs_create_wbs_autorec_event_draft_private(text,uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,refs_app;

COMMIT;
