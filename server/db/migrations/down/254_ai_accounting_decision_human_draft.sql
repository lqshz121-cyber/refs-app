BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM ai_accounting_decision) THEN RAISE EXCEPTION 'Cannot remove retained AI accounting decisions' USING ERRCODE='55000'; END IF; END $$;
DROP FUNCTION IF EXISTS refs_create_ai_accounting_decision_draft(uuid,uuid,uuid,text,text,text,text,text);
DROP FUNCTION IF EXISTS refs_human_decide_ai_accounting(uuid,uuid,uuid,text,bigint,text,text,text,text);
DROP FUNCTION IF EXISTS refs_retain_ai_accounting_decision(uuid,uuid,jsonb,text,text);
DROP TABLE IF EXISTS ai_accounting_decision_draft_evidence;
DROP TABLE IF EXISTS ai_accounting_human_decision;
DROP TABLE IF EXISTS ai_accounting_decision;
COMMIT;
