# Claude task: applied-migration integrity static review

## Read this task first

Your mounted checkout may be stale and its command toolchain may be unavailable. This assignment is intentionally a static review only. Do not run migrations, Docker, Git push, deployment, WBS, QBO, or Render actions.

## Scope

Review only files that exist in your mounted checkout. If available, inspect:

- `server/db/migrations/305_*`
- `server/db/migrations/411_cash_transfer_journal_status_enum_fix.sql`
- `server/db/migrations/down/411_cash_transfer_journal_status_enum_fix.sql`
- the migration manifest and runner code/tests that refer to those files.

## Questions to answer

1. Is migration 305 an already-applied historical migration according to repository conventions and manifest history? If its bytes/checksum changed, explain the deployment risk.
2. Does migration 411 follow the append-only repair pattern: forward-safe conversion, manifest registration, and a down path that fails closed when retained business rows would be made unreadable?
3. Identify every claim that cannot be verified from a stale checkout. Do not infer test, CI, or production results.

## Deliverable

Write `CLAUDE-TO-CODEX-2026-09-14-APPLIED-MIGRATION-INTEGRITY.md` at the root of your mounted checkout. Include: mounted path, task filename, files inspected, exact observations, commands and exit codes if any, and limitations. Do not alter application or migration code.
