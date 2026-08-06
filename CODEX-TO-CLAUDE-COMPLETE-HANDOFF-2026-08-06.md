# REFS — Codex to Claude Complete Handoff

**Date:** 2026-08-06
**Integration owner:** Codex
**UI / scoped implementation owner:** Claude
**Status:** active integration; do not treat any local, mock, Pages-only, or static-analysis result as a production accounting release.

## 1. What the product is

REFS is a real-estate accounting system. It is **not** a recreation of QuickBooks or WBS.

- QuickBooks is a read-only product/UI reference. Retain only the controller-facing accounting review flows that fit REFS.
- WBS is an upstream business system. Do not recreate WBS modules, screens, or mutations. REFS may only consume WBS accounting-relevant data through a receipt-gated, read-only integration.
- PostgreSQL/server-side accounting workflow is the authority. Browser fixtures, seed data, mock data, and localStorage are never accounting authority.

The target architecture is:

```text
Authoritative PostgreSQL + Accounting API + OIDC
  -> one front-end shell
  -> Bank/Reconcile/AP/AR/GL/Reports review workflows

WBS read-only envelope
  -> immutable receipt/hash/replay validation
  -> Raw -> Normalized -> Staging / Exception
  -> mapping review / AutoRec review evidence
  -> standard REFS Draft -> Review -> Approve -> Post command path
  -> GL / statements / audit / source trace
```

WBS, MCP, AI Audit, and AutoRec are never permitted to create, approve, dispatch, or post a JE directly.

## 2. Current repository reality — read this before changing anything

The checked-out worktree at the time of this handoff is:

```text
C:\Users\lqshz\Documents\Codex\2026-08-01\refs-claude-codex-refs-app-wanbridge\work\refs-app
```

It is currently on `claude/ia-fix-round1` at `3d810b1`, not on `origin/main`.

The worktree is **not clean**. Existing unstaged/untracked work at handoff time:

```text
M  mtest.jsx
M  src/app.jsx
?? .refs-probe-5
?? INTEGRATION-STATUS-2026-08-06-R2.md
```

Do not reset, clean, add-all, or overwrite these files. Use a clean isolated worktree based on the frozen SHA selected for a task.

Current published remote baseline visible locally:

```text
origin/main = 19294ee
```

The historical Pages baseline described in prior handoffs may differ. Always verify the deployed SHA/stamp before making live claims.

## 3. Work already delivered or integrated locally

### 3.1 Claude UI and QuickBooks-informed review shell

The following Claude work has already been cherry-picked into one or more integration lines and should be treated as implementation input, not as a blank task:

- `d2c4c86`, `babbe47` — measured QuickBooks-inspired shell/system pass.
  - The UI system consolidates competing CSS layers and introduces one visual token system.
  - Layout direction: light 74px icon rail, second-level white panel, measured typography and hairlines, no hover-lift ornament.
  - Source reference documents: `docs/QB-DESIGN-TOKENS.md`, `docs/QB-SHELL-STRUCTURE.md`.
  - No Intuit asset/font was copied; no visual equivalence claim is allowed.
- `fb17940` — Bank/Reconcile review shell improvements.
  - Filters, deep-link state, evidence detail, reconciliation summary.
  - Categorize / Match / Exclude / Undo must remain visibly unavailable/read-only unless an authoritative command contract explicitly authorizes a mutation.
- `662cf16` — WBS MCP lineage mapping foundation.
  - Eight read-only source categories are mapped to accounting lineage; provider schemas remain partially REFS-declared and fail closed.

Relevant integration/release lines include:

```text
release/integration-claude-122f475  c72c239
integration/claude-tasks-2026-08-06 96461b0
claude/final-ui-system-pass-122f475 3366e32
claude/qb-bank-reconcile-review-20260805 fb17940
claude/wbs-mcp-lineage-review-20260805 662cf16
```

### 3.2 Runtime and authoritative-data direction

Integration branch history includes:

- `1b1c0d3` — runtime fails closed instead of silently serving demo data.
- `1ec01e0` — seed allowlist reasons checked against OpenAPI.
- `2ed53e1` — WBS fixture/contract chain to Balance Sheet and Income Statement.
- `087720c` — frontend convergence and data-boundary guard.
- `65b1350` — GAP-1 line-level journal read exposed.
- `8214b2f` — Income Statement operating-expense binding fix.

