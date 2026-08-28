BEGIN;
REVOKE ALL ON FUNCTION refs_read_ai_construction_loan_gl_balances(uuid,uuid,uuid) FROM refs_app;
REVOKE ALL ON FUNCTION refs_read_ai_construction_loan_lender_balance_population(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_read_ai_construction_loan_gl_balances(uuid,uuid,uuid);
DROP FUNCTION refs_read_ai_construction_loan_lender_balance_population(uuid,uuid,uuid);
COMMIT;
