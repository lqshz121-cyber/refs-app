# Acceptance traceability matrix (N40)

Owner: Ricky · Maintained by Claude session `claude-9c9cd162` · Baseline `origin/main` = `ff163552eec0ee78b5806a7ae16323a9463b3a8c` · Integration branch `claude/2026-09-16-n-batch-9c9cd162`.

Rules of this file: a row is **DONE** only when code, an executable test, the exact SHA and a database/log read-back all exist and the Owner has ticked the last column. "Page opens" and "`/health/ready` 200" never satisfy the read-back column (RELEASE-GATES.md §0). Live read-backs marked **not run** are truthful: no session has production or staging credentials. Column semantics (S-GATE-02): `☑` in the Owner column means **Owner design approval only**. A live result is recorded only in the *Live read-back* column and only with the prefix `LIVE_VERIFIED:` when a session actually performed the read-back (URL/time/value in the cited receipt); `not run` otherwise. Statuses: `DONE` (all evidence, Owner-accepted) · `EVIDENCED` (all evidence, awaiting Owner tick) · `GAP` (known defect pinned by a test that asserts current behaviour) · `BLOCKED` (needs credentials / platform access / Owner decision) · `PARTIAL`.

`tests/acceptance-traceability-matrix.test.mjs` fails when any test file or document referenced in the *Test / Doc* column stops existing.

## A. Release readiness (P0)

