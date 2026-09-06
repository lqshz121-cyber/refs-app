BEGIN;
REVOKE ALL ON FUNCTION refs_create_native_settlement(uuid,uuid,text,uuid,uuid,text,date,text,text,numeric,text,uuid[],text) FROM refs_app;
DROP FUNCTION refs_create_native_settlement(uuid,uuid,text,uuid,uuid,text,date,text,text,numeric,text,uuid[],text);
COMMIT;
