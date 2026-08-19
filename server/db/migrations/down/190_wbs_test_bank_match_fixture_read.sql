BEGIN;

REVOKE EXECUTE ON FUNCTION refs_bind_wbs_test_bank_match_payment_source(uuid,uuid,uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION IF EXISTS refs_bind_wbs_test_bank_match_payment_source(uuid,uuid,uuid,uuid,uuid);
REVOKE EXECUTE ON FUNCTION refs_resolve_wbs_test_bank_match_fixture(uuid,uuid) FROM refs_app;
DROP FUNCTION IF EXISTS refs_resolve_wbs_test_bank_match_fixture(uuid,uuid);

COMMIT;
