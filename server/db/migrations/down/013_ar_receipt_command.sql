BEGIN;

REVOKE EXECUTE ON FUNCTION refs_create_ar_receipt(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_ar_receipt_hash(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_create_ar_receipt(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text,text,text);
DROP FUNCTION IF EXISTS refs_ar_receipt_hash(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text);

COMMIT;
