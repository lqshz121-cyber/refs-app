BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM ai_journal_review_link) OR EXISTS(SELECT 1 FROM ai_journal_review_evidence) THEN
    RAISE EXCEPTION 'Cannot remove retained AI journal review evidence' USING ERRCODE='55000';
  END IF;
END $$;

DROP FUNCTION refs_link_ai_reviewed_journal(uuid,uuid,uuid,uuid,text,text);
DROP FUNCTION refs_record_ai_journal_review_evidence(uuid,uuid,text,text,text,text,timestamptz,text,text);
DROP FUNCTION refs_record_ai_journal_review_evidence_hash(uuid,uuid,text,text,text,text,timestamptz);
DROP TABLE ai_journal_review_link;
DROP TABLE ai_journal_review_evidence;
DELETE FROM permission_catalog WHERE permission_code='AI.REVIEW';

COMMIT;
