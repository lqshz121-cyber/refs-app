BEGIN;
DO $$BEGIN IF EXISTS(SELECT 1 FROM ai_bank_duplicate_payment_finding LIMIT 1) THEN RAISE EXCEPTION 'Cannot remove retained AI bank duplicate-payment evidence' USING ERRCODE='55000'; END IF; END$$;
DROP FUNCTION IF EXISTS refs_materialize_ai_bank_duplicate_payment_batch(uuid,uuid,uuid,jsonb,text,text);
DROP FUNCTION IF EXISTS refs_ai_bank_duplicate_payment_batch_hash(uuid,uuid,uuid,jsonb);
DROP TABLE IF EXISTS ai_bank_duplicate_payment_source;
DROP TABLE IF EXISTS ai_bank_duplicate_payment_finding;
COMMIT;
