BEGIN;

REVOKE ALL ON FUNCTION refs_read_ai_finding_actions(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_finding_actions(uuid,uuid,integer) TO refs_app;

COMMIT;