| ID | Requirement | Code | Test / Doc | SHA | Offline read-back | Live read-back | Status | Owner |
|---|---|---|---|---|---|---|---|---|
| A1 | Migration chain is manifest-pinned, idempotent, checksum-guarded | `server/runtime/migrations.mjs`, `migration-manifest.mjs` (429 entries incl. 423) | `server/tests/migration-down-symmetry.test.mjs`; `npm run db:up` ×2 | ff163552 + `6a757d79` | PG 16.4 fresh: 428 applied → 428 skipped, exit 0/0 (T01/T02, P0-B) · independent PG 16.14: 427/427 (session f5b431ef) | not run | EVIDENCED | ☐ |
| A2 | Exactly one unconditional irreversibility barrier (down/401); reset refuses before first down | `migrations.mjs` `downMigrationRefusesUnconditionally`, `MIGRATION_RESET_BLOCKED` | `server/tests/migration-reset-preflight.test.mjs`, `server/tests/migration-barrier-contract-postgres.test.mjs` | `6a757d79` | 43 conditional + 1 unconditional, two independent detectors agree | n/a | EVIDENCED | ☐ |
| A3 | down/371 symmetric with up/371 | `server/db/migrations/down/371_*.sql` | `migration-down-symmetry.test.mjs` | `6a757d79` | up→down→up cycle exit 0 | n/a | EVIDENCED | ☐ |
| A4 | Migration 422 only disambiguates PL/pgSQL names in 374 (no semantic change) | `server/db/migrations/422_accounting_settings_workflow_alias_fix.sql` | `server/tests/accounting-settings-workflow-postgres.test.mjs` (T04) | `6a757d79` | tenant/approval/closed-period/SQLSTATE read-backs in T01 receipt | not run | EVIDENCED | ☐ |
| A5 | Older build cannot start in front of newer schema (rollback is forward-only, enforced) | `migrations.mjs` `MIGRATION_LEDGER_AHEAD` | `server/tests/migration-ledger-ahead-preflight.test.mjs`; `server/PRODUCTION-RECOVERY-RUNBOOK.md`; `RELEASE-GATES.md` §1a | `76cc6c9d` | PG16: foreign ledger row → `db:up` exit 1, 0 statements, ledger 429 unchanged | not run | EVIDENCED | ☐ |
| A6 | Pages deploy only after same-SHA kernel gate on main | `.github/workflows/deploy.yml` | `verify-release-deploy-gate.mjs` (now also pins main-only dispatch) | S14 `035d34b2` | exit 0; unconditional dispatch removed | GitHub Actions history — **Owner** | EVIDENCED | ☐ |
| A7 | Render services manual-deploy only, secrets `sync:false`, `preDeployCommand: db:up`, `/health/ready` gate | `render.yaml`, `render.integrations.yaml` | N35 receipt §1; T13 `RELEASE-GATES.md` | ff163552 | file audit | Render dashboard — **Owner** | EVIDENCED | ☐ |
| A8 | Branch protection on `main`, `github-pages` environment approval | GitHub settings (not in repo) | L16 receipt | — | — | LIVE_VERIFIED 2026-09-17: GitHub API `branches/main` → `protected:false`; PR #582 already merged | **GAP — main unprotected; Owner to add rule** | ☐ |
| A9 | Production Blueprint exists | — (`render.yaml` defines staging / internal-test only) | N35 G7 | — | — | — | GAP — Owner decision | ☐ |
| A10 | Backup / restore drill incl. `refs_schema_migration` | `server/runtime/test-backup-restore-drill.mjs` | `server/BACKUP-RESTORE-DRILL.md` (T15) | `6a757d79` | local drill exit 0 (Docker path documented; embedded PG path run) | production drill **plan only** | PARTIAL | ☐ |
| A11 | Release signing / provenance / SBOM | — | N35 G5 | — | — | — | GAP — Owner decision | ☐ |
| A12 | Staging read-back (2026-09-17): API 98e3431 ready but crash-looping on idle pg client errors; internal-test-api same; outbox worker suspended since 09-02; static app 12e6a31 (SHA drift); Node 26 runtime; PG 18 | `server/runtime/db.mjs` (pool error listener fix) | `server/tests/db-pool-idle-error.test.mjs`; S31 receipt | fix commit on branch | unit 1/1; posting-sod 7/7 | LIVE_VERIFIED: 320bcbad deployed to staging 2026-09-17 12:21–12:35 GMT+8 (API + internal-test-api + refs-app); /health/ready release = 320bcbad on both APIs; refs-build.js = 320bcbad; migrations 421/422/423 completed in preDeploy; RELEASE_MISMATCH cleared; crash-loop observation window open | PARTIAL — awaiting 6 h crash-free window, refs-internal-test static still 98e3431, outbox worker suspended | ☐ |
| A13 | CI gate ran on the deployed candidate SHA | `.github/workflows/accounting-kernel-ci.yml` | L17 receipt | 320bcbad | — | LIVE_VERIFIED: 0 workflow runs for 320bcbad / branch; main ff163552 Kernel Gate = failure | **GAP — staging runs an un-gated build; open PR to trigger** | ☐ |
| A14 | Static asset cache/CSP headers on staging | `render.yaml` | L04 receipt; `tests/frontend-security-surface.test.mjs` | 320bcbad (+ `ac298053` boot-guard no-store) | 4/4 | LIVE_VERIFIED: refs-app no-store + CSP ✅; boot-guard s-maxage=300 (fixed in candidate, not yet deployed); refs-internal-test still 98e3431 without CSP | PARTIAL | ☐ |
| A15 | OIDC / auth boundary on staging | `accounting-http.mjs` | L08 receipt | 320bcbad | posting-sod 7/7 | LIVE_VERIFIED: 401 no/malformed/tampered token, 403 unauthorised entity, 405 GET retired route; 1 h token, no refresh | EVIDENCED (logout/expiry not exercised) | ☐ |
| A16 | Staging DB network exposure | Render DB settings | L10 receipt | — | — | LIVE_VERIFIED: inbound `0.0.0.0/0` | GAP — Owner to restrict | ☐ |
| A17 | Outbox worker health | `server/runtime/start-outbox-dispatch-worker.mjs` | L02 receipt | — | S23 52/52 | LIVE_VERIFIED: Suspended since 09-02; consumer endpoint 404 | BLOCKED — consumer absent / secrets unknown | ☐ |

## B. Authority, SoD, period control

