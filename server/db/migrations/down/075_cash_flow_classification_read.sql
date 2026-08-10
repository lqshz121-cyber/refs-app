BEGIN;

REVOKE EXECUTE ON FUNCTION refs_get_cash_flow_classification(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_get_cash_flow_classification(uuid,uuid,uuid);
DROP INDEX mapping_snapshot_cash_flow_exact_read_idx;

COMMIT;
