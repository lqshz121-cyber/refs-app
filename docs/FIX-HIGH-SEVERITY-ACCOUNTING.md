# REFS — High severity accounting fixes

**Branch:** `claude/fix-high-severity-accounting` · **Base:** `9900bfd`
**Source of the defects:** `docs/ACCOUNTING-CLOSE-REVIEW-2026.md` on `claude/accounting-close-review` (`785e571`).
**Seed version:** `SEED_V` raised `v12` → `v13` (`src/app.jsx`), because `src/seed.js` and `src/data.js` both changed structurally.

Every "before" figure below was produced by running the measurement script named in that
section against the tree at `9900bfd`, and every "after" figure by running the same script
against this branch. Nothing here is quoted from the close review without being re-measured
first — several of the review's numbers were taken at `96461b0` and had already moved.

Run any of them with:

```
./node_modules/.bin/esbuild tools/analysis/<name>.js --bundle --platform=node --format=cjs \
  --outfile=/tmp/x.cjs && node /tmp/x.cjs
```

Each exits non-zero if its assertions fail.

| Defect | Script | Before | After |
|---|---|---|---|
| H-1 rule engine emits invalid journals | `rule-engine-validity.js` | 10 of 12 drafts rejected, 15 × error 4020 | 0 rejected, 0 × 4020 |
| H-2 GL loan payable below the loan master | `loan-gl-vs-master.js` | GL 2,900,000.00 vs master 9,970,000.00, difference **7,070,000.00** | GL 9,970,000.00 vs master 9,970,000.00, difference **0.00** |
| H-3 interest accrual an order of magnitude short | `interest-accrual.js` | accrued 29,200.00, in-service loan expensed **0.00** | accrued 256,939.41, in-service loan expensed **205,205.00** |
| H-4 construction cost carries no dimensions | `construction-dimensions.js` | 462 invoice lines: 0.0% project, 0.0% cost code | 462 invoice lines: 100.0% project, unit, cost code and vendor |
| H-5 closings with no withholding, AR or selling cost | `closing-legs.js` | 0 of 132 closings carried any of the three | 132 of 132 carry all three |

---

## H-1 — The rule engine emitted journals that failed the engine's own validator

### Root cause

`loanRule` and `pmRule` in `src/engine.js` set `loan_id` / `property_id` on every line and
never set `member`. `subsidiaryOf` (`src/coa-wbs.js`) marks `111000`, `120200`, `220200`,
`225000`, `270100` and `270200` as subsidiary-ledger control accounts, and `validateJE`
raises `4020` on any line posted to one of them without a member. So every draft the rule
engine produced was rejected the moment it was submitted, on a journal the user had not
written and had no field to fix.

The seed ledger hid this: a normalisation pass at the end of `src/seed.js` back-fills
`member` on every subsidiary line, so the demonstration data was clean while the live rule
path was not.

### Fix

`src/engine.js` now resolves the member from the master record the source transaction
already points at, through three named resolvers:

- `bankMemberFor(entityId)` — the entity's operating bank account from `BANK_ACCOUNTS`.
- `loanMemberFor(loanId)` — `"<loan_code> · <lender_name>"` from `LOANS`.
- `residentMemberFor(row, property)` — the resident. **The property-management feed carries
  no resident name**, only a property and a unit, so the member is `"<property> · <unit>"`.
  That is the key the feed actually carries; inventing a personal name would put a value in
  the subledger that no source system could be reconciled against.
- `pmVendorMemberFor(row, property)` — the payee on a pass-through property charge. The
  feed did not carry one, so `vendor` was added to the `PM_ROWS` staging shape (a real
  Yardi expense feed reports a payee). When a feed still omits it the resolver returns
  `"Unidentified payee · <property>"` rather than guessing a vendor.

Each resolver returns `null` when the master holds no such record, and `null` is not papered
over: the line stays memberless and `4020` still fires, which is the correct outcome for a
draw against a loan that is not in the loan master.

