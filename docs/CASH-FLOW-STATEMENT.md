# Statement of cash flows

REFS now has one. Before this change the Cash Flow tab was honestly labelled
*Cash movement evidence* and carried the sentence *"This evidence view is not a
complete statement of cash flows"*. It classified whole journals by looking at
the first contra account family it recognised, which put the Cedar Ridge parcel
acquisition — `Dr 161000 900,000 / Dr 163000 2,100,000 / Cr 270100 2,400,000 /
Cr 111000 600,000` — entirely into Financing, because the journal touched
`270100`. A land purchase part-funded by a construction draw is two cash flows,
not one.

| Piece | File |
| --- | --- |
| Classification policy and both methods | `src/cash-flow-statement.js` |
| Statement in the General Ledger workspace | `src/modules-more.jsx` (Cash Flow tab) |
| Consolidated statement | `src/module-consolidation.jsx` (Cash Flows view) |
| Measurement | `tools/analysis/cash-flow.js` |
| Regression gate | `verify-cash-flow-statement.mjs` |

The statement posts nothing. Building it is a read, and the verifier proves the
posted ledger is byte-identical afterwards.

---

## 1. The one identity

```
opening cash + (operating + investing + financing) = closing cash
```

exactly, in **integer minor units**, per entity and consolidated, and closing
cash equals the cash accounts on the balance sheet. Measured, not asserted:

```
[2] entities whose opening cash + net change != closing cash: 0 of 119
    entities whose closing cash != balance-sheet cash accounts: 0 of 119
    entities where the direct and indirect methods disagree:    0 of 119
    entities the statement declares not ready:                  0 of 119
    sum of the 119 entity statements: opening 26,270,000.00 + change 1,312,695.64 = closing 27,582,695.64
```

There is no residual, no plug and no "other" bucket. A posted line that no rule
classifies is **reported** and the statement declares itself **not ready**; it
never lands in a balancing figure.

### Cash means cash, cash equivalents and restricted cash

ASU 2016-18. The cash base is exactly the set the application already treats as
cash (`src/cash-account-scope.js`): operating (`110100`, `111000`), escrow
(`112xxx`), reserve/restricted (`113xxx`), security deposit (`117xxx`) and
payroll-restricted (`118xxx`). There is one definition of cash in this product
and the statement reuses it rather than inventing a second.

A transfer between two accounts *inside* the base is not a cash flow, and falls
out of the arithmetic on its own — the journal has no line outside the base, so
it contributes to no section.

**Fail-closed on the cash-scope gap.** `115000 Cash Clearing`, `115010 Cash &
cash equivalent` and `116000 Operating Cash - 2022` are named as cash in the WBS
chart but are **not** in the application's cash scope. The engine refuses to
classify them (`CF-GAP-CASH`) rather than pick a side, because either choice
silently moves the cash base. Nothing is posted to them today; if anything ever
is, the statement stops being ready and says which account.

---

## 2. How the two methods are built, and what their agreement proves

Every posted journal that moves cash balances: the sum of its cash lines is the
negative of the sum of its non-cash lines. So the cash a journal moved can be
attributed, **exactly and without allocation**, to that journal's own non-cash
lines — one line, one classification, one attribution.

* **Direct** — walk the journals that moved cash; attribute each journal's cash
  movement to its own non-cash lines. Receipts and payments.
* **Indirect** — walk the *account movements* for the period: net income, plus
  the lines of journals that moved no cash at all (the non-cash adjustments),
  plus the movement in operating balance-sheet accounts.

Written out, with `Δ` the period movement of an account in minor units:

```
CFO_direct   = -Σ (non-cash lines of journals that moved cash, classified operating)
CFO_indirect = net income
             + Σ Δ of profit-and-loss accounts presented in investing or financing
             + Σ (lines of journals that moved NO cash, classified operating)
             - Σ Δ of operating balance-sheet accounts
```

and these are equal identically, because `Δ` over all journals is `Δ` over the
cash-moving journals plus `Δ` over the cashless ones.

