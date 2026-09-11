BEGIN;
DROP FUNCTION IF EXISTS refs_read_recurring_transaction_detail(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS refs_read_recurring_transaction_register(uuid,uuid,text,text,uuid,integer);
DROP FUNCTION IF EXISTS refs_project_recurring_transaction_row(uuid,uuid,uuid,boolean);
DROP FUNCTION IF EXISTS refs_recurring_date(text);
DROP FUNCTION IF EXISTS refs_recurring_interval(text);
DROP FUNCTION IF EXISTS refs_recurring_status(text);
COMMIT;
