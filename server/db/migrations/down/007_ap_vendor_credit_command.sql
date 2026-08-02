BEGIN;

REVOKE EXECUTE ON FUNCTION refs_create_ap_vendor_credit(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_ap_vendor_credit_hash(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_create_ap_vendor_credit(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,text,text);
DROP FUNCTION IF EXISTS refs_ap_vendor_credit_hash(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text);

COMMIT;