**What the agreement does and does not prove.** It is not two independent
derivations of the same economics — it is two different aggregations of one
per-line classification. It therefore detects exactly the failures it is there
to detect: a line classified twice, a line missed, a cashless transaction
corrected twice or not at all, and a *context* rule that fires in the
journal-walk and not in the account-walk. It does not prove the policy in
section 3 is the right policy. The independent check is the third one: the raw
movement of the cash accounts themselves, computed with **no classification at
all**, must equal the sum of the three sections.

Measured, consolidated:

```
    Operating    direct     (4,330,315.48)   indirect     (4,330,315.48)   difference         0.00
    Investing    direct               0.00   indirect               0.00   difference         0.00
    Financing    direct       5,643,011.12   indirect       5,643,011.12   difference         0.00
```

Depreciation illustrates the mechanism rather than needing a special case. The
depreciation journal is `Dr 785000 (operating) / Cr 168002 (investing)` and moves
no cash, so the correction adds `+121,333.31` back to operating and removes the
matching phantom inflow from investing. That is the classic add-back, produced by
the identity rather than by a hand-written adjustment line.

---

## 3. The classification policy, per line type

Rules are ordered; the first match wins. Every rule is keyed on the **full
six-digit account code** — nothing truncates, and no rule falls back on account
type. An account no rule claims is refused.

