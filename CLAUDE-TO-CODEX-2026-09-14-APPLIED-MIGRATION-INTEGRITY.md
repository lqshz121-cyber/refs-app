# Applied migration integrity static review

- Mounted checkout: `C:\Users\lqshz\Documents\Codex\2026-09-06\task-continuation-019fbdb6-9\work\refs-accounting-settings-authoritative`
- Task read: `TASK-TO-CLAUDE-2026-09-14-APPLIED-MIGRATION-INTEGRITY-STATIC-REVIEW.md`
- Review mode: read-only static inspection. No migration, database, Docker, Git mutation, deployment, WBS, QBO, or Render action was run.

## Files inspected

- `server/db/migrations/305_native_settlement_command.sql`
- `server/db/migrations/down/305_native_settlement_command.sql`
- `server/db/migrations/411_cash_transfer_journal_status_enum_fix.sql`
- `server/db/migrations/down/411_cash_transfer_journal_status_enum_fix.sql`
- `server/runtime/migration-manifest.mjs`
- `server/runtime/migrations.mjs` and `server/runtime/migrate.mjs`
- `server/tests/migration-runner.test.mjs`
- relevant `server/tests/postgres-kernel.test.mjs` references for migration 305 and cash transfer
- `server/db/migrations/down/401_native_settlement_bank_account_control.sql` for the repository's retained-history barrier convention
- `CLAUDE-TASK-ROUTING.md`

## Commands and exit status

The following read-only PowerShell discovery/read/hash searches completed with exit code 0: `Get-ChildItem`, `Get-Content`, `rg`, and a PowerShell/.NET SHA-256 calculation over UTF-8 text after normalizing CRLF to LF. No `git`, `node`, `npm`, Docker, or database command was executed for this review.

Normalized checksums observed:

- migration 305 up: `e7300c321a1ea9c6ca1ffa1145d264600681c2f075522b775d478eed3238f259`
- migration 305 down: `f51d42aa9ed32b0128ac3933061a62b94ca435120c9d7712c016e9db10083a09`
- migration 411 up: `4cdba2b92ac01ccfd517e2605fbdf0883f6358f30682cb00d8e4c4933170de8c`
- migration 411 down: `21326f3275b81ecd3118bbf9a2b7ed7d382b8cdfa4083395797be543e04bc339`

Each value matches the corresponding entry currently present in `MIGRATION_MANIFEST`.

## Findings

1. **Migration 305 is treated as historical and immutable by repository conventions.** It is registered in the fixed manifest between migrations 304 and 306, while the manifest continues through later migrations. The migration tests explicitly assert a rollback barrier at migration 305, and `down/401_native_settlement_bank_account_control.sql` states that migration 305 is retained as immutable historical evidence. The runner records each applied checksum in `refs_schema_migration`; before executing an already-recorded migration it compares the stored checksum and raises `MIGRATION_CHECKSUM_MISMATCH` when bytes differ. The present checkout's 305 bytes match the manifest hashes, but this static review cannot compare them with bytes already applied in any external database. If a deployed database has the old 305 checksum, changing 305 (or merely changing its manifest hash) would make the next migration run fail closed; bypassing that check by editing metadata would risk an unreproducible schema/history fork.

2. **Migration 411 follows an append-only repair shape.** Its up migration uses `CREATE OR REPLACE FUNCTION` for the Cash Transfer transition/cancel functions and journal guard, changing the status comparison to text-safe behavior while retaining the existing aggregate, CAS, idempotency, permission, SoD, audit, outbox, and evidence gates. It is appended as manifest entry 411 with matching up/down hashes. Its down migration is an explicit no-op with a comment that reverting would reintroduce a runtime failure. Because down neither drops the repaired functions nor deletes retained rows, a rollback cannot make retained Cash Transfer evidence unreadable. This is fail-closed preservation, rather than a destructive reverse implementation.

3. **Static boundary on 411 down.** The down file does not inspect row counts or raise a conditional exception; its safety property is that it performs no rollback at all. Whether a future operator expects a non-zero rollback signal, and whether all deployed 411 applications are compatible with this no-op, require an executed database/operational check not available here.

## Unverifiable from this checkout

- Whether migration 305 is actually present in a target database's `refs_schema_migration` table, and which checksum that database recorded.
- Whether migration 411 has been applied successfully to any PostgreSQL 15/16/18 or production target, including transaction, lock, privilege, trigger, and retained-row behavior.
- Current CI/GitHub status, release bundle freshness, deployment state, production readiness, or any live provider/browser/object-storage/scanner evidence.
- Whether another checkout, branch, or deployment artifact contains different 305/411 bytes.
- Whether the complete business workflow and all external integrations remain operational after applying 411; no runtime or integration tests were run by this static assignment.

No application or migration code was changed. The only intended deliverable is this review receipt.
