# Recurring Scheduler release candidate — 2026-09-14

## Candidate

- Branch: `codex/374-postgres-syntax-verify`
- Candidate commit: `867ed1054d5e72c92fcdafc6fa4c2460b476a690`
- Prerequisite commit: `8e54dd83efd4ac3983d2abb1e345aca3527c9fce`
- Added migrations: 412 through 416. Existing applied migrations are not modified.

## Verified locally

1. `node runtime/test-postgres-fresh.mjs --pattern "recurring scheduler separates creation approval and due-run, creates one Draft, and never writes ledger"`
   - exit 0; isolated PostgreSQL 16; selected 1, passed 1, skipped 0.
   - verifies maker/create, independent submitter, independent approver, runner, one Draft journal, zero ledger writes, idempotent rerun, audit and outbox records.
2. `node --test tests/workflow-role-grant.test.mjs tests/recurring-scheduler-contract.test.mjs tests/recurring-scheduler-http.test.mjs tests/migration-runner.test.mjs`
   - exit 0; 43 passed, 0 failed.

## Required Render staging verification before release

1. Confirm the deployed source revision equals the candidate revision after the normal reviewed merge path.
2. Run the API pre-deploy migration command; read back migration history and checksums for 412–416.
3. Verify `/health/ready` and the static client build/revision agree with the API revision.
4. Execute an authenticated, non-posting scheduler E2E using separate maker, submitter, approver, and runner identities. Confirm the output is Draft-only and ledger remains unchanged.
5. Record exact URL, deployment id, command exit codes, migration readback, and rollback target.

## Boundaries

This is a staging release candidate. It does not demonstrate production deployment, WBS provider-signed admission, object-storage/scanner integration, or a real-user accounting close.