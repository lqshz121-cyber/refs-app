# Audit gate hardening — `audit.js` / `npm run test:audit`

Branch `claude/harden-audit-gate`, from `ed27d74`.

## 1. What was wrong

`audit.js` was 46 lines and reported `entities=119/119 jes=3656 fails=0`. That
number was treated as proof that the books were correct. It was not. The old
gate carried exactly four content rules:

1. per-journal balance, with a `0.005` float tolerance;
2. account code exists in the demo COA or the WBS master;
3. the `validateJE` catalog (line shape, subsidiary member);
4. an `AUTO` journal names a source document and a rule code.

A ledger generator that only ever emits two-sided entries cannot violate rule 1,
and only ever uses accounts it took from the master, so it cannot violate rule 2.
The gate was mostly re-checking what the generator guarantees.

Measured, not remembered — `tools/analysis/audit-before-after.js` re-implements
the previous gate exactly as it stood at `ed27d74` and runs every injection in
the mutation catalogue through it:

```
previous gate on the shipped seed: fails=0
previous gate caught 6 of 36 injected defect classes; the other 30 passed straight through.
```

Of the 6 it caught, 3 were caught only incidentally and with the wrong name: a
four-digit account code was reported as `unknown account 7050`, and a pair of
negative amounts as `unbalanced or empty` (because `jeTotals().debit` went
negative, not because anything checked signs).

## 2. What the gate reports now

Two lines, kept separate on purpose. This distinction is unchanged in meaning
and is applied deliberately to every new rule.

```
audit entities=119/119 jes=3656 fails=0
audit-rules-fired <rule>=<count> ...            (only when something fired)
period-control PERIOD_CONTROL_EXCEPTIONS_FOUND closed_period_journals=26
  unconfigured_entity_periods=943 unconfigured_journals=3583
```

- **`fails=`** counts journal **CONTENT** defects. The books are wrong. Exit 1.
- **`period-control`** counts posting **AUTHORIZATION** defects on already
  Posted, immutable evidence. The books may be right; nobody opened the period
  they sit in. A human resolves those by an authorised period action or by a
  reversal. They never become `fails`, and the same detector drives the
  Exception Center. The 26 closed-period journals and 943 unconfigured
  entity/period pairs in the seed are known, surfaced, and unchanged.

**How each new class was classified, and why.** A content rule asks *is this
entry a correct record of what happened*; a control rule asks *was this entry
allowed to be made*. Every rule added here is a content rule, because every one
of them describes an entry that would still be wrong in a fully open period.
Two are worth calling out because they look like period/entity questions:

- `AUD-PER-001` (period `2027-13`) is **content**, not control. No period
  authority can open a period that cannot exist, so there is no authorization
  decision to make. Same for a `period_code` that is absent or malformed.
- `AUD-ENT-001` (a journal on an entity that is not in the entity master) is
  **content**, not control. The period master cannot arbitrate a posting for an
  entity that does not exist.

Classifying either as a control exception would have hidden them inside the 943
unconfigured pairs, which is exactly the failure mode this work exists to remove.

A failure line names the journal, entity (id and code), period, account (code and
name) and the rule, followed by what the rule requires and what the entry does
instead:

```
FAIL AUD-LOAN-001 je=JE-2026-07-1001 entity=2 (WBLD) period=2026-07
  account=164200 (CWIP - Building) :: a loan draw is Dr Cash / Cr Loan Payable.
  This journal debits 164200 CWIP - Building for $500,000.00, booking borrowed
  money as cost. The cash that actually arrived is never recorded, the loan
  balance is right for the wrong reason, and the cost is overstated by the whole
  draw.
```

At most 8 lines per rule are printed, then a count of the rest, so one systemic
defect cannot bury the others.

## 3. Money

Comparisons are now integer arithmetic in the ledger's minor unit, which is one
ten-thousandth — the precision Postgres stores as `numeric(20,4)`. The
per-journal `0.005` float tolerance is gone. There is no tolerance anywhere in
the file.

