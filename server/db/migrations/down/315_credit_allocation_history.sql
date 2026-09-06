BEGIN;
DROP FUNCTION refs_read_credit_allocation_history(uuid,uuid,uuid,text,uuid,integer);
DROP INDEX credit_allocation_credit_history_idx;
DROP INDEX credit_allocation_document_history_idx;
COMMIT;
