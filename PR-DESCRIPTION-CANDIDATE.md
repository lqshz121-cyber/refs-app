# PR: candidate `claude/2026-09-16-n-batch-9c9cd162` → `main`

**Do not merge until the Accounting Kernel Gate is green on the head SHA and Codex has issued a GO on S-GATE-01..06.** Opening this PR is what triggers CI on the candidate (branch pushes do not).

## Scope
Base `ff163552` → head `2048d74f64848f0b18dced9d903bf402dd67bebf` · 30 commits · 80 files (+5802 / −86). Deployed to **staging** on 2026-09-17 at `320bcbad` (API, internal-test-api, refs-app); commits after 320bcbad are hardening/tooling only (no migrations).

## Migrations (2, both function-level, verbatim down files, zero data rewrite)
| # | What | Risk | Rollback |
|---|---|---|---|
| 422 | `CREATE OR REPLACE` two accounting-settings functions from 374: PL/pgSQL name collisions only | none (T01 semantic review, T04 tests) | `db:down` one step (test DBs) / forward fix (prod) |
| 423 | in-place `pg_get_functiondef` patches of 006/010/023: AP bill void accepts `APPROVED\|OPEN` + attachment evidence; payment reversal reopens to `OPEN` | Owner-approved business change (T11-G1); kernel void/reversal tests 5/5; e2e test | verbatim down; already-voided bills keep their posted ledger |
Staging preDeploy applied 421 (already on main, not yet on staging), 422, 423 — logged `migration_completed` ×3, runner completed.

## Runtime / product code
- `runtime/migrations.mjs`: `MIGRATION_RESET_BLOCKED` preflight; `MIGRATION_LEDGER_AHEAD` (older build refuses newer schema); test-only `migrateUp({until})`.
- `runtime/db.mjs`: pool `error` listener — **fixes the staging crash loop** (idle pg client errors exited the process).
- `runtime/process-guards.mjs`: unhandledRejection/uncaughtException → one safe event, clean stop, exit 1; `gracefulClose` for SIGTERM.
- `kernel-repository.mjs`: failed serializable retries revoke their issued context.
- Frontend: async Chart.js (CDN outage no longer blanks), `refs-boot-guard.js` (bundle-never-ran notice), CSP headers on `refs-internal-test`, `no-store` on all runtime assets.
- OpenAPI: four undocumented 410 retired routes now declared deprecated.
- Delivery: `deploy.yml` manual dispatch restricted to `main`; `.node-version` 20.

## Tests / tooling added
Contract suites: journal lifecycle, posting SoD, context revocation, optimistic locking, migration barriers/symmetry/ledger-ahead/historical-head, report↔ledger trace, WBS raw immutability, observability catalog, router↔kernel surface, permission matrix, boot guard, security surface (CSP/SRI/secret sweep), traceability-matrix guard, GO/NO-GO generator, Render env schema, staging release read-back. Root `npm test` gained 8 segments.

## Known pre-existing reds on `main` (not introduced here)
`test:visual`; kernel tests that walk down through barrier 401 (S18 design + primitive landed; call-site conversion pending); kernel :6738 42P08; fixed-asset post-impairment policy fixture 23514. Accounting Kernel Gate on `main` ff163552 is already **failure**.

## Feature scope exclusions (not in this release, see S12/S13/RELEASE-NOTES §6)
Estimate, PO, goods receipt, check, write-off, bank deposit batch, AR invoice void, refund reversal, Unit Cost Layer, sales COGS, interest capitalisation, business Closing, PM Pickup object.

## Evidence
`ACCEPTANCE-TRACEABILITY-MATRIX.md` (47 rows, §H receipt index), `RELEASE-NOTES-2026-09-CANDIDATE.md`, `GO-NO-GO` report (currently **NO-GO**), receipts `CLAUDE-TO-CODEX-2026-09-1{6,7}-*` in the repo root.

