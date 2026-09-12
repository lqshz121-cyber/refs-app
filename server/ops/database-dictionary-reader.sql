-- Run only by the managed PostgreSQL administrator for the selected REFS database.
-- This file intentionally does not set a password and is not run by application migrations.
-- Provision the login secret through the database provider's secret manager.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_dictionary_reader') THEN
    CREATE ROLE refs_dictionary_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END;
$$;

ALTER ROLE refs_dictionary_reader NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
REVOKE ALL ON SCHEMA public FROM refs_dictionary_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM refs_dictionary_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM refs_dictionary_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM refs_dictionary_reader;

GRANT USAGE ON SCHEMA public TO refs_dictionary_reader;
GRANT SELECT (migration_name,checksum) ON TABLE refs_schema_migration TO refs_dictionary_reader;

-- Required catalog reads are publicly visible PostgreSQL metadata. No accounting table,
-- sequence, application function, or write privilege is granted by this file.

-- Verification: this must return only SELECT on refs_schema_migration and no function grants.
SELECT table_schema,table_name,privilege_type
FROM information_schema.role_table_grants
WHERE grantee='refs_dictionary_reader'
ORDER BY table_schema,table_name,privilege_type;

SELECT routine_schema,routine_name,privilege_type
FROM information_schema.role_routine_grants
WHERE grantee='refs_dictionary_reader'
ORDER BY routine_schema,routine_name,privilege_type;
