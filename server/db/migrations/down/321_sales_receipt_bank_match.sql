BEGIN;
DROP FUNCTION refs_create_sales_receipt_bank_match(uuid,uuid,uuid,uuid,bigint,bigint,text,text,text);
DROP FUNCTION refs_sales_receipt_bank_match_hash(uuid,uuid,uuid,uuid,bigint,bigint,text);
COMMIT;