Two further corrections in the same path:

- `loanRule` was hard-coded to `270100 Construction Loan - Long Term` for every facility. A
  mortgage draw or repayment now posts to `270200 Mortgage Loan - Long Term`, read off
  `loan_type`.
- `225000`/`225001`/`225100`/`225200` were mapped to the **Vendor** subledger in
  `src/coa-wbs.js`. A tenant deposit is money held for a resident and refunded to that
  resident; filing it under accounts payable means no deposit tie-out or refund aging can
  ever find it. They are now the **Tenant** subledger. Nothing is relaxed — a member is
  still required.

### Before → after (`tools/analysis/rule-engine-validity.js`)

```
BEFORE
  loanRule DRAW loan=L-2025-014                  -> INVALID R-LOAN-01
      4020 Line 1: 111000 requires a Bank member.
      4020 Line 2: 270100 requires a Loan member.
  ...
  drafts generated:                 12
  drafts REJECTED by validateJE:    10
  4020 missing-member errors:       15
rule-engine-validity: drafts=12 invalid=10 member_errors=15 failures=10   (exit 1)

AFTER
  loanRule DRAW loan=L-2025-014                  -> VALID   R-LOAN-01
  loanRule INTEREST_ACCRUAL loan=L-2025-014      -> VALID   R-LOAN-03
  loanRule INTEREST_PAYMENT loan=L-2025-014      -> VALID   R-LOAN-05
  loanRule REPAYMENT loan=L-2025-014             -> VALID   R-LOAN-08
  loanRule DRAW loan=M-2024-003                  -> VALID   R-LOAN-01
  loanRule INTEREST_ACCRUAL loan=M-2024-003      -> VALID   R-LOAN-04
  loanRule INTEREST_PAYMENT loan=M-2024-003      -> VALID   R-LOAN-05
  loanRule REPAYMENT loan=M-2024-003             -> VALID   R-LOAN-08
  pmRule RENT (ACCRUAL) YARDI-5581               -> VALID   R-PM-11
  pmRule LATE_FEE (CASH) YARDI-5582              -> VALID   R-PM-11
  pmRule SEC_DEPOSIT (CASH) YARDI-5583           -> VALID   R-PM-16
  pmRule UTILITIES (ACCRUAL) YARDI-5584          -> VALID   R-PM-18
  pmRule PET_FEE (CASH) YARDI-5585               -> no journal generated (by design)
  drafts generated:                 12
  drafts REJECTED by validateJE:    0
  4020 missing-member errors:       0
rule-engine-validity: drafts=12 invalid=0 member_errors=0 failures=0      (exit 0)
```

`validateJE` was not touched. The unmapped `PET_FEE` charge code still produces no journal,
which is the designed `GL_MAPPING_MISSING` exception path.

### Residual risk

- The resident member is a unit key, not a person. When a real resident master exists,
  `residentMemberFor` should read it; the fallback is deliberately identifiable as a
  fallback.
- `pmRule` still debits `111000 Operating Cash` for a security deposit. A tenant deposit
  belongs in restricted cash (`117010`), and holding it in operating cash is a legal
  exposure for a Texas build-to-rent operator, not only an accounting one. That is finding
  H-6 of the close review and is **not fixed here**.

---

## H-2 — GL loan payable was $7,070,000 below the loan master

### Root cause

Two independent failures compounding:

1. **The ledger carried no opening debt at all.** The 2025-12-31 opening balance sheet gave
   every one of the 119 entities cash, work in progress, trade payables, capital and prior
   year retained earnings — and no loan. A group holding a 2024 mortgage and a 2025
   construction facility cannot have opened the year with zero debt.
2. **The roll-forward never read the ledger.** `src/modules-more.jsx` derived beginning
   principal as `current_principal - draws + repayments` from the loan master and the
   staging table, so ending principal was `current_principal` by construction. It tied to
   itself and could not show a break. `EXCEPTIONS[3]` claimed a $12,500 loan mismatch while
   the real one was 566× larger.