| Rule | Section | Presentation line | Why |
| --- | --- | --- | --- |
| `CF-GAP-CASH` | **refuse** | Cash-named account outside the application cash scope | The account is named as cash but is not in the cash scope the balance sheet uses. Classifying it would move the cash base without saying so. |
| `CF-IC-01` | Financing | Advances to and from affiliates | A standalone entity that funds, or is funded by, an affiliate is financing itself. On consolidation the same balance is internal cash and never reaches a section. |
| `CF-FIN-DEBT-COST` | Financing | Debt issuance and loan costs paid | Costs of obtaining borrowings, and the lender deposit that secures them, are financing outflows however they are capitalised. |
| `CF-FIN-DEBT` | Financing | Loan draws and principal repayments | RED LINE. A construction loan draw is Dr Cash / Cr Loan Payable - a financing inflow, never a cost. Repayment of principal is the financing outflow that reverses it. |
| `CF-FIN-NOTE` | Financing | Notes payable drawn and repaid | A note payable is borrowing, regardless of where the chart files it. |
| `CF-FIN-PREF` | Financing | Preferred capital classified as a liability | Preferred capital carried as a liability is still capital raised; its cash is financing. |
| `CF-FIN-DIST` | Financing | Distributions and draws paid to owners | A distribution is a return of capital to owners. The withholding tax deducted from it stays in operating with the other taxes. |
| `CF-FIN-CONTRIB` | Financing | Capital contributions received | Capital put in by members, partners or the developer is a financing inflow. |
| `CF-FIN-RESULT` | Financing | Result carried in equity (nil in a closed period) | Retained earnings and the current-year result are an accumulation, not a transaction. The year-end close moves one to the other inside this line and nets to nil; anything else here is a defect and is meant to be visible. |
| `CF-FIN-RESERVE` | Financing | Replacement and reserve fund movements | Reserve-fund contributions are funding set aside by owners. JUDGEMENT, and unexercised by the posted ledger. |
| `CF-OP-AR` | Operating | Receipts from customers and residents | Rent, management fees, sale proceeds receivable and other trade receivables are the operating cycle. |
| `CF-INV-NOTE-RCV` | Investing | Notes receivable advanced and collected | Lending money to a third party is investing, not a trade receivable. |
| `CF-OP-PREPAID` | Operating | Prepaid expenses and other operating assets | Prepaid insurance, tax and supplies are operating working capital. |
| `CF-INV-RESERVEFUND` | Investing | Reserve and replacement funds | A replacement reserve is money set aside to buy capital assets. JUDGEMENT, and unexercised by the posted ledger. |
| `CF-INV-EQUITY-METHOD` | Investing | Investments in subsidiaries, joint ventures and associates | Buying and selling an interest in another undertaking, or an investment security, is investing. |
| `CF-OP-INVENTORY` | Operating | Land and construction spend on inventory held for sale | THE DEVELOPER RULE. Land, land improvements, construction work in progress and completed homes are INVENTORY for a merchant builder. Buying and building them is the operating cycle, not investing - the group is not acquiring a productive asset, it is manufacturing the product it sells. These are the 161x/162x/163x/164x/1651x accounts; property held for use lives in 165000, 1652xx-1659xx and 166000 and is a different rule. |
| `CF-INV-PPE` | Investing | Property and equipment held for use | THE DEVELOPER RULE, other side. Investment homes, vehicles, furniture, leasehold improvements and their accumulated depreciation are held to produce rent or to be used, not to be sold as product. Buying and disposing of them is investing. |
| `CF-INV-INTANGIBLE` | Investing | Software and other intangible assets | Capitalised software and organisational costs are long-lived assets acquired. |
| `CF-OP-COMMISSION-ASSET` | Operating | Capitalised leasing commissions | A leasing commission is a cost of obtaining a lease - part of the rental operating cycle. |
| `CF-OP-DEPOSIT-PAID` | Operating | Deposits paid and refunded | Utility deposits and earnest money on land bought for inventory sit in the operating cycle. The lender-required construction loan deposit (185100) is financing and is matched earlier. |
| `CF-OP-INTEREST` | Operating | Interest paid | ASC 230 puts interest paid in operating. Where the interest was CAPITALISED rather than expensed, this rule looks through the payable to what the capitalisation funded: into inventory (164500 CWIP capitalised interest) it stays operating, because for a developer the inventory it funds is operating; into property held for use it becomes investing, which is what ASC 230-10-45-13(c) requires. See docs/CASH-FLOW-STATEMENT.md. |
| `CF-OP-DEPOSIT-HELD` | Operating | Security deposits received and refunded | A resident deposit taken into UNRESTRICTED operating cash is operating: the money is available to the business and the liability is part of the rental cycle. A deposit taken into a RESTRICTED security-deposit account (117xxx) is financing: the group holds the money for the resident, cannot use it, and the arrangement is a refundable borrowing. The rule reads which cash account the journal actually used. |
| `CF-OP-AP` | Operating | Payments to vendors, contractors and for operating costs | Trade payables, accruals and tax payables settle the operating cycle. Where the payable funded construction work in progress it is still operating, because that work in progress is inventory. |
| `CF-OP-REVENUE` | Operating | Revenue | All income, including interest income, is operating. Proceeds of an inventory unit sale are operating; proceeds of disposing of property held for use are matched by the disposal rules and land in investing. |
| `CF-INV-DISPOSAL-RESULT` | Operating | Result on disposal or transfer | A gain or loss follows the asset. On an inventory lot it is operating; on property held for use it is investing, so that the whole of the disposal proceeds - carrying amount and result together - reports in investing rather than being split across two sections. |
| `CF-INV-LOSS` | Investing | Investment losses | A loss on an investment belongs with the investment cash flows. |
| `CF-INV-CAPEX` | Investing | Capital expenditure | The 780xxx CAPITAL EXPENSE family buys capital items. Charging them through the profit and loss does not make buying a dishwasher an operating cash flow. JUDGEMENT, and unexercised by the posted ledger. |
| `CF-OP-EXPENSE` | Operating | Operating costs paid | Cost of sales, property expense, administrative expense, depreciation and interest expense are the operating result. Depreciation is non-cash and is added back through the non-cash adjustment, not by excluding the account. |

### 3.1 The developer split — the call a generic implementation gets wrong

A merchant builder does not *invest* in the homes it sells; it manufactures them.
So:

* **Operating** — `161xxx` inventory land and land carrying cost, `162000` land
  improvements, `163000` inventory buildings, `164000`–`164699` construction work
  in progress in all its forms, `164900` CWIP accrual, `1651xx` completed
  inventory. Land acquisition, development spend, construction draws to
  contractors and the proceeds of selling a unit are all operating.
* **Investing** — `165000` furniture and fixtures, `1652xx`–`1659xx` fixed assets
  including `165901 FA - Investment Homes`, `166000` startup assets, and `168xxx`
  accumulated depreciation. Property held to produce rent or to be used.

