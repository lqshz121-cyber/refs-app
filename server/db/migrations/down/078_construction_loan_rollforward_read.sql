BEGIN;
REVOKE EXECUTE ON FUNCTION refs_get_construction_loan_rollforward(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_get_construction_loan_rollforward(uuid,uuid,uuid);
DROP INDEX mapping_snapshot_construction_loan_account_read_idx;
COMMIT;
