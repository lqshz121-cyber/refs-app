BEGIN;

-- GL.JE.VIEW is owned by 057_journal_entry_read.sql and is deliberately left intact:
-- this migration only added a function, so only that function is removed.
REVOKE EXECUTE ON FUNCTION refs_get_journal_entry_lines(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_get_journal_entry_lines(uuid,uuid,uuid);

COMMIT;
