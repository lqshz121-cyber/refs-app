BEGIN;
DO $$BEGIN IF EXISTS(SELECT 1 FROM ai_invoice_capitalization_proposal) THEN RAISE EXCEPTION 'Cannot rollback migration 189 while capitalization proposals exist' USING ERRCODE='55006';END IF;END$$;
REVOKE ALL ON FUNCTION refs_propose_ai_invoice_capitalization_hash(uuid,uuid,uuid,text,uuid,text,text,text,text,jsonb,date,integer,text),refs_propose_ai_invoice_capitalization(uuid,uuid,uuid,text,uuid,text,text,text,text,jsonb,date,integer,text,text,text),refs_read_ai_invoice_capitalization_proposals(uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_read_ai_invoice_capitalization_proposals(uuid,uuid,integer);
DROP FUNCTION refs_propose_ai_invoice_capitalization(uuid,uuid,uuid,text,uuid,text,text,text,text,jsonb,date,integer,text,text,text);
DROP FUNCTION refs_propose_ai_invoice_capitalization_hash(uuid,uuid,uuid,text,uuid,text,text,text,text,jsonb,date,integer,text);
DROP TABLE ai_invoice_capitalization_proposal;
UPDATE permission_catalog SET active=false,version=version+1,effective_to=clock_timestamp() WHERE permission_code IN ('AI.CAPITALIZATION.PROPOSE','AI.CAPITALIZATION.VIEW');
COMMIT;
