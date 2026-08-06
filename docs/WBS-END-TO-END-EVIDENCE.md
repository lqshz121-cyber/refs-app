# WBS → accounting end-to-end evidence

**Status: contract-plus-fixture evidence. This is not a production PASS.**

The real WBS read-only MCP provider is not reachable from this environment and
no credentials exist here. Everything below was produced by running the frozen
in-repository contract (`server/runtime/wbs-readonly-mcp.mjs`,
`server/runtime/wbs-mcp-lineage.mjs`, `server/runtime/wbs-inbound-data-adapter.mjs`)
against **sanitized, invented fixture rows**. No stage of this document should
be read as "WBS works in production".

Section 6 lists, precisely, what a production run still needs.

---

## 1. How to run it

```bash
# from the repository root
npm run wbs:e2e                       # all three scenarios, printed stage by stage
node server/tools/wbs-e2e-harness.mjs payable    # scenario 1 only
node server/tools/wbs-e2e-harness.mjs bank       # scenario 2 only
node server/tools/wbs-e2e-harness.mjs costgl     # scenario 3 only
node server/tools/wbs-e2e-harness.mjs --json     # machine-readable summary

npm run test:wbs-e2e                  # 31 assertions over the same chain
npm run test:wbs-mcp-lineage          # 34 assertions over the frozen mapper
```

Files:

| File | Role |
| --- | --- |
| `server/runtime/wbs-accounting-e2e.mjs` | The chain library: fixed-point money, receipt, event, Draft builder, GL/TB/BS/IS, lineage trace |
| `server/tools/wbs-e2e-harness.mjs` | Runnable harness, three scenarios, stage-by-stage printing |
| `server/tools/wbs-e2e-fixtures.mjs` | Sanitized fixture rows and envelope builder |
| `server/tests/wbs-accounting-e2e.test.mjs` | 31 tests |

The harness performs no network access, holds no hostname, no endpoint and no
credential, and never writes WBS.

---

## 2. Scenario 1 (priority 1): payable → accrual JE → GL → TB → BS / IS

**Reached: Balance Sheet and Income Statement.** Every stage of the requested
chain executed.

### Stage 1–2 · WBS MCP read → immutable receipt

```
transport                : NOT EXERCISED (no provider, no credentials) - fixture envelope
evidence class           : CONTRACT_PLUS_FIXTURE
tool                     : list_payables
contract_version         : WBS-REFS-MCP-V1
environment              : production
captured_at              : 2026-08-05T12:00:00.000Z
source                   : {"system":"WBS","module":"read_only_mcp"}
scope / company          : {"company":"CO-A","period":"2026-07"} / CO-A
record_count             : 3
content_sha256           : c8c044c9794531aac8eadf137c0c146d1f264106f0bfb2099528ff49e4f47d47
content hash verified    : true
currencies               : USD
revision/CDC/tombstone   : false/false/false -> deletion may NOT be inferred
```

The receipt is produced by the frozen `validateWbsReadEnvelope`, not by a
re-implementation. The content hash is independently recomputed from
`canonicalRequestBody(rows)` and compared. A tampered row is rejected with
`WBS_MCP_CONTENT_HASH_MISMATCH` (test: *a tampered row is rejected by the frozen
envelope validator*).

### Stage 3 · Raw → Normalized → Staging / Exception

```
raw rows                 : 3
normalized rows          : 3
staging items            : 2
mapping review candidates: 2
standard JE seams        : 2
exceptions               : 1
  - WBS_LINEAGE_SCHEMA_INVALID row=2 {"missing":["nonzero_amount"]}
```

The third payable row is schema-valid but unstageable (zero amount). It becomes
a scoped row-level exception and does not quarantine the other two rows.

### Stage 4–5 · Reviewed staging, mapping version, rule version

