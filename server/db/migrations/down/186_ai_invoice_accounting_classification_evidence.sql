BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM ai_invoice_accounting_classification_evidence) THEN RAISE EXCEPTION 'Cannot roll back retained AI invoice accounting classification evidence' USING ERRCODE='55006'; END IF;
END $$;
REVOKE ALL ON FUNCTION refs_ai_invoice_classification_batch_hash(uuid,uuid,uuid,jsonb),refs_materialize_ai_invoice_classification_batch(uuid,uuid,uuid,jsonb,text,text),refs_read_ai_invoice_classification_evidence(uuid,uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_read_ai_invoice_classification_evidence(uuid,uuid,uuid,integer);
DROP FUNCTION refs_materialize_ai_invoice_classification_batch(uuid,uuid,uuid,jsonb,text,text);
DROP FUNCTION refs_ai_invoice_classification_batch_hash(uuid,uuid,uuid,jsonb);
DROP TABLE ai_invoice_accounting_classification_evidence;
COMMIT;