A third, smaller item: funded draw `WBS-CLTXN-88255` ($275,000, 2026-07-28) had
`generated_je: null` — money in the bank with no journal.

### Which record is authoritative, and why

**For the FY2026 opening position, the loan master.** The ledger's opening loan balance was
not wrong, it was absent, and the master's `current_principal` is the lender-derived figure
for principal outstanding. So the opening balance is *derived* — master principal
outstanding, less every FY2026 principal movement the ledger records — and posted. The
master is not edited down to the books.

**From FY2026 onward, the ledger.** `src/loan-rollforward.js` builds every column except
`master_principal` from posted journals, and reports the difference between the two as a
reconciling item. A future divergence surfaces as an exception instead of disappearing into
a beginning balance.

### Fix

- **`src/loan-rollforward.js`** (new): `loanRollForward({journals, loans, fromPeriod, toPeriod})`
  reads posted journals, attributes each loan-payable line to a facility by explicit
  `loan_id` (or, where an entity holds exactly one facility, by entity), and returns GL
  beginning / draws / repayments / ending alongside the master figure and the difference.
  Movement it cannot attribute to any facility is returned separately and reported, never
  dropped. Accumulated in integer cents. `loanReconcilingItems(rows)` turns a non-zero
  difference into a named exception.
- **`src/seed.js`**: opening principal posted at 2025-12-31 for both facilities, against the
  asset each financed — `164200 CWIP - Building` for the construction facility (project
  under construction), `165901 FA - Investment Homes` for the mortgage (project in service).
  The entry ties without touching capital.
- **`src/seed.js`**: the two staged loan transactions that had never been posted are now
  posted **through `loanRule`**, the same rule engine the application uses, and their
  `generated_je` / `recon_status` are set.
- **`src/modules-more.jsx`**: `Construction Loan Rollforward` rebuilt on `loanRollForward`,
  with GL columns, the master column, a per-facility difference, a status badge and a
  reconciling-items table.
- **`src/seed.js`**: `EXCEPTIONS[3]` restated. It claimed $12,500; it now names the real
  $7,070,000 break, its two causes and its resolution, and is `CLOSED`.

Derived opening principal:

| Facility | Master principal | FY2026 GL movement | Derived opening at 2025-12-31 |
|---|---|---|---|
| `L-2025-014` construction, entity 2 | 4,250,000.00 | draws 3,175,000.00 (500,000 JE-2026-07-1001 + 2,400,000 JE-2026-07-1007 + 275,000 WBS-CLTXN-88255) | 1,075,000.00 |
| `M-2024-003` mortgage, entity 4 | 5,720,000.00 | none | 5,720,000.00 |

### Before → after (`tools/analysis/loan-gl-vs-master.js`)

```
BEFORE
  GL loan payable (credit balance):   2,900,000.00   across 2 line(s)
  LOANS master principal outstanding: 9,970,000.00   across 2 loan(s)
  DIFFERENCE (master - GL):           7,070,000.00
  L-2025-014  GL beginning 0.00 + draws 2,900,000.00 = ending 2,900,000.00
              master 4,250,000.00   UNRECONCILED DIFFERENCE 1,350,000.00
  M-2024-003  GL beginning 0.00 + draws 0.00 = ending 0.00
              master 5,720,000.00   UNRECONCILED DIFFERENCE 5,720,000.00
loan-gl-vs-master: gl=2900000.00 master=9970000.00 difference=7070000.00 failures=3   (exit 1)

AFTER
  GL loan payable (credit balance):   9,970,000.00   across 5 line(s)
  LOANS master principal outstanding: 9,970,000.00   across 2 loan(s)
  DIFFERENCE (master - GL):           0.00
  L-2025-014  GL beginning 1,075,000.00 + draws 3,175,000.00 = ending 4,250,000.00
              master 4,250,000.00   UNRECONCILED DIFFERENCE 0.00   tie
  M-2024-003  GL beginning 5,720,000.00 + draws 0.00 = ending 5,720,000.00
              master 5,720,000.00   UNRECONCILED DIFFERENCE 0.00   tie
  GL loan payable NOT attributable:   0.00
loan-gl-vs-master: gl=9970000.00 ... difference=0.00 mutations_detected=2/2 failures=0  (exit 0)
```

