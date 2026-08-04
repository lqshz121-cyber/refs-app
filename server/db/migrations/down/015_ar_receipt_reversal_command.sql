BEGIN;
REVOKE EXECUTE ON FUNCTION refs_create_ar_receipt_reversal(uuid,uuid,uuid,uuid,text,date,text,text,text) FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_ar_receipt_reversal_hash(uuid,uuid,uuid,uuid,text,date,text) FROM PUBLIC,refs_app;
DROP FUNCTION IF EXISTS refs_create_ar_receipt_reversal(uuid,uuid,uuid,uuid,text,date,text,text,text);
DROP FUNCTION IF EXISTS refs_ar_receipt_reversal_hash(uuid,uuid,uuid,uuid,text,date,text);
COMMIT;
