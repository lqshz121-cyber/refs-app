-- Run only by the managed PostgreSQL administrator during credential retirement.
REVOKE ALL ON TABLE refs_schema_migration FROM refs_dictionary_reader;
REVOKE USAGE ON SCHEMA public FROM refs_dictionary_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM refs_dictionary_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM refs_dictionary_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM refs_dictionary_reader;
ALTER ROLE refs_dictionary_reader NOLOGIN;