A roll-forward that reports zero on a clean ledger has proved nothing, so the script also
breaks a copy of the ledger two ways and requires the difference to be raised. This is the
check the old report could never have passed:

```
== MUTATION: does the roll-forward SEE a divergence when one exists? ==
  DETECTED  a principal repayment is posted that the loan master does not know about
      L-2025-014: 250,000.00 · the general ledger carries 4000000.00 of principal and the loan master says 4250000.00 ...
  DETECTED  loan principal is posted on an entity that holds no facility in the master
      (unattributed): 400,000.00 · names no loan in the master, so it cannot be reconciled to any lender statement.
```

### Residual risk

- The opening balance is derived, not evidenced. There is no lender statement, amortisation
  schedule or loan agreement in REFS to tie it to. The derivation is stated on the entry
  itself and in `src/seed.js`, so a reader can see what it is.
- Carrying the mortgaged property at exactly the mortgage balance (`165901` = 5,720,000)
  says the property has no equity in it. REFS holds no cost basis for the property; setting
  it equal to the debt is the assumption that does not overstate the asset.
- Attribution falls back to "the entity's only facility" when a line carries no `loan_id`.
  An entity holding two facilities with unlabelled lines leaves them unattributed and
  reported, never split by guess.

---

## H-3 — Interest accrual was an order of magnitude short, and the in-service loan accrued nothing

### Root cause

There was no interest schedule. One hand-entered journal (`JE-2026-07-1002`, $29,200,
capitalised) was the entirety of FY2026 loan interest across 119 entities and two
facilities. `M-2024-003` — a mortgage on `PRJ-002 Maple Court`, which is `IN_SERVICE` —
accrued nothing at all, so `795000 Interest Expense` carried no loan interest and the
capitalise/expense split in `src/engine.js` was never exercised by any data.

### Fix — and an honest correction to the review's benchmark

`src/seed.js` now posts one interest journal per facility per month, from a schedule driven
by the loan master:

- **Basis:** principal outstanding at the **start** of the month × the master's annual rate ÷ 12.
  Stated rather than assumed — REFS holds no day-count basis, no rate reset schedule and no
  payment schedule for these facilities, so a daily or average-balance accrual would require
  inventing a basis the data does not carry.
- **Split (ASC 835-20):** debit `164500 CWIP - Capitalized interest` while the financed
  project is `UNDER_CONSTRUCTION`, debit `795000 Interest Expense` once it is complete and in
  use. The status is read off the financed project, never assumed. Both lines carry
  `loan_id` and `project_id`, so `AUD-LOAN-002/003/004` can evidence the decision.
- **Provenance:** each entry carries an `INTEREST_SCHEDULE` source document recording the
  opening principal, the rate, the convention and the treatment, so the figure can be
  re-derived from the entry alone.
- The staged interest payment `WBS-CLTXN-77010` ($29,315, 2026-07-01) is posted through
  `loanRule` and its `generated_je` set.

**The review's $409,736.25 benchmark over-states the correct accrual, and the script says
so.** That figure is `current_principal × rate × 7/12` — it assumes the year-end principal
was outstanding for all seven months. It is right for `M-2024-003`, whose principal never
moved (205,205.00). It is wrong for `L-2025-014`, whose facility was drawn from 1,075,000 to
4,250,000 *during July*: on that principal the seven-month accrual is 51,734.41, not
204,531.25. `tools/analysis/interest-accrual.js` prints both the flat benchmark and the
ledger schedule and reconciles to the schedule.