Two rules come out of that:

- `AUD-BAL-001` — debit total must equal credit total exactly, in
  ten-thousandths.
- `AUD-BAL-002` — no amount may carry more precision than `numeric(20,4)` can
  hold. Detected from the decimal **text**, not from a float multiplication,
  because `1703376.86 * 10000` is `17033768599.999998` in binary floating point
  and a naive scale test reports two false positives on the shipped seed.

**Effect of tightening the tolerance on the shipped seed: none.** All 3,656
journals already tie exactly at 1/10,000, so `fails` did not move. What changed
is what now gets rejected: the `within-old-0005-tolerance` injection (0.004 out)
passed the old gate and fails the new one, and `sub-minor-unit-precision`
(a 5-decimal amount) is caught where nothing looked before.

## 4. Defect classes, before and after

"Before" is measured by `tools/analysis/audit-before-after.js`. "After" is
measured by `tools/analysis/audit-mutation-harness.mjs`, which runs the real
gate binary. Every row's mutation is named; run one with
`REFS_AUDIT_INJECT=<mutation> npm run test:audit`.

The 16 classes from the reference probe (`gate-probe.js` @ `785e571`) first:

| # | Defect class | Before | Rule now | Mutation | Counted as |
|---|---|---|---|---|---|
| 1 | Posting to a WBS HEADER account (`110000`, kind=H) | not caught | `AUD-COA-003` | `header-account-posting` | fail |
| 2 | Posting to a WBS TOTAL account (`199000`, kind=T) | not caught | `AUD-COA-003` | `total-account-posting` | fail |
| 3 | Security deposit credited to revenue, not a liability | not caught | `AUD-DEP-001` | `deposit-to-revenue` | fail |
| 4 | Loan draw booked as cost instead of `Dr Cash / Cr Loan Payable` | not caught | `AUD-LOAN-001` | `loan-draw-as-cost` | fail |
| 5 | Interest expensed while the project is UNDER_CONSTRUCTION | not caught | `AUD-LOAN-002` | `interest-expensed-under-construction` | fail |
| 6 | COGS 70× the unit's accumulated cost | not caught | `AUD-INV-001` | `cogs-70x-unit-cost` | fail |
| 7 | One-sided intercompany (due-from with no matching due-to) | not caught | `AUD-IC-002` | `one-sided-intercompany` | fail |
| 8 | Posting into a CLOSED / unconfigured period | reported on the control line | *(unchanged, deliberate)* | — | **control exception** |
| 9 | Posting to an impossible period (`2027-13`) | not caught | `AUD-PER-001` | `impossible-period` | fail |
| 10 | Posting to a nonexistent entity | not caught | `AUD-ENT-001` | `nonexistent-entity` | fail |
| 11 | Construction cost with no Project / Unit / Cost Code / Vendor | not caught | `AUD-CON-001`, `AUD-CON-002` | `construction-no-dimensions`, `construction-invoice-missing-costcode` | fail |
| 12 | Duplicate journal entries | not caught | `AUD-DUP-003` | `duplicate-journal` | fail |
| 13 | Suspense account left with an unexplained balance | not caught | `AUD-SUS-001` | `suspense-balance` | fail |
| 14 | Depreciation never run | not caught | `AUD-FA-001` *(conditional — see §7)* | `depreciation-never-run` | fail |
| 15 | Negative debit and negative credit that still net to balanced | caught, mis-named `unbalanced or empty` | `AUD-SIGN-001` | `negative-both-sides` | fail |
| 16 | Balanced only inside the 0.005 float tolerance (0.004 out) | not caught | `AUD-BAL-001` | `within-old-0005-tolerance` | fail |

The remaining classes named in the accounting red lines:

| Defect class | Before | Rule now | Mutation | Counted as |
|---|---|---|---|---|
| Interest capitalised once the asset is complete / in use | not caught | `AUD-LOAN-003` | `interest-capitalised-in-service` | fail |
| Interest accrual whose capitalisation basis cannot be evidenced | not caught | `AUD-LOAN-004` | `interest-basis-unresolvable` | fail |
| Journal that does not balance to the cent | caught | `AUD-BAL-001` | `off-by-a-cent` | fail |
| Amount finer than `numeric(20,4)` | not caught | `AUD-BAL-002` | `sub-minor-unit-precision` | fail |
| Six-digit account code degraded to four digits | caught only as "unknown account" | `AUD-COA-002` | `four-digit-account` | fail |
| Account in neither chart | caught | `AUD-COA-004` | `unknown-account` | fail |
| `je_date` outside its `period_code` | not caught | `AUD-PER-002` | `date-outside-period` | fail |
| One document number on two journals in one entity | not caught | `AUD-DUP-001` | `duplicate-je-number` | fail |
| One `je_id` on two journals | not caught | `AUD-DUP-002` | *(structural; no seed or injected case)* | fail |
| Cumulative COGS on a unit exceeding cumulative cost, by one cent | not caught | `AUD-INV-001` | `cumulative-cogs-over-cost` | fail |
| COGS relieved off CWIP without the finished-inventory step | not caught | `AUD-INV-002` | `cogs-not-from-inventory` | fail |
| COGS with no Unit/WBS dimension | not caught | `AUD-INV-003` | `cogs-without-unit` | fail |
| Closing revenue on a unit with no cost of sales | not caught | `AUD-CLS-001` | `sale-without-cogs` | fail |
| PM charge code flagged LIABILITY mapped to a revenue account | not caught | `AUD-DEP-002` | `deposit-mapping-to-revenue` | fail |
| Affiliate account carrying a non-group counterparty | not caught | `AUD-IC-001` | `intercompany-nongroup-member` | fail |
| Intercompany line naming its own entity | not caught | `AUD-IC-003` | `intercompany-self-dealing` | fail |
| Subsidiary-ledger line with no `member` | caught (`4020`) | `AUD-SUB-001` | `subsidiary-no-member` | fail |
| Posted entry amended instead of reversed | not caught | `AUD-IMM-001` | `posted-then-edited` | fail |
| AI-originated journal reaching POSTED unreviewed | not caught | `AUD-AI-001` | `ai-autopost` | fail |
| `AUTO` journal with no source document / rule code | caught | `AUD-TRC-001` | `auto-without-trace` | fail |
| `source_doc_id` that resolves to nothing | not caught | `AUD-TRC-002` | `dangling-source-doc` | fail |
| Entity with no FY2026 ledger coverage | caught | `AUD-COV-001` | *(structural; no injected case)* | fail |

## 5. Mutation testing

An unmutated check is an unproven check. `tools/analysis/audit-mutations.js`
holds one injection per rule; `tools/analysis/audit-mutation-harness.mjs` runs
the **real gate binary** (`audit.cjs`, the same one `npm run test:audit` runs)
once per injection and requires:

1. injected → exit non-zero **and** the rule under test named in the output;
2. injection removed → exit 0.

The harness never re-implements a rule, so it cannot drift from the gate.

Two safety properties of the injection mechanism:

- An injection can only **add** a defect. Nothing in the catalogue removes a
  check, relaxes a threshold or deletes a failure, so `REFS_AUDIT_INJECT` cannot
  be used to make the gate greener than it is on the untouched seed.
- When `REFS_AUDIT_INJECT` is set and the targeted rule does **not** fire,
  `audit.js` itself exits non-zero with `MUTATION-NOT-DETECTED`. A check that
  silently stops working fails the harness even on a clean ledger.

