BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_ai_construction_loan_cwip_population_attestation(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_read_ai_construction_loan_cwip_population_attestation(uuid,uuid,uuid);
COMMIT;
