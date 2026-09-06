BEGIN;
DROP FUNCTION refs_list_sales_receipts(uuid,uuid,uuid,uuid,integer);
DROP FUNCTION refs_read_sales_receipt(uuid,uuid,uuid);
DROP INDEX sales_receipt_period_id_idx;
DROP VIEW sales_receipt_detail_read;
COMMIT;
