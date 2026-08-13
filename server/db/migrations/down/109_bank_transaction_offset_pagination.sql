BEGIN;

REVOKE EXECUTE ON FUNCTION refs_list_bank_transactions(uuid,uuid,text,date,date,integer,integer) FROM refs_app;
DROP FUNCTION refs_list_bank_transactions(uuid,uuid,text,date,date,integer,integer);

COMMIT;