```
STAGE 4  staging review  : STAGING_REVIEWED by gl.reviewer
                           [NON_PRODUCTION_EXECUTABLE_SPEC, persistence=IN_PROCESS_SIMULATED]
         staging_item_id : STG-1c49b3fe6beb16e1c591c70f9f6a5358
         raw_event_id    : RAW-a3487155df48fd52371836281f9b4140
         source_document : SRCDOC-cd132c443c97117fb850b8a8a68c3e1f
STAGE 5  mapping version : WBS-REFS-MAPPING-2026-08-A (snapshot MAP-AP-COST-0001)
         rule version    : AP_ACCRUAL_V1 R-WBS-AP-ACCRUAL v1.0.0
```

**This is the first real gap.** Those three identities are minted by
`refs_persist_wbs_inbound_rows` (migration `058_wbs_inbound_atomic_persistence.sql`)
inside PostgreSQL. There is no PostgreSQL in this environment, so the harness
derives them deterministically from the WBS stable key and labels them
`IN_PROCESS_SIMULATED`. `simulatePersistedReviewedStaging` throws
`WBS_E2E_PERSISTENCE_UNAVAILABLE` unless the caller passes
`allowSimulatedPersistence: true`, so the simulation can never be reached by
accident.

### Stage 6–7 · Accounting event and suggested BALANCED Draft JE

`AP-GUID-0001` — event `EVT-a356003f0dd43c7e1cd7904899deccbd`,
type `PAYABLE_ACCRUAL`, `1250.5000 USD`, Draft `WBS-AP-AP-2026-0001`, date
`2026-07-31`:

| account | member | account name | debit | credit |
| --- | --- | --- | ---: | ---: |
| 610900 | – | Project Operating Expense | 1250.5000 | 0.0000 |
| 220100 | – | Accounts Payable | 0.0000 | 1250.5000 |
| | | **totals** | **1250.5000** | **1250.5000** |

`AP-GUID-0002` — event `EVT-…`, Draft `WBS-AP-AP-2026-0002`, date `2026-07-30`:

| account | member | account name | debit | credit |
| --- | --- | --- | ---: | ---: |
| 164400 | – | Construction in Progress | 84200.7500 | 0.0000 |
| 220100 | – | Accounts Payable | 0.0000 | 84200.7500 |
| | | **totals** | **84200.7500** | **84200.7500** |

Balance is proved on integers, not floats: `12505000 == 12505000` and
`842007500 == 842007500` minor units at scale 1e-4. Every amount in the chain
is a `BigInt` count of ten-thousandths; `parseMoney` refuses any value it cannot
represent exactly rather than rounding it (`WBS_E2E_AMOUNT_PRECISION_UNSUPPORTED`).

Mapping supplies the debit (cost / CWIP) account; the versioned rule supplies
the AP control credit. Both versions are carried on the journal in
`mapping_used` and `setting_used`.

### Stage 8 · Standard JE command → Review → Approve → Post

```
STAGE 8  standard command: STANDARD_AUTO_JOURNAL_REQUEST
         status=READY_FOR_STANDARD_JE_COMMAND kernel=createAutoJournal can_dispatch=false
         production kernel: PostgresAccountingKernel.createAutoJournal [UNVERIFIED_REQUIRES_PRODUCTION]
STAGE 8b controlled workflow [NON_PRODUCTION_EXECUTABLE_SPEC - JEService + MemoryJEDatabase]
         OK      create (maker)                                DRAFT
         OK      submit (maker)                                PENDING_REVIEW
         OK      review (reviewer)                             PENDING_APPROVAL
         REFUSED approve attempted by maker (must be refused)  JE_SOD_MAKER
         OK      approve (controller)                          APPROVED
         REFUSED post attempted by approver (must be refused)  JE_SOD_APPROVER_POSTER
         OK      post (senior accountant)                      POSTED
         maker cannot approve : true
         approver cannot post : true
         final status         : POSTED
```

The command object is built by the repository's own
`buildStandardDraftRequest` — the function the frozen lineage mapper names as
`required_command`. It refuses anything that is not a reviewed staging item
plus an approved versioned mapping plus a balanced journal, and it returns
`can_dispatch: false`.

