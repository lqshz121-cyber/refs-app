# Backup, restore and rollback drill

Companion to `PRODUCTION-RECOVERY-RUNBOOK.md`. Two parts: what was verified
locally (repeatable without Docker), and the production drill plan that waits
for the Owner.

## A. Local drill — verified on PostgreSQL 16.4 (embedded), chain 428

| Step | Command / action | Result |
|---|---|---|
| Seed | `db:up` (428 completed), tenant `BKDRILL`, entity, one `attachment` with `storage_ref=object://attachments/drill`, `VERIFIED_CLEAN` | ledger sha256 `70020ef2…` |
| Freeze + backup | `pg_ctl stop -m fast` then `tar` of the data directory (physical, consistent) | 15.9 MB, tarball sha256 recorded |
| Restore | untar into a **new** data directory, start on the same port | start exit 0 |
| Verify | ledger sha256 re-read | **identical**; `BKDRILL` present; attachment `storage_ref`/status intact |
| Forward fix | `db:up` on the restored database | exit 0, **428 skipped / 0 completed** |
| Binary rollback probe | run `9531ce34`'s `runtime/migrate.mjs up` (422-entry manifest) against the 428 database | exit 0, 422 skipped — the older runner ignores the six newer applied entries |
| Ledger loss | `DROP TABLE refs_schema_migration`, then `db:up` | exit 1, `42710 duplicate_object` on `001` — **fails closed**, never re-runs DDL over a live schema |

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
   instance as smoke.
5. **Application version rollback rehearsal**: start the previous release
   binary against the restored (newer-schema) database in staging; run the E2E
   matrix B1/B5/B10 and the HTTP posting/reopen paths; only if green may binary
   rollback be listed as an option in the release plan.
6. **Time budget**: record restore duration and data loss window (RPO) from the
   snapshot timestamp; the release gate matrix requires both numbers on file.