**The one hand-entered accrual was corrected by reversal, not by rewriting it.**
`JE-2026-07-1002` carries $29,200 for `L-2025-014` in 2026-07; the schedule on that month's
opening principal is $7,390.63. The posted entry is immutable, so the generator posts a
correcting reversal of $21,809.37 in the same open period (`R-LOAN-03R`,
`Dr 220410 / Cr 164500`) rather than editing the original. `164500` therefore shows debits
73,543.78 and credits 21,809.37, net 51,734.41 — which is exactly the schedule.

**Depreciation was forced by the H-2 fix and is included.** Putting the mortgaged property
on entity 4's books creates a depreciable fixed asset, and `AUD-FA-001` correctly refuses a
ledger that carries depreciable property and no depreciation. `src/seed.js` posts monthly
straight-line depreciation, `Dr 785000 / Cr 168002`, over 27.5 years (330 months): 17,333.33
per month, 121,333.31 for the seven months.

### Before → after (`tools/analysis/interest-accrual.js`)

```
BEFORE
  flat benchmark  (master principal x rate x 7/12):            409,736.25
  ledger schedule (opening GL principal x rate / 12, monthly):      0.00   <- no opening principal existed
  164500/164501 capitalised interest:                           29,200.00
  L-2025-014  accrued in the ledger against this loan:          29,200.00
  M-2024-003  accrued in the ledger against this loan:               0.00
  loan M-2024-003 finances an IN_SERVICE project: interest expensed in the ledger = 0.00
interest-accrual: flat_benchmark=409736.25 scheduled=0.00 capitalised=29200.00 expensed=1585976.00 failures=2  (exit 1)
  FAIL M-2024-003 finances an in-service project and has no interest expense at all

AFTER
  flat benchmark  (master principal x rate x 7/12):            409,736.25
  ledger schedule (opening GL principal x rate / 12, monthly): 256,939.41
  164500/164501 capitalised interest:                           51,734.41
  L-2025-014  financed project PRJ-001 is UNDER_CONSTRUCTION -> interest belongs in 164500 (capitalised)
     expected FY2026 accrual (ledger schedule): 51,734.41
     accrued in the ledger against this loan:   51,734.41   (of which reversed to the schedule: 21,809.37)
     SHORTFALL:                                 0.00
  M-2024-003  financed project PRJ-002 is IN_SERVICE -> interest belongs in 795000 (expensed)
     expected FY2026 accrual (ledger schedule): 205,205.00
     accrued in the ledger against this loan:   205,205.00
     interest paid in the period:               29,315.00
     SHORTFALL:                                 0.00
  loan M-2024-003 finances an IN_SERVICE project: interest expensed in the ledger = 205,205.00
interest-accrual: flat_benchmark=409736.25 scheduled=256939.41 capitalised=51734.41 expensed=1791181.00 failures=0  (exit 0)
```

Group balances that moved: `164500` 29,200.00 → 51,734.41 net · `795000` 1,585,976.00 →
1,791,181.00 (the 205,205.00 increase is entirely the mortgage) · `220410` 29,200.00 →
227,624.41 net accrued · `785000` 0.00 → 121,333.31 · `168002` 0.00 → (121,333.31).

### Residual risk

- **The accrual basis is a convention, not evidence.** Opening balance × rate ÷ 12. A real
  facility would accrue on a daily balance at an actual/360 or actual/365 basis and the
  figure would differ, most visibly in July for `L-2025-014`.
- **There is no ASC 835-20 avoided-cost limit.** Capitalised interest is not tested against
  weighted-average accumulated expenditures, and there is no stop-capitalisation trigger at
  substantial completion. Interest is capitalised for as long as the project master says
  `UNDER_CONSTRUCTION`. The review asked for both; neither is built here.
