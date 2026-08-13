BEGIN;

REVOKE EXECUTE ON FUNCTION refs_get_reconciled_snapshot(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_get_reconciled_snapshot(uuid,uuid,uuid);

COMMIT;
