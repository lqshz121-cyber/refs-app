BEGIN;
DROP FUNCTION refs_read_counterparty_changes(uuid,uuid,text,text,text,uuid,integer);
DROP FUNCTION refs_read_counterparty_detail(uuid,uuid,text,text);
DROP INDEX counterparty_change_history_idx;
DROP INDEX counterparty_change_queue_idx;
COMMIT;
