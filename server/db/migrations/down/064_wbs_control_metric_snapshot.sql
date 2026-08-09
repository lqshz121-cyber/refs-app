BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_wbs_control_metric_snapshot(uuid,uuid,text,jsonb) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_persist_wbs_control_metric_snapshot(uuid,uuid,text,jsonb,uuid,jsonb,jsonb,text,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_read_wbs_control_metric_snapshot(uuid,uuid,text,jsonb);
DROP FUNCTION IF EXISTS refs_persist_wbs_control_metric_snapshot(uuid,uuid,text,jsonb,uuid,jsonb,jsonb,text,text);
DROP TABLE IF EXISTS wbs_control_metric_snapshot;
COMMIT;
