BEGIN;

REVOKE EXECUTE ON FUNCTION refs_get_reconciliation_posted_lineage(uuid,uuid,uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_get_reconciliation_posted_lineage(uuid,uuid,uuid,uuid,uuid);

COMMIT;
