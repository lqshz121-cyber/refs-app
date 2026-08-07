# Consolidation and elimination

REFS can now consolidate. Before this change the group's intercompany balances
mirrored correctly (118/118 pairs) and a script could prove that they netted to
zero, but there was no consolidation entity, no elimination ledger and no
consolidated report. `tools/analysis/consolidated.js` printed a 119-entity trial
balance with the header *"no eliminations"* and that was the whole of it.

What exists now:

| Piece | File |
| --- | --- |
| Group model (119 explicit membership rows) | `src/consolidation-groups.js` |
| Elimination engine and consolidated statements | `src/consolidation.js` |
| Consolidation workspace (`/consolidation`) | `src/module-consolidation.jsx` |
| Measurement | `tools/analysis/consolidation.js` |
| Regression gate | `verify-consolidation-invariants.mjs` |
| Intercompany lot transfers in the seed | `src/seed.js` (`IC_LOT_TRANSFERS`) |

---

## 1. The group model

`src/consolidation-groups.js` holds a table, not a rule. Every one of the 119
entities has exactly one membership row naming its group, its immediate parent,
its ownership in **integer basis points**, and its consolidation method. Nothing
reads an entity name or `entity_type` at runtime to decide where an entity
belongs. An entity that is not in the table is not in the group, and the engine
says so rather than guessing.

```
WBG        Wan Bridge Group - consolidated        ultimate parent: entity 1  (WBGR)
  +- WBG-LAND   Land companies                    parent: entity 2  (WBLD)   14 members
  +- WBG-DEV    Development / project companies   parent: entity 3  (WBDE)   50 members
  +- WBG-VERT   Home building (vertical)          parent: entity 4  (WBHO)   13 members
  +- WBG-CORP   Corporate                         parent: entity 15 (WBAI)    7 members
  +- WBG-FUND   Investment funds                  parent: entity 32 (FDF4)   24 members
  +- WBG-SVC    Service companies                 parent: entity 33 (WBPM)    4 members
```

The six segment parents are themselves members of `WBG` and report to entity 1.
Entity 1 has no parent. Any group code can be reported on its own; the engine
consolidates that group and everything under it.

**Ownership basis.** `ownership_bp` is an integer, 10000 = 100.00%. `method` is
one of:

* `FULL` — consolidated line by line; 100% of the member's balances enter the
  consolidated column and 100% of its intercompany balances eliminate.
* `EQUITY` — outside the line-by-line boundary. Its intercompany balances with
  the group then **cannot** eliminate, because only one side of the pair is
  inside the boundary; the engine reports each one.
* `EXCLUDED` — outside the boundary entirely.

Every member today is `FULL` at 10000 bp. That is what the data supports, not a
placeholder: the seeded ledger carries no non-controlling capital — every equity
account is a group contribution — so there is no minority interest to measure.
`EQUITY` and `EXCLUDED` are honoured by the engine and are proved to do work by
the measurement script (excluding the funder leaves a `(6,901,500.00)`
intercompany residual and 865 reported unmatched items).

**The model is auditable.** `validateConsolidationModel()` fails on: a duplicate
membership row, an entity in the master with no row, a row for an entity that is
not in the master, a non-integer or out-of-range ownership, `FULL` on 50% or
less, a parent that is not a member, an ownership cycle, more than one root, and
the elimination entity appearing in the entity master. The verifier runs it.

---

## 2. The elimination ledger

An elimination is a **journal**, not a subtraction in a report.

* It lives on `ELIMINATION_ENTITY` — entity 900, code `ELIM`. That entity is
  deliberately **not** in `ENTITIES`: it has no bank account, no period master,
  no chart of its own, and nothing may ever be posted to it by a user.
* Consolidated column = entity ledger **plus** elimination ledger. Delete the
  elimination ledger and every entity's books are exactly as posted.
* Each entry has a stable id (`ELIM-WBG-2026-07-IC-BAL-0001`), a rule code,
  lines with debit/credit in integer cents, and a `sources[]` array naming every
  posted journal line it was derived from.
* Eliminations are **derived deterministically**: the same posted books produce
  the same batch with the same numbers every time. Building the batch is a read.
  It is not "auto-posting" — nothing reaches an entity ledger and nothing changes
  a posting status. The verifier proves this two ways: a byte signature of the
  posted ledger before and after two builds, and a source check that the engine
  never assigns to a journal field and never imports `repo.js`,
  `je-workflow.js`, `document-posting.js` or `seed.js`.

