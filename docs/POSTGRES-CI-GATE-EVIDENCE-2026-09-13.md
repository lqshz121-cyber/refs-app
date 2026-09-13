# PostgreSQL CI Gate Evidence — 2026-09-13

## Scope

Evidence for PR #582 at commit `801bde2445e81b6c3a4feca13f5feaa11f02843c`. This record does not claim that PostgreSQL migration, closure, deployment, or production acceptance passed.

## GitHub Actions run

- Accounting Kernel Gate: `34767706649`
- Commit: `801bde2445e81b6c3a4feca13f5feaa11f02843c`
- PostgreSQL business-closure fixture job: `103751541841`
- The fixture job completed with failure at 2026-09-13 16:14:50 UTC after the step `Run every isolated PostgreSQL accounting closure`.
- GitHub supplied only `Process completed with exit code 1` as the failure annotation. No test name, SQLSTATE, stack trace, or SQL error was available through the job annotations or log endpoint at the time of review.

## Successful checks on this commit

- `static-and-unit`
- `Versioned object storage and malware scan gate`
- `isolated-consumer (15)`
- `isolated-consumer (16)`
- `isolated-consumer (18)`

## Incomplete checks

At the time of evidence capture, the PostgreSQL 15, 16, and 18 required gates remained `in_progress`; their fresh zero-skip PostgreSQL step had started but did not publish a result. They must each complete successfully before this PR can be treated as passing the database compatibility gate.

## Local corroborating checks

- Full migration manifest: 409 migrations / 818 up and down files, normalized SHA-256 mismatches: 0.
- `npm run build`, `npm run typecheck`, release simulation, and non-container accounting contracts passed locally.
- Docker Desktop was unavailable locally, so no local fresh PostgreSQL or attachment-container integration result is claimed.

## Release boundary

No merge, deployment, Render configuration change, QBO/WBS change, credential action, or accounting write was performed. Staging release alignment and authenticated business E2E remain unverified.