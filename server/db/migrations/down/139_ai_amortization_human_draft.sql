BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM ai_amortization_draft_evidence) THEN RAISE EXCEPTION 'Cannot remove retained AI amortization Draft evidence' USING ERRCODE='55000'; END IF;
END $$;
DROP FUNCTION IF EXISTS refs_create_ai_amortization_draft(uuid,uuid,uuid,uuid,uuid,text,uuid[],text,text,text);
DROP FUNCTION IF EXISTS refs_create_ai_amortization_draft_hash(uuid,uuid,uuid,uuid,uuid,text,uuid[],text);
DROP TABLE IF EXISTS ai_amortization_draft_evidence;
UPDATE permission_catalog SET active=false,effective_to=clock_timestamp(),version=version+1 WHERE permission_code='AI.AMORTIZATION.DRAFT';
COMMIT;
