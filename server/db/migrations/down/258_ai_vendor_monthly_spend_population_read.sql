BEGIN;
REVOKE ALL ON FUNCTION refs_read_ai_vendor_monthly_spend_population(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_read_ai_vendor_monthly_spend_population(uuid,uuid,uuid);
COMMIT;
