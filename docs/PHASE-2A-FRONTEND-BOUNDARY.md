# Phase 2a — Frontend convergence and the data boundary gate

Branch: `claude/phase2-unify-frontend`

REFS carries two frontends. The authoritative one (`src/authoritative-*.jsx`) reads the
accounting API and has correct data but few pages. The legacy one (`src/module-*.jsx`,
`src/modules-*.jsx`) has the rich workspaces but reads `src/seed.js` and keeps business
state in `localStorage`.

**The repository swap is deliberately not in this phase.** The authoritative API and its
PostgreSQL instance are not deployed, so rewiring a page to it cannot be verified and
would be guesswork. Phase 2a does the work that is verifiable today and installs a gate
that makes the remaining rule enforceable instead of aspirational.

## Verification honesty

There is no browser in the build sandbox and `file://` is blocked from the operator's
Chrome, so **nothing in this document is backed by a screenshot**. Every claim below is
one of two kinds:

- **Test-verified** — asserted by a script listed under "Gates". Source-level facts
  (a string is gone, a component is used, a class exists in `index.html`) are proven.
  SSR markup is proven by `npm run test:ssr` rendering 27 components to static HTML.
- **Static reasoning** — how the result *looks* in a live browser. Layout, contrast,
  dark-mode rendering and focus-ring appearance were reasoned about from the token
  system in `index.html`, not observed. Treat those as unverified.

---

## 1. Removed: `Observed QBO` demonstration shells

These were decorative reproductions of QuickBooks screens — navigation strips, column-name
grids, marketing panels — carrying no REFS data. They showed controls that did nothing and
implied a parity REFS does not claim.

| File | Removed |
| --- | --- |
| `src/module-banktx.jsx` | 12-badge "Observed QuickBooks Accounting navigation" strip and its caption; the "Observed QBO supports drag/drop, device upload…" paragraph; the 9-cell "Observed column" placeholder grid in the Receipts section; the trailing "unverified in REFS" paragraph. The Receipts section itself is kept — it renders real retained local receipt evidence — and its landmark is now `aria-label="Local receipt evidence"`. |
| `src/module-bankrec.jsx` | The entire `QUICKBOOKS RECONCILE` marketing panel ("Match the books to the bank records", "Connected accounts are easier to reconcile", three benefit cards) and its `Connect now / Video tutorials (7:48) / Get started` chips. Replaced by one truthful sentence about what reconciliation actually compares. |
| `src/module-coa.jsx` | 7-badge "Observed QuickBooks Accounting navigation" strip. Filter-bar landmark renamed to `Chart of accounts filters`. Column header `QuickBooks balance` renamed to `Local balance` — it was always a locally computed balance, so the old header was a parity claim about a number REFS produced itself. |
| `src/modules-more.jsx` | A 52-line block already dead-coded behind `{false && …}`: the smart-reporting tip, Management reports shell, Custom reports list, Transaction Drilldown Report shell, KPI Scorecard, Dashboards library, Performance center and Cash flow planner promo. Also the "Observed QBO bank-rule list shell" caption, its `New rule` / `Bank rules` / `Integration rules` / `Settings` dead controls and its "Observed column" grid in `RuleCenter` — the rule *search* and the rule table are real and were kept. |

Also removed as unreachable code found during the sweep:

- `modules-more.jsx` `reportTool` panel and its `useState` — `setReportTool` was never called, so the Customize/More/Insights panel could never render.
- `modules-more.jsx` `AssetsLegacy` — an unexported, unreferenced second Fixed-assets page that carried a fake `Export` button whose only effect was a toast reading "Asset export prepared".

Dead CSS removed from `index.html`: `.bank-action-chip` (folded into the shared
`.unavailable-chip`) and `.qbo-insight-metrics` (four selector references).

**Count: 4 `Observed QBO` occurrences → 0. All `Observed QuickBooks` / `Observed column` /
`Observed in QuickBooks` / `QUICKBOOKS RECONCILE` occurrences → 0.** Enforced by rule 3 of
the boundary verifier, which has no allowlist.

---

## 2. Removed: meaningless disabled affordances

A control that can never be enabled must not render as a control. Three treatments were
applied, chosen per case:

**(a) Deleted where it carried no information.** The Chart of Accounts "Filter by limit"
`<select disabled>` whose only option was `All`. The report toolbar's `Display columns by`
select, locked to `Total`.

**(b) Converted to a non-executable statement.** A new `<Unavailable>` component in
`src/ui.jsx` renders a `<span class="unavailable-chip" aria-disabled="true">` carrying the
label and its reason. It is not focusable and is not a `<button>`, so no reader can queue
a click that will never fire. This generalises the pattern the bank workspace already used
(`bank-action-chip` / `bank-action-item`); that bank chip class was deleted and its call
sites now use `<Unavailable>`. The `bank-action-item` list on the bank workspace action-
availability panels is unchanged — it was already a non-executable `aria-disabled` list.

