BEGIN;
DROP FUNCTION refs_read_credit_allocation_targets(uuid,uuid,text,uuid,uuid,text,uuid,integer);
DROP INDEX business_document_credit_target_idx;
COMMIT;