- **Depreciation is modelled for one entity only.** The property has no in-service date and
  no land/building allocation in REFS, so there is no opening accumulated depreciation and
  the whole carrying amount is depreciated. Depreciating land overstates expense; carrying
  no accumulated depreciation on a property financed since 2024 overstates the asset. Both
  are wrong in a small way and both are stated on the schedule document. The group-wide
  depreciation gap (review finding H-1) is otherwise untouched.

---

## H-4 — Construction cost lines carried no dimensions

### Root cause, and why the gate stayed green

Two separate things, and the second is the more serious.

1. The generator wrote Project, Cost Code and Vendor to the **source document** and only
   `unit_code` to the journal line. A dimension that lives on the document cannot be
   grouped, filtered or summed by anything built on the ledger — and every job cost report
   is built on the ledger.
2. `AUD-CON-001` was written as `!l.unit_code && !l.project_id` — it accepted a line that
   named a unit and nothing else. That is the exact shape all 462 lines carried. The gate
   had a rule for this defect and the rule could not fire on it. `AUD-CON-002` did check
   Project/Unit/Cost Code/Vendor, but on the *source document*, which was complete.

There was also no project to point at. `PROJECTS` held two rows for 119 entities, 66 of
which capitalise vertical construction and 15 of which capitalise land development.

### Fix

- **`src/data.js`**: a `COST_CODES` master (WBS convention — `0LD` land development, `1SD`
  soft cost, `2HD` vertical hard cost, `3INT` capitalised interest, the same prefixes
  `src/ai.js` already maps on) plus `COST_CODE_MAP`.
- **`src/data.js`**: `PROJECTS` now carries the two named fixtures plus one generated
  project per developing entity (`Vertical`, `ProjectCo`, `LandCo`), exported alongside
  `DEVELOPMENT_PROJECT_OF`. Status is `UNDER_CONSTRUCTION`, which is read off the
  generator's own cycle rather than assumed: every such entity is mid-build-cycle or
  mid-development at 2026-07.
- **`src/seed.js`**: construction and land cost lines carry `project_id`, `cost_code`,
  `unit_code` (vertical only) and `vendor` on the **line**. Opening work in progress carries
  the same dimensions. Land development invoices get their own source-document type,
  `LAND_DEVELOPMENT_INVOICE`, because a parcel cost has no unit.
- **`audit.js`**, strengthened, not relaxed:
  - `AUD-CON-001` now requires a `project_id` present **and in the project master** on every
    CWIP debit, and covers `164100 CWIP - Land` as well as vertical CWIP.
  - `AUD-CON-002` additionally requires `Project` on the source document, and applies to
    land development invoices (without the unit requirement).
  - `AUD-CON-003` (new) asks the **journal line** for Project, Unit/WBS, Cost Code and
    Vendor on any construction- or land-invoice posting, and rejects a cost code that is not
    in the master.
- **`tools/analysis/audit-mutations.js`**: four new mutations, so the harness goes from 36
  to **40** cases. Two prove the strengthened `AUD-CON-001`
  (`construction-unit-but-no-project` reproduces the exact 462-line shape;
  `land-cost-no-project`), two prove `AUD-CON-003`
  (`construction-line-dimensions-only-on-document`, `construction-line-unknown-cost-code`).

### Before → after (`tools/analysis/construction-dimensions.js`)

```
BEFORE
== Vertical construction cost (164200,164300,164400,164500,164600,164700,164900) ==
  debit lines: 529   total 52,136,762.00
    carrying Unit/WBS on the line:  528 (99.8%)
    carrying Project on the line:     1 (0.2%)
    carrying Cost Code on the line:   0 (0.0%)
== Land development cost (164100) ==
  debit lines: 120   total 3,075,423.00
    carrying Project on the line:     0 (0.0%)
    carrying Cost Code on the line:   0 (0.0%)
  whole ledger: line-level cost_code = 0, line-level project_id = 2
  AUD-CON-001 as written (no unit AND no project): 0 line(s)  <- why the gate was green
construction-dimensions: failures=7   (exit 1)

AFTER
== Every CWIP debit (vertical + land) ==
  debit lines: 649   total 55,212,185.00
    carrying Project    on the line:  649 (100.0%)
    carrying Cost Code  on the line:  649 (100.0%)
== Vertical construction invoice cost lines ==
  debit lines: 462   total 46,238,062.00
    carrying Project / Unit/WBS / Cost Code / Vendor: 462 / 462 / 462 / 462 (100.0% each)
== Land development invoice cost lines ==
  debit lines: 105   total 1,693,923.00
    carrying Project / Cost Code / Vendor: 105 / 105 / 105 (100.0% each)
  AUD-CON-001 as strengthened (no project): 0 line(s)
construction-dimensions: failures=0   (exit 0)
```

