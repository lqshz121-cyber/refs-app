# Fix: unit COGS, intercompany elimination, opening balances

**Branch:** `claude/fix-cogs-ic-opening` · **Base:** `96461b0`
**Answers:** the three Critical findings C-2, C-3 and C-4 of `docs/ACCOUNTING-CLOSE-REVIEW-2026.md` (branch `claude/accounting-close-review`, commit `785e571`).

Every before/after number below was produced by running a script, not by reading
code. The scripts are in `tools/analysis/` and each one exits non-zero when its
assertions fail:

```
./node_modules/.bin/esbuild tools/analysis/<name>.js --bundle --platform=node \
  --format=cjs --outfile=/tmp/x.cjs && node /tmp/x.cjs
```

| Script | Measures |
|---|---|
| `tools/analysis/unit-cost-cogs.js` | Defect 1 — the Land/CWIP → finished inventory → COGS chain on a unit |
| `tools/analysis/ic-elimination.js` | Defect 2 — intercompany mirroring and consolidation residual |
| `tools/analysis/opening-equity.js` | Defect 3 — opening trial balance, equity, retained-earnings roll-forward |

The "before" column comes from running the same three scripts against a clean
checkout of `96461b0` (`git archive 96461b0 src | tar -x -C /tmp/before`, with
the new `src/engine.js` and `src/unit-transfer-pairing.js` copied in because the
scripts import them; neither affects any pre-fix figure).

`tools/analysis/_ledger.js`, `consolidated.js` and `realestate.js` are carried
over unchanged from `785e571` so the review's own scripts can be re-run against
the fixed ledger. The remaining scripts from that commit stay on their branch.

**Rule compliance.** `src/seed.js` changed shape, so `SEED_V` in `src/app.jsx`
moved `v9` → `v10`. Loan Draw is still `Dr Cash / Cr Loan Payable` and still
never touches cost — no rule in `src/engine.js` was changed. Account codes are
still six digits. Every subsidiary-ledger line still carries a `member`
(`ic-elimination.js` check [2] proves it for the intercompany family:
0 lines without one). No AI path posts anything. Posted entries are still
immutable. No API/OpenAPI contract, migration, WBS/MCP rule or authorization
behaviour was touched.

---

## Defect 1 — COGS exceeded the accumulated cost on every unit sold

### Root cause

Three separate faults in one block of `src/seed.js` (line 160 at `96461b0`):

1. **COGS was derived from revenue.** `Math.round(price*0.82)` — the relief was
   82% of the sale price. The cost the unit had actually accumulated never
   entered the calculation.
2. **The cap was a per-entity pool, not the unit.** `_cwipBal[e]` was one number
   for the whole company, so cost incurred on lot A could be relieved against a
   sale of lot B.
3. **The relief was booked to the wrong unit.** Cost was capitalised to
   `UNIT_OF(e, m)` and relieved from `UNIT_OF(e, m-1)`.

There was a fourth fault the review did not name, and the measurement found it:
`UNIT_OF(e,k)` used `%3` on both the lot number and the block letter, so it only
ever produced three distinct unit codes per entity. With sales in months 3 and 6,
`UNIT_OF(e,3) === UNIT_OF(e,6)` — **every one of the 66 lots was sold twice.**

And there was no CWIP → finished inventory step at all, so the "inventory" in
"cost of goods sold" did not exist as a balance.

### Fix

`src/seed.js` now holds a real unit cost ledger:

- `_unitCwip` and `_unitInv`, keyed `(entity|unit_code)`, in whole dollars.
- `UNIT_OF(e,k)` uses `%7` on the lot and `%4` on the block, so `k = 0..3` give
  four distinct units. `k=0` is the unit carried in as opening work in progress;
  `k=1..3` are the three FY2026 build cycles. A lot is built once and sold once.
- Cost is capitalised monthly to the unit under construction in the current
  cycle: `Dr 164400 CWIP / Cr 220300 A/P`, `unit_code` on the cost line.
- At completion the whole accumulated cost moves out of CWIP and into finished
  inventory: `Dr 165100 Inventory / Cr 164400 CWIP` (`R-INV-XFER-01`). This is
  the middle step that did not exist.
- At closing, cost of sales is relieved **from that unit's inventory carrying
  value**: `Dr 510000 / Cr 165100` (`R-CLS-COGS-01`). The amount is the carrying
  value, full stop. `relieveUnitInventory()` throws at module load if a relief
  would ever exceed what the unit carries, so the rail cannot be crossed
  silently.

