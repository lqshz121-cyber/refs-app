# QuickBooks Banking / Reconcile vs REFS - comparison audit

Task: TASK-TO-CLAUDE-2026-08-05-003
Branch: `claude/qb-bank-reconcile-review-20260805`
Base: `1233a13`
Scope: REFS `src/module-banktx.jsx` (Bank transactions) and `src/module-bankrec.jsx` (Reconciliation worksheet).

## 0. Method and boundary

This is a **comparison against measurements taken from the QuickBooks Online Banking
surface by the coordinating reviewer**, not an integration and not a copy. No
QuickBooks product was activated or called from this branch. No QuickBooks markup,
stylesheet, icon or font asset was copied, and no proprietary Intuit webfont is
referenced anywhere in this change. Layout values below are restatements of the
measurements supplied with the task, used as a visual target for an independent
implementation.

**REFS is not equivalent to QuickBooks.** REFS enforces controls QuickBooks does not
(segregation of duties, Draft -> Review -> Approve -> Post, immutable Posted evidence,
reversal-only correction, a strict local sign-off gate). Nothing in this document should
be read as a parity, certification or production-readiness claim.

## 1. Queue status mapping

| QuickBooks queue | Observed rendering | REFS internal state | REFS label | Notes |
| --- | --- | --- | --- | --- |
| `Pending (1,402)` | Segmented control item, count inside the label | `Review` | `Pending (n)` | REFS derives the queue from retained local evidence, not from a feed flag |
| `Posted` | Segmented control item | `Posted` | `Posted (n)` | REFS only reports `Posted` when an exact retained POSTED cash JE proves entity, cash account, direction and amount |
| `Excluded` | Segmented control item | `Excluded` | `Excluded (n)` | REFS additionally requires a retained audit rationale (`EXCLUDED_NEEDS_AUDIT_REASON`) |

Differences that matter:

- QuickBooks derives `Posted` from a bank-feed acceptance action. REFS derives it from
  `localBankTransactionEvidence(...)`, which withholds the `Posted` label unless a single,
  unambiguous, POSTED, same-entity, same-cash-account, same-direction, same-amount journal
  entry exists. An amount match alone is never enough.
- QuickBooks conflates "accepted into the books" with "reconciled". REFS keeps two
  **independent dimensions**:
  - bank review dimension: `Pending` / `Posted` / `Excluded`
  - reconciliation dimension: `matched` / `cleared` / `signed-off`
  A `Posted` bank item is not cleared, and a cleared item is not signed off. This branch
  states that independence in the UI (`BANK_QUEUE_DIMENSION_NOTE`) and asserts it in
  `verify-qb-bank-reconcile-parity.mjs`. Rows outside the three queues are reported as
  `unclassified` rather than silently folded into `Pending`.
- Any queue value arriving from a URL is re-validated; an unknown queue collapses to
  `Pending` rather than widening what a reader sees.

## 2. Detail-page field comparison

QuickBooks opens a transaction in an inline expanding row; REFS opens a **full-page**
evidence detail that replaces the workspace.

| Field | QuickBooks | REFS before this change | REFS after this change |
| --- | --- | --- | --- |
| Amount | Yes | Yes (`Direction / amount`) | Yes, plus explicit `Money in` / `Money out` |
| Payee | Yes (editable) | Not shown as a field | Yes, read-only (`Payee`), falls back to `Payee not retained` |
| Description / memo | Yes (editable) | Combined into `Bank ID / description` | Yes, standalone `Description` field |
| Status | Queue status | Evidence state only | Yes, `Queue status` plus evidence state |
| Match evidence | "Matched to ..." link | Yes (`state` + `label`) | Yes, unchanged, now grouped with the other required fields |
| Linked journal entry | Linked transaction | Yes (`Matched JE`) | Yes (`Linked journal entry`) with drill to the retained JE |
| Linked GL account | Category selector | Not shown | Yes, `Linked GL account` = mapped bank cash account code and name |
| Reconciliation status | Not surfaced on the row | Shown as `Lifecycle` | Yes, `Reconciliation status`, explicitly a separate dimension |
| Dimensions (property / project / loan) | Not present in QuickBooks | Yes | Yes, unchanged |
| Duplicate boundary / reason code | Not present in QuickBooks | Yes | Yes, unchanged |

REFS-only fields exist because REFS has to prove an accounting fact, not record a user's
choice. QuickBooks-only capabilities on this surface (category editing, split, add/confirm)
are deliberately absent - see the exclusions list in the implementation document.

## 3. Reconciliation worksheet comparison

| Aspect | QuickBooks Reconcile | REFS before | REFS after |
| --- | --- | --- | --- |
| Headline summary | Beginning balance, ending balance, cleared balance, difference | Difference shown in a `recon-diff` tile; book and bank spread across three sections | Dedicated `Book / Bank / Difference` panel at the top of the worksheet |
| Uncleared items | Implicit (unticked rows) | Counted internally, not surfaced | Explicit uncleared count, cleared count, and an uncleared-item detail table |
| Unverified matches | No equivalent | Counted in `Matched-item proof` | Surfaced in the summary as `Matched without verified proof` and folded into the unresolved count |
| Sign-off | "Finish now" enabled at difference 0 | Strict gate `localReconciliationReadiness`, sign-off control permanently unavailable in the retained-evidence workflow | Unchanged gate; the summary **restates** the precondition (difference is zero AND zero unresolved items) for the reader |
| Statement bridge | Not shown | Shown | Unchanged |
| Reopen / correction | Undo reconciliation | Request / approve / reject with retained metadata, permission gated on `CASH.RECON.SIGNOFF` | Unchanged |