| ID | Requirement | Code | Test / Doc | SHA | Offline read-back | Live read-back | Status | Owner |
|---|---|---|---|---|---|---|---|---|
| B1 | Authenticated principal required; GUC claims not trusted; bound context token ⋈ grants ⋈ catalog | `server/runtime/kernel-repository.mjs`, migrations 274/307 | `server/tests/posting-sod-contract-postgres.test.mjs` (7/7) | `6a757d79` | 403 paths + DB zero-write read-backs (T03) | not run | EVIDENCED | ☐ |
| B2 | One workflow authority class per actor per entity; creator≠reviewer≠approver≠poster | `refs_transition_journal`, `refs_post_journal` (002/274) | `posting-sod-contract-postgres`, `server/tests/journal-lifecycle-contract-postgres.test.mjs` (8/8) | `76cc6c9d` | SoD negatives via fixture-seated created_by/reviewed_by | not run | EVIDENCED | ☐ |
| B3 | Period reopen CRITICAL, closer≠reopener, close requires readiness hash | `refs_reopen_period_v`, `refs_close_period` | `journal-lifecycle-contract-postgres` (interlock asserted; close blocked by `APPROVED_CLOSE_POLICY_UNAVAILABLE`) | `76cc6c9d` | 22023 without readiness hash; blocker codes read back | not run | PARTIAL (full close path needs approved policy + statement snapshot fixtures) | ☐ |
| B4 | Failed SSI retry leaves no unbound context; success token binding intact | `kernel-repository.mjs` `revokeOnFailure`, `accounting-server.mjs` | `server/tests/context-retry-revocation-postgres.test.mjs` | `6a757d79` | 16-way concurrency, zero cross-tenant leak (T06) | not run | EVIDENCED | ☐ |
| B5 | Base reconciliation transition still granted to `refs_app` | migration grants | T10 receipt | ff163552 | `has_function_privilege` read-back | — | GAP — revoke proposal awaiting Owner | ☐ |
| B6 | Self-service grant activation endpoint undocumented in OpenAPI | `accounting-http.mjs:359` | N33 F1, T16 M-1 | ff163552 | source audit (two sessions) | — | GAP — document or retire, Owner | ☐ |

## C. Sub-ledgers and GL

