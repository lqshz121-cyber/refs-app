BEGIN;
REVOKE ALL ON FUNCTION refs_read_period_close_history(uuid,uuid,uuid,integer,timestamptz,uuid) FROM PUBLIC,refs_app;
DROP FUNCTION refs_read_period_close_history(uuid,uuid,uuid,integer,timestamptz,uuid);
DROP INDEX audit_event_period_close_history_idx;
COMMIT;
