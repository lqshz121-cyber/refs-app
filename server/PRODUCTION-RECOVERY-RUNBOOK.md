# Production database recovery runbook

Scope: the REFS PostgreSQL kernel (`server/db/migrations`, runner
`runtime/migrate.mjs`). This document is normative for production and staging.
It exists because the migration chain is deliberately irreversible past
migration 401 and conditionally irreversible at forty-three further points, so
"roll the schema back" is not an available recovery move. Recovery is
**restore an approved backup, then fix forward.**

## 1. What the runner will and will not do in production

| Command | Production database (name not ending in `_test`, `REFS_ALLOW_DB_DOWN` unset) | Test database |
|---|---|---|
| `npm run db:up` | Applies pending migrations in manifest order, one transaction each, records checksum in `refs_schema_migration`. Re-running is a no-op (all `skipped`). | same |
| `npm run db:down` | Refused: exit 1, `DB_DOWN_FORBIDDEN`, schema untouched. | Rolls back exactly one migration if its down body permits. |
| `npm run db:reset` | Refused: `DB_DOWN_FORBIDDEN`. | Refused up front with `MIGRATION_RESET_BLOCKED` once the chain has crossed an unconditional barrier (today: 401); the `migration_reset_blocked` event names `schema_head`, `applied_count`, `first_irreversible_migration` and the recovery path. Nothing is torn down. |

Barriers, verified by `tests/migration-barrier-contract-postgres.test.mjs`
(each probe runs inside a rolled-back transaction and asserts the ledger hash is
unchanged):

- **401** `native_settlement_bank_account_control` — refuses unconditionally
  (`P0001`, "migration 305 is retained as immutable historical evidence").
- **414** `runtime_context_additive_authority_fix` — refuses (`55006`) while any
  `runtime_auth_context` row is unrevoked and unexpired; lets go once revoked.
- **43 evidence-conditional barriers** (122–126, 156, 164, 167, 196–212, 254–287,
  337–389, …) refuse while the retained rows they protect exist. Each guarded
  table is asserted to exist.

## 2. Backup requirements

A backup is not "approved" for recovery unless all of the following hold:

1. It is a consistent snapshot of the **whole database**, including
   `refs_schema_migration`. Losing that table while the schema survives makes
   `db:up` fail closed with `42723` (duplicate object) on the first
   `CREATE FUNCTION` it re-runs — by design, it will not silently redefine.
2. It records the **application release SHA** and the **ledger hash** at backup
   time:
   `SELECT encode(sha256(convert_to(string_agg(migration_name||':'||checksum,',' ORDER BY migration_name),'UTF8')),'hex') FROM refs_schema_migration;`
3. It was taken **before** the release being recovered from, with business
   writes frozen (the runner's own advisory lock does not freeze the application).
4. Object storage (attachments) is snapshotted or versioned at the same
   moment; `attachment.storage_ref`/`storage_version` in the database must
   resolve after restore.

## 3. Recovery procedure

1. **Stop** the application and outbox consumers. Confirm no live
   `runtime_auth_context` rows: `SELECT count(*) FROM runtime_auth_context WHERE revoked_at IS NULL AND expires_at>clock_timestamp();`
   Revoke any that remain (`UPDATE … SET revoked_at=clock_timestamp()`) — this
   is an operational revoke, not an accounting write.
2. **Restore** the approved backup into a fresh database. Do not restore over
   the live one.
3. **Verify the ledger**: the ledger hash equals the value recorded at backup
   time; `SELECT max(migration_name) FROM refs_schema_migration;` equals the
   release SHA's expected head.
4. **Fix forward**: check out the release SHA (or a later approved one) and run
   `npm run db:up`. Expect `migration_completed` only for migrations newer than
   the backup and `migration_skipped` for the rest. Any `migration_failed` stops
   the procedure; do not edit history, skip entries or touch
   `refs_schema_migration` by hand.
5. **Attestation**: the deployment identity ceremony (`REFS_EXPECTED_INSTALLATION_ID`,
   `REFS_EXPECTED_DATABASE_NAME`) must be re-run against the restored database
   before any grant reconciliation or HTTP listen.
6. **Re-point** the application and resume outbox consumers only after the
   release owner signs off on the gates in `RELEASE-GATES.md`.

## 4. Application version rollback

Rolling the binary back to a SHA whose manifest is **shorter** than the applied
chain leaves objects in the database the older code does not know about. That is
only safe once a rollback drill has shown the older binary tolerates them; on
`ff163552` the extra objects would be 417–421 (and 422 if applied), which the
`9531ce34` binary never references but whose triggers on `journal_entry` remain
active. **Do not assume; drill it** (T15).

## 5. What must never be done

- Running `db:down`/`db:reset` against production, or setting `REFS_ALLOW_DB_DOWN=1` there.
- Deleting or inserting rows in `refs_schema_migration` to make a run green.
- Editing a historical migration file (the manifest checksum will refuse it; if it does not, the manifest was edited too, which is worse).
- Restoring a backup that lacks `refs_schema_migration` or lacks a recorded ledger hash.

## Application rollback past a migration is refused automatically

`db:up` (Render `preDeployCommand`) now compares `refs_schema_migration` with the
files the build ships. If the ledger holds a migration this build does not know,
the runner emits `migration_ledger_ahead` (`MIGRATION_LEDGER_AHEAD`), executes
nothing, and the deploy aborts before the old code starts. This makes the
forward-only policy above enforceable: "rollback to previous deploy" in Render
cannot put older code in front of a newer schema. Recovery is unchanged —
redeploy the newer build, or restore the approved pre-migration backup
(including `refs_schema_migration`) and then deploy the older build.
