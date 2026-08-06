# Integration round 2 — Phase 1, Phase 2b, WBS end-to-end

Branch `integration/claude-tasks-2026-08-06` @ `1b1c0d3`, three commits ahead of
`origin/main` (`21a423c`). All three cherry-picks applied with **zero conflicts**.
Not pushed.

```
1b1c0d3  feat(runtime): fail closed on every path that could serve demo data   (Phase 1)
1ec01e0  gate(boundary): verify every seed allowlist reason against the API    (Phase 2b)
2ed53e1  feat(wbs): prove the WBS read to Balance Sheet chain                  (WBS E2E)
21a423c  fix(nav): panel lists one focused group                               (= origin/main)
```

---

## 1. REPO DEFECT — fix this before anything else

`node_modules` is **tracked in git** as mode `120000` (a symlink) pointing at a
sandbox-absolute POSIX path. On a Windows checkout git cannot create the symlink, so it
writes the target path into a **55-byte regular file** that points at itself.

Consequence: **a fresh clone or worktree cannot run any gate.** Every esbuild script dies
with `esbuild: not found` / `Cannot find package 'esbuild'`. All three agents independently
hit this and each worked around it locally. Worse, `git checkout` / `reset` in a worktree
destroys an installed tree.

Fix: `git rm --cached node_modules`, add `node_modules/` to `.gitignore`, commit. Nothing
should ever track it. Until then every gate result in this repo depends on a manual local
workaround, which is a poor foundation for release discipline.

## 2. Worktree hygiene — resolved, but worth knowing

`.wt/p1`, `.wt/p2b` and `.wt/wbs` were initially **not registered worktrees** — partial file
copies without `.git`, so git commands run inside them silently operated on the parent repo.
Consequence: `claude/wbs-e2e` ended up checked out in the parent `work/refs-app` itself, and
the parent's working tree showed the WBS agent's five new files as staged deletions. Anyone
running `git add -A && git commit` there would have reverted that work.

**Resolved.** The parent is now on a detached HEAD at `6b7f95e` with a clean tree. All
branches verified intact, including yours:

```
release/integration-claude-122f475   c72c239   (untouched)
backend/postgres-api                 106839e   (untouched)
```

Your in-progress work is safe in `stash@{0}` — "temporary backup before clean baseline",
which you created. I did not touch it.

---

## 3. Phase 1 — runtime fails closed

Eight demo-fallback paths existed. The old boundary was a single line:
`__REFS_RUNTIME_MODE__ !== 'LOCAL_MOCK'`. Each is now closed:

1. Adapter claims `LOCAL_MOCK` on a production host → the build stamp and the adapter must
   **both** say demonstration; `write-runtime-config.mjs` stamps both from one env in one step.
2. Demonstration build pointed at a real API → render throws if mock mode carries any
   authoritative coordinate.
3. Config script fails to load → `RUNTIME_CONFIG_MISSING`, not a fall-through.
4. Unrecognised mode string → rejected twice: a non-configurable property slot collapses any
   unenumerated value to `RUNTIME_MODE_REJECTED`, and the resolver returns
   `RUNTIME_MODE_UNRECOGNISED`. Case variants rejected.
5. Lock redefined by a later script → slot is `configurable:false`.
6. API 5xx/401/403/network at boot → distinct states, below.
7. `refreshAuthoritativeDocuments` swallowed HTTP status (a 403 reported as "refresh failed")
   → now propagates the classified failure.
8. Stale `refs-runtime-lock.js` served beside a fresh adapter → `no-store` added.