One input-data change was needed and is called out here because it moves the
margin: the seed's monthly construction accrual used to be a formula unrelated
to the sale price, and produced a cost basis of about 23% of price. A unit cost
ledger built on that input is mechanically correct and still reports a 77%
gross margin, which is not a homebuilder. The monthly accrual is now
`UNIT_MONTH_COST()`, one third of a deterministic 76.00%–86.99% of the unit's
contract price, split into three monthly accruals that add back to the total
exactly. **The relief still never reads the price** — the price is an input to
what the builder spends, not to what is relieved. The margin below is the
output, not a target.

### Before → after

```
                                                    BEFORE (96461b0)      AFTER
units where cumulative COGS > cumulative unit cost     66 of 66           0 of 132
total over-relief                                   $7,525,556.00         $0.00
units relieved with no CWIP -> inventory transfer      66 of 66           0 of 132
posted CWIP -> finished inventory journals                  0               132
units with a negative CWIP or inventory balance            66                 0
units sold in more than one period                         66                 0
gross margin on unit closings                            77.0%             19.9%
```

Decisive output, after (`tools/analysis/unit-cost-cogs.js`, exit 0):

```
== UNIT COST LEDGER · Land/CWIP -> Finished inventory -> COGS ==
  units carrying any dimensioned activity: 279
  units with cost relieved to COGS:        132

  [1] units where cumulative COGS exceeds cumulative unit cost: 0 of 132
      total over-relief: 0.00

  [2] units relieved to COGS without an equal transfer into finished inventory: 0 of 132

  [3] posted journals moving CWIP into finished inventory: 132

  [4] units with a negative CWIP or inventory carrying value: 0

  [5] units sold in more than one period: 0

== RESULTING MARGIN ON UNIT CLOSINGS ==
  revenue 491800 on units: 49,162,500.00
  cost of sales on units:  39,354,697.00
  gross profit:            9,807,803.00  (19.9%)

  work in progress still in CWIP at 2026-07: 14,134,365.00
  finished inventory unsold at 2026-07:      0.00

unit-cost-cogs: failures=0
```

Same script, before (exit 1):

```
  [1] units where cumulative COGS exceeds cumulative unit cost: 66 of 66
      total over-relief: 7,525,556.00
        119|Lot 102 Block B: cost 75,649.00 relieved 225,686.00 OVER by 150,037.00
        114|Lot 103 Block C: cost 73,222.00 relieved 220,927.00 OVER by 147,705.00
  [3] posted journals moving CWIP into finished inventory: 0
  [5] units sold in more than one period: 66
        101|Lot 102 Block B: sold in 2026-03, 2026-06
  gross profit: 37,850,846.00  (77.0%)
```

### Residual risk

- $14,134,365 of work in progress remains in CWIP at 2026-07. That is correct —
  build cycle 3 (July) is unfinished — but it is a large balance sitting on one
  account with no ageing or completion-percentage evidence behind it.
- Unit cost contains hard construction cost only. No capitalised interest, no
  land basis allocation, no soft costs, no capitalised property tax. A real unit
  cost ledger has all four. Adding them was out of scope here and would change
  the margin again.
- The cost basis is a deterministic function of the sale price. That is the
  wrong causal direction for a real business and it is a seed input, not a
  posting rule. If someone later feeds real cost data in, nothing in the relief
  path has to change.
- Revenue is still recognised entirely in cash at closing, with no AR split, no
  title withholding and no selling costs. Review finding C-2 named that; it is
  not fixed here.

---

## Defect 2 — no intercompany pair eliminated

### Root cause

Two different causes, and the second one is not quite what the briefing said.

**In the seed (the $15.45M).** `src/seed.js` credited `291000 Due to …` in every
project company, land company and service company and **never booked the other
side anywhere**. `Wan Bridge Development LLC` was named as counterparty on
$13,419,876 of other entities' balances while carrying none of it itself. That
is 119 of 119 eliminable relationships one-sided, and it is the whole of the
problem's size.

A second, smaller cause inside the same number: $2,009,777.21 of the residual
sat in `291000`/`291001` against counterparties that **are not group entities at
all** — Welltower Inc., ADP, Google, GitHub, OpenAI, Texas Mutual, several
Beijing suppliers, and seven individual owners receiving dividends. Those
balances can never eliminate, because there is nothing to eliminate them
against. They were misclassified, not unmirrored.

