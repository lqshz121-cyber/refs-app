BEGIN;

REVOKE ALL ON FUNCTION refs_read_ai_accounting_decision_queue(uuid,uuid,uuid,integer,integer) FROM refs_app;
DROP FUNCTION refs_read_ai_accounting_decision_queue(uuid,uuid,uuid,integer,integer);

COMMIT;