### Elimination types and their triggers

| Type | Trigger | Entry |
| --- | --- | --- |
| `E-IC-BAL` | A posted line on an intercompany account (125xxx Due from Related Party, 291xxx Due to/from) whose subsidiary **member** is another entity consolidated in the same group. | Reverses both sides of the pair, one entry per counterparty pair per period. The member is preserved on every line, so a subsidiary-ledger account never loses its counterparty. |
| `E-IC-PL` | A revenue or expense line in a journal that **also** carries an intercompany line naming a consolidated group counterparty. | Dr the intercompany revenue, Cr the intercompany expense, one entry per pair per period. |
| `E-IC-PROFIT` | A paired intercompany asset transfer (both journals carry the same `ic_pair_id`) where the receiver capitalised **more** than the transferor released. | Dr the transfer gain (787001), Cr the receiver's inventory, for the part of the asset the group still holds. |

`E-IC-PL` is detected from the ledger, not from an allow-list of rule codes. That
matters: the *expense* side of the intercompany outsourcing fee carries no
intercompany rule code at all (`src/seed.js` sets `R-IC-SVC-01` only on the
income side). A rule-code allow-list would have eliminated one side of that pair
and left the other, and the entry would not have balanced.

The transfer-gain account 787001 is **excluded** from `E-IC-PL`. The receiver of
an intercompany asset books no expense against the transferor's gain — it books
an asset. That margin is `E-IC-PROFIT`'s business, and it is also the one
intercompany result that must *survive* consolidation once the asset has been
sold outside the group.

### How `E-IC-PROFIT` decides

For each `ic_pair_id`:

* `released` = what the transferor credited off inventory/CWIP (group cost).
* `capitalised` = what the receiver debited to inventory/CWIP (what it paid).
* `unrealised = capitalised - released`.

Then:

* `unrealised > 0` and the receiver has **not** relieved the unit to cost of
  sales → eliminate all of it.
* the receiver has relieved the whole unit to cost of sales → the group sold it
  to somebody outside the group, the profit is real, **nothing is eliminated**.
* partly relieved → the elimination is scaled by the part still held, floored to
  whole cents; the count of these is reported in `diagnostics`.
* `unrealised < 0` (moved at **below** group carrying cost) → **not** eliminated,
  and a warning is raised. The literal reading of "intragroup profits and losses
  are eliminated in full" would write the asset back up to group cost. This
  consolidation deliberately does not: an internal transfer at a loss is the
  clearest impairment indicator a group ledger produces, and REFS holds no
  recoverable amount with which to decide the write-down was wrong. It is
  reported and left in. See "Residual risk".

---

## 3. Consolidated statements and the drill-down path

`src/module-consolidation.jsx` (route `consolidation`, General Ledger group)
shows five views behind a segmented control: **Trial Balance**, **Balance
Sheet**, **Income Statement**, **Eliminations**, **Group**. The first three
carry three money columns in the same order everywhere:

```
Account   Name                    Entity totals      Eliminations      Consolidated
```

Drill-down path:

```
consolidated figure
  -> the entities behind the entity column        (entity, debit, credit, line count)
  -> the eliminations applied to that account     (id, type, period, debit, credit)
       -> the elimination's own lines             (account, member, source entity)
       -> the posted journal lines it came from   (je_number, entity, period, account, member, amounts)
```

`consolidatedAccountDetail(result, code)` and `eliminationDetail(result, id)`
are the same functions the workspace uses; the measurement script and the
verifier call them directly. The verifier asserts that **every** consolidated
account's entity column re-adds from the entities behind it, that any account
with a non-zero elimination names its eliminations, and that every elimination
names at least one posted journal line on an entity in the master.

Consolidation is a **read**. There is no command to authorise and no new
permission: like GL / TB / BS / IS the workspace is reachable by every role that
can reach the ledger, including `AUDITOR` and `READ_ONLY`, whose permission lists
are empty and who need consolidated statements most. No control on the page
posts, approves, exports beyond the shared table CSV, or changes any record.

---

## 4. What is eliminated, and what is not

**Eliminated**

* Intercompany receivable and payable between two fully consolidated members —
  `$99,838,058.00` of gross intercompany turnover, leaving `$0.00` on every
  intercompany account.
