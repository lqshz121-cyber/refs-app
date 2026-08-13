BEGIN;

REVOKE EXECUTE ON FUNCTION refs_get_bank_transaction_detail(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_get_bank_transaction_detail(uuid,uuid,uuid);

COMMIT;
