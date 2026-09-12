# REFS database dictionary export

`runtime/database-dictionary.mjs` exports a catalog-only, migration-bound database dictionary. It reads schema metadata in a repeatable-read, read-only transaction and never selects accounting rows, PostgreSQL function bodies, function signatures, trigger definitions, policy predicates, or index/constraint definitions.

The export fails closed unless every `refs_schema_migration` entry exactly matches the fixed migration manifest. Its JSON includes the applied migration list, a manifest SHA-256, and a catalog SHA-256 suitable for release evidence.

Run it only with a dedicated low-privilege PostgreSQL role that can inspect the required `pg_catalog` relations and read `refs_schema_migration`. Do not use an application, migrator, or superuser credential. Store generated evidence outside source control and do not include connection strings in the artifact.

The managed database administrator must provision the role with [database-dictionary-reader.sql](ops/database-dictionary-reader.sql). It grants only schema usage and the two migration-history columns; it deliberately does not create a password or grant access to accounting tables, sequences, or application functions. Credential retirement uses [database-dictionary-reader-revoke.sql](ops/database-dictionary-reader-revoke.sql).

Use the explicit reader connection only. The CLI rejects `DATABASE_URL`, migration, issuer, and grant-sync URLs when reused, and requires the PostgreSQL username `refs_dictionary_reader`:

```powershell
$env:REFS_DATABASE_DICTIONARY_DATABASE_URL='postgresql://refs_dictionary_reader:...@host/database?sslmode=require'
npm run db:dictionary -- --out-json C:\secure-evidence\dictionary.json --out-markdown C:\secure-evidence\dictionary.md
```

The command outputs only catalog and manifest hashes. Its errors expose only a stable error code.

The production database could not be inspected from this workspace. A generated dictionary must therefore be treated as environment-specific evidence, not as proof that this branch has been deployed.
