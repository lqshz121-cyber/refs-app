BEGIN;
REVOKE EXECUTE ON FUNCTION refs_create_ar_credit_memo(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,text,text) FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_ar_credit_memo_hash(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text) FROM PUBLIC,refs_app;
DROP FUNCTION IF EXISTS refs_create_ar_credit_memo(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,text,text);
DROP FUNCTION IF EXISTS refs_ar_credit_memo_hash(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text);
COMMIT;