The important product direction is not “make the demo prettier.” It is to replace fixture/local authority with API/OIDC-backed, fail-closed read models.

### 3.3 WBS inbound accounting boundary

The WBS owner’s accepted boundary:

- only read-only WBS snapshots/envelopes;
- immutable signed receipt, hash, key scope, replay/nonce/version checks;
- Raw -> Normalized -> Staging or Exception;
- mapping and AutoRec candidates are evidence/review only;
- missing source/version/company/currency/date/amount/mapping or ambiguous relationships fail closed;
- no WBS business UI, WBS writes, token/cookie storage, direct Draft/Approve/Post, or inferred deletion/reversal;
- WBS bank data needs an approved cash-book-to-GL mapping and the provider’s confirmed `journal_no`/schema semantics before production AutoRec.

The upstream real provider still has unresolved external evidence gaps: signed nonempty receipt/key material, provider-confirmed schemas, revision/CDC/tombstone semantics, and production authorization. These are not implementation defects to conceal with fixtures.

## 4. Accounting non-negotiables

1. A JE reaches `POSTED` only through the PostgreSQL workflow:

   ```text
   Draft -> Review -> Approve -> Post
   ```

   with segregation of duties, idempotency, immutable posted evidence, audit, ledger, outbox, source trace, and transactional rollback.

2. No mutation trusts browser-provided actor, tenant, entity, idempotency hash, or authorization.

3. Applied migrations are never edited. Add an up migration, matching down migration, manifest checksum, and fresh upgrade/down proof.

4. All money stays fixed-point / PostgreSQL numeric / integer minor units. Never aggregate accounting balances with JavaScript floating point.

5. Details replace their workspace. Every detail page needs an explicit Back that restores entity, dates, property/project/loan/cash scope, filters, query, selection, pagination and, where applicable, scroll.

6. UI text is English-only and must not contain mojibake.

7. Do not add exports, print/download substitutes, payment rails, bank feeds/connect/import, OCR, auto-match/categorize/post, sales channels, WBS actions, or destructive controls unless the assigned task provides an approved authoritative contract.

## 5. QuickBooks-derived REFS scope

Keep these controller review flows:

- chart of accounts -> cash Register or scoped GL;
- Bills, Payments, Vendor Credits, AP Aging;
- Invoices, Receipts, AR Aging;
- Bank transaction evidence -> JE / GL / TB / Reconcile -> Back;
- Reconciliation statement/history evidence;
- Journal Entry evidence and controlled workflow history;
- core Reports: TB, GL, BS, IS/P&L, Cash Flow, AP/AR Aging, Reconciliation History;
- property/project/cash/escrow/restricted/loan/prepaid/CWIP/related-party review boundaries.

Exclude or render unavailable:

- QuickBooks payment, card, ACH, check, refund, Bill Pay, portal and promotional features;
- feeds, connectors, import, OCR, sync;
- direct Match/Categorize/Clear/Sign-off mutations without server commands;
- export, email, sharing, custom report persistence, dashboard/KPI/sales features;
- payroll, time, inventory, lending, marketplace and consumer workflows.

## 6. Known technical gaps and priority order

### P0 — make live authoritative, not a demo

1. Deploy the existing `server/` accounting API with PostgreSQL and OIDC.
2. Configure the authoritative runtime coordinates and remove any production demo fallback.
3. Prove authenticated API `200`, anonymous `401`, token refresh, tenant/entity blocking, persisted route/scope after refresh, and five-plus core pages reading API data.
4. Frontend must not use `seed.js`/localStorage as business authority in authoritative mode.

### P0 — Bank/Reconcile full authoritative loop

Implement only after/read alongside authoritative read APIs:

```text
Bank source -> exact posted AP/AR evidence -> controlled Match/Unmatch
-> reconciliation worksheet -> Clear/Unclear -> Review -> Sign-off
-> immutable history -> GL/TB/report -> Back
```

Duplicate cash rows, ambiguous candidates, cross-entity/account/currency conflicts and non-posted evidence must result in zero write.

