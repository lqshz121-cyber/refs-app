BEGIN;
REVOKE ALL ON FUNCTION refs_read_ai_invoice_classification_source(uuid,uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_read_ai_invoice_classification_source(uuid,uuid,uuid,integer);
COMMIT;