**What this relies on, stated plainly.** It relies on the chart of accounts
separating the two, which it does: inventory and CWIP live in `161xxx`–`164xxx`
and `1651xx`; held-for-use property lives in `165000`, `1652xx`–`1659xx` and
`166000`. The engine reads the account code and nothing else — not the entity
type, not the project, not a name. If a held-for-use home were ever posted to
`165100 Inventory`, this statement would call it operating and would be wrong,
and no check here would catch it. That is a chart-of-accounts discipline the
statement depends on and cannot itself enforce.

Measured effect, consolidated:

```
  [6] land and construction spend on inventory held for sale -> OPERATING: (3,000,000.00)
      loan draws and principal repayments -> FINANCING:                    3,175,000.00
      property held for use -> INVESTING:                                  0.00
```

Flipping the rule moves `3,000,000.00` from operating to investing and the
statement still ties — proving the tie is a property of the cash, not of the
classification:

```
      flipping the developer split (inventory -> investing) moves the sections: true
        operating (4,330,315.48) -> (1,330,315.48)
        investing 0.00 -> (3,000,000.00)
      the flipped statement still TIES (the tie does not depend on the classification): true
```

### 3.2 Loan draws and repayments — the red line

`Loan Draw = Dr Cash / Cr Loan Payable`, never a cost. `CF-FIN-DEBT` puts the
whole `260000`–`279999` family in **financing**, so a draw can only ever be a
financing inflow and a principal repayment only ever a financing outflow. The
verifier additionally proves no draw journal touches a `5xxxxx`/`6xxxxx`/`7xxxxx`
account at all.

The Cedar Ridge acquisition is the case the old view got wrong. Line-level
classification now splits it correctly:

```
  3,000,000.00 operating outflow   (Dr 161000 900,000 + Dr 163000 2,100,000)
  2,400,000.00 financing inflow    (Cr 270100 construction draw)
    600,000.00 net cash out
```

### 3.3 Capitalised interest paid — the treatment, stated

Interest **paid in cash** is **operating**, and the reason is traced rather than
assumed. The cash payment's contra is an interest-payable account (`220310`,
`220410`, `220451`). `CF-OP-INTEREST` looks *through* that payable to where the
facility's interest accrual actually landed:

* accrued to a profit-and-loss interest expense account (`661000`, `772450`,
  `795000`) → **operating**;
* capitalised into `164500`/`164501 CWIP - Capitalized interest` → **operating**,
  because for a developer the inventory that interest funds is operating;
* capitalised into an asset **held for use** (`165xxx`, `168xxx`) → **investing**,
  which is what ASC 230-10-45-13(c) requires.

Measured on the posted ledger:

```
      interest destination by loan (drives how interest PAID classifies):
        loan 1 -> Operating
        loan 2 -> Operating
      cash interest payments in range: 1, cash effect (29,315.00)
      journals capitalising interest into an asset HELD FOR USE: 0
        (the investing branch of the interest rule is therefore UNEXERCISED by this ledger)
```

The only cash interest payment in the range is `20260701008142`, `29,315.00` on
mortgage `M-2024-003`, whose accrual is **expensed** (`R-LOAN-04` → `795000`).
The capitalised interest that does exist — `164500`, construction facility
`L-2025-014` — was accrued but never paid in cash inside the period, so it
reaches the statement only as a non-cash adjustment (`+51,734.41`) offset by the
matching movement in `220410`. The investing branch of the rule is real code and
the verifier exercises it with an explicit fixture, but **the posted ledger never
reaches it**, and this document does not claim otherwise.

### 3.4 Unit sale proceeds

Inventory unit proceeds are operating: the closing journal `R-CLS-SALE-01` debits
cash and `121011` proceeds receivable and credits `491800` (revenue), all
operating. Disposal of property **held for use** is investing, and
`CF-INV-DISPOSAL-RESULT` makes the gain or loss on that disposal follow the
asset, so the whole of the proceeds — carrying amount and result together —
reports in investing rather than being split across two sections. The
inventory-lot branch is exercised by the intercompany lot transfers; the
held-for-use branch is proved by fixture in the verifier and is unexercised by
the posted ledger.

