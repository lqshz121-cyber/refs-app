BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_construction_loan_register(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_read_construction_loan_register(uuid,uuid,uuid);
COMMIT;
