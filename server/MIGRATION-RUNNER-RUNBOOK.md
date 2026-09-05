# Accounting migration runner

Use this runbook when a deployment migration (for example, an audit index build)
needs longer than the ordinary API query deadline. This is runner configuration,
not a schema change. It does not change the consumer database or IAM authority.

## Configuration and prerequisites

- The release owner must approve the exact release SHA and applicable CI gates.
- Use only the isolated `MIGRATION_DATABASE_URL` login for the intended database.
  Never copy credentials, SQL, raw error details, or business values into logs.
- `REFS_PG_MIGRATION_STATEMENT_TIMEOUT_MS` defaults to `600000` milliseconds and
  accepts decimal integers from `100` through `600000`, inclusive. Invalid values
  stop the runner before it creates a connection. Both accounting Render
  Blueprints explicitly freeze `600000`.
- The override is passed only to the migration pool. Ordinary API
  `REFS_PG_STATEMENT_TIMEOUT_MS` (source default `10000`) and lock timeout remain
  unchanged. This is a per-statement deadline, not a whole-deploy deadline.
- Existing advisory-lock serialization is unchanged: timeouts are temporarily
  disabled only while awaiting the migration advisory lock, then restored to
  the migration pool's configured limits before any migration SQL executes.

## Deploy and observe

1. Verify backups and the approved release/environment. Keep the Render
   pre-deploy command `npm run db:up`, executed from `server`.
2. Sync the dedicated migration configuration from the appropriate Blueprint.
   Remove any temporary Dashboard command prefix such as
   `REFS_PG_STATEMENT_TIMEOUT_MS=600000`; do not extend the daily API timeout.
   Apply the same release/configuration policy to any separately provisioned
   production accounting service; these files do not create such a service.
3. Read JSON log events: `migration_runner_started` gives the selected command
   and deadline. Each manifest migration emits `migration_started`, then
   `migration_completed`, `migration_skipped`, or `migration_failed`, with its
   manifest name, direction and `elapsed_ms`. `skipped` means the stored checksum
   was verified; it does not mean SQL was rerun. Completion is emitted only after
   the SQL and metadata transaction commits.
4. A failed event includes only an allowlisted runner code or PostgreSQL SQLSTATE
   (for example `57014` for query cancellation). It excludes raw errors, SQL,
   identities, URLs and payloads. Runner-level failures also exit nonzero with a
   safe code. A missing completion event is not proof of success; verify the
   deployment outcome and metadata through approved read-only operations.
5. Once migration completion is proven, check live/ready and web build identity
   against the exact release SHA. Migrations alone are not authenticated E2E.

## Retry, rollback and escalation

Each migration's schema/data SQL and checksum metadata remain one transaction.
A failing statement rolls back that migration; earlier committed migrations
remain committed. Retry `npm run db:up` on the same approved SHA: completed
entries must match the fixed checksums, and only pending entries execute.
Never edit historical migrations, skip a failed entry, or manually insert or
delete migration metadata to make a deployment green.

Do not use `db:down`/`reset` as an automatic production recovery mechanism.
Existing destructive database/identity guards still apply. If ten minutes is
insufficient, stop and give the release owner the exact SHA, migration name,
elapsed time and safe code; investigate locks/query design and agree a forward
fix or approved database recovery. Do not remove all deadlines. Keep business
writes frozen until the release owner confirms the required acceptance gates.

## Verification

`node --test tests/migration-runner.test.mjs tests/migrations-safety.test.mjs`
from `server` exercises deadline isolation, validation before connections,
fixed-order/checksum checks, transaction commit/rollback and redacted logs with
fake pools (no database writes). Full PostgreSQL fresh/upgrade gates remain the
proof for actual SQL execution and schema compatibility.
