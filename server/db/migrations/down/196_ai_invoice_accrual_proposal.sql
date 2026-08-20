BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM ai_invoice_accrual_proposal) THEN RAISE EXCEPTION 'Cannot remove retained AI invoice accrual proposals' USING ERRCODE='55006'; END IF; END $$;
DROP FUNCTION refs_read_ai_invoice_accrual_proposals(uuid,uuid,integer);
DROP FUNCTION refs_propose_ai_invoice_accrual(uuid,uuid,uuid,text,uuid,text,text,jsonb,text,date,text,text,text);
DROP FUNCTION refs_propose_ai_invoice_accrual_hash(uuid,uuid,uuid,text,uuid,text,text,jsonb,text,date,text);
DROP TABLE ai_invoice_accrual_proposal;
DELETE FROM permission_catalog WHERE permission_code IN ('AI.ACCRUAL.PROPOSE','AI.ACCRUAL.VIEW') AND NOT EXISTS(SELECT 1 FROM runtime_actor_grant WHERE permission=permission_code);
COMMIT;
