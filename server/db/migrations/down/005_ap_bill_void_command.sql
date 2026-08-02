BEGIN;

REVOKE EXECUTE ON FUNCTION refs_create_ap_bill_void(uuid,uuid,uuid,uuid,text,date,text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_ap_bill_void_hash(uuid,uuid,uuid,uuid,text,date,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_create_ap_bill_void(uuid,uuid,uuid,uuid,text,date,text,text,text);
DROP FUNCTION IF EXISTS refs_ap_bill_void_hash(uuid,uuid,uuid,uuid,text,date,text);

COMMIT;
