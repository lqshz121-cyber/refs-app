BEGIN;
REVOKE ALL ON FUNCTION refs_read_business_document_counterparties(uuid,uuid,text,text,text,integer) FROM refs_app;
DROP FUNCTION refs_read_business_document_counterparties(uuid,uuid,text,text,text,integer);
DROP INDEX member_master_active_ref_page_idx;
COMMIT;