| ID | Requirement | Code | Test / Doc | SHA | Offline read-back | Live read-back | Status | Owner |
|---|---|---|---|---|---|---|---|---|
| C1 | Native AP payment / AR receipt / AR refund routes (legacy 410) with authz, period, idempotency, audit | `accounting-http.mjs` native routes; 305/311/401 | `server/tests/postgres-kernel.test.mjs` (T05 three tests) | `6a757d79` | 403 / 423 55000 / 200 idempotent / 409 / audit row | not run | EVIDENCED | ☐ |
| C2 | Native AP bill can be voided when fully open | migration `server/db/migrations/423_ap_bill_open_status_unification.sql` (patches 006/010 in place) | `server/tests/ap-bill-void-reachability-postgres.test.mjs` (end-to-end void → bill VOID, 291001 nets 0) | N-batch branch | PG16: native bill OPEN → void DRAFT → 4-role post → VOID; kernel void/reversal tests 5/5; 423 down/up clean | not run | EVIDENCED (Owner approved 2026-09-16 「统一」) | ☑ |
| C3 | Reversal status symmetric AP/AR | 423 patches 023 → reopen to OPEN (AR 016 unchanged) | same test, test 2 (reads `pg_get_functiondef`) | N-batch branch | both reducers reopen to OPEN; `postgres-kernel` :4187 updated | not run | EVIDENCED (Owner approved) | ☑ |
| C4 | AR credit memo → allocation → native refund limited to remaining posted credit; over-refund zero residue | 017/018/019/036/311/021 | `postgres-kernel.test.mjs` :4078, :4857 | `6a757d79` | 422 + 0 rows in adjustment/JE/receipt | not run | EVIDENCED | ☐ |
| C5 | Refund reversal path | — | N13 C1 | — | — | — | GAP — business decision | ☐ |
| C6 | AP/AR aging reconciles to GL control | `refs_ap_control_total` (166), `refs_ap_aging` (046), 253 snapshots | `postgres-kernel.test.mjs` :4509/:4676 | ff163552 | pass | not run | PARTIAL (2-arg vs 3-arg total mismatch T11-G9; aging not point-in-time G4) | ☐ |
| C7 | Report figure → ledger → JE → business object → WBS raw event and back | projections over `ledger_line` | `server/tests/report-ledger-reverse-trace-postgres.test.mjs` | `6a757d79` | round trip asserted (T09) | not run | EVIDENCED | ☐ |
| C8 | Optimistic locking / ETag / If-Match on key objects; 40001 classification | `isRevisionPrecondition`, `withSerializableRetry` | `server/tests/concurrency-optimistic-lock-postgres.test.mjs` (5/5) | `76cc6c9d` | 412 vs 503 split measured (64/96 messages); `bank_source.version` dead | not run | PARTIAL (N39 gaps) | ☐ |
| C9 | 291001 two-step clearing (native AP and WBS G11): member-level net zero, intermediate state, idempotent INCUR, immutable events | 048/305 (native); `server/db/migrations/152_wbs_autorec_g11_draft.sql`, `server/db/migrations/153_wbs_autorec_g11_incurred.sql` | `server/tests/postgres-kernel.test.mjs` :2130 (G11), :4676, :4509 | ff163552 | PG16 pass; 4 lines per chain read back; net 0 by member | not run | PARTIAL (N24 K1: no member-level open-clearing read surface) | ☐ |
| C10 | AR invoice → receipt (partial) → reversal; sales receipt without AR, posting re-validation, bank match evidence | 048 / 305 / 014–016; `server/db/migrations/317_native_sales_receipt.sql` … 321, 400 | `server/tests/postgres-kernel.test.mjs` :3943, :4471, :3666, :7241; `server/tests/native-sales-receipt.test.mjs` | ff163552 | PG16 3/3 pass; :7241 red (pre-existing: crosses down/401 barrier) | not run | PARTIAL (N12 G1 no AR invoice void, G2 no sales receipt reversal object, G3 test crosses barrier) | ☐ |
| C11 | Customer / Vendor master with reviewed change workflow | `server/db/migrations/326_counterparty_register.sql`, `server/db/migrations/327_counterparty_maintenance.sql` | `server/tests/postgres-kernel.test.mjs` :639, :643, :7733 | ff163552 | :639 pass; :7733 red (pre-existing barrier crossing) | not run | EVIDENCED (N11/N14) | ☐ |
| C12 | Estimate, Purchase Order, Goods Receipt, Check, bank Deposit objects | — (UI copy only) | N11 E1, N14 P1, N16 X1/X2 | — | 0 migrations / routes / tests | — | GAP — Owner scope decision | ☐ |
| C13 | Native Expense and Cash Transfer (bank control pair, evidence, drift re-validation, separated approvals) | `server/db/migrations/393_native_expense_authoritative.sql`, `server/db/migrations/375_cash_transfer_authoritative.sql` | `server/tests/postgres-kernel.test.mjs` :7464, :1287; `server/tests/native-expense.test.mjs`; `server/tests/cash-transfer-contract.test.mjs` | ff163552 | PG16 2/2 pass; contracts pass | Transfer UI disabled in staging until attachment mode REQUIRED | EVIDENCED (N16) | ☐ |
| C14 | Real-estate modules: CWIP admission/rollforward, loan register/draw, unit transfer, intercompany reconciliation + consolidation reads, rent pickup | see S13 receipt | `server/tests/postgres-kernel.test.mjs` :1764, :6094, :3473, :6105, :6120, :1309, :6638, :6706, :4561, :6738 | ff163552 | PG16 9/10; :6738 red (pre-existing 42P08) | not run | PARTIAL (S13: Unit Cost Layer, sales COGS, interest capitalisation, business Closing, PM Pickup object absent) | ☐ |

## D. WBS evidence chain

