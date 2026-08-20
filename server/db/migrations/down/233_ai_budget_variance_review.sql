BEGIN;
REVOKE ALL ON FUNCTION refs_read_ai_budget_variance_policy(uuid,uuid,uuid),refs_read_ai_budget_vs_actual_source(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_read_ai_budget_vs_actual_source(uuid,uuid,uuid);
DROP FUNCTION refs_read_ai_budget_variance_policy(uuid,uuid,uuid);
COMMIT;