**(c) Kept as a real conditional action, with the reason stated.** Anything whose
`disabled` is an expression — `disabled={!can('GL.JE.CREATE')}`,
`disabled={bankEvidence?.state !== 'VALID_LOCAL_MATCH'}`, `disabled={page===0}` — is a real
action that is unavailable right now. These were not stripped. Where the reason was
missing it was added as a `title` that states the specific block (permission not held,
Draft already created, no retained open balance, exact posted evidence required).

Counts of the literal token `disabled` in `src/*.jsx`:

| File | Before | After |
| --- | ---: | ---: |
| `modules-more.jsx` | 33 | 4 |
| `module-banktx.jsx` | 17 | 13 |
| `modules-core.jsx` | 10 | 7 |
| `module-bankrec.jsx` | 10 | 6 |
| `module-ap.jsx` | 8 | 3 |
| `module-ar.jsx` | 5 | 0 |
| `module-amortization-accrual.jsx` | 4 | 4 |
| `module-register.jsx` | 3 | 3 |
| `module-coa.jsx` | 2 | 0 |
| `authoritative-bank-workspace.jsx` | 2 | 2 |
| `authoritative-workspace.jsx` | 2 | 2 |
| `authoritative-app.jsx` | 1 | 1 |
| `module-aiaudit.jsx` | 1 | 1 (a data label, "Posting disabled: Yes") |
| `module-ai-je-workbench.jsx` | 1 | 1 |
| `module-setting.jsx` | 1 | 0 |
| `module-unittransfer.jsx` | 1 | 1 |
| `ui.jsx` | 5 | 7 (the `Btn` primitive and comments) |
| **Total** | **149** | **66** |

The number that matters is not the total but this one. Counting `<button>`/`<Btn>` tags
carrying a **bare `disabled` attribute** (no expression — permanently dead):

| | Before | After |
| --- | ---: | ---: |
| Hard-disabled `<button>` / `<Btn>` tags in `src/*.jsx` | **87** | **0** |

(`modules-more.jsx` alone held 65 of them, most inside the dead `{false && …}` demo block.)
Every remaining `disabled` in the tree is `disabled={expression}` — a real action in a
temporarily unavailable state — plus the `Btn` primitive's own prop plumbing. Rule 4 of the boundary verifier keeps it that way for
Export/Print/Email/Save/Share/Download/Customize/Insights/More/Create/New labels.

`<Unavailable>` is used at 33 sites: `module-ap.jsx` (7), `module-ar.jsx` (5),
`module-bankrec.jsx` (3), `module-banktx.jsx` (4), `module-coa.jsx` (1),
`module-register.jsx` (2), `modules-core.jsx` (3), `modules-more.jsx` (8).

**Known accessibility limitation (static reasoning, not tested):** the reason on a kept
conditional control is a `title` attribute. Some screen readers do not announce `title` on
a disabled button. `<Unavailable>` does not have this problem — its reason is real text in
the accessibility tree. Moving conditional reasons to visible text is a follow-up, not
done here.

---

## 3. Unified: loading / error / empty / permission

`StateBlock` in `src/ui.jsx` is now the only renderer of the four states. It takes
`tone` (`loading` | `error` | `empty` | `permission`), a `title`, body `children`, an
optional `actions` row for real navigation, an optional `label` and an optional
`className` modifier.

| Tone | Class | Role | Live region |
| --- | --- | --- | --- |
| `loading` | `empty empty-state state-block state-loading` | `status` | `polite`, `aria-busy="true"` |
| `error` | `err-box state-block state-error` | `alert` | `assertive` |
| `empty` | `empty empty-state state-block state-empty` | `status` | `polite` |
| `permission` | `empty empty-state report-entity-required state-block state-permission` | `status` | `polite` |

Before this pass the four states were written ad hoc: `<div className="empty">`,
`<div className="empty-state">`, `<div className="empty" role="alert">`,
`<section className="empty" role="alert">`, `<div className="empty-state report-entity-required" role="status">`,
each with its own heading markup and its own choice of whether to announce at all. Error
states were frequently `role="alert"` in one file and unannounced in another; loading
states were sometimes `role="status"` and sometimes silent.