### P1 — finish WBS accounting ingestion, not WBS product features

1. Connect provider envelope reader to receipt validation and the atomic persisted Raw/Normalized/Staging repository seam.
2. Bind read-only AutoRec candidates to persisted receipt/control/mapping rows.
3. Require provider-confirmed source schema, cursor/version/tombstone semantics and cash-book -> GL map.
4. Route eligible evidence only into a standard REFS Draft request. Never bypass human Review/Approve/Post.
5. Verify the exact WBS receipt to GL / TB / BS / IS / audit trace on PostgreSQL, not only memory fixtures.

### P1 — unified front end

- One API-backed shell, one navigation/header/scope model, one data repository.
- API-first loading/error/empty/permission states.
- Remove no-op “Observed QBO” and misleading disabled utility controls from user-facing production shell.
- Do not maintain demo/local and authoritative UI state as parallel business systems.
- Required visual evidence after any UI merge: Dashboard, Reports, BankTx, Reconcile, Expenses, Accounting, Rule Center, Integration Hub, AI Audit, and responsive widths 1440/1280/1024/768/430/360.

### P2 — real-estate reports

Cash Flow, Property/Project P&L, unit/lot profitability, CWIP/loan/prepaid rollforwards, AP/AR control reconciliations, intercompany/consolidation, comparisons and immutable report snapshots. All report amounts must be sourced from authoritative fixed-point data and preserve full drill/Back context.

## 7. Existing candidate branches — do not merge blindly

| Candidate | Scope | Integration rule |
| --- | --- | --- |
| `claude/ui-round3-qb-polish` (`35c82d7`) | Accessibility/dark mode/off-canvas UI polishing | Review on a clean worktree; screenshot at all required viewports before merge. |
| `claude/fix-is-crash-period-control` (`ff95a9b`) | Income Statement crash and period control | Review with accounting/report regression gates. |
| `claude/gap1-journal-lines` / current `65b1350` | Line-level JE read API | Treat as authoritative-read prerequisite; validate OpenAPI, tenant scope and API client. |
| `claude/phase1-runtime` (`4c1011f`) | Runtime fail-closed | Already represented in integration history; do not duplicate. |
| `claude/phase2b-api-repo` (`1dba572`) | Seed/API boundary proof | Already represented in integration history; do not duplicate. |
| `claude/wbs-mcp-lineage-review-20260805` (`662cf16`) | WBS MCP mapper | Integrate only with WBS owner’s formal validation and a clean `test:wbs-mcp-lineage` pass. |

Current `INTEGRATION-STATUS-2026-08-06-R2.md` should be read for the detailed Phase 1, Phase 2b, and WBS E2E findings. It contains mojibake in headings, so use the facts, not its encoding, and do not copy corrupted text into UI or runbooks.

## 8. Required verification before handing work back

Run the relevant focused tests first, then these gates in a clean worktree:

```powershell
npm.cmd test
npm.cmd run build
Set-Location server; npm.cmd test
Set-Location server; $env:POSTGRES_IMAGE='postgres:15-alpine'; npm.cmd run test:postgres:fresh
Set-Location server; $env:POSTGRES_IMAGE='postgres:16-alpine'; npm.cmd run test:postgres:fresh
git diff --check
```

An exit-0 PostgreSQL command that reports all tests skipped is not a pass. Record actual executed/passed/skipped counts.

For user-visible UI changes also capture browser screenshots and visible-text/console/network checks. Static analysis alone is insufficient for responsive claims.

For all inbound WBS work, never log or commit real provider data, headers, tokens, cookies, keys, certificates, or signed receipts.

## 9. Claude’s immediate task queue

Claude should take **one bounded task at a time**, on an isolated branch with a frozen base. Codex integrates and releases.

### Task A — UI visual validation and repair (highest Claude task)

Base: choose the clean integration SHA approved by Codex, not the current dirty parent worktree.

Scope:

- Validate the merged UI system in a real browser at 1440, 1280, 1024, 768, 430 and 360 widths.
- Check Dashboard, Reports, Expenses, Accounting, BankTx, Reconcile, Rule Center, Integration Hub, AI Audit and JE.
- Repair only verified layout defects: overflow, clipped controls, broken focus, contrast failure, inconsistent card/table/filter hierarchy, or English/mojibake failures.
- Preserve multi-expand navigation behavior required by the product owner: opening one subsection must not fold unrelated already-open subsections.

