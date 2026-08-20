BEGIN;
REVOKE ALL ON FUNCTION refs_read_ai_construction_loan_source(uuid,uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_read_ai_construction_loan_source(uuid,uuid,uuid,integer);
COMMIT;