## Commits
- `2048d74f` L03/L13: staging release read-back tool (4 surfaces, CONSISTENT/DRIFT/UNREACHABLE, --expect) + 5 tests
- `645fa785` R15/L21: process guards (unhandledRejection/uncaughtException -> one safe event, clean stop, exit 1) + gracefulClose (idle connections, hard deadline) wired into the API; observability catalog + 5 tests
- `d4e74a2d` R27/L22: secret-free Render Blueprint schema check (duplicates, literal secrets, API/static coordinate drift, runtime-vs-declared variable notes) + test
- `0dcccffb` R30/L15: GO/NO-GO report generator from the acceptance matrix (defaults NO-GO; P0 needs LIVE_VERIFIED) + tests; npm run release:go-no-go
- `d114b7cb` S-GATE-02: matrix hygiene - LIVE_VERIFIED prefix, ☑ = design approval only, 429 migrations, push status, receipt index (section H) + generator tool, outputs path guard
- `2eaf2708` matrix: fix A17 path
- `2188aceb` matrix: A8 gap (main unprotected), A13-A17 staging read-backs (L02/L04/L08/L10/L17)
- `ac298053` L04: serve refs-boot-guard.js no-store on both static services (staging read-back showed s-maxage=300); pin in security-surface test
- `699157f5` matrix: A12 staging deployment read-back (S32)
- `320bcbad` matrix: A12 staging read-back (S31)
- `be4aea59` fix(db): attach pool error listener - idle pg client errors were crashing the staging API (exit 1); safe event database_idle_client_error + test
- `8fbf51a0` S30: release notes, deployment order, rollback, troubleshooting, monitoring, known limitations, Owner decisions
- `41150961` S29: permission matrix (167 permissions, generated from live catalog) + contract test pinning it to migration SQL
- `ebc9c245` S25: document the four undocumented 410 ROUTE_RETIRED routes in OpenAPI as deprecated (contract only; no behaviour change)
- `2ef63e90` S18: migrateUp({until}) test-only historical head (fresh _test db), proof test 5/5, barrier-test design doc; no barrier weakened
- `8a4ac7a3` S12 S13: scope inventories -> matrix C14, E1 boot-guard reference
- `a4708407` S11: refs-boot-guard.js closes the last blank-page path (bundle never runs) - CSP-compatible external script, build+asset verifier wired, 5 tests, matrix B12 closed
- `e5dcb725` S06: reconciliation idempotency fixture - intruder holds one authority class (fixture guard mirrors 274); no control weakened
- `5e325983` matrix: A6 evidenced by S14
- `035d34b2` S14: restrict manual Pages dispatch to main and pin it in verify-release-deploy-gate; pin Node 20 via .node-version
- `8d340a50` N31: WBS twelve-sample manual acceptance workbook, blank manifest template and drift test -> matrix row D3
- `602798bb` N11 N14 N16: customer/vendor, PO/receipt, check/expense/deposit/transfer audits -> matrix C11-C13
- `cda6c68d` N12: invoice / sales receipt chain audit -> matrix row C10 (receipt CLAUDE-TO-CODEX-2026-09-16-N12-claude-9c9cd162)
- `6a68eac6` N24: 291001 two-step clearing audit -> matrix row C9 (receipt CLAUDE-TO-CODEX-2026-09-16-N24-claude-9c9cd162)
- `68c45078` 423: unify fully-open AP bill status for void (APPROVED|OPEN, attachment evidence) and reopen-to-OPEN after payment reversal; closes T11-G1 / N15-G2 (Owner decision 2026-09-16)
- `c8786a15` N40: acceptance traceability matrix + existence drift guard (receipt CLAUDE-TO-CODEX-2026-09-16-N40-claude-9c9cd162)
- `987c77c8` N03 fix (session e952882a): resolve variance policy test path relative to file, not cwd
- `039c271f` N37: frontend security surface contract (CSP/SRI/inline-script/secret sweep) + CSP headers on refs-internal-test (receipt CLAUDE-TO-CODEX-2026-09-16-N37-claude-9c9cd162)
- `76cc6c9d` N28 N39 N36 N30 N15 N35: contract tests, observability contract, migration ledger-ahead preflight (receipts CLAUDE-TO-CODEX-2026-09-16-Nxx-claude-9c9cd162)
- `6a757d79` T01-T18 cumulative (receipts CLAUDE-TO-CODEX-2026-09-16-T01..T18-claude-9c9cd162)
