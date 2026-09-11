BEGIN;
DROP FUNCTION IF EXISTS refs_read_receipt_detail(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS refs_read_receipt_register(uuid,uuid,text);
DROP FUNCTION IF EXISTS refs_project_receipt_row(uuid,uuid,uuid);
COMMIT;