* Intercompany revenue and the matching intercompany expense —
  `$2,153,981.00` on each side (interest charged by the funds to the developer,
  the outsourcing service fee charged by the service hub, and the R&D service
  fee).
* Unrealised intercompany profit capitalised in group inventory —
  `$55,500.00` across six land-to-homebuilder lot transfers, together with the
  matching transfer gain in the group result.

**Not eliminated, on purpose**

* **Investment in subsidiary against subsidiary equity.** Account 158001 exists
  in the chart but carries no posted balance and no member entity holds equity
  issued by another, so there is nothing to eliminate and no elimination type was
  invented for it. If the seed ever books an intercompany equity investment this
  is the first gap to close.
* **Non-controlling interest.** Not measured. See "Residual risk".
* **Intercompany transfers below group carrying cost.** Reported as an impairment
  indicator, left in.
* **Third-party balances parked in an intercompany account.** These cannot
  eliminate by definition. The engine reports each one as a warning rather than
  dropping it; the audit gate (`AUD-IC-001`) already refuses to let one be posted.
* **Unrealised profit on intercompany services and interest that has been
  capitalised.** The seeded intercompany service fee and interest are expensed,
  not capitalised, so there is no service margin sitting in an asset. If an
  intercompany fee is ever capitalised into CWIP, `E-IC-PROFIT` will not find it —
  it only follows paired asset transfers.
* **Deferred tax on eliminations.** REFS holds no tax basis. Nothing is
  attempted.

---

## 5. A change this made to the entity ledgers

`src/unit-transfer-pairing.js` used to have the *receiving* entity record the
unit at the group's carrying cost and take the transferor's gain to profit and
loss as an offset. That pushed the consolidation entry down into a separate
company's ledger: the buyer's balance sheet understated an asset it had paid for
and its income statement carried a loss it had not incurred. No separate-company
report of that entity could ever have been right.

The receiver now capitalises what it paid, the transferor records its gain, and
the elimination happens where it belongs. `tools/analysis/ic-elimination.js`
section `[7]` was changed to match: it used to assert that the *buyer's own
ledger* carried the unit at group cost — it was checking the wrong ledger. It now
checks the separate-company facts on the built pair and then runs that pair
through the real consolidation engine and measures the consolidated inventory,
the consolidated gain and the consolidated intercompany balance. That is a
stricter test than the one it replaces, because it exercises the elimination
code instead of asserting an outcome.

---

## 6. Proof

`tools/analysis/consolidation.js` measures, and exits 1 on any failure:

| # | Measured |
| --- | --- |
| 0 | The group model validates; the elimination entity is not in the entity master. |
| 1 | Every elimination is on entity 900; the posted ledger is byte-identical after building the batch twice; every elimination type produced entries. |
| 2 | Every elimination balances in itself; the batch balances. |
| 3 | Consolidated intercompany residual is `0.00` **and** no intercompany account carries any consolidated balance. |
| 4 | Consolidated Assets = Liabilities + Equity + current earnings, exactly; the consolidated trial balance ties. |
| 5 | Intercompany revenue and expense measured independently of the engine; consolidated revenue and expense equal the entity column less exactly that amount. |
| 6 | Paired transfers measured independently; eliminations remove exactly the margin capitalised in group inventory; no transfer gain survives. |
| 7 | Every consolidated figure re-adds from its drill-down; every elimination names its source lines. |
| 8 | Suppressing each elimination type in turn breaks the consolidated statements; excluding a member from the group leaves an intercompany residual. |
| 9 | Every intercompany balance the engine could not eliminate is reported, and there are none on the full group. |

The residual netting to zero is deliberately **not** the headline test. The
group's due-froms already equal its due-tos, so the total is zero whether or not
anything eliminates — which is exactly how `$10.5m` of intercompany receivable
and `$10.5m` of intercompany payable can both sit on a "balanced" consolidated
balance sheet. The test is that no intercompany account carries *any*
consolidated balance.

`verify-consolidation-invariants.mjs` pins all of the above plus the source
contracts (elimination types declared, workspace routed and in the navigation,
`SEED_V` raised, no elimination pushed into an entity ledger). It is
auto-discovered by `tools/run-verifiers.mjs`.

### Measured, at 2026-07, group WBG

