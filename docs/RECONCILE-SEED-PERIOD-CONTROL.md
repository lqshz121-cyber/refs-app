# Reconciling ff95a9b (fail-closed period control) with 4615407 (regenerated ledger)

Branch `integration/claude-tasks-2026-08-06`, on top of `2b0be3e`.

Two individually-correct fixes were cherry-picked onto one line:

- `ff95a9b` made period control fail closed and added SSR coverage that renders
  all five GL report tabs for entities that actually carry POSTED journals.
- `4615407` corrected the demo ledger's accounting and regenerated `src/seed.js`
  (`SEED_V` v9 -> v10, journals 2121 -> 3656, opening balances dated 2025-12).

After the merge `npm run test:ssr` reported `components=27 failed=6`.

Every number in this document is measured against the merged tree, not quoted
from either commit message. Claims that are reasoning rather than measurement
are marked **reasoning**. There is no browser in this environment and `file://`
is blocked, so nothing here rests on a screenshot; UI claims are made against
server-rendered markup produced by `renderToStaticMarkup`.

---

## 1. Why closed-period postings went from 2 to 26

`src/data.js` `PERIODS` is a three-row fixture and neither commit touched it:

```
{entity_id:2, period_code:'2026-06', status:'CLOSED'}
{entity_id:2, period_code:'2026-07', status:'OPEN'}
{entity_id:4, period_code:'2026-07', status:'OPEN'}
```

Exactly one entity/period pair in the whole master is CLOSED, so every
closed-period exception is by construction an entity 2 / 2026-06 journal.

Measured, entity 2 / 2026-06 holds 26 POSTED journals, $184,924 of debits:

| rule_code / source | count | what it is |
|---|---|---|
| `R-AP-STD-01` / PAYABLE | 1 | 06/2026 Land development cost (164100 / 220300) |
| `R-IC-ADV-02` / AUTOC | 1 | 06/2026 Contractor paid by affiliate (220300 / 291000) |
| `R-IC-SVC-01` / INTERNAL | 12 | 06/2026 Outsourcing service income (125000 / 490600) |
| `R-IC-SVC-02` / EXPA | 12 | 06/2026 ACH receipt (111000 / 125000) |

The first two are the pair `ff95a9b` reported as `20260612006437` /
`20260622006438`. They are the same two journals; `4615407` renumbered them to
`20260612007282` / `20260622007283`, because `je_number` is derived from the
generator's running counter and the counter now runs further.

The 24 new ones were created by one change in `4615407`. In `src/seed.js` the
ServiceCo/Corporate/Holding/TitleCo/OpCo branch of the monthly loop used to emit
only the debtor's side of the outsourcing service relationship. It now emits
both sides from one amount:

```js
push(e,          mm,'05','PAYABLE', ...);   // 705002 / 291001  - already existed
push(SERVICE_HUB_ID, mm,'05','INTERNAL',...);  // 125000 / 490600  - NEW
push(e,          mm,'18','EXPA',    ...);   // 291001 / 111000  - already existed
push(SERVICE_HUB_ID, mm,'18','EXPA',...);   // 111000 / 125000  - NEW
```

`SERVICE_HUB_ID = 2`, twelve counterparty entities take that branch, and the
loop runs for m = 1..7. Entity 2 therefore gained 24 journals in every month of
2026-01..2026-07. Only 2026-06 is CLOSED, so only that month's 24 surface as
closed-period exceptions. Entity 2's journal count per period is now
`{2025-12: 2, 2026-01..2026-06: 26 each, 2026-07: 40}`.

### Is that a defect in the seed fix?

**No, and it must not be "fixed" by moving anything.** Evidence:

1. **None of the new opening, CWIP-transfer or year-end-close journals lands in
   a CLOSED period.** The opening trial balance and the FY2025 close are dated
   `2025-12-31` with `period_code 2025-12`, which the period master does not
   mention at all, so they resolve to `JE_PERIOD_NOT_CONFIGURED`, not `4005`.
   Measured: entity 2 / 2026-06 contains zero `CLOSING` and zero `OPENING`
   journals; the completion transfer (`R-INV-XFER-01`) and the closing/COGS
   entries only exist on Vertical/ProjectCo entities, and entity 2 is a LandCo.
   The specific failure mode the review was worried about did not occur.
2. **Each of the 24 is one half of a mirrored intercompany pair whose other half
   is in the same period.** Measured: 24 of 24 have a counterparty leg on the
   debtor entity in 2026-06. Re-dating entity 2's leg into 2026-07 would leave
   the June pair one-sided; `tools/analysis/ic-elimination.js` check [5] would
   drop from 820 of 820 mirrored per period, and the group would carry a
   $-to-$ intercompany residual in June. The correct accounting is exactly what
   the seed does: one amount, one period, two entities.
