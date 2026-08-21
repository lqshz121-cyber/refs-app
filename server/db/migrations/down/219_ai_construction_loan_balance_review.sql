BEGIN;
REVOKE ALL ON FUNCTION refs_read_ai_construction_loan_balance_policy(uuid,uuid,uuid),refs_read_ai_construction_loan_lender_balances(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_read_ai_construction_loan_lender_balances(uuid,uuid,uuid);
DROP FUNCTION refs_read_ai_construction_loan_balance_policy(uuid,uuid,uuid);
DROP INDEX mapping_snapshot_loan_statement_account_read_idx;
COMMIT;
