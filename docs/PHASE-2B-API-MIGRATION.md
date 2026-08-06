# Phase 2b — Moving business workspaces onto the API repository

Branch: `claude/phase2b-api-repo`

## Headline, stated plainly

**No page was migrated and no seed allowlist entry was removed.** Phase 2b set out to
move the legacy workspaces off `src/seed.js` and onto `src/accounting-api.js`, and to
shrink the Phase 2a allowlist from five modules to fewer. After checking every one of the
five recorded reasons against `server/api/openapi-accounting.json`, all five are correct:
the reads those pages need do not exist on the contract. Two of the five reasons were also
found to be *overstated* — they named seed exports the module imported but never used —
and those have been corrected.

What Phase 2b actually delivers is therefore smaller than intended and different in kind:

1. Every allowlist reason is now verified against the contract and names the exact
   missing endpoint or the exact missing response field, rather than a category.
2. Three unused seed imports were deleted, which is a real (if small) reduction of the
   seed surface and makes two allowlist reasons truthful.
3. The gate got stricter: the seed allowlist is now countable at **symbol** granularity,
   not just file granularity, so a page shedding four of five seed dependencies is now
   visible instead of invisible.
4. A precise API gap list for the backend owner, below. It contains one gap that was not
   previously recorded anywhere and that blocks far more than the four pages the Phase 2a
   note attributed to it.

## Verification honesty

This sandbox has **no browser** (`file://` is blocked, no screenshots) and **no deployed
accounting API** (no request can be executed). Every claim in this document is one of:

- **Test-verified** — asserted by a script under "Gate results". Source-level facts and
  the shape of the OpenAPI document are proven.
- **Contract-verified** — read directly out of `server/api/openapi-accounting.json` by
  parsing the JSON, not from memory or from the Phase 2a note. Statements of the form
  "there is no endpoint X" mean: the document declares 35 paths, 12 of which have a `get`,
  and none of them is X. It does **not** mean the backend cannot grow one.
- **Static reasoning** — reachability of a code path, or what a rewired page *would* do.
  Explicitly labelled where used, and never load-bearing for a migration decision.

Nothing here is verified against a running API or a rendered browser page.

## 1. What the authoritative API actually offers

`server/api/openapi-accounting.json` (title `REFS Accounting Command API`, version `1.0.0`)
declares **35 paths**. It is overwhelmingly a command surface. There are exactly **12 GET
reads**:

| Read | Client function in `src/accounting-api.js` |
| --- | --- |
| `GET /entities/{entityId}/journal-entries` | `refreshAuthoritativeJournalEntries` |
| `GET /entities/{entityId}/ap/bills` | `refreshAuthoritativeDocuments` |
| `GET /entities/{entityId}/ar/invoices` | `refreshAuthoritativeDocuments` |
| `GET /entities/{entityId}/ap/adjustments` | `refreshAuthoritativeDocuments` |
| `GET /entities/{entityId}/ar/adjustments` | `refreshAuthoritativeDocuments` |
| `GET /entities/{entityId}/ap/aging` | *none* |
| `GET /entities/{entityId}/ar/aging` | *none* |
| `GET /entities/{entityId}/ap/control-totals` | *none* |
| `GET /entities/{entityId}/ar/control-totals` | *none* |
| `GET /entities/{entityId}/bank/transactions` | `refreshAuthoritativeBankTransactions` |
| `GET /entities/{entityId}/bank/reconciliation` | `refreshAuthoritativeReconciliation` |
| `GET /entities/{entityId}/reports/financial-statements` | `refreshAuthoritativeFinancialStatements` |

Four reads (`ap/aging`, `ar/aging`, `ap/control-totals`, `ar/control-totals`) have **no
client function at all**. Writing one is possible, but nothing in this repository could
prove the wiring correct without a live response, so none was written.

### The gap that was not on record

`GET /entities/{entityId}/journal-entries` returns `JournalEntryReadRow`, whose complete
property set is:

```
journal_entry_id, journal_number, journal_type, status, journal_date,
currency, description, revision, created_at, posted_at, ledger_line_count
```

It returns a line **count**. It does not return the lines. There is no `account_code`, no
`debit_amount` / `credit_amount`, no `member`, no `property_id` / `project_id` /
`loan_id` / `unit_code` dimension, and no `source_doc_id`.

This matters far beyond the four pages the Phase 2a note flagged. Every legacy workspace
in `src/` computes from `ctx.jes[].lines[]`: the trial balance, balance sheet, income
statement, cash-movement evidence, GL detail, the account register, unit cost, CWIP and
inventory rollforwards, the asset subledger, and the journal-entry editor itself. None of
them can be rebuilt on the journal read as specified. The `financial-statements` read
covers the statement totals, but not line-level drill, dimensions or the register.