**Failure states are decided by the status line and cannot be relabelled by the response
body** (tested both directions): 401 re-auth · 403 no retry offered and the server message is
never echoed, so it cannot leak what exists · 5xx retry · unreachable (copy explicitly says the
browser cannot distinguish network/DNS/TLS/stopped-service — it does not claim "the API is
down") · protocol · 404/429/other-4xx · six OIDC codes · an explicit unclassified fallback.

New verifier `verify-runtime-fail-closed.mjs` executes 13 runtime environments and asserts
exactly one reaches demonstration data. Suite is now **43/43**.

## 4. Phase 2b — zero allowlist entries removed, and that is the honest answer

All five recorded seed-blockage reasons were re-verified by **parsing the OpenAPI contract**,
not by memory. All five hold. No page could be migrated. What did shrink: imported seed
symbols 20 → 17, because the gate now tracks symbols rather than whole files.

Two shortcuts were explicitly refused: passing `SOURCE_DOCS` through `ctx` would have deleted
an allowlist entry while changing nothing about the data source (gaming the gate); deleting
12 unreachable report renderers would have made `verify-cash-restricted-control-return.mjs:19`
match an empty string and pass vacuously (silently weakening a gate).

**API gap list — the real blocker, ordered by frontend unblocked:**

1. **GAP-1 — line-level journal read.** `GET /journal-entries` returns `ledger_line_count`
   but **no lines**: no account code, no debit/credit, no dimensions, no `source_doc_id`.
   This was on no one's record and blocks far more than Phase 2a assumed — JE editor, GL
   detail, TB/BS/IS drill, cash evidence, Account Register, Unit Cost, CWIP and inventory
   rollforwards, asset subledger.
2. GAP-2 source-document read (4 of 5 modules) · 3 PM pickup · 4 unit→owner entity ·
   5 closing statement · 6 intercompany · 7 construction-loan txns · 8 repository-seam
   resources (audit log, AI outcomes, workspace state) — these block deleting `repo.js`.

Also: `ap/aging`, `ar/aging`, `ap/control-totals`, `ar/control-totals` exist on the API with
**no client function**. Frontend work, deliberately not done blind.

## 5. WBS → GL → BS/IS — the chain runs

`npm run wbs:e2e` (or `node server/tools/wbs-e2e-harness.mjs payable|bank|costgl`).

**Payable → accrual JE reaches the Balance Sheet and Income Statement.**

```
AP-GUID-0001 → Draft WBS-AP-AP-2026-0001, 2026-07-31
  610900  Project Operating Expense      Dr 1250.5000
  220100  Accounts Payable                            Cr 1250.5000
AP-GUID-0002 → Draft WBS-AP-AP-2026-0002, 2026-07-30
  164400  Construction in Progress       Dr 84200.7500
  220100  Accounts Payable                            Cr 84200.7500
```

Balance is exact integer equality on BigInt minor units at scale 1e-4. No floating point
touches money; `parseMoney` rejects what it cannot represent exactly rather than rounding.

```
Trial Balance 2026-07   totals 85451.2500 = 85451.2500, ties exactly
Balance Sheet   ASSETS 84200.7500 · LIABILITIES 85451.2500 · EQUITY 0.0000
                CURRENT_EARNINGS -1250.5000   → assets == liabilities + equity + earnings
Income Statement  revenue 0.0000 · expenses 1250.5000 · net income -1250.5000
```

CWIP capitalisation correctly stays out of the P&L. Lineage runs back **8 hops** from the
trial-balance row to the exact WBS row bytes, and replay from zero is deterministic. SoD is
proved by refusal, not assertion: maker-approves → `JE_SOD_MAKER`; approver-posts →
`JE_SOD_APPROVER_POSTER`.

Scenario 2 (bank → reconciliation exception) reaches the exception and is **correctly
blocked** — no JE, as intended. Scenario 3 (cost GL → CWIP cutoff) reaches the evidence seam
and a cutoff finding; **a JE is impossible from that source and was not faked** —
`list_journal_entries` is `LEDGER_EVIDENCE` with `terminus: EVIDENCE_SEAM` in the frozen
catalog, so a CWIP reclass must originate from a REFS-posted journal and be corrected by
reversal.

### Two genuine findings, not stubbed over
- `journal_no` is required by `evaluateWbsAutoReconciliationEligibility` but is **absent from
  the frozen** `WBS_READONLY_ROW_FIELDS.list_bank_transactions`. Auto-reconciliation cannot
  pass until the provider exposes it or the gate changes. Left `null` rather than fabricated.
- `list_bank_transactions.bank_account_ref` (a GL account) does not join to
  `list_payables.cb_id` (a cash-book id). The harness joins on `cb_id`; production needs an
  approved cash-book ↔ GL-account map.

### Three substitutions, all labelled in code
1. **WBS transport never exercised** — no provider, credentials, network or hostname.
2. **Persistence simulated** — production is `persistWbsInboundRows` (migration 058).
   `simulatePersistedReviewedStaging` **throws** unless the caller passes
   `allowSimulatedPersistence: true`; there is no silent default.
3. **Posting and statements non-production** — runs on `JEService` + `MemoryJEDatabase` (both
   self-declare `NON_PRODUCTION_EXECUTABLE_SPEC`). The TB/BS/IS builders are an exact
   executable mirror of migration 062, but the SQL function has never been diffed against
   them on the same data.

This is **contract-plus-fixture evidence, not a production PASS.**

---

## 6. Gates on the merged tree — all exit 0

`build` · `test:ssr` (components=27 failed=0) · `test:audit` (entities=119/119 jes=2121
fails=0) · `run-verifiers.mjs` **43/43** · `verify-global-visible-english` ·
`test:wbs-mcp-lineage` 34/34 · `test:wbs-e2e` 31/31 · `test:runtime-config` · `test:oidc` ·
`test:api-client` · `test:navigation-a11y` · `test:authoritative-bank` ·
`test:authoritative-reports` · `test:wbs-accounting-foundation` ·
`test:wbs-accounting-acceptance` · `test:ap-ar` · `test:attachment-client` ·
`test:ai-draft-je-contract` · `test:ai-review-outcome-contract` · `test:workflow` ·
`test:autorecon` · `test:release-harness` · `test:release-simulation` ·
`test:release-evidence-bundle` · `git diff --check`.

The chain has **21 scripts, not 20**. It cannot run as one process here (45s tool cap), so it
was run in consecutive foreground segments covering all 21. Run it as a single command before
release.

`cd server && npm run test:postgres` → **61 tests, 0 pass, 0 fail, 61 skipped.** Docker is not
installed, so the suite self-skips. Exit 0 here means *nothing ran* — do not read it as green.

## 7. Verified on the live site (first real browser evidence)

Against `https://lqshz121-cyber.github.io/refs-app/` at build stamp `9aecf76`, and again
after `21a423c` deployed:

- rail is exactly **74px / `#F0F4F6`**, canvas `#F4F5F8` — matches the QBO measurements
- **zero horizontal overflow** at 1536px; zero out-of-viewport buttons
- navigation focus contract holds: clicking Sources → Reconcile → Settings → Operations lists
  **exactly one group each time**, always the one just clicked

**Still unverified:** narrow breakpoints. An attempt to resize to 360px did not change the
page's `innerWidth`, so that measurement was invalid and is not claimed. 1280/1024/768/430/360
still need a real check, as does dark mode, which has tokens for everything new but has never
been rendered.

## 8. What a production run still needs

Phase 1 infrastructure (owner, credentials required): provision PostgreSQL and the four
connection roles; configure the OIDC PKCE public client and the API issuer/audience/JWKS;
deploy `server/` plus the cleanup worker with storage, scanner, CORS origin and the WBS
keyring; set the ten `REFS_PUBLIC_*` coordinates on the authoritative site and **never** set
`REFS_PUBLIC_RUNTIME_MODE` there. `docs/PHASE-1-DEPLOYMENT-RUNBOOK.md` gives the exact
verification command per step and a 9-row acceptance table.

WBS production run additionally needs: a reachable MCP endpoint with its three auth headers ·
provider confirmation of the `get_meta` and `trace_by_key` schemas (still REFS-declared) ·
migration 058 applied and `persistWbsInboundRows` authorized · Docker + PostgreSQL so the real
posting kernel runs · `refs_get_financial_statements` diffed against the mirror on identical
data · `journal_no` on bank transactions · an approved cash-book ↔ GL-account map · real
approved versioned mapping snapshots · real per-tenant `account_master` · real
`accounting_period` resolution with close-state enforcement · a revision/CDC/tombstone
contract before deletion can ever be inferred.

## 9. Known gaps worth your ruling

- **No silent token renewal.** `src/oidc-client.js` holds no refresh token and does no
  `prompt=none` renewal, so expiry produces a visible re-authentication. Left alone — new
  feature work outside the phase.
- **`npm run dev` no longer shows demo data by default**, because the watch build does not run
  `write-runtime-config.mjs` and therefore emits no channel stamp, which now resolves
  authoritative. Deliberate (fail closed) but it will surprise people; a full
  `REFS_PUBLIC_RUNTIME_MODE=LOCAL_MOCK npm run build` is required for local demo work.
- **Navigation contract changed** at the owner's direction: the panel lists one focused group.
  `verify-navigation-multi-expand.mjs` was rewritten to assert the new contract; singleton
  safety, immutability and reference stability are still guarded. This intentionally reverses
  a behaviour you had marked do-not-weaken.
- **Seed data is still in the bundle.** Phase 1 makes it unreachable on an authoritative
  build; it does not delete it. That needs GAP-1 and GAP-2.

## Statement

No accounting calculation, source classification, state machine, API/OpenAPI contract,
migration, or authorization change. Read-only toward WBS throughout — no writes, no network,
no credentials, no hostnames in code. No push, no merge to `main`, no release. No claim of
QuickBooks parity or equivalence.