### 3.5 Security deposits received — the choice, and its reason

**Chosen:** a resident deposit is **operating** when it is taken into
unrestricted operating cash, and **financing** when it is taken into a restricted
security-deposit account (`117xxx`).

The distinction is restriction, not the account name on the liability. Money
commingled with operating cash is available to the business and the deposit
liability is part of the rental operating cycle. Money segregated in a restricted
deposit account cannot be used in operations and the arrangement is economically
a refundable borrowing from the resident — which is what financing means. Because
the cash base includes restricted cash (ASU 2016-18), both cases are genuine cash
inflows; only the section differs.

`CF-OP-DEPOSIT-HELD` implements this by reading which cash account the journal
actually used, not by guessing. **No posted journal exercises it**: the rule
engine's `R-PM-16` deposit rule exists in `src/engine.js` but the seeded ledger
contains no posted deposit receipt, and — separately — that rule currently debits
`111000` operating cash rather than a `117xxx` restricted account, so if it ever
did post, this policy would classify it as operating. Both facts are stated here
rather than smoothed over. The verifier proves both branches with a fixture.

### 3.6 Intercompany — and how it is stopped from manufacturing operating cash

For a **single entity**, an advance to or from an affiliate is financing: the
entity is funding itself, or being funded (`CF-IC-01`).

For the **group**, an intercompany receivable or payable that eliminates inside
the boundary is **internal cash**. This matters because of how the ledger records
a payment made on an affiliate's behalf:

```
entity 3   Dr 125000 Due from Related Party   82,370   Cr 111000 Operating Cash   82,370
entity 1   Dr 220300 A/P Accrual              82,370   Cr 291000 Due to/from      82,370
ELIM       Dr 291000                          82,370   Cr 125000                  82,370
```

Group cash fell by `82,370` and it paid Summit General Contractors for
construction work in progress. Reading each entity's journal on its own would say
the group had a `82,370` *financing* outflow and no operating payment, which is
false. The consolidated walk therefore runs over a **cash pool** = real cash
accounts **plus** intercompany accounts whose counterparty is consolidated in the
same group, and follows the money to the entity that actually spent it. The
result is a `(82,370)` operating payment and nothing in financing.

The pool's own movement equals real cash movement **exactly when intercompany
cash nets to zero**, which is measured rather than assumed:

```
  [4] intercompany cash movement inside the boundary (treated as internal cash):
        inflow      151,640,654.00
        outflow   (151,640,654.00)
        net                   0.00  eliminated: true
      purely internal transaction chains suppressed from the sections: 266 chain(s), 884 journal(s)
      independent check: movement on 125xxx/291xxx after eliminations = 0.00
```

**Phantom gross-ups.** A first implementation of the pool got the *totals* right
and the *lines* wrong: an intercompany lot transfer, in which no bank account
moves at all, grossed up the consolidated operating section by `+55,500` of
"result on transfer" and an offsetting `(55,500)` buried in the inventory line.
Journals joined by an eliminated intercompany balance are now grouped into a
chain — using the same `period | counterparty pair` key the elimination engine
buckets on — and a chain in which **no bank balance moved** is treated as a
non-cash transaction of the group and kept out of every section. The effect is
visible: consolidated `CF-OP-REVENUE` is `49,162,500.00`, which is exactly the
external home-sale revenue in the ledger, with no intercompany service income or
transfer gain inflating it.

A chain is judged to have moved the group's money when its **net real cash is
non-zero**, or when a single journal in it both moved real cash and carried a
line outside the pool — the signature of a payment to somebody outside the group.
The second condition exists so that a chain which happens to net to zero real
cash while still paying an outside party is not suppressed. Residual risk from
this heuristic is in section 6.

### 3.7 What the elimination ledger does, and does not do, to this statement

Measured, and stated because it is counter-intuitive:

