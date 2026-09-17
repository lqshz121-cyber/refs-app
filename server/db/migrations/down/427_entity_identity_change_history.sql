BEGIN;
DROP FUNCTION IF EXISTS refs_read_entity_identity_changes(uuid,uuid,integer,integer);
DROP TRIGGER IF EXISTS entity_identity_change_audit ON entity;
DROP FUNCTION IF EXISTS refs_entity_identity_change_trigger();
DROP TRIGGER IF EXISTS entity_identity_change_append_only ON entity_identity_change;
DROP FUNCTION IF EXISTS refs_entity_identity_change_append_only();
DROP TABLE IF EXISTS entity_identity_change;
COMMIT;
