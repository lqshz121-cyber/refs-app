BEGIN;
REVOKE EXECUTE ON FUNCTION refs_ar_credit_memo_allocation_hash(uuid,uuid,uuid,uuid,numeric,text) FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_apply_ar_credit_memo(uuid,uuid,uuid,uuid,numeric,text,text,text) FROM PUBLIC,refs_app;
DROP FUNCTION IF EXISTS refs_apply_ar_credit_memo(uuid,uuid,uuid,uuid,numeric,text,text,text);
DROP FUNCTION IF EXISTS refs_ar_credit_memo_allocation_hash(uuid,uuid,uuid,uuid,numeric,text);
COMMIT;