```
      consolidating WITHOUT the elimination ledger:
        intercompany cash nets to 0.00 (unchanged: the mirrored pair already nets)
        net change in cash        1,312,695.64 vs 1,312,695.64 with eliminations
        operating total           (4,330,315.48) vs (4,330,315.48) with eliminations
        NET INCOME at the top of the indirect reconciliation 6,658,280.12 vs 6,602,780.12 with eliminations
        difference in net income  55,500.00
      elimination journals that touch a cash account: 0 of 1008
```

The consolidated **cash** totals are invariant to the elimination ledger. That is
not the pool hiding something: every `125xxx` debit already has a mirrored
`291xxx` credit at the counterparty and both are in the pool, so `E-IC-BAL`
reverses two pool accounts against each other and moves nothing. `E-IC-PL` and
`E-IC-PROFIT` touch no cash and no pool account, so they are non-cash
transactions and the correction removes them from every section.

What the elimination ledger **does** change is the top of the indirect
reconciliation — consolidated net income — by exactly the `55,500.00` of
unrealised intercompany profit that `E-IC-PROFIT` removes from group inventory.
The verifier asserts both halves: cash must not move, net income must.

---

## 4. The measured statement

Consolidated, group `WBG`, 119 entities, `2026-01` ~ `2026-07`:

```
== CONSOLIDATED STATEMENT OF CASH FLOWS · DIRECT METHOD ==
  OPERATING ACTIVITIES
    CF-OP-AP                 Payments to vendors, contractors and for operating c      (47,941,093.48)
    CF-OP-AR                 Receipts from customers and residents                          918,968.00
    CF-OP-EXPENSE            Operating costs paid                                       (3,441,375.00)
    CF-OP-INTEREST           Interest paid                                                 (29,315.00)
    CF-OP-INVENTORY          Land and construction spend on inventory held for sa       (3,000,000.00)
    CF-OP-REVENUE            Revenue                                                     49,162,500.00
                             Net cash from operating activities                         (4,330,315.48)
  INVESTING ACTIVITIES
                             Net cash from investing activities                                   0.00
  FINANCING ACTIVITIES
    CF-FIN-CONTRIB           Capital contributions received                               2,503,376.86
    CF-FIN-DEBT              Loan draws and principal repayments                          3,175,000.00
    CF-FIN-DIST              Distributions and draws paid to owners                        (35,365.74)
                             Net cash from financing activities                           5,643,011.12
                           NET CHANGE IN CASH                                           1,312,695.64
                           Cash at the beginning of the period                         26,270,000.00
                           Cash at the end of the period                               27,582,695.64
```

**Investing is genuinely zero, not missing.** The only held-for-use asset in the
ledger — `165901 FA - Investment Homes`, `5,720,000.00` — was recognised on the
opening balance sheet at `2025-12-31`, before the reporting range, and nothing
has been bought or sold since. The investing section is empty because the group
did no investing in these seven months, and the investing rules are therefore
proved by fixture rather than by data. That is a limitation of the dataset, not
of the statement, and it is not papered over.

---

## 5. What is measured, and what is only reasoned

| Claim | Basis |
| --- | --- |
| opening + net change = closing, 119/119 entities and consolidated | **measured**, integer minor units, `tools/analysis/cash-flow.js` [2][3] |
| closing cash = balance-sheet cash accounts | **measured** [2][3] |
| direct and indirect agree in every section | **measured** [2], consolidated section of the script |
| every posted line classified exactly once, none uncategorised | **measured** [1] — 6,611 lines, 0 unclassified |
| intercompany cash nets to zero on consolidation | **measured** [4] — 151,640,654.00 in and out |
| removing an exercised rule breaks the statement | **measured** [8] — 8 move a section, 2 move only the presentation line |
| the developer split is load bearing | **measured** [8] — flipping it moves 3,000,000.00 |
| eliminations never touch cash; they do reach net income | **measured** [8] |
| the Cash Flow tab and the Cash Flows view render and tie | **measured** by server-side render in `verify-cash-flow-statement.mjs` and `mtest.jsx` |
| the two screens look right — spacing, contrast, dark mode, focus rings | **NOT measured.** There is no browser in this environment and `file://` is blocked, so nothing here was screenshotted. The markup reuses the existing `stmt`/`stmt-row`/`stmt-sec`/`Segmented`/`Badge`/`Money` primitives and adds no new CSS, which is static reasoning about visual correctness, not evidence of it. |
| 18 of the 28 rules are correct | **NOT measured.** The posted ledger never reaches them. They are reasoned from the account names in the WBS chart and, where the reasoning is a judgement call, the rule says `JUDGEMENT` in its own text. |