**In the unit transfer path.** The briefing says `src/module-unittransfer.jsx`
"books `125000` on the way out and `291000` on the way in, so the two sides use
different accounts and can never eliminate." **That part is not right, and I am
not going to report a fix for it.** `125000 Due from Related Party` (asset) and
`291000 Due to/from` (liability) are the correct symmetric pair; measured on the
pre-fix code with a carrying cost of 300,000 and a price of 400,000, due-from was
400,000 and due-to was 400,000 and they net to zero. What that path actually got
wrong was:

```
BEFORE (inline logic at src/module-unittransfer.jsx:10 @96461b0)
  due from 125000 = 400000
  due to   291000 = 400000        <- these did mirror
  receiver inventory 164400 = 400000   (group carrying cost is 300000)
  intercompany profit capitalised in receiver inventory = 100000
  net group gain left in 787001 = 100000
```

The receiving entity capitalised the unit at the **transfer price**, so 100% of
the transferring entity's gain stayed inside group inventory, and the gain
itself stayed in group income. There was also no atomicity: the two
`newJEFromRule` calls were independent, so a failure on the second one would
leave a half transfer.

### Fix

**Seed.** One intercompany mechanism, used at every site:

- `125000` is the asset side on the creditor's books, always.
- `291000` (funding advances) and `291001` (service and fee balances) are the
  liability side on the debtor's books, always.
- Both sides are booked from one amount, in one period, with the other entity as
  the line `member`. `icAdvance()` and `icRepay()` in `src/seed.js` emit the pair.
- Group companies no longer receive cash from nowhere. The funder settles the
  general contractor on the project company's behalf (`Dr 220300 / Cr 291000` in
  the project company, `Dr 125000 / Cr 111000` in the funder), and the project
  company repays out of closing proceeds (`R-IC-RPY-01`/`-02`). The service hub
  books the matching `Due from` and service income for every outsourcing fee it
  charges. Each fund books `Due from` for interest income and the developer books
  the mirror `Due to` and the interest cost.
- The two hand-written entity-1 journals (`1101`, `1102`) that credited `291001`
  against Wan Bridge Land LLC now have mirror journals `1103`/`1104` in entity 2.
- Non-group counterparties moved out of the affiliate accounts: third-party
  vendor payables to `220300 A/P Accrual` with the vendor as member; the
  Welltower contribution to `380100 WT Equity Contribution`; the owner dividend
  run to `380110 Distribution`.

**Unit transfer.** The inline builder moved to `src/unit-transfer-pairing.js`,
`buildUnitTransferPair()`, which is a pure function and therefore testable:

- Both journals are built before either is created; a pair that fails validation
  returns a coded error and neither side is created.
- The receiving entity records the unit at the **group carrying cost**. The
  intercompany profit is pushed down as the equal and opposite entry on `787001`,
  so the net group gain is zero and nothing unrealised stays in inventory. Both
  lines carry the pair id, so the elimination is visible rather than implied.
- The function refuses a same-entity transfer, a zero carrying cost, a negative
  price, and any pair whose due-from and due-to would differ.

### Before → after

```
                                                          BEFORE (96461b0)        AFTER
consolidated residual 125000 + 291000 + 291001            $(15,452,053.21)        $0.00
eliminable pairs, mirrored (cumulative)                       0 of 119           118 of 118
eliminable pairs, mirrored (per period)                       0 of 827           820 of 820
non-group counterparties inside an intercompany account          24                  0
net non-group balance inside an intercompany account       $(2,009,777.21)        $0.00
intercompany lines with no counterparty member                    0                  0
unit transfer: profit capitalised in receiver inventory      $100,000            $0.00
unit transfer: net group gain left unrealised                $100,000            $0.00
```

Decisive output, after (`tools/analysis/ic-elimination.js`, exit 0):

