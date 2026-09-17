# REFS release candidate — notes, runbooks, limitations (S30)

Candidate branch `claude/2026-09-16-n-batch-9c9cd162`; this document was written at `4115096149e5`. The exact release SHA is fixed by S37 (GO/NO-GO) — never by this file. Nothing here claims a staging or production read-back; those are S32–S39 and are marked **not run** until executed.

## 1. What is in the candidate (relative to `origin/main` ff163552)

Accounting / schema
- Migration **422** — removes two PL/pgSQL name collisions in the accounting-settings workflow functions (374). No semantic change (T01, T04).
- Migration **423** — a fully-open AP bill (`APPROVED` or `OPEN`) can be voided; native bills use their verified attachment evidence when no source document exists; a fully reversed AP payment reopens the bill to `OPEN` (AR parity). Owner decision 2026-09-16. Proven end-to-end on PG16 (S03 review pending by an independent session).
- Migration runner: reset refuses before the first irreversible down (`MIGRATION_RESET_BLOCKED`); an older build refuses to run in front of a newer schema (`MIGRATION_LEDGER_AHEAD`); test-only `migrateUp({until})` for historical heads (S18).
- Kernel repository: failed serializable retries revoke their issued context (T06).

Frontend
- Chart.js is loaded `async`; a CDN outage no longer blanks the app (T14).
- `refs-boot-guard.js`: if the bundle never runs, a static notice with code `APP_BUNDLE_NOT_STARTED` and the release stamp appears after 8 s (S11).

Delivery / security
- Pages deploy: manual dispatch restricted to `main`; `.node-version` = 20 (S14).
- Static Render services carry identical CSP / security headers; secret sweep, SRI and inline-script checks are gates (N37/S10).
- OpenAPI now lists all six retired 410 routes as deprecated (S25).

Contracts and evidence (tests only): journal lifecycle, posting SoD, context revocation, optimistic locking, migration barriers/symmetry, report ↔ ledger reverse trace, WBS raw-event immutability, observability catalog, router ↔ kernel surface, permission matrix, boot guard, traceability-matrix drift guard. Root `npm test` gained `test:startup-surface`, `test:security-surface`, `test:traceability-matrix`, `test:boot-guard`.

## 2. Deployment order (staging, then production — each needs Owner authorisation)

1. Confirm the candidate SHA equals `origin/claude/2026-09-16-n-batch-9c9cd162` head and that the Accounting Kernel Gate is green for that SHA (RELEASE-GATES.md §0).
2. Take the database backup **including** `refs_schema_migration` (server/BACKUP-RESTORE-DRILL.md).
3. Deploy the API service manually (`autoDeployTrigger: off`). Render runs `npm run db:up` as preDeploy: expect `migration_completed` for 422 and 423 only, everything else `skipped`, then `migration_runner_completed`. Any `migration_failed` / `migration_ledger_ahead` aborts the deploy by itself.
4. `/health/ready` must return 200 with `release` = candidate SHA. This proves reachability only.
5. Deploy the static client with the same SHA; verify `/refs-boot-guard.js`, `/refs-runtime-config.js` are served `no-store` and the CSP header is present.
6. Run S33/S34 read-only and isolated-tenant E2E before declaring staging accepted.

## 3. Rollback

Application rollback is **forward-only** past a migration: redeploying an older build will be refused by `MIGRATION_LEDGER_AHEAD` (and must be). Options, in order:
1. Forward fix: patch, new SHA, redeploy.
2. Revert the offending change in a new commit (422/423 are function-level and have verbatim down files; `db:down` one step is safe on a **test** database only — production uses forward fixes).
3. Restore the pre-deploy backup (with `refs_schema_migration`) and redeploy the previous SHA — data written after the backup is lost; Owner decision only. Full procedure: server/PRODUCTION-RECOVERY-RUNBOOK.md.

## 4. Troubleshooting (first 15 minutes)

| Symptom | Where to look | Likely cause |
|---|---|---|
| deploy aborted, log has `migration_ledger_ahead` | preDeploy log | older build deployed over newer schema — deploy the newer SHA |
| deploy aborted, `migration_failed` with SQLSTATE | preDeploy log; `refs_schema_migration` has no row for that file | migration error; nothing partially applied |
| `/health/ready` 503 | API logs `startup_failed`, `accounting_database_timeout` | DB URL / role / statement timeout |
| page shows `APP_BUNDLE_NOT_STARTED` | network tab for `bundle.js` (404 / blocked) | static deploy incomplete or cache key mismatch |
| page shows `RUNTIME_CONFIG_MISSING` / `RUNTIME_CHANNEL_MISMATCH` | `refs-runtime-config.js`, `refs-build.js` | static build env not set for this channel |
| many 403 for one actor | `accounting_access_failure` | grant missing or a second workflow class refused (by design) |
| 412 on write | client sent stale `If-Match` | concurrent edit — reload and retry |
| outbox backlog grows | `outbox_dispatch_unhealthy`, `outbox_failed` metric | consumer down or dead-letter; do not requeue by editing rows |

## 5. Daily monitoring (until a SaaS is wired)

Scrape stdout for the `EVENT_CATALOG` alert rules (server/OBSERVABILITY.md); run the nine `DB_METRICS` SELECTs every 5 minutes; page on `posted_into_closed_period>0`, `ap_control_out_of_balance>0`, `outbox_failed>0 for 15 min`, `migration_ledger_hash ≠ manifest`.

## 6. Known limitations in this release (do not present as features)

Not persisted / not available: Estimate, Purchase Order, Goods Receipt, Check, Write-off, Bank Deposit (batch), AR Invoice Void, Refund reversal, Sales Receipt reversal object, Unit Cost Layer, sales COGS close-out, interest capitalisation, business Closing, PM Pickup object, CWIP→fixed-asset transfer (S12/S13). Recurring, Fixed Assets, Budget/Forecast, Consolidation posting and Closing/PM Pickup are being closed out in S41–S45.
Known pre-existing test reds not introduced by the candidate: root `test:visual`; kernel tests that walk down through barrier 401 (to be converted per S18 design); kernel :6738 42P08 (intercompany elimination lifecycle).
Live read-backs (staging/production) have **not** been run by any session.

## 7. Owner decisions outstanding

See ACCEPTANCE-TRACEABILITY-MATRIX.md §G: branch protection / environment approval read-back (A8); production Render Blueprint ownership (A9); provenance attestation + CodeQL (A11/E6); revoke base reconciliation transition from `refs_app` (B5); document or retire `self-service-read-grant/activate` (B6); scope decisions for the S12/S13 absent objects; a secret-free WBS MCP schema or sanitized sample via Codex (D2/D3).
