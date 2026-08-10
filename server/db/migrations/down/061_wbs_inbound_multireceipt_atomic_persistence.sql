BEGIN;
REVOKE EXECUTE ON FUNCTION refs_persist_wbs_inbound_snapshot_rows(uuid,uuid,uuid,jsonb,text,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_persist_wbs_inbound_snapshot_rows(uuid,uuid,uuid,jsonb,text,text);
COMMIT;