Exclusions: accounting calculations, server/OpenAPI, migrations, WBS lineage, data authority, new business actions.

Acceptance: screenshot matrix + visible-text scan + no console errors + zero horizontal overflow + keyboard focus path; focused UI tests and build exit 0.

### Task B — authoritative report/UI read-model audit

Scope:

- Audit which report/GL/TB/BS/IS workspace surfaces still depend on seeds or localStorage.
- Produce a precise API gap matrix (endpoint, required fields, consuming components, fail-closed UX) and, only if the endpoint already exists, wire a small read-only client path with a regression test.

Exclusions: no new backend endpoint, no report mutation/export, no fallback to fixtures when API fails.

### Task C — WBS MCP contract review only

Scope:

- Reconcile `662cf16`’s eight source schemas with the formal provider interface documents supplied by the user.
- Produce a field-by-field “provider confirmed / REFS declared / absent / fail-closed” matrix.
- Add tests only for safe envelope/schema validation gaps; do not build WBS screens or make WBS calls.

Exclusions: provider networking, real data, credentials, persistence mutations, JE command dispatch.

## 10. Completion handoff format

Every task must return exactly:

```text
SHA/base:
branch/worktree:
changed files:
scope and exclusions:
tests + exact exit codes:
browser evidence (if UI):
PostgreSQL executed/pass/skip counts (if server):
known risks / external unknowns:
PASS / PARTIAL / FAIL:
next:
```

Do not push to `main`, force-push, publish, or claim production equivalence. Codex is responsible for conflict resolution, integration, final gates, live verification and release.

## 11. External production gates — still open

The following cannot be marked complete with local simulation, CI, Pages or a static bundle:

1. real HTTPS Accounting API + configured OIDC provider, authenticated browser/API evidence and token refresh;
2. provider-backed S3/scanner lifecycle;
3. one signed, nonempty, read-only WBS provider receipt with verified key/certificate, signature, hash, scope, replay and version semantics;
4. real PostgreSQL migration/runtime data path and browser E2E with zero skipped required scenarios.

Until these are met, status remains **PARTIAL**, never production/global PASS.

## 12. Late integration audit findings (must be addressed before a release candidate)

These were independently reviewed during this handoff and override any earlier optimistic summary.

### Runtime fail-closed P0

`src/app.jsx` currently sends every runtime mode other than the exact
`REQUIRES_AUTHORITATIVE_API` value to the local mock/seed application. That includes a missing
runtime configuration, an unknown mode, or a failed config script. This is a release blocker.

Required correction:

```text
LOCAL_MOCK                   -> mock application, only when explicitly stamped
REQUIRES_AUTHORITATIVE_API   -> authoritative application
missing / unknown / invalid  -> fail-closed configuration error page
```

Add regression tests for missing mode, unknown mode, missing runtime config and missing runtime
lock. Do not solve this by silently treating a failure as a demonstration build.

### Reconciliation P1 concurrency rule

The reconciliation Start path obtains the account advisory lock before row lock, while some
transition paths obtain the reconciliation row lock first. Normalize the order to:

```text
account advisory lock -> reconciliation row lock -> state transition
```

This avoids a preventable PostgreSQL deadlock class. It is availability P1, not a reason to
weaken atomicity or locking.

### UI current state

The focused Bank Transactions/Reconciliation evidence UX repair has passed its local focused,
build, visual (39/39), SSR, English scan and diff gates. It uses independent full-page evidence
and scoped Back, fixed4/BigInt display, and no mutation controls. Re-run it only after the
current integration tree becomes clean; do not overwrite it with broad UI refactors.

### WBS current state

The WBS Payable-to-report mock chain currently reports 3 complete and 7 incomplete flows. The
Payable accrual path is review-gated and retains source, suggested/posted JE, GL/report rows and
audit trace. It is still mock-only. The root all-gates run was blocked in the shared tree by a
concurrent deletion of `src/authoritative-bank-workspace.jsx`; do not repair or restore that file
without identifying its owner and intended replacement.
