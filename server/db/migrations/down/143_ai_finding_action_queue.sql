BEGIN;

-- Do not erase an accountable AI finding history once any assignment exists.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM ai_finding_action) THEN RAISE EXCEPTION 'Cannot remove AI finding action queue after assignments are retained' USING ERRCODE='55000'; END IF;
END $$;
DROP FUNCTION refs_assign_ai_finding_action(uuid,uuid,text,uuid,text,text,date,integer,text,text);
DROP FUNCTION refs_assign_ai_finding_action_hash(uuid,uuid,text,uuid,text,text,date,integer);
DROP TABLE ai_finding_action;
UPDATE permission_catalog SET active=false,effective_to=clock_timestamp(),version=version+1 WHERE permission_code='AI.FINDING.ASSIGN';

COMMIT;
