# Fix: Income Statement ReferenceError, and period control that failed open

**Branch:** `claude/fix-is-crash-period-control` · **Base:** `96461b0`
**Source findings:** `docs/ACCOUNTING-CLOSE-REVIEW-2026.md` (`785e571`, branch `claude/accounting-close-review`) — C-5 and C-6.
**Scope of this change:** two Critical defects only. No API/OpenAPI contract, migration, WBS/MCP logic or authorization behaviour is changed. Draft→Review→Approve→Post, segregation of duties, immutable Posted evidence and reversal-only correction are preserved. No export, payment rail, bank feed, auto-match, auto-categorize, auto-post, sign-off automation, destructive action or promotion is added.

---

## Defect 1 — the Income Statement threw `ReferenceError: opex is not defined`

### Root cause

`src/modules-more.jsx` computed the operating-expense total from an inline
expression and then handed the drill-down a variable that was never declared:

```js
const revT=..., cogsT=..., opexT=sum(exp.filter(r=>!cogs.includes(r)),r=>r.balance);
...
{drillLine('Total Expenses', opex, opexT, {isTotal:true})}   // `opex` does not exist
```

`grep -rn "const opex\|let opex\|var opex" src/` returned nothing. The intended
value is unambiguous from the surrounding code and from the account taxonomy in
`src/income-statement-classification.js`: `localIncomeStatementSection` maps
every `EXPENSE` row into exactly one of six sections, of which
`Cost of goods sold` (account codes `51xxxx`) is one and the other five are
operating expense. `opexT` was already the sum over
`exp.filter(r => !cogs.includes(r))`, and the `expenseGroups` rendered directly
above are precisely those five sections. `opex` was therefore the same row set
the total was taken from — the author had inlined the filter into `sum()` and
never bound it.

The identifier is evaluated only when the Income Statement body renders, which
needs an entity with posted revenue or expense in scope. The SSR gate rendered
`GLTrialBalance` with `entity: 0`, which makes `hasReportEntity` false, empties
`posted`, and short-circuits into the empty-scope `StateBlock` before the
throwing branch. That is why a crashing financial statement kept a green gate.

### The fix

`src/modules-more.jsx`: bind the row set once and derive both the total and the
drill from it, so the number on the line and the rows the drill opens can never
diverge.

```js
const opex = exp.filter(r => !cogs.includes(r));
const revT = sum(rev, r => -r.balance), cogsT = sum(cogs, r => r.balance), opexT = sum(opex, r => r.balance);
```

The line label is now `Total Operating Expenses` when a Cost of Goods Sold
section is present and `Total Expenses` when it is not. The previous fixed label
said "Total Expenses" over a figure that deliberately excluded COGS, which
misstates the caption whenever COGS exists. Net Income is unchanged:
`revT - cogsT - opexT`.

### What was rejected and why

* A `try/catch`, `opex = 0`, or an early return would each have produced a
  rendered Income Statement whose Total Expenses line was wrong or absent. A
  wrong number on a financial statement is worse than a crash, because a crash
  is noticed.
* Making `Total Expenses` include COGS would have double-counted it against the
  Gross Profit subtotal rendered immediately above.

### Closing the test hole

`mtest.jsx` (the `test:ssr` gate) now renders all five GL report tabs —
Trial Balance, Balance Sheet, Income Statement, GL Detail, Cash Flow — for three
real entities with POSTED activity, selecting the tab through `navContext`:

| entity | why it was chosen |
|---|---|
| 4 | revenue (2 rows), COGS (1 row) and non-COGS operating expense (2 rows) — the complete Income Statement body |
| 114 | revenue and COGS only, so the operating-expense row set is empty |
| 2 | posted balance-sheet activity but no P&L at all — the empty-scope state |

The other four tabs had the same blind spot (they were all rendered only under
`entity: 0`) and are now covered for the same three entities. Beyond "it
renders", each statement's totals are asserted against an independent
computation from the same seed:

* Income Statement: `Total Income`, `Gross Profit`, operating-expense total and
  `Net Income` must all appear in the markup with the values recomputed from
  `trialBalance()` + `localIncomeStatementSection`.
* Trial Balance: debit = credit and the total is present.
* Balance Sheet: assets = liabilities + equity + earnings and the total is present.
* GL Detail: the first posted journal number appears.
* Cash Flow: the cash movement evidence body renders.

**Proof that the new coverage catches the original defect.** Re-introducing the
undeclared identifier makes it fail:

