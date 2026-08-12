BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_wbs_payable_review_evidence(uuid,uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_read_wbs_payable_review_evidence(uuid,uuid,uuid,integer);
COMMIT;
