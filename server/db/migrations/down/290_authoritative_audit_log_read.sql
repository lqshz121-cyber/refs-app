BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_authoritative_audit_log(uuid,uuid,integer,timestamptz,uuid,text,text,text,timestamptz,timestamptz) FROM refs_app;
DROP FUNCTION refs_read_authoritative_audit_log(uuid,uuid,integer,timestamptz,uuid,text,text,text,timestamptz,timestamptz);
DROP INDEX audit_event_entity_timeline_idx;
UPDATE permission_catalog SET active=false,effective_to=clock_timestamp(),version=version+1 WHERE permission_code='AUDIT.VIEW';
COMMIT;
