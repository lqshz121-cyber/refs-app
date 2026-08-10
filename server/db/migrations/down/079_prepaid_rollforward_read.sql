BEGIN;
REVOKE EXECUTE ON FUNCTION refs_get_prepaid_rollforward(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_get_prepaid_rollforward(uuid,uuid,uuid);
DROP INDEX mapping_snapshot_prepaid_account_read_idx;
COMMIT;
