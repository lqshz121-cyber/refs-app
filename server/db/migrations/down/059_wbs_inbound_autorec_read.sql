BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_wbs_inbound_rows(uuid,uuid,text,text[]) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_read_wbs_autorec_control_rows(uuid,uuid,text,text[]) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_read_wbs_autorec_mappings(uuid,uuid,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_read_wbs_inbound_rows(uuid,uuid,text,text[]);
DROP FUNCTION IF EXISTS refs_read_wbs_autorec_control_rows(uuid,uuid,text,text[]);
DROP FUNCTION IF EXISTS refs_read_wbs_autorec_mappings(uuid,uuid,text);
COMMIT;
