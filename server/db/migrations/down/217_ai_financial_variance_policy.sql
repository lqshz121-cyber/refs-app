BEGIN;
REVOKE ALL ON FUNCTION refs_read_ai_financial_variance_policy(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_read_ai_financial_variance_policy(uuid,uuid,uuid);
COMMIT;
