BEGIN;
REVOKE EXECUTE ON FUNCTION refs_ensure_internal_test_cash_transfer_evidence(uuid,uuid,text) FROM refs_app;
DROP FUNCTION refs_ensure_internal_test_cash_transfer_evidence(uuid,uuid,text);
COMMIT;
