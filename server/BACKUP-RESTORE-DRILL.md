# Backup, restore and rollback drill

Companion to `PRODUCTION-RECOVERY-RUNBOOK.md`. Two parts: what was verified
locally (repeatable without Docker), and the production drill plan that waits
for the Owner.

## A. Local drill — verified on PostgreSQL 16.4 (embedded), chain 428 (see A2 for the current 429 chain)

| Step | Command / action | Result |
|---|---|---|
| Seed | `db:up` (428 completed), tenant `BKDRILL`, entity, one `attachment` with `storage_ref=object://attachments/drill`, `VERIFIED_CLEAN` | ledger sha256 `70020ef2…` |
| Freeze + backup | `pg_ctl stop -m fast` then `tar` of the data directory (physical, consistent) | 15.9 MB, tarball sha256 recorded |
| Restore | untar into a **new** data directory, start on the same port | start exit 0 |
| Verify | ledger sha256 re-read | **identical**; `BKDRILL` present; attachment `storage_ref`/status intact |
| Forward fix | `db:up` on the restored database | exit 0, **428 skipped / 0 completed** |
| Binary rollback probe | run `9531ce34`'s `runtime/migrate.mjs up` (422-entry manifest) against the 428 database | exit 0, 422 skipped — the older runner ignores the six newer applied entries |
| Ledger loss | `DROP TABLE refs_schema_migration`, then `db:up` | exit 1, `42710 duplicate_object` on `001` — **fails closed**, never re-runs DDL over a live schema |

## A2. Logical restore drill — `npm run test:restore:logical` (S24, no Docker)

The Docker drill (`npm run test:backup:restore`) proves the `pg_dump -Fc` /
`pg_restore` round trip, but it asserts only two facts about the restored
database: the migration row count and one seeded tenant. Equal cardinality is
not equal content, and a restore that is merely *plausible* is the failure mode
that matters. `runtime/test-logical-restore-drill.mjs` runs against any
PostgreSQL 16 reachable through `MIGRATION_DATABASE_URL` — the embedded server
used by the kernel gate is enough — refuses any database whose name does not
end in `_test`, and restores the ledger from its own logical export in a
`finally` block so it cannot leave the database mutated.

Verified on PostgreSQL 16.4 (embedded), chain **429**, ledger sha256
`8d696fd8f600d4e74ffd736029ac318d782f3405d83816d5dc1b8a9acd4c6869`
(exit 0, 11/11 checks):

| Check | What it rules out |
|---|---|
| `ledger_count_matches_manifest` / `ledger_digest_matches_manifest` | a restore that reproduces 429 rows with different checksums |
| `ledger_export_non_empty` | an empty export being mistaken for a clean ledger |
| `no_document_payload_in_database` | believing a database backup is a *complete* backup — zero binary columns on attachment/document tables and zero large objects, so attachment bytes live only in object storage and must be captured at the same timestamp |
| `attachment_storage_metadata_present` / `attachment_storage_ref_constrained` | a restore that silently drops `storage_ref`/`storage_version` (both `NOT NULL`, `storage_ref ~ '^(object|s3)://'`, `UNIQUE (tenant_id, storage_ref, storage_version)`) |
| `restored_ledger_is_byte_exact` | a logical import that reorders or rewrites rows |
| `post_restore_up_is_noop` | `db:up` after a good restore doing anything at all — observed 0 completed / **429 skipped**, exit 0 |
| `tampered_ledger_fails_closed` | one wrong checksum being served as a valid schema — observed exit 1, `MIGRATION_CHECKSUM_MISMATCH` |
| `missing_ledger_row_fails_closed` | a row lost in restore causing the runner to re-run DDL over a live schema — observed exit 1, SQLSTATE `55000` |
| `drill_leaves_ledger_unchanged` | the drill itself becoming the incident |

**Advisory from the run (not a failure, Owner decision):** `fixed_asset_read_cursor_key.secret`
is `bytea`. It is a legitimate cursor signing key, but it means the dump is a
secret-bearing artifact: production backups must be encrypted at rest and the
key rotated after any restore into a lower environment.

What the local drill does **not** prove: `pg_dump -Fc` / `pg_restore` logical
round-trip (the CI drill `npm run test:backup:restore` does, in Docker), object
storage contents (only the database's `storage_ref`/`storage_version` metadata
was checked), and application-level behaviour of the older binary against the
extra triggers/functions of 417–422 (only its migration runner was exercised).

## B. Production drill plan (Owner to schedule; nothing here is executed)

1. **Pre-conditions**: business writes frozen; outbox consumers stopped;
   `SELECT count(*) FROM runtime_auth_context WHERE revoked_at IS NULL AND expires_at>clock_timestamp()` = 0.
2. **Backup**: managed-provider snapshot **plus** `pg_dump -Fc` of the whole
   database; record release SHA, ledger sha256, `count(*) FROM refs_schema_migration`,
   `count(*) FROM attachment`, and the object-storage version marker at the same timestamp.
3. **Restore into a fresh instance** (never over the live one); run the
   post-restore checks in `PRODUCTION-RECOVERY-RUNBOOK.md §3` and additionally:
   `attachment.storage_ref` sample resolves in object storage; `refs_dictionary_reader`
   dictionary `catalog_sha256` equals the pre-backup value.
4. **Forward fix**: `db:up` on the release SHA — expect only `skipped`; then
   `npm run test:postgres:barriers` and `test:postgres:sod` against the restored
   instance as smoke. Record the restored ledger sha256 and compare it to the
   pre-backup value; they must be identical. The logical drill (A2) may **not**
   be pointed at the restored production instance — it mutates
   `refs_schema_migration` and refuses non-`_test` databases by design; run it
   against a `_test` clone restored from the same dump instead.
5. **Application version rollback rehearsal**: start the previous release
   binary against the restored (newer-schema) database in staging; run the E2E
   matrix B1/B5/B10 and the HTTP posting/reopen paths; only if green may binary
   rollback be listed as an option in the release plan.
6. **Time budget**: record restore duration and data loss window (RPO) from the
   snapshot timestamp; the release gate matrix requires both numbers on file.
