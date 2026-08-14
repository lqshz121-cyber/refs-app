BEGIN;

-- Journal readers may inspect the retained human decision that permitted an
-- AI recommendation to become a normal journal. This is evidence only: it
-- exposes no AI command, edit, or posting path.
CREATE FUNCTION refs_get_ai_journal_review_evidence(
  p_tenant uuid,p_entity uuid,p_journal_id uuid
) RETURNS TABLE(
  ai_journal_review_evidence_id uuid,
  proposal_id text,
  finding_id text,
  review_outcome_id text,
  proposal_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  linked_by text,
  linked_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  RETURN QUERY
  SELECT e.ai_journal_review_evidence_id,e.proposal_id,e.finding_id,e.review_outcome_id,e.proposal_hash,
    e.reviewed_by,e.reviewed_at,l.linked_by,l.linked_at
  FROM ai_journal_review_link l
  JOIN ai_journal_review_evidence e
    ON e.ai_journal_review_evidence_id=l.ai_journal_review_evidence_id
   AND e.tenant_id=l.tenant_id
   AND e.entity_id=l.entity_id
  WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.journal_entry_id=p_journal_id;
END;
$$;

REVOKE ALL ON FUNCTION refs_get_ai_journal_review_evidence(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_ai_journal_review_evidence(uuid,uuid,uuid) TO refs_app;

COMMIT;