```
FAIL GL report tab "Income Statement" for entity 4 -> opex is not defined
FAIL GL report tab "Income Statement" for entity 114 -> opex is not defined
```

Entity 2 still passes in that run, which is the same short-circuit that hid the
bug — evidence that "render with a real entity that has postings" is the part
that matters.

One unrelated SSR-hostile line was fixed to make the editor renderable in the
test: `src/modules-core.jsx` read `window.__subsOf` unguarded in the editable
journal-line branch. It now calls the imported `subsidiaryOf` directly. This
changes no behaviour in a browser.

---

## Defect 2 — period control failed open

### Root cause

`src/app.jsx:183`:

```js
const period = PERIODS.find(p => p.entity_id===(entity||2) && p.period_code==='2026-07')
            || {period_code:'2026-07', status:'OPEN'};
```

Three things were wrong at once:

1. **A missing period record was synthesised as OPEN.** `src/data.js` declares
   exactly three period rows. 824 of the 827 entity/period combinations that
   carry posted journals have no record at all, so for those the control
   answered "open" to a question nobody had ever answered.
2. **`validateJE` only blocked on an explicit `CLOSED`.** `src/engine.js` raised
   `4005` only when a period object was supplied *and* marked CLOSED. Absence
   was silence, and silence was permission.
3. **The period checked was not the period being posted into.** The lookup was
   hard-coded to `2026-07` and to the entity selected in the header, so a
   journal claiming `2026-06` for entity 2 was validated against entity 2's
   `2026-07` record.

The server-side path was already correct — `server/api/je-policy.mjs`
`resolveOpenPeriod` fails with `PERIOD_NOT_CONFIGURED` — and the browser JE
workflow module already had a correct resolver (`resolveJEPeriod` in
`src/je-workflow.js`, code `JE_PERIOD_NOT_CONFIGURED`) that the application
shell never used.

### The fix

**New leaf module `src/period-control.js`** — the single browser-side resolver.
It never synthesises, mutates, re-dates or deletes anything.

* `resolvePostingPeriod(periods, target)` resolves the record for the target's
  **own** `entity_id` and **own** `period_code`, and returns one of:
  * `{ok:true, period}` — an affirmative `OPEN` record exists.
  * `{ok:false, code:'JE_PERIOD_NOT_CONFIGURED', …}` — no record. The returned
    `period.status` is `NOT_CONFIGURED`, never `OPEN`.
  * `{ok:false, code:'4005', …}` — a record exists and is not OPEN.
  * `{ok:false, code:'JE_PERIOD_UNIDENTIFIED', …}` — the entry names no valid
    entity or no well-formed `YYYY-MM` period (this is what rejects `2027-13`).
* Every message names the entity, the period and what to do next.
* `periodControlExceptions({journals, periods})` is a read-only detector over
  the retained ledger.

**`src/engine.js`** — `postingPeriodError(period, je)` fails closed: it returns
`null` only for an affirmative `OPEN`. `validateJE` pushes its result, so every
caller of `validateJE` — including `validateJETransition`, which gates the whole
Draft→Review→Approve→Post sequence — inherits the closed default.

**`src/app.jsx`** — the `|| {status:'OPEN'}` fallback is gone. `ctx` now carries
`periods`, `periodControl`, `periodExceptions` and `resolvePeriodFor`. Every
path that writes a POSTED journal is guarded and tells the user why it refused:

| path | guard |
|---|---|
| `advanceJE` | any forward move (`next !== 'DRAFT'`) resolves the entry's own period. Rejection back to DRAFT is never blocked — it is not a posting act. |
| `reverseJE` | resolves the source entry's period. A reversal is itself a posting; it is refused rather than silently re-dated into an open period. |
| `approveBill`, `payBills`, `addInvoice`, `receivePayment` | routed through `postedJE(...)`, which resolves before the journal is created. |
| `newJEFromRule` | guarded only when the spec arrives already `POSTED`. Creating a Draft in any period stays allowed. |

**`src/modules-core.jsx`** — `JEEditor` resolves period control from the entry's
own entity and period, renders a `Period control` panel showing
`Entity / period`, whether a period record is retained, and
`PERMITTED` / `BLOCKED`, prints `[code] message` when blocked, disables the
workflow action, and replaces `Reverse` with the existing `<Unavailable
reason=…>` control carrying the same reason. `ExceptionCenter` gains a
read-only `Period control exceptions` section fed by the detector.

