# REFS delivery guardrails

## Accounting redlines

- A journal may reach `POSTED` only through the PostgreSQL workflow; ledger, audit, outbox, source trace, and business balances must commit or roll back together.
- Browser state, fixtures, and `localStorage` are never accounting authority. In authoritative mode, missing backend commands must fail closed.
- Do not edit an applied migration. Add a forward migration and matching down migration, update the manifest checksum, and prove clean up/down plus upgrade behavior.
- Every mutation requires server-derived identity, authorization, idempotency, and optimistic concurrency where it changes an existing resource. Never trust actor, tenant, entity, or request hashes from a body.
- WBS is read-only. Do not claim WBS equivalence without immutable authorized source receipts, scoped keys, control totals, and bidirectional trace evidence.

## Ownership and verification

- Keep API/runtime/migrations, UI, WBS ingestion, and AI/attachment changes as isolated scopes. Preserve unrelated dirty work.
- Required local gates: `npm.cmd test`, `npm.cmd run build`, `server/npm.cmd test`, and fresh isolated PostgreSQL 15 and 16: set `POSTGRES_IMAGE` then run `npm.cmd run test:postgres:fresh` from `server`.
- Browser/live evidence requires the exact built SHA, a real deployed API and identity provider, refresh persistence, keyboard/focus/resize checks, console/network capture, and no skipped scenarios.
- A module is not production-complete until independent audit, applicable zero-skip tests, and end-to-end business acceptance all pass.