```
$ npm run test:audit-mutations
== BASELINE: the shipped seed, no injection ==
  audit entities=119/119 jes=3656 fails=0
  exit=0

== MUTATION RESULTS ==
PASS  AUD-BAL-001  off-by-a-cent
        injected -> exit=1, rule named=true
        FAIL AUD-BAL-001 je=MUT-0001 entity=2 (WBLD) period=2026-07 :: journal does not
        balance: debit $1,000.01 credit $1,000.00, out by $0.01. Balance is exact in
        ten-thousandths (numeric(20,4)); there is no tolerance.
... 35 further cases ...

== REMOVED: same gate, injection removed ==
  audit entities=119/119 jes=3656 fails=0
  exit=0

mutation-harness cases=36 proved=36 broken=0 baseline_clean=true
```

Single case:

```
$ REFS_AUDIT_INJECT=loan-draw-as-cost npm run test:audit ; echo exit=$?
audit entities=119/119 jes=3657 fails=1 injection=loan-draw-as-cost
audit-rules-fired AUD-LOAN-001=1
FAIL AUD-LOAN-001 je=MUT-0001 entity=2 (WBLD) period=2026-07 account=164200 ...
injection=loan-draw-as-cost expected_rule=AUD-LOAN-001 detected=true
exit=1

$ npm run test:audit ; echo exit=$?
audit entities=119/119 jes=3656 fails=0
exit=0
```

The harness is **not** in the `npm run test` chain (that chain stays at 21
scripts). It is `npm run test:audit-mutations`, 7.4s wall.

## 6. Three genuine defects the new gate found in the shipped seed

The first run of the hardened gate against the untouched seed:

```
audit entities=119/119 jes=3656 fails=40
audit-rules-fired AUD-DUP-001=1 AUD-LOAN-001=1 AUD-SIGN-001=38
exit=1
```

All three are real accounting defects, not check artefacts, and all three were
corrected in `src/seed.js`. `SEED_V` in `src/app.jsx` went `v10` → `v11`.

**(a) `AUD-LOAN-001` × 1 — `JE-2026-07-1001`, entity 2, 2026-07.**
`Dr 164200 CWIP - Building 500,000 / Cr 270100 Construction Loan 500,000`.
A draw is loan cash-in, not cost — `engine.js loanRule('DRAW')` returns
`Dr 111000 / Cr 270100` and Blueprint 7.3 says the same. The entry booked
borrowed money as construction cost, recorded no cash at all for a bank credit
it is explicitly matched to (`BANKTXN-A-1002`, 500,000 CREDIT, "LOAN DRAW FNB"),
and overstated CWIP by the whole draw. `docs/RECONCILE-SEED-PERIOD-CONTROL.md`
§7 and `contracts/MERGE-GUIDE-a77822a.md` both already record it as a known
historical mis-posting. Fixed: the debit moved to `111000`. Balance-neutral for
the journal; entity 2's CWIP falls and cash rises by 500,000, total assets
unchanged.

**(b) `AUD-SIGN-001` × 38 — opening balance sheets at 2025-12-31.**
`opening capital = cash + wip - ap - prior_earnings` goes negative for 38
entities, and the result was written as `credit_amount: -4,350` on `380101 Paid
in Capital - Common`. Direction in a ledger is expressed by the side of the
entry, never by the sign; a negative credit is a debit. Arithmetically the
journal tied, which is exactly why the old gate never saw it, but the trial
balance columns stop being additive. Fixed: a negative capital is now booked as
a debit to `380101` ("Opening capital deficit"). Every account balance is
identical; only the debit/credit column totals change.

**(c) `AUD-DUP-001` × 1 — document number `20260701000001`, entity 2, 2026-07.**
Two entirely different journals carried it: `je_id 1000` (the demo capital
contribution, 800,000) and `je_id 9701` (a scraped WBLD dividend run, 8,400.74).
A journal number identifies one journal. Fixed: the demo fixture was renumbered
to `20260701000501`.

