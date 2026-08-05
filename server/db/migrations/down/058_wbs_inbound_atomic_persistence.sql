BEGIN;
REVOKE EXECUTE ON FUNCTION refs_persist_wbs_inbound_rows(uuid,uuid,uuid,text,text,jsonb,text,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_persist_wbs_inbound_rows(uuid,uuid,uuid,text,text,jsonb,text,text);
DROP TABLE IF EXISTS wbs_inbound_row;
DROP TABLE IF EXISTS wbs_inbound_receipt;
COMMIT;
