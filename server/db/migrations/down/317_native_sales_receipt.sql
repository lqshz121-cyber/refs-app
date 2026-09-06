BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM sales_receipt) THEN
    RAISE EXCEPTION 'Cannot remove sales receipt schema while business records exist' USING ERRCODE='55000';
  END IF;
END; $$;
DROP TRIGGER sales_receipt_posted ON journal_entry;
DROP FUNCTION refs_activate_posted_sales_receipt();
DROP FUNCTION refs_create_native_sales_receipt(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text);
DROP TABLE sales_receipt;
DELETE FROM permission_catalog WHERE permission_code='AR.SALES_RECEIPT.CREATE';
COMMIT;
