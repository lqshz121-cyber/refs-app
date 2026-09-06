BEGIN;
DROP FUNCTION refs_read_document_settlements(uuid,uuid,uuid,text,uuid,integer);
DROP INDEX payment_occurrence_document_history_idx;
COMMIT;
