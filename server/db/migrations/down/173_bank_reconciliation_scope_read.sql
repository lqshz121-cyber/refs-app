BEGIN;

REVOKE EXECUTE ON FUNCTION refs_list_reconciliation_scopes(uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_list_reconciliation_scopes(uuid,uuid,integer);

COMMIT;
