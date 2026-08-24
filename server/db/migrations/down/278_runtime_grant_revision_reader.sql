BEGIN;

REVOKE EXECUTE ON FUNCTION refs_current_actor_grant_set_version(uuid,text,uuid) FROM refs_grant_sync;
DROP FUNCTION refs_current_actor_grant_set_version(uuid,text,uuid);

COMMIT;
