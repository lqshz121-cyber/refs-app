BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_ai_invoice_source_support_inputs(uuid,uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_read_ai_invoice_source_support_inputs(uuid,uuid,uuid,integer);
COMMIT;
