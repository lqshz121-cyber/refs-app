BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM ai_accounting_decision WHERE packet#>>'{source,source_type}'='LOAN_TRANSACTION') THEN RAISE EXCEPTION 'Cannot remove retained construction loan accounting decisions' USING ERRCODE='55006'; END IF; END $$;
DROP FUNCTION refs_create_ai_accounting_decision_draft(uuid,uuid,uuid,text,text,text,text,text);
ALTER FUNCTION refs_create_ai_accounting_decision_draft_v257(uuid,uuid,uuid,text,text,text,text,text) RENAME TO refs_create_ai_accounting_decision_draft;
GRANT EXECUTE ON FUNCTION refs_create_ai_accounting_decision_draft(uuid,uuid,uuid,text,text,text,text,text) TO refs_app;
DROP FUNCTION refs_read_ai_construction_loan_decision_source(uuid,uuid,uuid,integer);
COMMIT;
