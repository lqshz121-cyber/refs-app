BEGIN;
REVOKE ALL ON FUNCTION refs_list_bank_match_candidates(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION IF EXISTS refs_list_bank_match_candidates(uuid,uuid,uuid);
COMMIT;