**`src/modules-more.jsx`** — the Intercompany mirror button no longer marks a
pair `MATCHED` when the mirror journal was refused.

**`audit.js`** — see "Honest limitation" below.

### The two journals already posted into a CLOSED period

Detected, reported, and left exactly as they are:

| JE number | entity | period | master status | date | source | debits | description |
|---|---|---|---|---|---|---|---|
| `20260612006437` | 2 | 2026-06 | CLOSED | 2026-06-12 | PAYABLE | 11,427.00 | 06/2026 Land development cost |
| `20260622006438` | 2 | 2026-06 | CLOSED | 2026-06-22 | AUTOC | 11,427.00 | 06/2026 Affiliate funding (Due to/from) |

They are **not** deleted, re-dated or rewritten. Posted evidence is immutable
and correction is by reversal only. They are surfaced in three places:

* `npm run test:audit` prints a `PERIOD-CONTROL` line per journal.
* The Exception Center renders them as `POSTED_INTO_CLOSED_PERIOD`, severity
  HIGH, with the required action: *"Posted evidence is immutable. Resolve by
  reversing this entry in an open period, or by documenting an authorised period
  reopen. REFS will not re-date or delete it."*
* `test:ssr` asserts both numbers are detected and that both remain
  `POSTED` in `2026-06` after detection.

Note the consequence, which is intentional: because entity 2's `2026-06` is
CLOSED, the Reverse button on these two entries is itself blocked. The reversal
must be booked into an open period, and REFS does not have a UI that re-dates a
reversal. That is a gap, recorded under residual risk — it is not something this
change should paper over by letting the app choose a period on the user's behalf.

### What a fresh or legitimately-unseeded entity does, and why

**It is blocked, with a named reason, and no period record is created for it.**

I considered and rejected bulk-seeding a period master for all 119 entities ×
`2026-01`…`2026-07` (833 rows), which would have made the demo fully postable
again and reduced the exception list to the two CLOSED-period journals. I
rejected it because it is the same defect relocated. A period master row is an
authorization record; writing 833 of them because the ledger happens to contain
journals is the system granting itself posting authority for periods nobody
opened. Moving that from a `||` fallback in `app.jsx` into `data.js` would make
the control look satisfied while changing nothing about who actually authorised
anything.

I also rejected seeding `2026-01`…`2026-06` as CLOSED: no close has ever run in
this system (the review's finding on `CLOSE_TASKS`, and "Close period" is still
a shell), so marking them closed would fabricate a control event that never
happened and would retroactively convert roughly 1,800 legitimately posted
journals into violations.

So the rule is: **absence blocks.** The remedy is to open a period, which is a
deliberate act by someone with period authority — not a side effect of trying to
post. This also aligns the browser app with the server, which already answers
`PERIOD_NOT_CONFIGURED` for the same condition.

### Legitimate posting is not broken

Entity 2 and entity 4 both hold an OPEN `2026-07` record. The demo's default
entity is `entity || 2`, and all three non-posted seeded journals (one DRAFT,
one PENDING_REVIEW, one PENDING_APPROVAL) belong to entities 2 and 4 in
`2026-07`. The default Draft→Review→Approve→Post walkthrough is unaffected, and
`test:ssr` asserts that the editor renders `PERMITTED` with an enabled
`Submit for review` button once the period is genuinely open.

Selecting one of the other 117 entities and trying to post now produces a
specific, actionable block rather than a silent success. That is the intended
behaviour change.

### Read-only viewing is untouched

Nothing in the reporting path calls the resolver. `test:ssr` asserts that
entity 2's Trial Balance still renders and that its GL Detail still lists
`20260612006437` — the very journal that is flagged as a control exception.

### Proof

Reverting `validateJE` to the old CLOSED-only check and restoring the
synthesised-OPEN fallback in `app.jsx` makes the new tests fail:

```
FAIL validateJE blocks a journal whose owning period has no record
FAIL validateJE blocks when no period object is supplied at all
FAIL JE workflow transition is blocked when the owning period has no record
mtest components=27 failed=3
```

and, separately, restoring only the `app.jsx` fallback:

```
FAIL the application shell never synthesises an OPEN period when no record exists
mtest components=27 failed=1
```

`npm run test:audit` output on the shipped seed:

