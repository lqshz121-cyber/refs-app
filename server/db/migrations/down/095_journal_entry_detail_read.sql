BEGIN;
REVOKE EXECUTE ON FUNCTION refs_get_journal_entry_detail(uuid,uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_get_journal_entry_detail(uuid,uuid,uuid,uuid);
COMMIT;