```
elimination ledger: 1008 journals, batch ELIM-WBG-2026-07, all on entity 900
  E-IC-BAL      742 entries       62,323,948.00
  E-IC-PL       260 entries        2,153,981.00
  E-IC-PROFIT     6 entries           55,500.00
  batch total: debit 64,533,429.00 credit 64,533,429.00 balanced=true
  eliminations that do not balance in themselves: 0 of 1008

intercompany       ENTITY TOTALS        ELIMINATIONS       CONSOLIDATED
  125000            10,521,352.00    (10,521,352.00)               0.00
  291000           (8,912,976.00)       8,912,976.00               0.00
  291001           (1,608,376.00)       1,608,376.00               0.00
  accounts still carrying a consolidated balance: 0

                     ENTITY            ELIMINATIONS        CONSOLIDATED
  assets       63,715,236.74        (10,576,852.00)       53,138,384.74
  liabilities  25,163,945.50        (10,521,352.00)       14,642,593.50
  equity       31,893,011.12                   0.00       31,893,011.12
  earnings      6,658,280.12            (55,500.00)        6,602,780.12
  out of balance: 0.00

  revenue      52,237,449.00         (2,153,981.00)       50,083,468.00
  expense      45,579,168.88         (2,098,481.00)       43,480,687.88
  net income    6,658,280.12            (55,500.00)        6,602,780.12

suppression test
  without E-IC-BAL     -> 21,042,704.00 of gross intercompany balance left on the
                          consolidated balance sheet; assets 63,659,736.74 instead
                          of 53,138,384.74
  without E-IC-PL      -> consolidated revenue 52,237,449.00 instead of 50,083,468.00;
                          consolidated expense 45,634,668.88 instead of 43,480,687.88
  without E-IC-PROFIT  -> assets 53,193,884.74 instead of 53,138,384.74; inventory
                          20,010,522.41 instead of 19,955,022.41; transfer gain
                          55,500.00 left in the result
  excluding entity 3 from the group -> intercompany residual (6,901,500.00),
                          865 unmatched intercompany warning(s)
```

---

## 7. Residual risk

1. **Non-controlling interest is not measured.** Every member is 100% owned in
   the model because the ledger carries no non-controlling capital. The
   `ownership_bp` field exists and is enforced (`FULL` requires more than 50%),
   but nothing splits consolidated equity or consolidated earnings between the
   parent and a minority. The moment a member is genuinely part-owned, the
   consolidated equity and earnings figures on this page will be wrong and
   nothing here will detect it.
2. **Investment-in-subsidiary elimination does not exist.** There is no posted
   intercompany equity investment to eliminate today. If one is booked, the
   consolidated balance sheet will double count it — the investment on the
   parent and the capital on the subsidiary — and no check in this branch fires.
3. **`E-IC-PROFIT` only follows paired asset transfers.** It needs both journals
   to carry the same `ic_pair_id`. An intercompany asset sale booked as two
   unlinked journals is invisible to it. Unpaired `ic_pair_id` groups are
   reported as warnings, but a transfer that never carried a pair id at all
   raises nothing.
4. **Partial realisation is proportional, not specific.** When part of a
   transferred unit has been relieved to cost of sales, the remaining unrealised
   margin is scaled by cost and floored to whole cents. No case in the current
   ledger exercises that branch (`transfer_pairs_part_realised = 0`), so it is
   implemented and unproved.
5. **Transfers below group carrying cost are left in.** Group inventory and the
   group result both carry the reduction, and a warning names it as an
   impairment indicator. If it is not an impairment, the consolidated statements
   understate the asset. The consolidation cannot tell which.
6. **The consolidation has no period control of its own.** It reads posted
   journals through a period; it does not check that the periods it is
   consolidating are closed, and it will happily consolidate an open period. It
   posts nothing, so nothing is authorised incorrectly, but a consolidated
   statement over an open period is a draft and the page does not say so.
7. **No currency translation.** Every group is `USD` and no rate is applied.
   `WB Cayman LP` and `WB Opportunity Fund VI Cayman L.P.` are consolidated at
   their ledger amounts with no translation and no cumulative translation
   adjustment.
8. **Not screenshotted.** This branch was built without a browser (`file://` is
   blocked in the sandbox). The workspace renders under server-side rendering in
   the SSR gate (`components=29 failed=0`), the design-system and accessibility
   verifiers pass, and every figure on the page is proved by the measurement
   script. Nobody has *looked* at it. Layout, contrast in the rendered dark
   theme, and the behaviour of the two drill-down drawers at narrow widths are
   static reasoning, not observation.
