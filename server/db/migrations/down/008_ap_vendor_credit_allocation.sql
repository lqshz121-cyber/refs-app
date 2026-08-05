BEGIN;

REVOKE EXECUTE ON FUNCTION refs_apply_ap_vendor_credit(uuid,uuid,uuid,uuid,numeric,text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_ap_vendor_credit_allocation_hash(uuid,uuid,uuid,uuid,numeric,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_apply_ap_vendor_credit(uuid,uuid,uuid,uuid,numeric,text,text,text);
DROP FUNCTION IF EXISTS refs_ap_vendor_credit_allocation_hash(uuid,uuid,uuid,uuid,numeric,text);

COMMIT;
