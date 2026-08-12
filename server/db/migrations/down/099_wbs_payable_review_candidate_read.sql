BEGIN;
REVOKE ALL ON FUNCTION refs_read_wbs_payable_review_candidates(uuid,uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_read_wbs_payable_review_candidates(uuid,uuid,uuid,integer);
COMMIT;
