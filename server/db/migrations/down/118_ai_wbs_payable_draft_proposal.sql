BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM ai_wbs_payable_draft_proposal) OR EXISTS(SELECT 1 FROM ai_wbs_payable_draft_proposal_review) THEN
    RAISE EXCEPTION 'Cannot remove persisted AI WBS payable proposal evidence' USING ERRCODE='55000';
  END IF;
END $$;

DROP FUNCTION refs_review_ai_wbs_payable_draft_proposal(uuid,uuid,uuid,text,text,text,text);
DROP FUNCTION refs_review_ai_wbs_payable_draft_proposal_hash(uuid,uuid,uuid,text,text);
DROP FUNCTION refs_propose_ai_wbs_payable_draft(uuid,uuid,uuid,text,text,text,text);
DROP FUNCTION refs_ai_wbs_payable_draft_proposal_hash(uuid,uuid,uuid,text,text);
DROP TABLE ai_wbs_payable_draft_proposal_review;
DROP TABLE ai_wbs_payable_draft_proposal;

COMMIT;