(The 529 → 649 line count is the fix's own additions — opening WIP, capitalised interest and
the opening construction-loan asset now carry dimensions and are in scope.)

### Residual risk

- One generated project per entity is a coarse job structure. A real developer runs several
  jobs per entity and would need phases and a budget per cost code; there is still no budget
  and therefore no budget-versus-actual or cost-to-complete.
- `cost_code` is a first-class **journal line** field but not a column in the Postgres
  schema — no migration was written, since migrations are out of scope for this branch. The
  JS ledger carries it; the server contract does not yet.
- Every vertical construction line carries the same cost code (`2HD220`). Job costing that
  spans real cost codes is not represented.

---

## H-5 — 132 closings, $49.1M, with no title withholding, no AR and no selling costs

### Root cause

`src/seed.js` posted a closing as two lines: `Dr 111000 Cash` and `Cr 491800 Sales of
Product Income`, for the whole contract price. That says the seller received every dollar
the buyer paid, owed no commission, paid no title company and withheld nothing. `src/settings.js`
already defined the split (`Sales income · Confirmed amount → 491800`,
`Sales income · Title Withholding → 220205 Title Closing fee Payable`) and `220205` had
never been posted, along with `510100`, `682500`, `778002` and `684000`.

### Fix

A closing is now posted from a settlement statement (`settlementOf(price)` in `src/seed.js`):

| Leg | Account | Amount |
|---|---|---|
| Net proceeds wired at closing | `111000` | price − commissions − receivable |
| Proceeds receivable from the title company | `121011` (member: Apex Title LLC) | 5.00% |
| Sales commission | `510100` | 3.00% |
| Buyer's broker commission | `682500` | 3.00% |
| Closing and title fees | `778002` | 1.00% |
| Contract sale price | `491800` (Cr) | 100.00% |
| Title closing fee payable | `220205` (Cr) | 1.00% |

The two balances a closing leaves open are cleared in the following month: the title company
funds the retained proceeds (`R-CLS-FUND-01`) and its closing fee is settled
(`R-CLS-FEE-01`). Both point at the same closing statement document. The affiliate advance
repaid at closing is now capped by the cash the closing actually produced, not by the
contract price.

**The deduction rates are modelling assumptions and are labelled as such in the code.** REFS
holds no settlement statement detail for these closings, only a contract price. They are
whole basis points of a whole-dollar price, so no journal total is the result of
floating-point arithmetic. `684000 Closing fee` is deliberately left unposted — it would
double-record the fee already in `778002`.

### Before → after (`tools/analysis/closing-legs.js`)

```
BEFORE
  closings: 132   gross contract price recognised: 49,162,500.00
  closings carrying a RECEIVABLE leg:            0 of 132           0.00
  closings carrying TITLE WITHHOLDING (220205):  0 of 132           0.00
  closings carrying SELLING COSTS:               0 of 132           0.00
  cash debited at closing:                                  49,162,500.00
  220205 lines=0   510100 lines=0   682500 lines=0   778002 lines=0
  gross margin          9,807,803.00  (19.9%)
  margin after selling  9,807,803.00  (19.9%)
closing-legs: failures=3   (exit 1)

AFTER
  closings: 132   gross contract price recognised: 49,162,500.00
  closings carrying a RECEIVABLE leg:          132 of 132   2,458,125.00
  closings carrying TITLE WITHHOLDING (220205):132 of 132     491,627.00
  closings carrying SELLING COSTS:             132 of 132   3,441,375.00
  cash debited at closing:                                  43,754,627.00
  220205 lines=264  510100 lines=132  682500 lines=132  778002 lines=132
  gross margin          9,807,803.00  (19.9%)
  margin after selling  6,366,428.00  (12.9%)
closing-legs: failures=0   (exit 0)
```

