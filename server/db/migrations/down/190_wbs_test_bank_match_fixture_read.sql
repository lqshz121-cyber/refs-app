BEGIN;

REVOKE EXECUTE ON FUNCTION refs_resolve_wbs_test_bank_match_fixture(uuid,uuid) FROM refs_app;
DROP FUNCTION IF EXISTS refs_resolve_wbs_test_bank_match_fixture(uuid,uuid);

COMMIT;
