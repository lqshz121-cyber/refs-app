BEGIN;

REVOKE EXECUTE ON FUNCTION refs_list_journal_entries(uuid,uuid) FROM refs_app;
DROP FUNCTION refs_list_journal_entries(uuid,uuid);
DELETE FROM permission_catalog WHERE permission_code='GL.JE.VIEW';

COMMIT;