The summary panel performs **no accounting**. `book`, `bank` and `difference` are the values
already computed by the existing reconciliation logic and are passed through unchanged;
the module only groups them, counts uncleared rows, and restates the blocking reasons.
The authoritative gate is still `localReconciliationReadiness`; nothing here loosens it.

## 4. Deep link and Back behaviour

| Behaviour | QuickBooks | REFS after this change |
| --- | --- | --- |
| Filter state in the URL | Partly (account and tab) | Yes: account, entity, queue, search, date range, custom from/to, transaction type, page, focused item |
| Detail presentation | Inline row expansion | Full-page detail that replaces the workspace |
| Back | Collapses the row | Restores account, entity, dates, dimensions, filters, query, selection, pagination and scroll offset |
| Deep link from another workspace | n/a | Existing JE / GL / AR / AP / Reconcile returns keep their own return context and are unchanged |

Restoration is exact: the return context carries `acctCode`, `entityId`, `queue`, `query`,
`dateRange`, `dateFrom`, `dateTo`, `type`, `page`, `bankTxnId` and `scrollY`. The existing
`localBankTransactionJournalReturnContext` contract was **not** modified (its verifier does a
deep-equality check); the additional keys are composed at the call site.

A URL can never assert an accounting fact. Every decoded value is re-validated against
retained evidence and the caller's existing permissions before anything renders; malformed,
unknown or hostile parameters fail closed to the default view.

## 5. Label audit

| Location | Before | After | Reason |
| --- | --- | --- | --- |
| Reconciliation row action (fee / interest) | `Categorization unavailable` (disabled primary button) | `Categorize` + `Unavailable here` (non-button chip) | Uses the precise QuickBooks verb; a disabled primary button looked executable |
| Reconciliation row action (unmatched) | `Review exact source` | `Open Match review` | `Review exact source` did not say which workflow it belonged to |
| Reconciliation row action (suspense) | `Hold unavailable` (disabled button) | `Exclude` + `Unavailable here` (non-button chip) | `Hold` is not a REFS or QuickBooks concept |
| Reconciliation sign-off | `Sign-off unavailable` (disabled primary button) | `Reconcile` + `Sign-off unavailable here` (non-button chip) | Uses the precise verb and stops rendering an executable-looking control |
| Reconciliation observed-QuickBooks promo | `Connect now` / `Video tutorials (7:48)` / `Get started` (disabled buttons) | Same text as non-button chips marked `Observed in QuickBooks only` | These describe an observation, not a REFS capability |
| Bank queue tabs | `Pending 3` (count in a separate pill) | `Pending (3)` (count inside the label) | Matches the observed QuickBooks segmented control |
| Bank pagination | `Page 1 of 2` | `1-25 of 40` + `Page 1 of 2` | Matches the observed QuickBooks pagination row |

Vague verbs searched for and **not found** in either owned file, before or after:
`Fix`, `Fix now`, `Apply`, `Accept`. The word "applied" appears only in two status
sentences (`Drill context applied`, `Local matched bank evidence applied`) where it
describes a completed navigation fact, not an offered action.

Terms deliberately **not** introduced: `Add`, `Confirm`, `Split`, `Connect`, `Link account`,
`Update`, `Import`, `Export`, `Auto-match`, `Auto-categorize`, `Sign off automatically`.

## 6. Visual observations acted on

- Queue control rebuilt as a segmented control: track `#E2E9ED`, radius 6, padding 2;
  item height 32, padding `0 16`, font `400 16px`, radius 5; idle `#4C555B`; selected white
  with `#21262A` text and `box-shadow: 0 1px 4px rgba(76,85,91,.2)`.
- Counts render inside the segment label with grouped thousands (`Pending (1,402)`).
- Account tile gains a count pill in the top-right corner.
- Filter row: search with a trailing magnifier glyph; account, entity, date range and
  transaction type selects; custom from/to date inputs appear only for `Custom range`.
- Pagination row leads with the `start-end of total` range.
- Hover is a background tint only. No hover lift was added anywhere in this change, and the
  verifier asserts the segmented control has no `transform` on hover.
- Elevation kept tight (`0 1px 4px rgba(76,85,91,.2)`); no new shadow scale was introduced,
  because a sibling branch owns the global token system.

## 7. Observations deliberately not acted on

`Link account`, `Update`, `Give feedback`, the tile pencil edit affordance, print / export /
column-settings icon buttons, and the account-tile carousel chevrons. Each maps to a
capability that is out of scope for this task (bank feeds and connection, export, sharing,
promotions) or to a mutation REFS does not perform on this surface.
