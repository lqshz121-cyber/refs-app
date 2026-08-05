BEGIN;

REVOKE EXECUTE ON FUNCTION refs_create_ap_payment(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_ap_payment_hash(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_create_ap_payment(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text,text,text);
DROP FUNCTION IF EXISTS refs_ap_payment_hash(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text);

COMMIT;
