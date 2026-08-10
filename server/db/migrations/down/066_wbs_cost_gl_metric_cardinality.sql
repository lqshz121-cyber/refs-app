BEGIN;
DROP TRIGGER IF EXISTS wbs_control_metric_snapshot_metric_cardinality ON wbs_control_metric_snapshot;
DROP FUNCTION IF EXISTS refs_validate_wbs_control_metric_cardinality();
COMMIT;
