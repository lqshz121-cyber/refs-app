BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_authoritative_setting_history(uuid,uuid,text,integer,bigint,uuid) FROM refs_app;
DROP FUNCTION refs_read_authoritative_setting_history(uuid,uuid,text,integer,bigint,uuid);
DROP INDEX setting_snapshot_entity_family_history_idx;
COMMIT;
