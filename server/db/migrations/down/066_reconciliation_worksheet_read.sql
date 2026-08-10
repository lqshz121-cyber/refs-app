BEGIN;
REVOKE ALL ON FUNCTION refs_list_reconciliation_worksheet(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION IF EXISTS refs_list_reconciliation_worksheet(uuid,uuid,uuid);
COMMIT;