Routed through `StateBlock` in this pass: **44 call sites** across
`app.jsx` (4), `authoritative-app.jsx` (3), `authoritative-bank-workspace.jsx` (7),
`authoritative-reports-workspace.jsx` (3), `module-ai-je-workbench.jsx` (1),
`module-aiaudit.jsx` (1), `module-amortization-accrual.jsx` (2), `module-ap.jsx` (1),
`module-ar.jsx` (3), `module-bankrec.jsx` (2), `module-banktx.jsx` (6),
`modules-core.jsx` (1), `modules-more.jsx` (10) — plus 3 inside `ui.jsx` itself
(the `Table` primitive's own error / loading / empty branches).

Because the `Table` primitive now routes its own three branches through `StateBlock`,
every `empty="…"` prop on a `<Table>` in the tree (**32 more**, across 11 files) is
covered transitively without touching those call sites.

Two deliberate exceptions, both documented rather than forced:

- `authoritative-app.jsx` login card. The `OIDC_LOGIN_REQUIRED` message is a form-level
  error inside the sign-in card, not a page state, and lives in a different layout.
- `authoritative-workspace.jsx` `AuthoritativeRuntimeLock`. Same reason — a full-page
  runtime lock screen, not a state inside a workspace.

**Static reasoning, not verified:** the centered-glyph empty treatment, its dark-mode
colours and the `.unavailable-chip` dashed border were reasoned from the token system
(`--qb-border`, `--qb-text-muted`, `--qb-text-strong`, all redefined under `body.dark`).
They were not viewed in a browser. What *is* test-verified is the class names, the roles,
the live-region attributes and the fact that the CSS rules exist.

---

## 4. The boundary verifier

`verify-frontend-data-boundary.mjs` in the repo root. Root `verify-*.mjs` files are
auto-discovered by `tools/run-verifiers.mjs`, so it joined `npm run test:visual` (now
42/42) and the `npm run test` chain with no wiring.

It is static analysis over `src/`. It proves what the source says, not what a browser
renders.

### Rule 1 — `SEED_IMPORT` / `SEED_ALLOWLIST_STALE`

A module that imports `./seed.js` must be in an enumerated allowlist. `src/seed.js` is
browser-resident demonstration data with no entity, period, approval or posting authority.

The allowlist is **shrink-only**: an entry whose file no longer imports seed is a hard
failure telling you to delete the entry. That is what makes Phase 2b countable — you
cannot quietly leave a satisfied entry behind and claim the same 5 pages are still blocked.

### Rule 2 — `LOCAL_STORAGE_WRITE` / `LOCAL_STORAGE_ALLOWLIST_STALE`

Every `localStorage.setItem(...)` call site in `src/` is classified by the **exact key
expression as written in source**, normalised only for whitespace.

**How UI preference is distinguished from business state: it is not inferred.** Permitted
preference writes are enumerated in `UI_PREFERENCE_WRITES`. Anything not in that table is
business state by default, *including every dynamically built key* — `'refs_' + k` cannot
be proven to hold a preference, so it is never treated as one. The default is the point:
the gate fails closed. To add a preference you must make the key a literal and say what it
holds.

The working definition: a UI preference stores **how the reader is looking at a page**
(sort, columns, density, saved filter scope, theme, navigation). It never stores a
journal, bill, invoice, bank transaction, account, approval, period or identity — those
are accounting records and belong to the API.

Declared UI-preference writes (3, permitted indefinitely):

| Site | What it holds |
| --- | --- |
| `src/ui.jsx :: 'refs_view_'+k` | Data-grid sort column, sort direction, text filter, row density for one table. |
| `src/module-ap.jsx :: 'refs_expense_columns'` | Expense table column visibility. |
| `src/modules-more.jsx :: 'refs_local_report_scopes'` | Saved report scope labels — the entity/period/dimension the reader last chose. A filter selection, not a report result. |

Legacy business-state writes (3, shrink-only) — see the allowlist table below.

### Rule 3 — `DEMO_SHELL`

No allowlist. Fails on `Observed QBO`, `Observed QuickBooks`, `Observed in QuickBooks`,
`Observed column`, `Observed KPI row`, `Observed access/status text`, the observed
report/dashboard list-shell captions, and `QUICKBOOKS RECONCILE`. The failure message says
to delete the block and explicitly says **not** to replace it with a disabled control.

### Rule 4 — `DEAD_CONTROL`

Fails on a `<button>` or `<Btn>` with a bare `disabled` attribute (not `disabled={…}`)
whose visible label starts with Export, Print, Email, Share, Download, Save, Save As,
Customize, Insights, More, Create or New. The message points at `<Unavailable>` and
explicitly permits the alternative: if the control *can* become available, write
`disabled={expression}` plus a `title` saying why it is unavailable now.

This rule caught one control the manual sweep had missed —
`modules-core.jsx` journal-entry action bar `Print` — which is the argument for having it.

### Current allowlist

| Module | Why it is still on seed data |
| --- | --- |
| `src/app.jsx` | Legacy demo shell. Seeds the whole `LOCAL_MOCK` store — journals, exceptions, close tasks, bank transactions, FY2026 opening balances — that every legacy workspace reads. Last entry to remove: it goes when `app.jsx` stops mounting the `LOCAL_MOCK` tree and `authoritative-app.jsx` is the only root. |
| `src/module-sourcedocs.jsx` | Source Documents page renders `SOURCE_DOCS`. No source-document read exists on the accounting API, so the page has nothing authoritative to bind to. |
| `src/module-unitcost.jsx` | Unit Cost Ledger renders `SOURCE_DOCS` as its cost source. Blocked on the same missing read. |
| `src/modules-core.jsx` | Property Ops Pickup and Closing Accounting read `PM_ROWS`, `CLOSINGS`, `LOAN_TXNS`, `IC_TXNS`, `UNIT_OWNERS`, `SOURCE_DOCS`. No property-management, closing or ownership endpoint is in the OpenAPI contract. |
| `src/modules-more.jsx` | Loan Register, Intercompany, Project Cost and Integration Hub read `LOAN_TXNS`, `IC_TXNS`, `CLOSINGS`, `PM_ROWS`, `SOURCE_DOCS`. Same missing endpoints. |

| localStorage business write | Why it is still there |
| --- | --- |
| `src/app.jsx :: 'refs_seedv'` | `LOCAL_MOCK` seed version stamp; exists only to invalidate the legacy store when `seed.js` changes. Removed with the store. |
| `src/app.jsx :: 'refs_'+k` | Legacy persistence for the whole `LOCAL_MOCK` store: journals, exceptions, close tasks, AP, bank, chart of accounts, AR and the selected demo user. Business state in the browser, and the single largest item Phase 2b removes. |
| `src/repo.js :: NS+k` | Legacy repository used by the `LOCAL_MOCK` store, including its audit log. Deleted with `src/repo.js` when the last legacy workspace stops calling `repo.save()`. |

---

## 5. What remains for Phase 2b

Ordered so that each step can be proven by deleting one allowlist entry:

1. **Deploy the accounting API and PostgreSQL.** Everything below is blocked on this. No
   page rewiring can be verified until a real response can be read.
2. **Specify the missing reads.** Source documents, property-management pickup, closing,
   intercompany, unit ownership and loan-register endpoints are not in the OpenAPI
   contract. Until they exist, four of the five allowlist entries cannot move.
3. **Move `module-sourcedocs.jsx` and `module-unitcost.jsx`** onto the source-document
   read. Two allowlist entries deleted; the gate proves it.
4. **Move `modules-core.jsx` and `modules-more.jsx`** page by page onto the remaining
   reads. These are the largest files and should be split as they migrate.
5. **Delete the `LOCAL_MOCK` branch in `app.jsx`.** This removes the last seed import and
   all three legacy `localStorage` business writes at once, and deletes `src/repo.js`.
   The seed allowlist and the business-state allowlist both reach zero.
6. **Delete `src/seed.js`.** At that point rule 1 has no allowlist and rule 2 permits only
   the three declared UI-preference writes.
7. **Merge the two roots.** `authoritative-app.jsx` becomes the only frontend and the
   `src/authoritative-*` / `src/module-*` split disappears.

Not attempted in Phase 2a and not planned as part of it: moving the conditional-disable
reasons out of `title` into visible text (see the accessibility limitation above), and any
visual verification, which needs a browser this sandbox does not have.

---

## Gates

All run from the worktree root. Every one exits 0 on this branch.

```
npm run test:ssr                 components=27 failed=0
npm run test:audit               entities=119/119 jes=2121 fails=0
npm run test:visual              Verifier summary: 42/42 passed
npm run build                    dist/bundle.js written, runtime assets verified
node verify-global-visible-english.mjs
npm run test:wbs-mcp-lineage     34/34
npm run test:navigation-a11y
git diff --check
```

Three existing gates were updated, each in the same direction as this phase rather than
weakened:

- `verify-je-controlled-workflow.mjs` pinned `Make recurring</Btn>` as a disabled control.
  It now requires `Make recurring</Unavailable>`, **additionally** asserts the label does
  not render as a `<Btn>`/`<button>`, and still requires the reason text. Strictly
  stronger.
- `tests/authoritative-bank-workspace.test.jsx` matched `role="status"` literally in the
  workspace source. The role now lives in the shared `StateBlock`, so the test asserts the
  workspace uses `<StateBlock tone="loading">` **and** that `src/ui.jsx` emits
  `role={… 'alert' : 'status'}` with `aria-busy`. Two assertions where there was one.
- `verify-qb-bank-reconcile-parity.mjs` pinned the exact `.bank-action-item,.bank-action-chip`
  CSS rule text. `.bank-action-chip` no longer exists; the assertion now pins the
  `.bank-action-item` rule, which is still in use.
- `tools/verify-table-empty-state.mjs` (orphaned — not called by any npm script) pinned the
  literal `className="empty empty-state"` in `ui.jsx`. It now checks the `STATE_CLASS` map
  and the role/live-region expression instead.
