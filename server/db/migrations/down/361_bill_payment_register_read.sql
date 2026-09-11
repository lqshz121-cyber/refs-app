BEGIN;
DROP FUNCTION refs_read_bill_payment_register(uuid,uuid,uuid,uuid,integer);
DROP INDEX audit_event_payment_occurrence_trace_idx;
DROP INDEX payment_occurrence_bill_payment_page_idx;
COMMIT;
