# QuickBooks Banking / Reconcile parity review - implementation notes

Task: TASK-TO-CLAUDE-2026-08-05-003
Branch: `claude/qb-bank-reconcile-review-20260805`
Base: `1233a13`

## 0. No QuickBooks equivalence

**REFS makes no claim of QuickBooks equivalence.** This branch is an independent
implementation informed by measurements of the QuickBooks Online Banking surface that were
supplied with the task. QuickBooks was not activated, called, integrated or contacted from
this branch. No QuickBooks markup, CSS, icon or font asset was copied, and no proprietary
Intuit webfont is referenced.

REFS is deliberately stricter than QuickBooks. It preserves segregation of duties,
Draft -> Review -> Approve -> Post, immutable Posted evidence, reversal-only correction, and
a strict local reconciliation sign-off gate. Nothing here is a certification, a parity claim,
or a production-readiness statement.

## 1. What was built

### New pure modules

| File | Purpose |
| --- | --- |
| `src/bank-workspace-url-state.js` | Encode / decode / normalise the Bank workspace deep-link scope. Presentation and navigation state only. |
| `src/bank-queue-summary.js` | Pending / Posted / Excluded segmented-control model with counts rendered inside the label, plus the queue-vs-reconciliation independence note. |
| `src/bank-action-visibility.js` | Role visibility for the bank queue verbs `Match`, `Categorize`, `Exclude`, `Undo`. Surfaces the caller's existing `can(permission)`; never defines authorization. |
| `src/bank-reconciliation-summary.js` | Book / Bank / Difference presentation model, uncleared count and uncleared detail rows, and a display-only restatement of the sign-off precondition. |

### `src/module-banktx.jsx`

- Filter row with **account**, **entity**, **date range** (`All dates`, `This month`,
  `Last 90 days`, `Custom range` with from/to date inputs), transaction type and search.
- Entity filter scopes the account tiles and the queue. When the selected account is outside
  the chosen entity, the queue lists nothing and an explicit notice explains why. REFS never
  lists cross-entity bank evidence together.
- Queue rebuilt as a segmented control with inline counts (`Pending (3)`), matching the
  observed QuickBooks control's geometry, colours and elevation.
- Account tile gains a pending-count pill.
- Pagination row leads with the `start-end of total` range.
- Full-page evidence detail gains `Payee`, `Description`, `Queue status`, `Linked GL account`
  and an explicit `Reconciliation status`, alongside the existing amount, match evidence and
  linked JE.
- Role-scoped **Workflow action availability** panel on both the queue and the detail page.
- URL scope is mirrored into the address bar and restored on load; scroll offset is restored
  on Back.

### `src/module-bankrec.jsx`

- New `Book / Bank / Difference` panel with uncleared count, cleared count, unverified-match
  count, the sign-off precondition, the blocking reasons, and an uncleared-item detail table.
- Label audit applied (see the audit document, section 5).
- Disabled buttons that looked executable replaced with non-button availability chips.

### Tests

`verify-qb-bank-reconcile-parity.mjs` (root, picked up automatically by
`tools/run-verifiers.mjs`, therefore runs under `npm run test:visual` and `npm run test`).
It unit-tests all four new modules - including hostile-input fail-closed cases and the
role matrix - and asserts the rendered contracts, the label removals, the absence of buttons
inside the availability panels, and the styling values.

## 2. Role and permission matrix

Permissions are read through the application's existing `ctx.can(permission)`. This branch
**surfaces** authorization; it does not define, widen or narrow it. `CONTROLLER` holds the
`*` wildcard in `ROLE_PERMS`, so it satisfies any code; every other enumerated role holds an
explicit allowlist. This follows the existing precedent of `GL.JE.REVERSE`, which is also
gated by a code that only the wildcard role satisfies.

| Role | `CASH.BANKTX.MATCH` | `CASH.BANKTX.CATEGORIZE` | `CASH.BANKTX.EXCLUDE` | `CASH.BANKTX.UNDO` | `CASH.RECON.SIGNOFF` | What the user sees |
| --- | --- | --- | --- | --- | --- | --- |
| `CONTROLLER` | yes (`*`) | yes (`*`) | yes (`*`) | yes (`*`) | yes (`*`) | The four verb names, each marked `Unavailable here` with the reason |
| `ACCT_MANAGER` | no | no | no | no | yes | No bank verb is rendered; an explicit read-only statement instead |
| `SENIOR_ACCT` / `TREASURY` | no | no | no | no | yes | Same as above |
| `STAFF_ACCT` / `PROJECT_ACCT` / `PROPERTY_ACCT` / `AP` / `AR` / `REVIEWER` | no | no | no | no | no | Same as above |
| `AUDITOR` / `READ_ONLY` / `SYS_ADMIN` | no | no | no | no | no | Same as above |

Two rules hold for every row:

1. **A role without the permission never sees the action name.** It is not greyed out - it
   is not rendered. Withheld verbs are still enumerated in the model (`hidden`) so an audit
   can prove what was suppressed.
2. **Nothing on this surface is executable, for any role.** REFS retains bank evidence
   read-only, so even a Controller gets a non-executable availability statement. The
   availability items are `<li aria-disabled="true">` and `<span aria-disabled="true">`
   elements with a dashed border and muted text - never `<button>`, never a disabled
   primary button that reads as "temporarily blocked". `bankActionVisibility(...).anyExecutable`
   is a hard `false` and the verifier asserts no `<Btn>` appears inside either panel.