| ID | Requirement | Code | Test / Doc | SHA | Offline read-back | Live read-back | Status | Owner |
|---|---|---|---|---|---|---|---|---|
| D1 | Raw event immutable (hash, no UPDATE/DELETE) | triggers on `wbs_raw_event` | `server/tests/wbs-evidence-immutability-postgres.test.mjs` (3/3) | `76cc6c9d` | pg_trigger read-back; UPDATE/DELETE refused | not run | EVIDENCED (immutability by privilege + trigger; N30 note) | ☐ |
| D2 | Raw → Normalized → Staging → Exception → manual review → Draft trace with stable source id, mapping version, control totals | `wbs-mcp-lineage.mjs`, `wbs-mcp-inbound-*.mjs` | `server/tests/wbs-h1-discovery-catalog-synthetic.test.mjs`; T08 checklist | `6a757d79` | synthetic fixtures only | **BLOCKED — no WBS credentials; never write WBS** | PARTIAL | ☐ |
| D3 | 12-sample manual acceptance workbook (N31) | — | not started | — | — | — | open task | ☐ |
| D4 | Workbench HTML artifact carries no real aggregates without Owner approval | `outputs/wbs-h1-2026/qbo-company-workbench.html` | T18 synthetic parser test + preflight draft | `6a757d79` | synthetic pass | — | Owner policy decision | ☐ |

## E. Frontend, observability, security

| ID | Requirement | Code | Test / Doc | SHA | Offline read-back | Live read-back | Status | Owner |
|---|---|---|---|---|---|---|---|---|
| E1 | No white screen on CDN block / missing adapter / release mismatch | `index.html` async Chart.js, `src/modules-core.jsx useChart` | `tests/startup-surface-matrix.test.jsx` (7/7); `tests/boot-guard.test.mjs` (5/5, S11 closes B12); `E2E-BROWSER-MATRIX.md`; authoritative-boot-white-screen test (session 3f0a1c7e patch, 14/14, not yet on this branch) | `6a757d79` | jsdom scenarios | staging E2E **PREPARED, NOT EXECUTED** | PARTIAL | ☐ |
| E2 | Static client CSP: no inline script, SRI on remote scripts, identical headers on all static services | `render.yaml`, `index.html` | `tests/frontend-security-surface.test.mjs` (4/4) | `039c271f` | negative run on ff163552 fails 2/4 (internal-test lacked CSP) | Render headers — **Owner** curl after deploy | EVIDENCED | ☐ |
| E3 | Secrets never committed; prod deps 0 vulnerabilities | — | `frontend-security-surface` test 4; `npm audit --omit=dev` | `039c271f` | 0/0 root+server; 3 placeholder hits allow-listed | n/a | EVIDENCED | ☐ |
| E4 | Key events / metrics / alert thresholds defined as local contract | `server/runtime/observability-contract.mjs`, `server/OBSERVABILITY.md` | `server/tests/observability-contract.test.mjs` | `76cc6c9d` | catalog ⊆ emitted events; MISSING_EVENTS listed | no SaaS — contract only | EVIDENCED | ☐ |
| E5 | Route surface ⇄ kernel ⇄ OpenAPI closed | `accounting-http.mjs`, `server/api/openapi-accounting.json` | `server/tests/router-kernel-surface-contract.test.mjs` (KNOWN_UNIMPLEMENTED = final1/orphans); N33 342/357 mechanical + 15 manual | `6a757d79` | dead route pinned | — | PARTIAL (T16 G-1 no bidirectional gate) | ☐ |
| E6 | SAST | — | N37 S3 | — | — | — | Owner decision (CodeQL free) | ☐ |

## F. Integration status of this work

| Item | State |
|---|---|
| Cumulative T01–T18 patch | applies clean to ff163552 (N03 verified, session e952882a); one HIGH regression (`ai-financial-variance-policy-contract` cwd) fixed in `987c77c8` |
| Pre-existing red on ff163552 | `test:visual` (N03 F2) — not introduced by this work |
| Branch | `claude/2026-09-16-n-batch-9c9cd162` = ff163552 + `6a757d79` + `76cc6c9d` + `039c271f` + `987c77c8` (+ this matrix). pushed by Owner 2026-09-17 (remote = 320bcbad); later commits ac298053+ pending push |
| PR #582 | untouched, unmerged |
| Shared dirty tree 98dcb137 | untouched |

## G. Decisions the Owner must make (nothing else is waiting on Claude)

