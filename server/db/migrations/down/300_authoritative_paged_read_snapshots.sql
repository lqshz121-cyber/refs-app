BEGIN;

REVOKE ALL ON FUNCTION refs_read_ai_accounting_decision_queue_snapshot(uuid,uuid,uuid,integer,integer,text) FROM refs_app;
REVOKE ALL ON FUNCTION refs_read_general_ledger_snapshot(uuid,uuid,uuid,text,text,integer,integer,text) FROM refs_app;
DROP FUNCTION refs_read_ai_accounting_decision_queue_snapshot(uuid,uuid,uuid,integer,integer,text);
DROP FUNCTION refs_read_general_ledger_snapshot(uuid,uuid,uuid,text,text,integer,integer,text);

COMMIT;
