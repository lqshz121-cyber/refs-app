BEGIN;
REVOKE ALL ON FUNCTION refs_read_ai_cross_entity_payment_invoices(uuid,uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
DROP FUNCTION refs_read_ai_cross_entity_payment_invoices(uuid,uuid,uuid,uuid,uuid,integer);
COMMIT;
