BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_wbs_control_reconciliation_mapping(uuid,uuid,text,jsonb) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_read_refs_control_metric_snapshot(uuid,uuid,text,jsonb) FROM refs_app;
DROP FUNCTION IF EXISTS refs_read_wbs_control_reconciliation_mapping(uuid,uuid,text,jsonb);
DROP FUNCTION IF EXISTS refs_read_refs_control_metric_snapshot(uuid,uuid,text,jsonb);
DROP TABLE IF EXISTS refs_control_metric_snapshot;
COMMIT;