1. ~~C2/C3~~ — approved 2026-09-16 and implemented as migration 423.
2. B5 — revoke base reconciliation transition from `refs_app`?
3. B6/E5 — document self-service grant activation in OpenAPI, or retire it?
4. A8 — confirm `main` branch protection and Pages environment approval (screenshot or `gh api` output).
5. A9 — who defines the production Render Blueprint; until then no "production rollback" claim is valid.
6. A11/E6 — introduce build provenance attestation and CodeQL (both free)?
7. ~~A6~~ — done in S14: dispatch restricted to `main`.
8. D2/D3 — provide (via Codex) a WBS MCP tool schema or one sanitized sample response so fakes and the N31 workbook match the real contract; no secrets needed.

## H. Receipt index (S-GATE-02, generated 2026-09-17 by `tools/matrix-receipt-index.mjs`)

Every `CLAUDE-TO-CODEX-*` receipt present in the shared repo root at generation time. Classification: **VERIFIED** = the receipt contains a live read-back this session performed; **INHERITED** = offline evidence (tests/audits) referenced by matrix rows; **BLOCKED** = receipt states credentials/authorisation missing. Receipts are untracked files; regenerate with `node tools/matrix-receipt-index.mjs <repo-root>`.

| Receipt | Class |
|---|---|
| `CLAUDE-TO-CODEX-2026-08-13-ROUND-7-DECISION-REQUEST.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-08-13-ROUND-8-DECISION-REQUEST.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-08-21-DECISION-REQUEST-period-exception-read-surface.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-08-29-AI-ACCOUNTING-INDEPENDENT-AUDIT.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-08-29-AI-HUMAN-LEDGER-CLOSURE.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-08-29-CONSTRUCTION-LOAN-POPULATION-REVIEW.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-08-29-LOAN-CWIP-1A35-PATCHSET-REVIEW.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-08-29-LOAN-CWIP-POPULATION-UNIVERSE.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-08-29-PRODUCTION-CLOSURE-AUDIT.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-08-29-PROPERTY-TAX-ADVERSARIAL-CORPUS.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-08-29-PROPERTY-TAX-FAIL-CLOSED.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-08-29-PROPERTY-TAX-INDEPENDENT-REVIEW.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-08-29-REQUEST-REACHABLE-PROPERTY-TAX-CANDIDATE.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-08-30-PROPERTY-TAX-GATE-R2-VERDICT.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-01-PROPERTY-TAX-R3-CONTRACT.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-01-PROPERTY-TAX-R4-REVISION-LIFECYCLE.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-02-PRODUCTION-E2E-RUNNER-AUDIT.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-06-PRODUCTION-IAM-ADVERSARIAL-REVIEW.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-06-PRODUCTION-TOPOLOGY-HAS-NO-GRANT-PROVISIONING-PATH.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-06-R19-ACCEPT-WITH-SUMMARY-RELABEL-FINDING.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-06-SETTLEMENT-RESERVE-DOUBLE-COUNT.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-06-SETTLEMENT-RESERVE-R2-FIX-DELIVERED.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-06-TWO-DEAD-ASSERTIONS-DECISION-REQUEST.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-08-F-A-STILL-OPEN-ON-MERGED-MAIN.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-08-R48-F-A-SECOND-SERVICE-AND-EXECUTABLE-GATE.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-08-R49-AR-CONTROL-MEMBER-NAIL.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-08-R50-TRANSIENT-FAILURE-STATUS.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-08-R51-CLIENT-SIDE-TRANSIENT-CONTRACT.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-08-R52-REPORT-CLASSIFICATION-GAP.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-09-R53-DEPLOYMENT-IDENTITY-CONFIGURATION.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-09-R54-RELEASE-GATE-WIRING.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-13-TASK-PICKUP-PATH.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-14-ATTACHMENT-CONTAINER-REGISTRY-REVIEW.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-14-MIGRATION-305-STATIC-REVIEW.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-14-MOUNT-ROUTING-REVIEW.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-14-RENDER-PRODUCTION-ACCEPTANCE.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-ALL-INDEX-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N01-claude-sched-3f8ad41c.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N02-claude-sched-6c9d9cae.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N03-e952882a.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N07-happy-festive-carson.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N11-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N12-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N13-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N14-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N15-FIX-423-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N15-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N16-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N17-claude-wd-18c791fa.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N22-eloquent-practical-hypatia.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N24-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N27-claude-sched-a41c7e02.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N28-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N29-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N30-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N31-claude-sched-n31-4b7e91c2.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N33-claude-amazing-focused-darwin.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N35-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N36-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N37-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N39-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-N40-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-P0-INDEPENDENT-PG16-AND-REVERSIBILITY-f5b431ef.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-P0-KERNEL-AUTH-ARTIFACT-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-P0-MIGRATION-AND-GATES.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-P0-RELEASE-RECOVERY-AND-PG16-nice-wizardly-cray.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-P0-RELEASE-RECOVERY-AND-PG16.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S01-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S02-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S03-claude-wd-9b4cd4ea.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S04-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S05-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S06-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S07-claude-wd-514881b4.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S08-claude-wd-4f79821a.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S09-claude-wd-ddad8475.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S10-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S11-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S12-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S13-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S14-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S15-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S16-claude-wd-eabbcccd.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S17-claude-wd-2b0953dd.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S18-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S19-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S20-claude-wd-3a2e087c.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S21-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S22-claude-wd-4c219c70.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S23-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S24-claude-wd-d8d1c45e.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S25-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S26-claude-9c9cd162.md` | BLOCKED |
| `CLAUDE-TO-CODEX-2026-09-16-S27-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S28-claude-wd-cbadfd0a.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S29-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S30-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S31-claude-9c9cd162.md` | VERIFIED |
| `CLAUDE-TO-CODEX-2026-09-16-S32-claude-9c9cd162.md` | VERIFIED |
| `CLAUDE-TO-CODEX-2026-09-16-S33-claude-9c9cd162.md` | VERIFIED |
| `CLAUDE-TO-CODEX-2026-09-16-S38-claude-9c9cd162.md` | BLOCKED |
| `CLAUDE-TO-CODEX-2026-09-16-S40-claude-wd-da4c91a4.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S41-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S42-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S43-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S44-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-S45-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T01-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T02-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T03-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T04-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T05-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T06-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T07-claude-9c9cd162.md` | BLOCKED |
| `CLAUDE-TO-CODEX-2026-09-16-T07-claude-t07-06d2c0fe.md` | BLOCKED |
| `CLAUDE-TO-CODEX-2026-09-16-T08-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T09-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T10-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T11-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T12-brave-trusting-ritchie.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T12-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T13-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T14-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T14-claude-t14-3f0a1c7e.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T15-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T16-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T16-fervent-sharp-pasteur.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T17-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-16-T18-claude-9c9cd162.md` | INHERITED |
| `CLAUDE-TO-CODEX-2026-09-17-L01-claude-9c9cd162.md` | VERIFIED |
| `CLAUDE-TO-CODEX-2026-09-17-L02-claude-9c9cd162.md` | VERIFIED |
| `CLAUDE-TO-CODEX-2026-09-17-L04-claude-9c9cd162.md` | VERIFIED |
| `CLAUDE-TO-CODEX-2026-09-17-L07-claude-9c9cd162.md` | VERIFIED |
| `CLAUDE-TO-CODEX-2026-09-17-L08-claude-9c9cd162.md` | VERIFIED |
| `CLAUDE-TO-CODEX-2026-09-17-L10-claude-9c9cd162.md` | VERIFIED |
| `CLAUDE-TO-CODEX-2026-09-17-L11-claude-9c9cd162.md` | BLOCKED |
| `CLAUDE-TO-CODEX-2026-09-17-L12-claude-9c9cd162.md` | VERIFIED |
| `CLAUDE-TO-CODEX-2026-09-17-L16-claude-9c9cd162.md` | VERIFIED |
| `CLAUDE-TO-CODEX-2026-09-17-L17-claude-9c9cd162.md` | VERIFIED |
| `CLAUDE-TO-CODEX-HANDOFF-FINAL-2026-08-07.md` | INHERITED |
| `CLAUDE-TO-CODEX-RECONCILE-2026-08-06.md` | INHERITED |
| `CLAUDE-TO-CODEX-STATE-OF-THE-LINE-2026-08-07.md` | INHERITED |

Evidence directories under `outputs/` at generation time: 88.