3. **Posted evidence is immutable.** Re-dating or deleting posted journals to
   make an exception count fall is the defect the control exists to detect.
4. `period_code` agrees with `je_date` on all 3,653 POSTED journals (measured, 0
   disagreements), so nothing has been quietly back-dated into or out of any
   period.

**Reasoning:** the demo deliberately seeds a closed-period breach so the
Exception Center has something real to show. `4615407` did not introduce a new
*kind* of breach; it enlarged an existing one by completing the books of the
entity that owns the only CLOSED period in the fixture. The control did its job:
it named all 26 individually, refused to rewrite any of them, and told a human
that the correction is a reversal in an open period.

**What was changed instead:** the tests that pinned the count `2` and the two
journal numbers. See section 4.

---

## 2. Are the Income Statement and Trial Balance failures real?

Both statements are **correct on the new data**. Both tests were measuring the
wrong thing. The numbers below were recomputed from `src/seed.js` in integer
cents without using `trialBalance()`, `statements()` or the component's own
as-of helper.

### Trial Balance

`GLTrialBalance`'s Trial Balance tab renders `tbAsOf = trialBalance(bsPosted)`,
where `bsPosted = postedJournalEntriesAsOf(jes, {entityId, toPeriod})`. Its
header says so: *"Trial Balance · As of 2026-07 (same-entity, same-dimension,
cumulative POSTED local evidence)"*. The test compared it to
`trialBalance(postedFor(4))`, a `2026-01 <= period_code <= 2026-07` movement
window.

Independent measurement for entity 4:

| set | journals | gross debits | gross credits |
|---|---|---|---|
| cumulative as of 2026-07 | 28 | $3,728,013.00 | $3,728,013.00 |
| 2026-01 ~ 2026-07 window | 26 | $3,542,413.00 | $3,542,413.00 |

Both tie. The difference, $185,600.00, is exactly entity 4's two 2025-12
journals (opening trial balance and FY2025 close). The rendered statement shows
$3,728,013.00, which is the right figure for a cumulative trial balance. Before
`4615407` nothing was posted before 2026-01, so the two sets were identical and
a movement-window total satisfied a cumulative assertion by accident.

**Stale test.** The rewritten case recomputes the as-of total inline in integer
cents and additionally asserts `as-of total > window total`, so deleting the
opening balances now fails the case (verified by mutation, section 5).

### Income Statement

The failing case asserted `expectedIncome(2).revT === 0`. Entity 2 now has
$568,005 of REVENUE in the 2026 window on account `490600 Outsourcing Service
Income` - it is `SERVICE_HUB_ID`, and `4615407` gave it the income side of every
intercompany service pair. The fixture premise, not the statement, is what
broke.

The property is intact and still holds. Measured: 14 entities (11, 18, 47, 49,
54, 58, 62, 63, 64, 74, 84, 88, 117, 118) carry POSTED balance-sheet activity in
the 2026 window and no revenue or expense row at all. Entity 11 renders
*"No revenue or expense activity in this Income Statement scope"* and renders no
`Total Income` and no `Net Income` line - an empty scope, not a statement of
zeroes.

**Stale test.** The rewritten case resolves the fixture entity from the seed at
run time instead of naming one, and additionally asserts the absence of the
zero-statement rows.

All fifteen `GL report tab ... renders for entity ...` cases (5 tabs x entities
4, 114, 2) pass unchanged. No statement crashes and no statement body is being
skipped.

---

## 3. Is unconfigured_entity_periods 824 -> 943 acceptable?

Yes, and the growth is fully explained.

Measured on the merged tree: POSTED journals occupy **946** distinct
entity/period pairs. Three of those pairs have a period master record, so 943
do not. `943 = 946 - 3` exactly reproduces the reported figure.

The increase is precisely one new period across the whole group:

| | old seed (`ff95a9b`) | new seed (`4615407`) |
|---|---|---|
| distinct entity/period pairs posted | 827 | 946 |
| pairs with a period record | 3 | 3 |
| unconfigured pairs | 824 | 943 |

`946 - 827 = 119` = one 2025-12 opening pair for each of the 119 entities. The
per-period breakdown confirms it: `{2025-12: 119, 2026-01..2026-06: 118 each,
2026-07: 119}`. (Entity 15, AIWB, is skipped by the monthly loop and only posts
in 2026-07, which is why the mid-year months are 118.)

**Verdict: expected demo-data shape, and a gap that must stay visible rather
than be closed by fabrication.** The period master is a three-row fixture
against a 946-pair ledger; that ratio was already 3:827 before this seed change.
`ff95a9b` explicitly refused to synthesise the missing authorization records,
and writing 943 of them now would be the same defect relocated - the ledger
would look authorised without anyone having authorised it. The correct posture
is the current one: fail closed on write, report the gap read-only, and let
period administration open periods deliberately. The only number that should
move this figure is a real period-opening decision.

