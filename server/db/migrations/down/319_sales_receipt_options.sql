BEGIN;
DROP FUNCTION refs_read_sales_receipt_options(uuid,uuid,text,text,text,integer);
DROP INDEX account_master_active_ref_page_idx;
COMMIT;
