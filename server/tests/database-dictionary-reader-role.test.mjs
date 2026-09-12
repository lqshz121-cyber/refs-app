import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('dictionary reader provisioning grants only metadata access and has a reversible retirement path',async()=>{
  const [grant,revoke]=await Promise.all([read('../ops/database-dictionary-reader.sql'),read('../ops/database-dictionary-reader-revoke.sql')]);
  for(const token of ['CREATE ROLE refs_dictionary_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS','REVOKE ALL ON ALL TABLES IN SCHEMA public FROM refs_dictionary_reader','REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM refs_dictionary_reader','REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM refs_dictionary_reader','GRANT USAGE ON SCHEMA public TO refs_dictionary_reader','GRANT SELECT (migration_name,checksum) ON TABLE refs_schema_migration TO refs_dictionary_reader'])assert.ok(grant.includes(token),`missing ${token}`);
  assert.doesNotMatch(grant,/GRANT\s+(?:ALL|SELECT)\s+ON\s+(?:ALL\s+TABLES|TABLE\s+(?!refs_schema_migration))/i);
  assert.doesNotMatch(grant,/\b(?:CREATE|ALTER)\s+ROLE\s+refs_dictionary_reader\b[^;]*\s(?:PASSWORD|CREATEROLE|SUPERUSER|BYPASSRLS)\b/i);
  assert.match(grant,/NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/);
  assert.doesNotMatch(grant,/GRANT\s+EXECUTE/i);
  assert.doesNotMatch(grant,/GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)/i);
  for(const token of ['REVOKE ALL ON TABLE refs_schema_migration FROM refs_dictionary_reader','REVOKE USAGE ON SCHEMA public FROM refs_dictionary_reader','ALTER ROLE refs_dictionary_reader NOLOGIN'])assert.ok(revoke.includes(token),`missing ${token}`);
});