Categorize / Match / Exclude / Undo remain the property of the controlled
Draft -> Review -> Approve -> Post journal workflow. Reconciliation sign-off remains gated by
`localReconciliationReadiness` plus `can('CASH.RECON.SIGNOFF')`, unchanged by this branch.

## 3. URL state schema

Route: the Bank transactions workspace. All parameters are optional; an omitted parameter
takes its default and a default-valued parameter is not written to the address bar.

| Query key | State field | Type / allowed values | Default |
| --- | --- | --- | --- |
| `acct` | `acctCode` | bank account code, re-validated against `bank.accounts` | `''` (current selection) |
| `entity` | `entityId` | entity id string | `''` (all entities) |
| `queue` | `queue` | `Review` \| `Posted` \| `Excluded` | `Review` |
| `q` | `query` | free text | `''` |
| `dates` | `dateRange` | `All dates` \| `This month` \| `Last 90 days` \| `Custom range` | `All dates` |
| `from` | `dateFrom` | real ISO calendar date `YYYY-MM-DD` | `''` |
| `to` | `dateTo` | real ISO calendar date `YYYY-MM-DD` | `''` |
| `type` | `type` | `All transactions` \| `Money in` \| `Money out` | `All transactions` |
| `page` | `page` | integer >= 1 | `1` |
| `txn` | `bankTxnId` | bank transaction id | `''` (list view) |

Guarantees:

- **Fail closed.** Any unknown, malformed or hostile value collapses to its default. A
  calendar-invalid date such as `2026-13-99` is discarded, not passed through.
- **No accounting in the URL.** The schema carries no amount, match decision, clearing
  state, sign-off state, posting status or authorization result. A link cannot assert a
  fact; every decoded value is re-validated against retained evidence and the caller's
  existing permissions before rendering.
- **An unknown account is ignored** rather than used to widen scope.
- **An empty query string does not overwrite in-app navigation context.**
- Parameters are removed from the address bar when the workspace unmounts.

Back-state restoration carries the same fields plus `scrollY`, so Back restores account,
entity, dates, dimensions, filters, query, selection, pagination and scroll offset. The
existing `localBankTransactionJournalReturnContext` contract was not modified; extra keys are
composed at the call site.

## 4. Explicit exclusions - not implemented, by instruction

- Split (one transaction into many account lines)
- Bank feeds, connect, disconnect, link account, import, OCR
- Auto-match, auto-categorize, auto-post
- Sign-off automation
- Payments, refunds
- Export, share, sync
- Promotions and upsell surfaces
- QuickBooks `Update` / `Link account` / `Give feedback` controls, tile pencil edit,
  print / export / column-settings icon buttons, account-tile carousel

Also unchanged, by instruction: accounting calculations, source classification, state
machines, API/OpenAPI contracts, migrations, WBS/MCP logic, and authorization behaviour.

## 5. Preserved controls

- Draft -> Review -> Approve -> Post is untouched.
- Segregation of duties is untouched.
- Posted evidence remains immutable; correction remains reversal-only.
- AI and rules never auto-post. No AI or rule surface was added or made executable.
- Sign-off still requires difference = 0 **and** zero unresolved items. The new summary
  panel restates that conjunction for the reader; it is not the gate, and it does not
  relax the gate.
- Transaction status (Pending / Posted / Excluded) and reconciliation status
  (matched / cleared / signed-off) remain independent dimensions and are never derived from
  each other.

## 6. Files changed

```
src/module-banktx.jsx              modified
src/module-bankrec.jsx             modified
src/bank-workspace-url-state.js    new
src/bank-queue-summary.js          new
src/bank-action-visibility.js      new
src/bank-reconciliation-summary.js new
verify-qb-bank-reconcile-parity.mjs new
index.html                         modified (additive CSS block only)
docs/QB-REFS-PARITY-AUDIT.md       new
docs/QB-REFS-PARITY-IMPLEMENTATION.md new
```

`index.html` was touched only by appending one CSS block immediately before `</style>`;
no existing rule, variable or selector was edited, because a sibling branch owns the global
token system. `src/ui.jsx` was not modified.

## 7. Known gaps and risks

- The availability panels report that Match / Categorize / Exclude / Undo exist and who may
  hold them, but REFS cannot execute them from this surface. That is intentional under the
  read-only evidence boundary, and it is a visible deviation from the task's literal wording
  ("Controller sees Categorize / Match / Exclude / Undo"). The Controller does see them; they
  are not offered as controls.
- `CASH.BANKTX.*` are new permission **codes**. They add no capability: `ROLE_PERMS` was not
  edited, so only the existing `*` wildcard satisfies them. If the product later wants a
  non-Controller role to see these verbs, that is a `ROLE_PERMS` decision outside this task.
- URL synchronisation is implemented inside the Bank workspace using
  `history.replaceState`, because the application has no router. It is scoped to the
  workspace lifetime and cleared on unmount. A global router would be the better long-term
  home.
- Custom date-range filtering compares ISO date strings directly. That is correct for the
  retained `YYYY-MM-DD` data but assumes that format continues to hold.
- No browser-based end-to-end verification was possible in this sandbox; the visual
  contract is asserted statically against the source and stylesheet.
