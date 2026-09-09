BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_wbs_payable_acceptance_evidence(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_read_wbs_payable_acceptance_evidence(uuid,uuid,uuid);
COMMIT;
