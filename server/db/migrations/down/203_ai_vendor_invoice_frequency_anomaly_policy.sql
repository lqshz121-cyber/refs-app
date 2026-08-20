BEGIN;
REVOKE ALL ON FUNCTION refs_read_ai_vendor_invoice_frequency_anomaly_policy(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_read_ai_vendor_invoice_frequency_anomaly_policy(uuid,uuid,uuid);
COMMIT;