**This is the second real gap.** The production posting path is
`PostgresAccountingKernel.createAutoJournal` → `refs_transition_journal` →
`refs_post_journal`. Those are SQL functions. The engine actually exercised here
is the repository's own `JEService` + `MemoryJEDatabase`, both of which declare
`NON_PRODUCTION_EXECUTABLE_SPEC = true` in their own source. What that engine
does prove: the Draft → Review → Approve → Post state machine, maker ≠ approver,
approver ≠ poster, and posted immutability.

### Stage 9 · GL → Trial Balance → Balance Sheet / Income Statement

General ledger (posted lines only):

```
ledger_line_id                       account  je_number                    debit         credit  wbs source
LL-94ba55aad19fd3620e434481b09129ca  610900   WBS-AP-AP-2026-0001      1250.5000         0.0000  AP-GUID-0001
LL-c860bd223bd49ffaf938409095e691f3  220100   WBS-AP-AP-2026-0001         0.0000      1250.5000  AP-GUID-0001
LL-b446bc9c1634d703749bc708c62c22ef  164400   WBS-AP-AP-2026-0002     84200.7500         0.0000  AP-GUID-0002
LL-e235c9b4b36bf70f1d0dc0f89d68d620  220100   WBS-AP-AP-2026-0002         0.0000     84200.7500  AP-GUID-0002
```

Trial Balance, period `2026-07` (`2026-07-01 .. 2026-07-31`):

| account | account name | period debit | period credit | ending balance |
| --- | --- | ---: | ---: | ---: |
| 164400 | Construction in Progress | 84200.7500 | 0.0000 | 84200.7500 |
| 220100 | Accounts Payable | 0.0000 | 85451.2500 | -85451.2500 |
| 610900 | Project Operating Expense | 1250.5000 | 0.0000 | 1250.5000 |
| | **TOTALS** | **85451.2500** | **85451.2500** | |

`trial balance ties exactly on integers: true`

Balance Sheet:

| section | account | account name | display balance |
| --- | --- | --- | ---: |
| ASSETS | 164400 | Construction in Progress | 84200.7500 |
| LIABILITIES | 220100 | Accounts Payable | 85451.2500 |
| CURRENT_EARNINGS | 610900 | Project Operating Expense | -1250.5000 |

```
ASSETS            84200.7500
LIABILITIES       85451.2500
EQUITY                0.0000
CURRENT_EARNINGS  -1250.5000
assets == liabilities + equity + current earnings : true
```

Income Statement (period movement only):

| section | account | account name | display balance |
| --- | --- | --- | ---: |
| EXPENSES | 610900 | Project Operating Expense | 1250.5000 |

```
total revenue      0.0000
total expenses     1250.5000
net income        -1250.5000
```

The CWIP capitalisation correctly stays out of the P&L and appears only as a
balance-sheet asset (asserted by test *income statement shows only the period
movement of revenue and expense*).

**This is the third real gap.** The production statements come from
`refs_get_financial_statements` (migration `062_financial_statement_read.sql`).
The builders in `wbs-accounting-e2e.mjs` are an *exact executable mirror* of
that function — the same account-class prefix rule (`1`→ASSET, `2`→LIABILITY,
`3`→EQUITY, `4`→REVENUE, `5-9`→EXPENSE), the same sections (`ASSETS`,
`LIABILITIES`, `EQUITY`, `CURRENT_EARNINGS`, `REVENUE`, `EXPENSES`) and the same
display-balance formulas. A mirror is not the function. Nobody has run the two
side by side on the same data, because the SQL function needs PostgreSQL.

### Stage 10 · Audit lineage back to the originating WBS row