```
audit entities=119/119 jes=2121 fails=0
period-control PERIOD_CONTROL_EXCEPTIONS_FOUND closed_period_journals=2 unconfigured_entity_periods=824 unconfigured_journals=2098
PERIOD-CONTROL 20260612006437: POSTED in 2026-06 which entity 2's period master marks CLOSED
PERIOD-CONTROL 20260622006438: POSTED in 2026-06 which entity 2's period master marks CLOSED
```

The 824 / 2,098 figures independently reproduce the review's C-6 count.

### Honest limitation in `audit.js`

`audit.js` calls `validateJE(je)` with no period object. Under the new
fail-closed default that produced 2,098 failures and broke the
`entities=119/119 fails=0` gate contract. Rather than weaken the resolver, I:

* excluded the three period-**authorization** codes from the journal-**content**
  failure count (the script checks balance, known accounts, line shape,
  subsidiary members and automatic-source trace — it never intended to evaluate
  posting authority), and
* added an explicit, separately named `period-control …` output line plus a
  `PERIOD-CONTROL` line per closed-period journal, so the information is
  reported rather than hidden.

**This is a judgement call and it should be reviewed.** A stricter reading is
that 2 posted-into-CLOSED journals *should* make `test:audit` exit non-zero. I
did not do that because the gate contract for this task requires `fails=0` and
because `test:audit` is being hardened in parallel by another agent; folding
these in unilaterally would collide with that work. The counts are printed on
every run, so the decision is visible rather than silent.

---

## Residual risk

1. **117 of 119 demo entities can no longer post.** This is the control working,
   but it materially changes what the demonstration can show. There is no UI to
   open a period (`Close period` is still shell-only), so the only way to open
   one today is to edit `PERIODS` in `src/data.js`. A period administration
   screen is the missing piece.
2. **The two CLOSED-period journals cannot be reversed from the UI**, because
   their own period is closed and REFS has no re-dating reversal flow. They will
   sit as open exceptions until either a reversal-into-an-open-period path or an
   authorised reopen path exists. Deliberate: the alternative is letting the app
   pick a period for the user.
3. **`mkJE` still hard-codes `je_date:'2026-07-31'`** and the period is still the
   single `CURRENT_PERIOD` constant. Making the period a user choice is out of
   scope here and would need its own control design.
4. **The 824 unconfigured entity/period pairs are reported as one row each**, not
   per journal. That keeps the list readable but means a reviewer sees 824 rows.
5. **`ctx.period` is still resolved for `entity || 2` / `2026-07`** for the header
   chip. It is presentational only — no posting path uses it — but a reader could
   still mistake the chip for the authority that governs a given entry. The
   editor's own Period control panel is the authoritative display.
6. **No visual verification.** There is no browser in this sandbox and `file://`
   is blocked, so nothing below the level of server-rendered markup was checked.
   The new UI reuses existing classes (`report-workbench`, `qbo-toolgrid`,
   `badge badge-bad`, `Unavailable`) and therefore should inherit dark-mode and
   focus styling, but **that is static reasoning, not an observation.** What is
   test-verified is: the markup renders, contains the expected strings and
   values, and the workflow button carries `disabled` when blocked and does not
   when open.
7. **`test:audit` remains weak evidence.** A separate review showed it misses 14
   of 16 injected defect classes. Nothing here should be read as that gate
   endorsing these fixes; the targeted assertions in `test:ssr` are the evidence.

---

## Files changed

| file | change |
|---|---|
| `src/period-control.js` | **new** — fail-closed resolver and read-only exception detector |
| `src/engine.js` | `postingPeriodError`; `validateJE` now fails closed on period |
| `src/app.jsx` | removed the synthesised OPEN period; guarded every posting path; `CURRENT_PERIOD`; header chip states the real status; exception detector wired into `ctx` |
| `src/modules-core.jsx` | `JEEditor` resolves the entry's own period, states the reason, disables the action; `ExceptionCenter` period-control section; exported `JEEditor`; removed an SSR-hostile `window` read |
| `src/modules-more.jsx` | declared `opex`; accurate Total Operating Expenses label; IC mirror no longer marks matched when the posting was refused |
| `audit.js` | period-authorization codes reported separately from content failures |
| `mtest.jsx` | GL report-tab coverage for real posting entities; period-control coverage |
| `docs/FIX-IS-CRASH-PERIOD-CONTROL.md` | this document |

`src/seed.js` is **not** changed, so `SEED_V` is not incremented. `src/data.js`
is not changed either — no period master rows were fabricated (see above).
