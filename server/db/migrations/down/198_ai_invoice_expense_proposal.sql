BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM ai_invoice_expense_proposal) THEN RAISE EXCEPTION 'Cannot remove retained AI invoice expense proposals' USING ERRCODE='55006';END IF;END $$;
DROP FUNCTION refs_read_ai_invoice_expense_proposals(uuid,uuid,integer);
DROP FUNCTION refs_propose_ai_invoice_expense(uuid,uuid,uuid,text,uuid,text,text,jsonb,text,text,text);
DROP FUNCTION refs_propose_ai_invoice_expense_hash(uuid,uuid,uuid,text,uuid,text,text,jsonb,text);
DROP TABLE ai_invoice_expense_proposal;
DELETE FROM permission_catalog WHERE permission_code IN('AI.EXPENSE.PROPOSE','AI.EXPENSE.VIEW') AND NOT EXISTS(SELECT 1 FROM runtime_actor_grant WHERE permission=permission_code);
COMMIT;