---

## 4. The six failures

| # | Failure | Verdict | Evidence | Fix |
|---|---|---|---|---|
| 1 | Income Statement states an empty scope instead of a zero statement when an entity has no P&L activity | **Stale test** (fixture) | Entity 2 now earns $568,005 on 490600 because `4615407` made `SERVICE_HUB_ID=2` book the income leg of every IC service pair. 14 other entities still satisfy the premise; entity 11 renders the empty-scope block and renders neither `Total Income` nor `Net Income`. | `mtest.jsx` resolves the no-P&L entity from the seed at run time and also asserts the zero-statement rows are absent. |
| 2 | Trial Balance renders balanced totals for a real posting entity | **Stale test** (wrong scope) | Tab renders the cumulative as-of set ($3,728,013.00 dr = cr, 28 journals); the test compared the 2026-01~2026-07 movement window ($3,542,413.00 dr = cr, 26 journals). Both tie; the $185,600.00 gap is entity 4's 2025-12 opening and close. Statement is right. | `mtest.jsx` recomputes the as-of total in integer cents inline and asserts it strictly exceeds the movement window. |
| 3 | the two journals already posted into a CLOSED period are detected and named | **Stale test** (magic numbers) | 26 journals, all entity 2 / 2026-06: the original 2 (renumbered to `20260612007282` / `20260622007283`) plus 24 IC service-hub mirror legs, each with a same-period counterparty leg. Section 1. | Case renamed and rewritten to recompute the closed set from `PERIODS` and assert set equality plus per-row attribution. No count, no journal number. |
| 4 | entity/period pairs carrying posted journals with no period record are reported as a control gap | **Stale test** (magic number) | 943 = 946 posted pairs - 3 configured pairs; the +119 over 824 is the 2025-12 opening period for every entity. Section 3. | Case recomputes the pair set and the journal count from the seed and the period master, and checks every reported row genuinely has no record. |
| 5 | Exception Center surfaces the closed-period postings to a human | **Stale test** (magic number + pagination) | `20260612006437` no longer exists. The exception table paginates at 10, so only 10 of the 26 journal numbers appear in page-one markup regardless. | Case asserts the three totals in the summary strip by exact markup (`<i>Posted into a CLOSED period</i><b>26</b>` etc.), plus the first row's number and reference. The count a human reads no longer depends on pagination. |
| 6 | read-only reporting is unaffected by period control | **Stale test** (magic number + pagination) | Asserted `GL Detail` markup contains `20260612006437`. GL Detail paginates at 30 lines sorted ascending by journal number; entity 2 now has 194 in-window journals, so page one is all 2026-01. Reporting itself was never blocked. | Case now proves it arithmetically: entity 2's rendered cumulative Trial Balance total equals the total *including* its 26 closed-period journals and strictly exceeds the total without them, GL Detail renders one of the entity's posted numbers, and no posting-block code appears on either surface. |

**None of the six was a real defect.** Two further problems were found while
proving that, and both were real:

### 4a. Real defect, merge-induced: the GL overview strip contradicted the Balance Sheet

`src/modules-more.jsx` printed `<i>Assets</i>` in the General Ledger overview
strip from `st = statements(posted)` - the `fromP~toP` movement window - while
the Balance Sheet tab directly underneath printed Total Assets from
`bsSt = statements(bsPosted)`, the cumulative as-of set. Before `4615407` there
was nothing posted before 2026-01, so the two agreed. After it they do not:

| entity | strip "Assets" (was) | Balance Sheet Total Assets | understated by |
|---|---|---|---|
| 4 | $295,134.00 | $435,134.00 | $140,000.00 |
| 114 | $286,724.00 | $439,224.00 | $152,500.00 |
| 2 | $4,339,451.26 | $4,451,951.26 | $112,500.00 |
| 11 | $82,579.00 | $228,829.00 | $146,250.00 |
| 3 | $1,844,557.06 | $23,300,807.06 | **$21,456,250.00** |

Two different numbers labelled "Assets" on one screen, the strip understating
entity 3 by 92%. Fixed: the strip reads `bsSt.assets` and states its basis,
`Assets as of {toP}`; the period figure next to it is labelled
`Net income {fromP} ~ {toP}`. Net income is unaffected numerically (the opening
journals touch balance-sheet and equity accounts only, so window earnings equal
cumulative earnings for every entity measured), but its basis is now stated too.

### 4b. Two SSR cases were passing for the wrong reason