`220205` and `121011` both net to zero at 2026-07 because every closing falls in month 3 or
month 6 and is settled the following month — within the ledger window.

### Residual risk

- 3% / 3% / 1% / 5% are modelled, not observed. A settlement statement carries prorated
  property tax, HOA transfer fees, escrow, buyer credits, survey and lender fees; none of
  those is represented.
- Every closing is modelled identically. A direct sale with no outside broker would carry no
  `682500`; the seed has none.
- The receivable is cleared the following month, so the balance sheet at 2026-07 shows no
  closing receivable. That is correct for this seed's timing, not a general property.

---

## What was NOT fixed

Stated plainly, because a green gate is not the same as close-ready books.

- **ASC 835-20 avoided-cost limit and stop-capitalisation trigger** — H-3 residual above.
- **Group-wide depreciation, prepaid amortisation, property tax, insurance, retainage,
  escrow, straight-line rent, allowance for doubtful accounts, tax provision** — the close
  itself is still absent (close review finding H-1). Depreciation exists for exactly one
  entity, because `AUD-FA-001` required it there.
- **Security deposits in restricted cash** (review H-6) — the subledger type is corrected,
  the cash account is not.
- **Unit transfers creating unrealised intercompany profit inside inventory** (review H-9).
- **Float money in the JS layer** (review H-10) — `audit.js` compares in integer
  ten-thousandths and the new code in this branch works in integer cents, but
  `src/engine.js` still carries the 0.005 tolerance in `isBalanced` and `validateJE`.
- **`je_number` uniqueness across the group** (review H-11) — `AUD-DUP-001` enforces it per
  entity, which is what a document number identifies; cross-entity collisions remain.
- **The rewritten `Construction Loan Rollforward` JSX is not render-tested.** The report name
  is excluded from `RETAINED_REPORT_NAMES` (`src/modules-more.jsx:351`), so its body is
  unreachable from the Reports Center and no SSR case executes it. What *is* measured is the
  logic behind it: `tools/analysis/loan-gl-vs-master.js` calls `loanRollForward` and
  `loanReconcilingItems` directly, on the real ledger and on two deliberately broken copies.
  The JSX itself is verified only to the extent that `npm run build` parses and bundles it.
  That is a real gap and it is a consequence of review finding M-7 (19 of 29 reports filtered
  out of the catalogue), which is not fixed here.
- **No browser here and `file://` is blocked**, so nothing in this document is a screenshot
  claim. Every figure above comes from a script; the appearance of any screen is reasoning,
  not measurement.

## Gates

All run on this branch, all exit 0:

```
npm run test:ssr                 mtest components=28 failed=0
npm run test:audit               audit entities=119/119 jes=3943 fails=0
npm run test:audit-mutations     mutation-harness cases=40 proved=40 broken=0 baseline_clean=true
npm run build
node tools/run-verifiers.mjs     Verifier summary: 46/46 passed
node verify-global-visible-english.mjs
npm run test:navigation-a11y
git diff --check
tools/analysis/unit-cost-cogs.js   failures=0
tools/analysis/ic-elimination.js   failures=0
tools/analysis/opening-equity.js   failures=0
npm run test                     all 21 scripts, run in segments
```

The mutation harness went from 36 to 40 cases; the four additions are listed under H-4. No
rule was removed, relaxed or re-scoped to make anything pass.
