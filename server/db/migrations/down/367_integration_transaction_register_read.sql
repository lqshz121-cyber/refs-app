BEGIN;
DROP FUNCTION IF EXISTS refs_read_integration_transaction_detail(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS refs_read_integration_transaction_register(uuid,uuid,text,text,text,uuid,integer);
DROP FUNCTION IF EXISTS refs_project_integration_transaction_row(uuid,uuid,uuid);
COMMIT;
