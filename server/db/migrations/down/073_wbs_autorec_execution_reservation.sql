BEGIN;
REVOKE EXECUTE ON FUNCTION refs_execute_wbs_autorec_intent(uuid,uuid,jsonb,text,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_execute_wbs_autorec_intent(uuid,uuid,jsonb,text,text);
DROP TABLE IF EXISTS wbs_autorec_source_reservation;
DROP TABLE IF EXISTS wbs_autorec_execution_event;
COMMIT;
