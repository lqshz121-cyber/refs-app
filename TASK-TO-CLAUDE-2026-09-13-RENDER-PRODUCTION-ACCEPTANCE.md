# Claude handoff: Refs production acceptance

## Correct repository and branch

- Repository: `C:\Users\lqshz\Documents\Codex\2026-09-06\task-continuation-019fbdb6-9\work\refs-accounting-settings-authoritative`
- Remote: `https://github.com/lqshz121-cyber/refs-app.git`
- Production branch: `main`
- Current pushed SHA: `18be517d2908aa58ee00a909498535d154b348fa`

Do not use the obsolete `work\refs-app` checkout at SHA `98dcb137`.

## Completed local change

`5500ceac feat(accounting): tighten settlement and reconciliation inputs`

It adds:
1. Exact approved bank-account/cash-account pairing for native AP payment and AR receipt settlement.
2. Verified-clean attachment candidate selection for reconciliation adjustments; users do not hand-enter attachment UUIDs.
3. Navigation that presents only API_READ/API_COMMAND workspaces, preserving the full catalog only as metadata.
4. OpenAPI paths and migrations 401/402.

## Local validation already run

- `npm run typecheck`
- `node --test server/tests/settlement-input-reads.test.mjs server/tests/migration-runner.test.mjs`
- `npm run test:authoritative-bank`
- `npm run test:authoritative-full-shell`
- `npm run test:api-client`
- `node --test server/tests/accounting-openapi.test.mjs`

All passed at the time of commit.

## Requested Claude work

Perform an independent production-readiness review without changing real accounting data:

1. Verify GitHub `main` resolves to the SHA above.
2. Review migrations `server/db/migrations/401_*` and `402_*`, their down migrations, and `server/runtime/migration-manifest.mjs` for checksum and migration ordering integrity.
3. Review the Render configuration and identify whether auto-deploy should build this SHA, but do not create paid resources or alter secrets.
4. If a non-production/staging database is already configured and authorization is present, prepare a read-only migration status and deployment validation plan. Do not run destructive commands.
5. Report exact commands, exit codes, SHA, and any blockers.

## Boundaries

- WBS is read-only.
- Do not post accounting journals, change access roles, modify secrets, create paid services, or alter production accounting records.
- Do not claim production completion based only on unit tests.