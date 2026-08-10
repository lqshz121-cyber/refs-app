BEGIN;
REVOKE EXECUTE ON FUNCTION refs_get_intercompany_reconciliation(uuid,uuid,uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION IF EXISTS refs_get_intercompany_reconciliation(uuid,uuid,uuid,uuid,uuid);
DROP INDEX IF EXISTS mapping_snapshot_intercompany_pair_read_idx;
COMMIT;
