BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_ai_bank_unusual_payment_sources(uuid,uuid,uuid,integer) FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_read_ai_bank_unusual_payment_policy(uuid,uuid,uuid) FROM PUBLIC,refs_app;
DROP FUNCTION IF EXISTS refs_read_ai_bank_unusual_payment_sources(uuid,uuid,uuid,integer);
DROP FUNCTION IF EXISTS refs_read_ai_bank_unusual_payment_policy(uuid,uuid,uuid);
COMMIT;
