BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_wbs_autorec_observed_state_evidence(uuid,uuid,text,text[]) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_persist_wbs_autorec_observed_state_evidence(uuid,uuid,jsonb,text,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_read_wbs_autorec_observed_state_evidence(uuid,uuid,text,text[]);
DROP FUNCTION IF EXISTS refs_persist_wbs_autorec_observed_state_evidence(uuid,uuid,jsonb,text,text);
DROP TABLE IF EXISTS wbs_autorec_observed_state_event;
COMMIT;