---

## 6. Residual risk

1. **18 of 28 classification rules are unreachable on this ledger.** The
   measurement script names every one of them. In particular the whole of
   investing, both security-deposit branches, the investing branch of the
   capitalised-interest look-through, and the held-for-use disposal branch have
   no posted data behind them. They are exercised by fixture in the verifier,
   which proves the code path runs — not that the policy is right for WanBridge.
2. **The developer split depends on chart discipline the statement cannot
   enforce.** A held-for-use home posted to `165100 Inventory`, or a lot for sale
   posted to `165901`, would be classified wrongly and silently. Nothing here
   detects it.
3. **Three rules are judgement calls with no authority behind them in this
   ledger**: `CF-FIN-RESERVE` (replacement and reserve funds as financing),
   `CF-INV-RESERVEFUND` (reserve fund assets as investing) and `CF-INV-CAPEX`
   (the `780xxx` CAPITAL EXPENSE family as investing). Each says `JUDGEMENT` in
   its own rule text. They should be confirmed with the controller before any
   ledger starts using those accounts.
4. **The internal-chain heuristic is coarse.** Chains are keyed on
   `period | counterparty pair`, which is the granularity the elimination engine
   itself uses, so all of a pair's traffic in a month is one chain. A chain whose
   net real cash is zero *and* whose every cash-moving journal has no line
   outside the pool is suppressed from the sections. A contrived case — a pair
   that, inside one month, both settles internally and pays an outside party in a
   journal carrying no non-pool line — would be suppressed wrongly. The statement
   would still tie; the presentation would understate gross operating flows. No
   such case exists in the ledger and none is detected.
5. **A dimension-filtered view is not a reporting entity.** The property,
   project and loan filters select *lines*, not whole journals, so a filtered
   Cash Flow tab is not expected to tie. The screen says so and marks itself not
   ready rather than showing a filtered statement as if it were a statement.
6. **Non-controlling interests are not measured** — inherited from
   `docs/CONSOLIDATION.md`. Every member is `FULL` at 10000 bp, so 100% of every
   member's cash flow enters the consolidated column. There is no minority share
   of cash flow to present because there is no non-controlling capital in the
   ledger.
7. **Foreign currency is out of scope.** Every entity reports in USD, so there is
   no effect of exchange rate changes on cash line and none is presented. A
   non-USD member would need one and would not get it.
8. **The interest look-through resolves by `loan_id`.** An interest payment
   carrying no `loan_id` falls back to operating. Every posted interest payment
   carries one; a future one might not.

---

## 7. The label

The old view said *"This evidence view is not a complete statement of cash
flows"*. That sentence has been removed, because for the local posted ledger it
is no longer true: the statement has all three sections, ties exactly per entity
and consolidated, reconciles both ways, and classifies every posted line.

Three things were **not** renamed, deliberately:

* **`Cash movement evidence` survives as the name of the drill-down**, the third
  view behind the segmented control. That view is exactly what the name says —
  the direct walk of every posted journal that moved a cash account. It is
  evidence, and calling it that is accurate.
* **The authoritative (API-backed) reports workspace keeps the
  `Cash movement evidence` label** (`src/authoritative-reports-workspace.jsx`).
  That path is served by the accounting API and has none of this engine behind
  it. Renaming it would be a claim about code that does not exist.
* **The statement declares itself not ready** whenever a line is unclassified, a
  section does not tie, the two methods disagree, or a dimension filter is
  active. The honest label is not a fixed string; it is a measured state, and the
  screen shows the measurement.
