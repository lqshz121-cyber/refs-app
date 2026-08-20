BEGIN;
REVOKE ALL ON FUNCTION refs_read_ai_ap_aging_risk_policy(uuid,uuid,date),refs_read_ai_ap_aging_risk_source(uuid,uuid,date) FROM refs_app;
DROP FUNCTION refs_read_ai_ap_aging_risk_source(uuid,uuid,date);
DROP FUNCTION refs_read_ai_ap_aging_risk_policy(uuid,uuid,date);
COMMIT;