## 2. Per-entry verdict

### Seed allowlist — `SEED_ALLOWLIST`

| Module | Recorded reason | Verdict | Exact blocker |
| --- | --- | --- | --- |
| `src/app.jsx` | Legacy `LOCAL_MOCK` root; last to go | **Correct, and out of scope for this phase** (owned by another agent) | Additionally blocked by the line-level journal read gap above |
| `src/module-sourcedocs.jsx` | No source-document read | **Correct** | No `GET .../source-documents`; no attachment read either — `POST /attachments/reservations` and `POST /attachments/{attachmentId}/finalize` are the only attachment paths and both are writes |
| `src/module-unitcost.jsx` | Blocked on the same source-document read | **Correct, and understated** | Blocked twice: the source-document read, *and* the line-level journal read — unit cost is accumulated from `unit_code` and `account_code` on ledger lines |
| `src/modules-core.jsx` | Reads `PM_ROWS, CLOSINGS, LOAN_TXNS, IC_TXNS, UNIT_OWNERS, SOURCE_DOCS` | **Correct on the blockage, wrong on the inventory** | `LOAN_TXNS` and `IC_TXNS` were imported and never used. Removed. Real blockers: no property-management pickup read, no unit-ownership read, no closing-statement read, no source-document read |
| `src/modules-more.jsx` | Reads `LOAN_TXNS, IC_TXNS, CLOSINGS, PM_ROWS, SOURCE_DOCS` | **Correct on the blockage, wrong on the inventory** | `CLOSINGS` was imported and never used. Removed. Real blockers: no intercompany read (live, `Intercompany` page), no source-document read (live, GL source trace) |

### localStorage business writes — `BUSINESS_STATE_ALLOWLIST`

| Site | Verdict | Exact blocker |
| --- | --- | --- |
| `src/app.jsx :: 'refs_seedv'` | **Correct** | Version stamp for the `LOCAL_MOCK` store; goes with the store |
| `src/app.jsx :: 'refs_'+k` | **Correct** | The store itself; blocked on the line-level journal read. `app.jsx` is owned by another agent this phase |
| `src/repo.js :: NS+k` | **Correct, and understated** | Nine callers, not one: `repo.js` audit log, `ai.js` `ai_log`, `module-staging.jsx` `staging`, `module-aiaudit.jsx` `audit_resolved`, `module-ai-je-workbench.jsx` `ai_je_workbench_state`, `module-amortization-accrual.jsx` `amortization_center_state` and `accrual_center_state`, `modules-core.jsx` `construction_loan_workspace_state`, `settings.js` `setting_<entity>`. The API has no audit-log resource, no AI-review-outcome store and no workspace-state resource |

## 3. Allowlist before and after

Rule 1 (seed imports), file granularity — **unchanged at 5**:

| | Before | After |
| --- | ---: | ---: |
| Allowlisted modules | 5 | 5 |

Rule 1, **new** symbol granularity:

| Module | Declared seed exports before | After |
| --- | ---: | ---: |
| `src/app.jsx` | (not tracked) | 7 |
| `src/module-sourcedocs.jsx` | (not tracked) | 1 |
| `src/module-unitcost.jsx` | (not tracked) | 1 |
| `src/modules-core.jsx` | 6 imported | **4** |
| `src/modules-more.jsx` | 5 imported | **4** |
| **Total imported seed exports** | **20** | **17** |

Rule 2 (localStorage business writes) — **unchanged at 3**. Declared UI-preference writes
— unchanged at 3. Rules 3 and 4 — unchanged, still no allowlist, still 0 violations.

The gate now prints `Seed-data allowlist 5 module(s) / 17 declared seed export(s)`.

## 4. Changes to the gate (strictly stronger, never looser)

`verify-frontend-data-boundary.mjs`:

- `SEED_ALLOWLIST` values changed from a bare reason string to `{ symbols, reason }`.
  No entry was added and no entry was removed.
- **New failure `SEED_SYMBOL_NEW`** — an allowlisted module that imports a seed export its
  entry does not declare fails. A page already on the list may keep the dependencies it
  had; it may not take a new one.
- **New failure `SEED_SYMBOL_STALE`** — a declared symbol the module no longer imports
  fails, mirroring `SEED_ALLOWLIST_STALE` one level down. The symbol list only shrinks.
- **New failure `SEED_IMPORT_FORM`** — an allowlisted module must use an explicit named
  import (`import { A, B } from './seed.js'`). A namespace or side-effect seed import
  cannot be counted, so it is rejected.
- All eight reasons rewritten to name the exact missing endpoint or missing response field.

All three new failures were negative-tested: injecting an undeclared symbol, deleting a
declared symbol, and converting the import to `import * as` each produce exactly one
failure and exit 1.

