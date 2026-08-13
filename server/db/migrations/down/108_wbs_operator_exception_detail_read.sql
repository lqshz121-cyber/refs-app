BEGIN;
REVOKE ALL ON FUNCTION refs_read_wbs_operator_payable_exception_rows(uuid,uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_read_wbs_operator_payable_exception_rows(uuid,uuid,uuid,integer);
COMMIT;
