BEGIN;
DROP FUNCTION refs_read_counterparty_register(uuid,uuid,text,text,text,text,integer);
DROP INDEX member_master_register_page_idx;
COMMIT;