## 5. API gap list for the backend owner

Ordered by how much of the frontend each one unblocks.

**GAP-1 — Line-level journal read. Blocks the most.**
`GET /entities/{entityId}/journal-entries` returns headers only. Needed: the ledger lines
for a journal entry, with at minimum `account_code`, `debit_amount`, `credit_amount`,
`description`, `member`, the dimension set (`property_id`, `project_id`, `loan_id`,
`unit_code`) and `source_document_id`. Either as a `lines` array on `JournalEntryReadRow`
or as `GET /entities/{entityId}/journal-entries/{journalEntryId}/lines`.
Unblocks: Journal Entry editor, GL Detail, Trial Balance drill, Balance Sheet drill,
Income Statement drill, cash-movement evidence, Account Register, Unit Cost Ledger, CWIP
and Inventory rollforwards, asset subledger.

**GAP-2 — Source-document read.**
No path resolves a source document. `source_document_id` is exposed as an opaque UUID on
`BankTransactionReadRow`, and `source_document_ids` as a UUID array on
`FinancialStatementReadRow`, but nothing turns either into a document. Needed:
`GET /entities/{entityId}/source-documents` (list) and
`GET /entities/{entityId}/source-documents/{sourceDocumentId}`, returning at least
`document_number`, `document_type`, `source_system`, `counterparty` (vendor / buyer /
title company), `unit`, `po_number`, `contract`, `cost_code`, `document_date`, `amount`,
and the linked `journal_entry_id`s. An attachment read
(`GET /entities/{entityId}/attachments/{attachmentId}`) is a separate missing piece — the
only attachment paths today are the reservation and finalize writes.
Unblocks: `module-sourcedocs.jsx` entirely; the source panels in `module-unitcost.jsx`,
`modules-core.jsx` (JE editor) and `modules-more.jsx` (GL source trace).

**GAP-3 — Property-management pickup read.**
No path. Needed: a read returning the charge rows the Property Operations Pickup page
works from — `external_id`, `property_code`, `unit`, `charge_code`, `posting_month`,
`amount`, `cash_accrual`, and the retained mapping/deduplication status.
Unblocks: `PMPickup` in `modules-core.jsx`.

**GAP-4 — Unit-to-owner-entity read.**
No path. Needed: the unit-to-owning-entity relationship (`unit` to `entity_id` /
`entity_name`) that PM pickup uses to route each charge to the correct owner ledger.
Unblocks: `PMPickup` in `modules-core.jsx` (together with GAP-3).

**GAP-5 — Closing-statement read.**
No path. Needed: closing header (`closing_code`, `closing_type`, `property_code`,
`closing_date`, `cash_to_close`, `loan_payoff`, balance-check status) and its worksheet
lines (`label`, `account_code`, `debit`, `credit`).
Unblocks: `ClosingWorkspace` in `modules-core.jsx`.

**GAP-6 — Intercompany due-to/from read.**
No path. Needed: IC pair rows (`ic_pair_id`, `ic_type`, `initiator_entity`,
`counterparty_entity`, `amount`, `match_status`).
Unblocks: `Intercompany` in `modules-more.jsx`.

**GAP-7 — Construction-loan transaction read.**
No path. Needed: loan draw / repayment / interest transactions
(`loan_id`, `txn_type`, `transaction_date`, `amount`, `funded_flag`,
`construction_status`, generated journal reference, reconciliation status).
Currently only reached by report renderers the Reports Center cannot open (see section 6),
so this is the lowest-priority gap of the seven.

**GAP-8 — Repository seam resources (blocks `src/repo.js`, not a page).**
Needed before `repo.save()` can be deleted: an audit-log resource (read and append), a
store for AI review outcomes and resolved findings, and a per-user or per-entity
workspace-state resource for the amortization, accrual, staging, AI JE workbench and
construction-loan review pages. Alternatively, a decision that this state is a UI
preference — but it is not: it records which findings already produced a Draft JE, which
is duplicate-prevention state.

**Client-side gap, not a backend gap.** Four existing reads have no client function:
`ap/aging`, `ar/aging`, `ap/control-totals`, `ar/control-totals`. Adding them is
frontend work, but it should be done against a running API so the envelope validation can
be exercised, not written blind.

## 6. What was deliberately not done

**The gate was not gamed.** `module-unitcost.jsx` touches seed in exactly one place — it
resolves a journal's `source_doc_id` to a document number in a drill-down column. Passing
`SOURCE_DOCS` in through `ctx` from `app.jsx` would delete one allowlist entry and change
nothing about where the data comes from, because `app.jsx` is already allowlisted. That
would report progress that did not happen. It was not done, and the same reasoning applies
to `modules-core.jsx` and `modules-more.jsx`.