```
== INTERCOMPANY ELIMINATION ==
  intercompany ledger lines: 2070
    125000: 10,095,852.00
    291000: (8,487,476.00)
    291001: (1,608,376.00)

  [1] consolidated intercompany residual (125000 + 291000 + 291001 + ...): 0.00
  [2] intercompany lines with no counterparty member: 0
  [3] intercompany balances against a counterparty that is NOT a group entity: 0 counterpart(ies), net 0.00
  [4] pair mirror (cumulative): 118 mirrored, 0 one-sided (of 118 eliminable relationships)
  [5] pair mirror (per period): 820 mirrored, 0 one-sided (of 820 eliminable relationships)
  [6] net due from 10,095,852.00 + net due to (10,095,852.00) = 0.00
  [7] unit transfer pairing (src/unit-transfer-pairing.js):
        gain     due from 400,000.00 | due to 400,000.00 | receiver inventory 300,000.00 | net group gain 0.00 | both sides balanced=true
        loss     due from 250,000.00 | due to 250,000.00 | receiver inventory 300,000.00 | net group gain 0.00 | both sides balanced=true
        at cost  due from 300,000.00 | due to 300,000.00 | receiver inventory 300,000.00 | net group gain 0.00 | both sides balanced=true
        atomicity: a same-entity transfer is refused before either side is created -> UT_SAME_ENTITY

ic-elimination: failures=0
```

Same script, before (exit 1):

```
  [1] consolidated intercompany residual: (15,452,053.21)
  [3] intercompany balances against a counterparty that is NOT a group entity: 24 counterpart(ies), net (2,009,777.21)
        Welltower Inc.                             (1,703,376.86)
        WB Asset Management LLC                    (237,901.00)
  [4] pair mirror (cumulative): 0 mirrored, 119 one-sided (of 119 eliminable relationships)
  [5] pair mirror (per period): 0 mirrored, 827 one-sided (of 827 eliminable relationships)
```

### Residual risk

- The mirror is enforced by construction in the seed, not by a control. Nothing
  in the running application stops a user from posting a one-sided `291000`
  journal by hand. `tools/analysis/ic-elimination.js` is the detective control;
  a preventive one (paired posting in the JE workflow, plus a nightly mirror
  exception) does not exist yet. Review finding C-3 asked for both.
- Elimination is *provable* but not *implemented*: there is no consolidation
  entity, no elimination ledger, and no consolidated report in the product. The
  measurement nets the accounts; the application does not.
- `_dueToFunder` sizing means a project company repays only what it owes at the
  time of closing, capped at the sale proceeds. Land companies never sell, so
  their due-to grows all year. That is realistic but it means the funder carries
  a $10.1M due-from at 2026-07 with no interest charged on it (the only
  intercompany interest in the ledger is the fund-to-developer allocation that
  was already there).
- The Intercompany report in `src/modules-more.jsx` still reads `IC_TXNS` (two
  demo rows), not the general ledger. Unchanged, and still wrong. That was part
  of C-3's fix list and is not done.
- Reclassifying the scraped AIWB and Wan Bridge Development vendor payables out
  of `291001` changes fixture data that was described as "real scraped entries".
  It is better accounting — a payable to ADP is not an affiliate balance — but it
  is a deliberate departure from source fidelity and should be reviewed as one.

---

## Defect 3 — no opening balances, no equity, no roll-forward

### Root cause

There were none. The first posted journal was `2026-01`, every account started at
zero, and one single equity posting existed across all 119 entities ($800,000 of
`380104`). The balance-sheet equation held only because zero equals zero.
`371000 Prior Years Retained Earnings` and `370300 Current Year Surplus` existed
in the chart of accounts and were never posted, and there was no close routine
anywhere in `src/`, so in a second year prior-year income would have kept
presenting as current earnings forever.

### Fix

**A mechanism, in `src/engine.js`:**

- `yearEndCloseLines(amount)` — the closing journal lines for a fiscal year's
  result. A surplus debits `370300` and credits `371000`; a deficit does the
  reverse; a zero result returns no lines, so the routine is safe to run twice
  and never posts an empty journal.
- `retainedEarningsRollForward(jes, {entityId, throughPeriod, fiscalYear})` —
  splits the position as of a period into equity already booked, earnings from
  prior fiscal years, and current-year earnings, accumulating in integer cents.
  Earnings from a closed year land in equity; only the current year's result is
  reported as current earnings.

**A real opening position, in `src/seed.js`:**

- One `OPENING` journal per entity at `2025-12-31`, period `2025-12`: opening
  cash (with the bank member), opening work in progress on unit `UNIT_OF(e,0)`
  for construction entities, opening trade payables (with the vendor member),
  `380101 Paid in Capital - Common`, and the FY2025 result sitting in
  `370300 Current Year Surplus`. Whole dollars, and it balances by construction.
