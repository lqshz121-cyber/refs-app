BEGIN;

REVOKE EXECUTE ON FUNCTION refs_get_financial_statement_period_comparison(uuid,uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_get_financial_statement_period_comparison(uuid,uuid,uuid,uuid);

COMMIT;
