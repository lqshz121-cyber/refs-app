BEGIN;
REVOKE ALL ON FUNCTION refs_ap_control_total(uuid,uuid,uuid) FROM refs_app;
REVOKE ALL ON FUNCTION refs_ar_control_total(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION IF EXISTS refs_ap_control_total(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS refs_ar_control_total(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS refs_ap_ar_period_control_lineage(uuid,uuid,uuid,text);
COMMIT;