**The unreachable report renderers in `modules-more.jsx` were left alone.** `REPORTS[open]()`
runs only when `previewMeta` is found, `previewMeta` comes from `reportRows`, and
`reportRows` is filtered by `RETAINED_REPORT_NAMES`. Of the thirteen keys in `REPORTS`,
only `Cash & Restricted Cash Control` is in that set, so twelve renderers — including the
three that read `LOAN_TXNS` and `PM_ROWS` — cannot currently be opened. That reachability
argument is *static reasoning*, and deleting them has a concrete cost:
`verify-cash-restricted-control-return.mjs:19` pins the literal
`'Construction Loan Rollforward'` as a section delimiter in a lookahead, so removing that
key would make the assertion match an empty string and pass vacuously — a gate silently
weakened. Removing the dead renderers *and* rewriting that verifier is follow-up work.

**`src/app.jsx` was not touched.** It is owned by another agent this phase. One finding
for that owner: it imports `BANK_TXNS` from `seed.js` and never uses it. Dropping it from
the import and from the `symbols` list in the gate is a free one-symbol shrink.

**No new client functions were written** for `ap/aging`, `ar/aging` or the control totals.
Correct wiring is provable from the schema only up to the envelope shape; the existing
client functions all validate response rows field by field, and writing that validation
against a contract nobody has executed would be guesswork of exactly the kind this phase
was told to avoid.

## 7. Changed files

| File | Change |
| --- | --- |
| `src/modules-core.jsx` | Import line only: dropped the unused `LOAN_TXNS` and `IC_TXNS` seed imports |
| `src/modules-more.jsx` | Import line only: dropped the unused `CLOSINGS` seed import |
| `verify-frontend-data-boundary.mjs` | Symbol-level seed allowlist; three new failure modes; all eight reasons rewritten with exact missing endpoints |
| `docs/PHASE-2B-API-MIGRATION.md` | This document |

No component, no calculation, no state machine, no permission check, no API contract, no
migration and no visible copy was changed. `StateBlock`, the Draft to Review to Approve to
Post workflow, segregation of duties, the `Cash movement evidence` label and its "not a
complete statement of cash flows" disclaimer, and the single-focused-group navigation
panel are all untouched.

## 8. Gate results

All run in the worktree at `.wt/p2b`. Every one exits 0.

| Gate | Exit |
| --- | ---: |
| `npm run test:ssr` — `components=27 failed=0` | 0 |
| `npm run test:audit` — `entities=119/119 jes=2121 fails=0` | 0 |
| `npm run build` | 0 |
| `node tools/run-verifiers.mjs` — `Verifier summary: 42/42 passed` | 0 |
| `node verify-global-visible-english.mjs` | 0 |
| `npm run test:api-client` | 0 |
| `npm run test:navigation-a11y` | 0 |
| `git diff --check` | 0 |

Full `npm run test` chain, run as consecutive foreground segments (the sandbox kills any
process outliving a 45s tool call). All 21 scripts, all exit 0:

```
test:ssr  test:authoritative-bank  test:authoritative-reports
test:wbs-accounting-foundation  test:wbs-accounting-acceptance  test:wbs-mcp-lineage
test:ap-ar  test:api-client  test:attachment-client  test:oidc  test:runtime-config
test:ai-draft-je-contract  test:ai-review-outcome-contract  test:navigation-a11y
test:workflow  test:autorecon  test:audit  test:visual  test:release-harness
test:release-simulation  test:release-evidence-bundle
```

**Environment note.** The committed `node_modules` entry in this repository is a symlink
whose target is itself, so a fresh checkout of any worktree has no working dependency
tree and every `esbuild`-backed script fails with `esbuild: not found`. For this run the
worktree's `node_modules` was temporarily pointed at an installed tree and then restored,
so the results above are from the worktree itself and not from a copy. The self-referential
`node_modules` symlink being tracked in git is a separate defect worth fixing: any
`git checkout` or `git reset` in a worktree destroys an installed dependency tree.

## 9. What Phase 2c needs

Unchanged from the Phase 2a plan, but now with the blocking order corrected:

1. **Deploy the accounting API and PostgreSQL.** Still the precondition for everything.
2. **Close GAP-1 first.** A line-level journal read unblocks more frontend than the other
   six gaps combined, and none of the ledger, register or cost pages can move without it.
3. **Close GAP-2.** Four of the five allowlisted modules touch source documents.
4. Then GAP-3 to GAP-7, page by page, deleting a symbol from the gate's `symbols` list
   each time and an entry when a module reaches zero.
5. Close GAP-8, then delete `src/repo.js`.
6. Delete the `LOCAL_MOCK` branch in `app.jsx`, then `src/seed.js`, then merge the roots.