```
--- AP-GUID-0001 ---  reverse lookup ok: true
  hop 1  WBS_SOURCE_ROW       row_index=0 row_content_hash=e35292b11b70ce4ee259dbe7f1a067e1ab99f3cc631c8afb2c5c338e06891664
  hop 2  IMMUTABLE_RECEIPT    sha256=c8c044c9794531aac8eadf137c0c146d1f264106f0bfb2099528ff49e4f47d47 verified=true
  hop 3  NORMALIZED           BGDATA.payable:AP-GUID-0001 version=content:e35292b11b70ce4ee259dbe7f1a067e1ab99f3cc631c8afb2c5c338e06891664
  hop 4  STAGING_REVIEWED     STG-1c49b3fe6beb16e1c591c70f9f6a5358 (IN_PROCESS_SIMULATED)
  hop 5  ACCOUNTING_EVENT     EVT-a356003f0dd43c7e1cd7904899deccbd rule=AP_ACCRUAL_V1@1.0.0 mapping=WBS-REFS-MAPPING-2026-08-A
  hop 6  POSTED_JOURNAL       WBS-AP-AP-2026-0001 POSTED maker=accounting.manager approver=controller poster=senior.accountant
  hop 7  LEDGER_LINES         2 lines on 220100, 610900
  hop 8  TRIAL_BALANCE        220100=-85451.2500  610900=1250.5000
```

Every hop is an identity that was actually carried through the chain, not a
reconstruction. The WBS source document ref is stamped on every ledger line, so
the reverse lookup does not depend on joining through mutable state.

Replay from zero is deterministic: a second run produces identical event ids,
identical ledger line ids, an identical content hash and identical trial-balance
totals (test: *replay from zero is deterministic*).

---

## 3. Scenario 2 (priority 2): bank statement → reconciliation exception

**Reached: reconciliation exception. Correctly blocked; no JE.**

### 2a · The matched pair is refused by the repository's own eligibility gate

`evaluateWbsAutoReconciliationEligibility` (in `wbs-inbound-data-adapter.mjs`)
returns `BLOCKED`:

```
BANK_SIDE      WBS_AUTOREC_ELIGIBILITY_TRACE_REQUIRED
  missing: receipt_id, account_before, account_after, review_event_id, journal_no
BUSINESS_SIDE  WBS_AUTOREC_ELIGIBILITY_TRACE_REQUIRED
  missing: receipt_id, account_before, account_after, review_event_id
```

Two distinct causes, and they matter differently:

1. **Frozen contract gap.** `journal_no` is required by the eligibility gate but
   is **not** in `WBS_READONLY_ROW_FIELDS.list_bank_transactions`. The WBS
   read-only contract as frozen today cannot supply it. The harness leaves it
   `null` rather than fabricating provider data.
2. **REFS review-state gap.** `receipt_id`, `account_before`, `account_after`
   and `review_event_id` are produced by REFS review persistence, not by WBS.
   They will exist once migration 058 persistence and a recorded review event
   exist; they cannot be invented here.

A third observation worth recording: the frozen contract maps
`list_bank_transactions.bank_account_ref` from `account_code` (a GL account),
while `list_payables` carries `cb_id` (a cash-book id). **They do not join.**
The harness joins on `cb_id`, which both rows do carry. A production run needs
an approved REFS cash-book ↔ GL-account map instead of that convention.

### 2b · Bank line with no business counterpart

```
WBS_E2E_BANK_NO_BUSINESS_COUNTERPART
bank source : SYS-BANK-0002  payee_no=V-0009  amount=4400.0000
can_create_draft/post : false/false
```

Retained as a reconciliation exception. Never auto-matched, never allocated,
never posted.

### 2c · Loan draw red line

```
expected shape : Dr Cash / Cr Loan Payable
  111000 Operating Cash    class=ASSET      Dr 500000.0000  Cr      0.0000
  211000 Loan Payable      class=LIABILITY  Dr      0.0000  Cr 500000.0000
shape holds, never a cost: true   posted: false
```