- *"Balance Sheet renders total assets..."* asserted
  `balanceSheetMarkup.includes(money(statements(postedFor(4)).assets))`, i.e.
  `$295,134.00`. That string was present - printed by the broken overview strip,
  not by the statement. The case would not have caught 4a. It now asserts the
  cumulative figure against the `Total Assets` line and asserts the
  movement-window figure is *not* adjacent to it.
- *"detected closed-period postings are reported, never rewritten"* filtered the
  ledger for two journal numbers that no longer exist and then called `.every()`
  on the empty result - a vacuous pass. It now asserts over the reported rows
  themselves, and additionally that each reported journal is still POSTED, still
  carries the period it breached, and still carries a `je_date` inside that
  period, so re-dating a journal out of the closed period fails the case.

`GL Detail renders posted journal lines for a real posting entity` was also
pinned to `postedFor(4)[0].je_number` and only passed because that journal
happened to land on page one; it now accepts any of the entity's posted numbers.

---

## 5. Mutation evidence

Each rewritten case was checked against a deliberate re-introduction of the
defect it guards. Every mutation was reverted immediately; `git status` is clean
of them.

| mutation | expected | observed |
|---|---|---|
| M1 `resolvePostingPeriod` synthesises `{status:'OPEN'}` for a missing record (reverts `ff95a9b`) | period control cases fail | `failed=7`, including the unconfigured-pairs and Exception Center cases |
| M2 Trial Balance tab renders `trialBalance(posted)` instead of the as-of set | TB case fails | `failed=2` (TB case and the read-only reporting case) |
| M3 Income Statement renders a statement of zeroes instead of the empty-scope block | empty-scope case fails | `failed=1`, that case |
| M4 seed stops emitting the 2025-12 opening balances (reverts half of `4615407`) | TB case fails | `failed=1`, that case |
| M5 seed re-dates entity 2's 2026-06 journals into 2026-07 to make the count fall | detection and immutability cases fail | `failed=3`: detection, "never rewritten", Exception Center |
| M6 overview strip goes back to `money(st.assets)` | strip/Balance Sheet agreement case fails | `failed=1`, that case |

---

## 6. Final period-control state

```
audit entities=119/119 jes=3656 fails=0
period-control PERIOD_CONTROL_EXCEPTIONS_FOUND closed_period_journals=26
  unconfigured_entity_periods=943 unconfigured_journals=3583
```

Unchanged by this reconciliation, and correct:

- 26 = every POSTED journal whose own entity and own period the master marks
  CLOSED. All entity 2 / 2026-06. All named individually in `audit.js` and in
  the Exception Center. None rewritten.
- 943 = 946 posted entity/period pairs minus the 3 that hold a period record.
- 3583 = POSTED journals sitting in those 943 pairs.

`src/seed.js` is not modified by this commit, so `SEED_V` stays at v10.

## 7. Red lines checked

Measured on the merged tree:

- Loan Draw: the only journal carrying `270100 Construction Loan - Long Term`
  with a cost debit is the hand-written fixture `JE-2026-07-1001`
  (`Dr 164200 / Cr 270100`), which pre-dates both commits and exists so the rule
  engine has a violation to detect. No generated journal books a loan draw to
  cost.
- Six-digit accounts: 0 line items with a non-six-digit `account_code`.
- Subsidiary-ledger members: 0 lines on 111000/220200/220300/291000/291001/
  125000/120200/123700/270100 missing `member`.
- Intercompany self-dealing: 0 IC lines naming their own entity as counterparty.
- Period control remains fail-closed; nothing in this commit touches
  `src/period-control.js`, `src/engine.js` or `src/app.jsx`.
- No API/OpenAPI contract, migration, WBS/MCP logic or authorization behaviour
  is touched. The navigation panel, off-canvas `inert` drawer and dark-mode AA
  contrast verifiers are untouched and pass.

## 8. Unresolved

- The demo period master remains three rows against 946 posted entity/period
  pairs. That is a real control gap in the demonstration data. It is left open
  deliberately (section 3); closing it means someone deciding which periods are
  open, not a script writing 943 rows.
- `tools/analysis/realestate.js` and `consolidated.js` were not re-run as gates;
  only the three named in the task (`unit-cost-cogs`, `ic-elimination`,
  `opening-equity`) were, and all three report `failures=0`.
- No browser is available here, so the visual result of the relabelled overview
  strip ("Assets as of 2026-07", "Net income 2026-01 ~ 2026-07") is asserted
  against server-rendered markup only. The strings are longer than the ones they
  replace; `.gl-overview-strip` lays its spans out with flow, and
  `node tools/run-verifiers.mjs` (45) and `npm run test:navigation-a11y` pass,
  but nobody has looked at it.
