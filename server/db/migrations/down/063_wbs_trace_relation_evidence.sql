BEGIN;
REVOKE EXECUTE ON FUNCTION refs_persist_wbs_trace_relation_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_read_wbs_trace_relation_evidence(uuid,uuid,jsonb) FROM refs_app;
DROP FUNCTION IF EXISTS refs_read_wbs_trace_relation_evidence(uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS refs_persist_wbs_trace_relation_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text);
DROP TABLE IF EXISTS wbs_trace_relation_item;
DROP TABLE IF EXISTS wbs_trace_relation_evidence;
COMMIT;
