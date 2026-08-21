BEGIN;
REVOKE EXECUTE ON FUNCTION refs_retain_ai_accounting_decision_batch(uuid,uuid,uuid,jsonb,text,text) FROM refs_app;
DROP FUNCTION refs_retain_ai_accounting_decision_batch(uuid,uuid,uuid,jsonb,text,text);
COMMIT;