- One `CLOSING` journal per entity at `2025-12-31`, built by
  `yearEndCloseLines()`: FY2025's result leaves `370300` and becomes
  `371000 Prior Years Retained Earnings`. 2026 therefore opens with nothing in
  current earnings, and the same routine closes FY2026 when the year ends.
- Opening cash is not a guess. `cashLowWater()` walks the generated FY2026 ledger
  chronologically per entity, and opening cash is a small fixed cushion plus the
  low-water requirement rounded up to the next $10,000. An opening balance sheet
  that lets an entity overdraw its bank is its own defect; check [6] measures it.
- The Welltower contribution and the owner dividend run, reclassified out of the
  intercompany accounts under Defect 2, now land in `380100` and `380110`, so
  equity has movement during the year as well as an opening balance.

### Before → after

```
                                                       BEFORE (96461b0)      AFTER
posted journals before 2026-01                                0                238
earliest posted period                                    2026-01            2025-12
entities with an opening trial balance                    0 of 119          119 of 119
opening trial balances that do not balance                    0                  0
equity accounts posted                                        1                  6
total equity postings                                    1 line            487 lines
entities carrying any equity                              1 of 119          119 of 119
371000 Prior Years Retained Earnings                      $0.00        $5,212,000.00
370300 Current Year Surplus after the FY2025 close        $0.00              $0.00
entities where A != L + E + current earnings              0 of 119          0 of 119
entities that go cash-negative during FY2026                 13                  0
posted journals not balancing to the cent                     0                  0
```

Decisive output, after (`tools/analysis/opening-equity.js`, exit 0):

```
== OPENING POSITION ==
  posted journals dated before 2026-01: 238
  earliest posted period: 2025-12

  [1] entities with an opening trial balance: 119 of 119
      opening trial balances that do NOT balance: 0

  [2] equity accounts posted: 6; total equity postings: 487 lines
        370300 Current Year Surplus (Deficit)         lines= 238 balance 0.00
        371000 Prior Years Retained Earnings          lines= 119 balance 5,212,000.00
        380100 WT Equity Contribution                 lines=   1 balance 1,703,376.86
        380101 Paid in Capital - Common               lines= 119 balance 24,193,000.00
        380104 Additional Paid in Capital             lines=   1 balance 800,000.00
        380110 Distribution                           lines=   9 balance (35,365.74)
      entities carrying any equity: 119 of 119
      total group equity: 31,873,011.12

  [3] 371000 Prior Years Retained Earnings: 5,212,000.00
      370300 Current Year Surplus after the FY2025 close: 0.00

  [4] retainedEarningsRollForward() over the whole group as of 2026-07:
        equity already booked         31,873,011.12
        earnings from prior years     0.00
        FY2026 current-year earnings  10,370,693.43
        retained earnings carried fwd 31,873,011.12
      yearEndCloseLines(FY2026 result) -> 2 lines, dr 10,370,693.43 cr 10,370,693.43, balanced=true

  [5] entities where Assets != Liabilities + Equity + current earnings: 0 of 119
      group: Assets 59,713,725.64 = Liabilities 17,470,021.09 + Equity 31,873,011.12 + earnings 10,370,693.43 -> 59,713,725.64

  [6] entities that go cash-negative at any point in FY2026: 0

  [7] posted journals that do not balance to the cent (audit.js allows |diff| < 0.005): 0 of 3653

opening-equity: failures=0
```

Same script, before (exit 1):

```
  [1] entities with an opening trial balance: 0 of 119
  [2] equity accounts posted: 1; total equity postings: 1 lines
        380104 Additional Paid in Capital             lines=   1 balance 800,000.00
      entities carrying any equity: 1 of 119
  [3] 371000 Prior Years Retained Earnings: 0.00
  [6] entities that go cash-negative at any point in FY2026: 13
        WBAI: low water (296.68)   WBPM: low water (4,545.00)   ...
```

### Residual risk

- **The FY2026 close is a mechanism, not a posting.** `yearEndCloseLines()` is
  proven on the FY2026 result in check [4], and it is *posted* for FY2025, but
  no FY2026 close journal exists because the ledger stops at 2026-07. Nothing in
  the application calls the routine yet — there is no year-end close command, no
  period-close workflow hook, and no UI. Someone has to wire it.
