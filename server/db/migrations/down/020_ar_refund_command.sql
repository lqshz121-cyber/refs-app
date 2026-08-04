BEGIN;
REVOKE EXECUTE ON FUNCTION refs_create_ar_refund(uuid,uuid,uuid,uuid,text,date,text,numeric,text,text,text) FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_ar_refund_hash(uuid,uuid,uuid,uuid,text,date,text,numeric,text) FROM PUBLIC,refs_app;
DROP FUNCTION IF EXISTS refs_create_ar_refund(uuid,uuid,uuid,uuid,text,date,text,numeric,text,text,text);
DROP FUNCTION IF EXISTS refs_ar_refund_hash(uuid,uuid,uuid,uuid,text,date,text,numeric,text);
COMMIT;
