REVOKE ALL ON FUNCTION refs_read_journal_upload_rows(uuid,uuid,uuid) FROM PUBLIC,refs_app;
DROP FUNCTION refs_read_journal_upload_rows(uuid,uuid,uuid);
COMMIT;
