BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_wbs_cost_cwip_review_evidence(uuid,uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_read_wbs_cost_cwip_review_evidence(uuid,uuid,uuid,integer);
COMMIT;