`buildSuggestedDraftJournal` throws `WBS_E2E_LOAN_DRAW_SHAPE_VIOLATION` if a
loan-draw rule is pointed at anything other than `Dr 111000 / Cr 211000`
(test: *a loan draw can never be pointed at a cost account*). The loan draw
Draft is deliberately **not** posted in this harness; it exists to prove the
shape guard.

---

## 4. Scenario 3 (priority 3): cost GL → CWIP cutoff

**Reached: evidence seam plus a cutoff review finding. A JE is impossible from
this source, by design.**

`list_journal_entries` is `LEDGER_EVIDENCE` in the frozen catalog with
`terminus: EVIDENCE_SEAM`. It can never reach the standard JE request seam, so a
CWIP reclass **cannot originate from WBS ledger evidence**. A reclass must
originate from a REFS-posted journal and be corrected by reversal only. The
harness reports the cutoff and stops:

```
terminus by frozen catalog  : EVIDENCE_SEAM
JE possible from this source: false
WBS_E2E_CWIP_POST_COMPLETION_CUTOFF
  account=164400 project=PJ-1 completed=2026-06-30 posted=2026-07-31 amount=61000.0000
  can_create_draft=false can_post=false
```

Subsidiary-ledger member enforcement is exercised on the same source. Without a
controller-supplied member the `291001` evidence row is refused with
`WBS_LINEAGE_TRACE_INCOMPLETE {"missing":["member"],"account_code":"291001"}`;
with the member supplied, both rows reach the evidence seam and the member is
carried.

### The `list_journal_entries.id` trap

The frozen envelope validator enforces `Number.isSafeInteger` on
`list_journal_entries.id`. The harness ships a fixture row with a **string** id
and proves it is rejected rather than quietly accepted:

```
string id blocked     : true
exception codes       : WBS_LINEAGE_SCHEMA_INVALID
upstream frozen codes : WBS_MCP_ENVELOPE_INVALID
```

---

## 5. Which stages are what

| Stage | Evidence class | What was actually executed |
| --- | --- | --- |
| WBS MCP transport (initialize / tools/list / tools/call) | **UNVERIFIED_REQUIRES_PRODUCTION** | Nothing. No provider, no credentials, no network. |
| Immutable receipt (`validateWbsReadEnvelope`) | CONTRACT_PLUS_FIXTURE | Frozen validator, real code, fixture rows |
| Raw / Normalized / Staging / Exception | CONTRACT_PLUS_FIXTURE | Frozen `mapWbsSourceEnvelope`, real code, fixture rows |
| Mapping version + rule version | CONTRACT_PLUS_FIXTURE | Real resolution through `resolveWbsAccountMapping`; the mapping snapshots themselves are fixtures |
| REFS raw_event / source_document / staging_item persistence | **NON_PRODUCTION_EXECUTABLE_SPEC** | Simulated in process. Production needs `persistWbsInboundRows` (migration 058). |
| Accounting event | CONTRACT_PLUS_FIXTURE | New code in `wbs-accounting-e2e.mjs`, fully tested |
| Suggested balanced Draft JE | CONTRACT_PLUS_FIXTURE | New code, exact integer balance |
| Standard JE command (`buildStandardDraftRequest`) | CONTRACT_PLUS_FIXTURE | Existing repository function, real code |
| Draft → Review → Approve → Post | **NON_PRODUCTION_EXECUTABLE_SPEC** | `JEService` + `MemoryJEDatabase`, both self-declared non-production. Production is `PostgresAccountingKernel`. |
| GL / Trial Balance / Balance Sheet / Income Statement | **NON_PRODUCTION_EXECUTABLE_SPEC** | Exact mirror of migration 062, never cross-checked against the SQL function |
| Audit lineage back to the WBS row | CONTRACT_PLUS_FIXTURE | Identities carried end to end and asserted |
| `get_meta` / `trace_by_key` schemas | **UNVERIFIED_REQUIRES_PRODUCTION** | REFS-declared, not provider-confirmed. Not promoted, not used in any scenario. |
| Deletion / absence semantics | **not inferable** | No revision, CDC or tombstone contract. Absence is `UNCONFIRMED`, never `DELETED`. |