This is a deliberate departure from "do not modify `src/seed.js`". All three are
corrections of wrong accounting, not adjustments to make a check pass; no check
was weakened, no threshold moved, and no rule was scoped around the seed. If you
want to see the gate fail on them, revert the three hunks in `src/seed.js` and
re-run — the output above is exactly what it prints.

## 7. Rules that are conditional, and why

- `AUD-FA-001` ("depreciation never run") cannot be an unconditional
  "there must be depreciation entries" rule: the absence of an entry is outside
  the gate's model, and the shipped seed legitimately holds no depreciable fixed
  assets. It fires when an entity **carries a positive balance in a depreciable
  fixed-asset account and has never posted depreciation**. `163000
  Inventory_Buildings` and `1651xx Inventory` are for-sale inventory in the WBS
  master and are excluded; including them raised one false positive on entity 2.
- `AUD-CON-001` scopes to *vertical* construction WIP (`164200/164300/164400/
  164500/164600/164700/164900`). `164100 CWIP - Land` is excluded because land
  development at a LandCo is a parcel cost that legitimately carries no unit.
- `AUD-DEP-001` fires when a journal **identifies itself** as a deposit — by
  rule code `R-PM-16*`, by journal or line description, or by source-document
  type. A completely unlabelled `Dr Cash / Cr Revenue` pair is indistinguishable
  from a sale, and no ledger-only rule can separate them. See §9.
- Duplicate detection is by **identical line signature** (entity, period, date,
  and the sorted set of account/debit/credit/unit/member), not by shared
  `source_doc_id`. A shared source document is legitimate here: one closing
  statement produces both the sale journal and the COGS relief, 132 such pairs
  in the seed. Keying on the document would have raised 132 false positives.

## 8. Cost

`node audit.cjs` runs in 0.17–0.20s wall on 3,656 journals (was ~0.1s). Six
passes, all linear or `n log n`. The `npm run test` chain is unchanged at 21
scripts.

## 9. What this gate still cannot catch

Stated plainly, because a gate that overstates its coverage is worse than one
that admits a hole:

1. **An unlabelled misclassification.** `Dr 111000 / Cr 491800` with no memo,
   no rule code and no source document is a valid sale and a mis-booked security
   deposit at the same time. `AUD-DEP-001` catches the labelled form (which is
   how REFS posts one), and `AUD-DEP-002` catches the mapping that would produce
   the wrong entry at source. Neither can catch a two-line entry that carries no
   evidence of what it is. This is a completeness limit of ledger-only auditing,
   not an implementation gap.
2. **Missing entries in general.** `AUD-FA-001` and `AUD-CLS-001` catch two
   specific absences (no depreciation against a depreciable asset; no COGS
   against a unit sale) because each has a *positive* trigger in the ledger. A
   transaction that was never recorded at all leaves nothing to trigger on.
3. **Amounts that are simply wrong.** Nothing here re-prices a contract or
   re-computes interest from a rate; the gate tests relationships between
   entries, not their agreement with external evidence. Loan balance vs lender
   statement stays an exception (`LOAN_BALANCE_MISMATCH`), not a gate.
4. **`AUD-DUP-002` (duplicate `je_id`) and `AUD-COV-001` (entity coverage) have
   no mutation case.** Both are structural, and the ledger arrays are built from
   generators that make the states hard to reach without rewriting the
   generator. They are the only two rules in this file that are not
   mutation-proved, and they should be read as unproven.

## 10. Files

| File | What it is |
|---|---|
| `audit.js` | the gate |
| `tools/analysis/audit-mutations.js` | one injection per rule |
| `tools/analysis/audit-mutation-harness.mjs` | runs the real gate once per injection |
| `tools/analysis/audit-before-after.js` | re-runs the previous gate for the "before" column |
| `src/seed.js` | three corrections, §6 |
| `src/app.jsx` | `SEED_V` v10 → v11 |
| `package.json` | `test:audit-mutations` script (not in the `test` chain) |
