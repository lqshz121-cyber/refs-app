BEGIN;
REVOKE ALL ON FUNCTION refs_read_wbs_autorec_matching_policies(uuid,uuid,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_read_wbs_autorec_matching_policies(uuid,uuid,text);
COMMIT;