---

## 6. Exact blockers preventing a production run

1. **No WBS provider reachable and no credentials.** The frozen client requires
   `CF-Access-Client-Id`, `CF-Access-Client-Secret` and `X-REFS-Auth`, and pins
   the endpoint origin. Nothing in this environment can satisfy that, and
   nothing in the harness attempts to.
2. **`get_meta` and `trace_by_key` schemas are REFS-declared, not
   provider-confirmed** (`schema_origin: REFS_DECLARED_PENDING_PROVIDER_CONFIRMATION`).
   They must be confirmed by the provider before admission. They were not used
   in any scenario here.
3. **No REFS raw/normalized/staging persistence in process.** Production needs
   `PostgresAccountingKernel.persistWbsInboundRows` and migration 058 applied.
   Until then the reviewed staging identities are simulated.
4. **No PostgreSQL, therefore no real posting.** Production needs
   `createAutoJournal` → `transitionJournal` → `postJournal` against a running
   database with `refs_bootstrap_context` and the `refs_app` role. `docker` is
   not installed in this sandbox, so `npm run pg:start` cannot start one and
   `npm run test:postgres` self-skips all 61 tests. That is a skip, not a pass.
5. **No real financial statements.** `refs_get_financial_statements` was never
   executed. The mirror must be diffed against the SQL function on identical
   data before anyone trusts the BS/IS numbers as REFS numbers.
6. **`journal_no` is missing from the frozen bank row contract** but is required
   by `evaluateWbsAutoReconciliationEligibility`. Either the provider must expose
   it on `list_bank_transactions`, or the gate must be changed. Auto-reconciliation
   cannot pass until one of those happens.
7. **No cash-book ↔ GL-account map.** `list_bank_transactions.bank_account_ref`
   (a GL account) and `list_payables.cb_id` (a cash-book id) do not join.
8. **Mapping snapshots are fixtures.** Real approved, versioned, effective-dated
   mapping snapshots must exist in REFS configuration, with a controller approval
   trail, before any WBS row can be mapped for real.
9. **The account master is harness-local.** `WBS_E2E_ACCOUNT_MASTER` is a small
   table in the harness. Production reads `account_master` per tenant and entity.
10. **No period/close integration.** The harness opens `2026-07` in memory.
    Production must resolve the period through `accounting_period` and respect
    close state.
11. **Deletion still cannot be inferred.** Without a revision, CDC or tombstone
    contract, an absent key is `UNCONFIRMED`. Any production design that treats
    absence as deletion is wrong and this harness will not model it.

---

## 7. Gate results

Run from the worktree root on branch `claude/wbs-e2e`.

| Command | Result | Exit |
| --- | --- | --- |
| `npm run test:wbs-mcp-lineage` | 34 pass / 0 fail | 0 |
| `npm run test:wbs-e2e` | 31 pass / 0 fail | 0 |
| `npm run test:wbs-accounting-foundation` | pass | 0 |
| `npm run test:wbs-accounting-acceptance` | 16/16 | 0 |
| `npm run test:ssr` | components=27 failed=0 | 0 |
| `npm run test:audit` | entities=119/119 jes=2121 fails=0 | 0 |
| `npm run build` | dist/bundle.js built, runtime assets pass | 0 |
| `node tools/run-verifiers.mjs` | 42/42 passed | 0 |
| `git diff --check` | clean | 0 |
| `cd server && node --test tests/wbs-*.test.mjs` | 125 pass / 0 fail | 0 |
| `cd server && npm run test:postgres` | **61 tests, 0 pass, 0 fail, 61 SKIPPED** — the suite self-skips with no `DATABASE_URL`; `docker` is not installed in this sandbox, so `npm run pg:start` cannot provide one. Exit 0 here means "nothing ran", not "passed". | 0 (vacuous) |