- The opening amounts are fabricated. They are deterministic, they balance, they
  are dimensioned, and the cash figure is derived from a measured requirement
  rather than invented — but they are not anyone's real 2025 balance sheet, and
  there is no opening-balance *import path*, which is what review finding C-4
  actually asked for.
- The opening trial balance has five lines: cash, work in progress, trade
  payables, paid-in capital, prior-year result. A real opening balance sheet for
  a homebuilder has debt, escrow, prepaid, accruals, fixed assets and accumulated
  depreciation. It does not have those because none of those exist anywhere in
  this ledger (review finding C-9); adding them here would be inventing a close
  that never ran.
- The opening journals use `period_code '2025-12'`, which no period master row
  covers. The browser period gate at `src/app.jsx:183` synthesises `OPEN` for any
  unknown entity/period — review finding C-6, owned by
  `claude/fix-is-crash-period-control`. My entries do not make that worse but
  they do add 238 more journals sitting in an unconfigured period.
- `2025-12` is outside the `MONTHS` list in `src/modules-more.jsx:114`, so the
  report period selector cannot select it. The Balance Sheet as-of reader
  (`postedJournalEntriesAsOf`, string compare `<= toPeriod`) does include it, and
  the GL Detail opening-balance reader (`period_code < fromP`) does too. **This
  is reasoning from the source, not a rendered check** — see Limitations.

---

## Money precision

Nothing here made the float situation worse, and the measurement side is better.

- Every amount the generator produces is a whole dollar computed with integer
  arithmetic (`UNIT_MONTH_COST` splits a total into three integers with the
  remainder on the last month, so the three accruals add back exactly). The only
  fractional amounts in the ledger are the scraped AIWB/REAL2 cents, which were
  not recomputed.
- All three measurement scripts accumulate in integer cents (`Math.round(x*100)`)
  and compare with `===`, not against a tolerance.
- `audit.js` still accepts a journal that is out by up to 0.005 while the
  Postgres side is `numeric(20,4)`. I did not change `audit.js` — a separate
  agent is hardening that gate. Instead `opening-equity.js` check [7] measures the
  stricter property directly: **0 of 3653 posted journals fail to balance to the
  cent.** That is a new, exact assertion where none existed.

---

## Gates

All run on the final tree.

| Gate | Result | Exit |
|---|---|---|
| `npm run test:ssr` | `mtest components=27 failed=0` | 0 |
| `npm run test:audit` | `audit entities=119/119 jes=3656 fails=0` | 0 |
| `npm run build` | `dist/bundle.js 871.3kb` · runtime deployment assets PASS | 0 |
| `node tools/run-verifiers.mjs` | `Verifier summary: 44/44 passed` | 0 |
| `node verify-global-visible-english.mjs` | source and dist English/no-mojibake PASS | 0 |
| `git diff --check` | clean | 0 |
| `tools/analysis/unit-cost-cogs.js` | `failures=0` | 0 |
| `tools/analysis/ic-elimination.js` | `failures=0` | 0 |
| `tools/analysis/opening-equity.js` | `failures=0` | 0 |

`test:audit fails=0` is weak evidence and is not offered as proof of anything
here. The three analysis scripts are the evidence.

---

## Limitations — what is measured and what is reasoning

**Measured** (a script ran and printed the number): every figure in the three
before/after tables, the consolidated trial balance, the unit transfer pairing
behaviour before and after, and every gate result above.

**Reasoning from source, not measured:** there is no browser in this environment
and `file://` is blocked, so nothing was rendered and no screenshot exists. The
following are read from the code and are not proven by execution:

- That the Balance Sheet, Trial Balance and GL Detail pages present the `2025-12`
  opening journals correctly in a browser. `postedJournalEntriesAsOf` and the
  `period_code < fromP` opening reader both include them by string comparison,
  and the SSR suite renders 27 components without error, but SSR does not exercise
  the report period selector.
- That the `2025-12` period, which the report period dropdown cannot select,
  causes no visible confusion on a page that lists periods from the journal data
  (`src/module-register.jsx:15`, `src/modules-more.jsx:634` both build their
  period lists from `jes`, so `2025-12` will appear there).
- That the Unit Transfer page still behaves correctly end to end. The pairing
  function is unit-measured; the React component wiring around it is not.

**Not attempted:** review findings C-1 (audit gate hardening), C-5 (the
`opex is not defined` Income Statement crash), C-6 (the period gate failing
open) and C-7 (unknown account codes defaulting to ASSET) are owned by other
branches and were left alone.
