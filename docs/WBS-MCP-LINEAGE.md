# WBS read-only MCP lineage — eight-source accounting field map

Contract version: `WBS-REFS-MCP-LINEAGE-V1`
Implementation: `server/runtime/wbs-mcp-lineage.mjs`
Tests: `server/tests/wbs-mcp-lineage.test.mjs` (`npm run test:wbs-mcp-lineage`)
Verifier: `verify-wbs-mcp-lineage.mjs` (runs inside `npm run test:visual`)

> **Read-only, credential-free.** This mapping never writes WBS, never creates,
> approves, dispatches or posts a journal entry, and performs no network access.
> It turns approved read-only MCP envelopes into review candidates for a human.
> No endpoint, host, header name, token or secret appears in the implementation
> or in its fixtures; every test runs on sanitized data.

---

## 1. Pipeline

```text
Receipt  ->  Raw  ->  Normalized  ->  Staging / Exception  ->  Mapping Review
      ->  AutoRec Review  ->  Standard JE Request seam | Evidence seam
```

| Stage | What it is | Who owns the next step |
|---|---|---|
| `RECEIPT` | The frozen read-only MCP envelope: `contract_version`, `tool`, `environment`, `captured_at`, `source`, `scope`, `record_count`, `content_sha256`, `cursor_next`, `etl_notice`, `rows`. Validated by `validateWbsReadEnvelope` in `server/runtime/wbs-readonly-mcp.mjs`. | Lineage mapper |
| `RAW` | Exact row bytes plus `row_content_hash`, retained read-only and never mutated. Retained even when the row later fails, so an exception can be explained. | Kernel `persistWbsInboundRows` |
| `NORMALIZED` | Canonical REFS field names, typed values, stable key, company, currency, amount, direction, dates, `source_document_ref`. | Kernel |
| `STAGING` | `STAGING_REVIEW_REQUIRED` transaction candidates. `can_allocate/can_create_draft/can_dispatch/can_post` are all `false`. | Human staging review |
| `EXCEPTION` | A scoped, explicit exception. Never an inference, never a silent skip. | Human exception queue |
| `MAPPING_REVIEW` | Exactly one highest-priority approved effective mapping, resolved with a six-digit account. | Human mapping review |
| `AUTOREC_REVIEW` | Hand-off to the existing gate `evaluateWbsAutoReconciliationEligibility` in `server/runtime/wbs-inbound-data-adapter.mjs`. This mapper never pairs and releases on its own. | Human AutoRec review |
| `STANDARD_JE_REQUEST_SEAM` | A description of the standard REFS command a human must invoke (`buildStandardDraftRequest`), with its preconditions. It is not a Draft and cannot be dispatched. | Human, then the REFS Accounting Kernel |
| `EVIDENCE_SEAM` | Control totals, ledger evidence, metadata and trace. May reconcile, may never create a source document, allocation, Draft, journal or posting. | Reconciliation / audit views |

---

## 2. The eight sources

Field counts below are asserted by the test suite. Total declared fields: **112**;
mapped source fields: **112** (coverage ratio `1.0`). A declared field counts as
mapped when it feeds a normalized alias, the stable key (`source_id`) or the
`source_document_ref` trace.

| # | Tool | WBS module | Role | Terminus | Declared fields | Stable-key parts | Source-document ref | Schema origin |
|---|---|---|---|---|---|---|---|---|
| 1 | `get_meta` | `wbs.meta` | `METADATA` | `RECEIPT` | 5 | `contract_version` + `generated_at` | — | REFS-declared* |
| 2 | `list_payables` | `BGDATA.payable` | `TRANSACTION_PRODUCER` | `STANDARD_JE_REQUEST_SEAM` | 25 | `ap_guid` | `ap_guid` | frozen allowlist |
| 3 | `list_bank_transactions` | `BGDATA.bank_transaction` | `TRANSACTION_PRODUCER` | `STANDARD_JE_REQUEST_SEAM` | 16 | `cb_id` | `sys_id` | frozen allowlist |
| 4 | `list_autorec_details` | `BGDATA.autoc_detail` | `TRANSACTION_PRODUCER` | `AUTOREC_REVIEW` | 18 | `pd_guid` | `pd_pv_guid` | frozen allowlist |
| 5 | `list_autorec_banks` | `BGDATA.autoc_bank` | `CASE_CONTROL` | `AUTOREC_REVIEW` | 13 | `pb_guid` | — | frozen allowlist |
| 6 | `list_journal_entries` | `accounting.accounting_info` | `LEDGER_EVIDENCE` | `EVIDENCE_SEAM` | 19 | `id` | `sys_id` | frozen allowlist |
| 7 | `list_control_totals` | `accounting.balance_cell` | `CONTROL_EVIDENCE_ONLY` | `EVIDENCE_SEAM` | 8 | `company` + `period` + `formula` | — | frozen allowlist |
| 8 | `trace_by_key` | `wbs.trace` | `TRACE` | `EVIDENCE_SEAM` | 8 | `source_module` + `source_record_id` + `source_version` | `source_document_id` | REFS-declared* |

\* `get_meta` and `trace_by_key` have no frozen row-field allowlist in
`WBS_READONLY_ROW_FIELDS`. Their schemas are marked
`REFS_DECLARED_PENDING_PROVIDER_CONFIRMATION` in the catalog and **must be
confirmed by the WBS provider before production admission**. The other six
schemas are asserted field-for-field against the frozen allowlist, so the
catalog cannot drift from the read-only contract.

### 2.1 Field maps

Only the mapped names are listed; the full typed schema is the single source of
truth in `WBS_SOURCE_CATALOG`.

**`list_payables` → PAYABLE**

| REFS normalized | WBS field | | REFS normalized | WBS field |
|---|---|---|---|---|
| `company_key` | `company_code` | | `bill_no` | `ap_long_id` |
| `company_name` | `company_name` | | `journal_no` | `journal_no` |
| `amount` | `amount` | | `bank_account_ref` | `cb_id` |
| `business_date` | `incurred_date` | | `payable_type` | `ap_type` |
| `accounting_date` | `posting_date` | | `pay_type` | `pay_type` |
| `clear_date` | `clear_date` | | `pay_status` | `pay_status` |
| `check_date` / `check_no` | `check_date` / `check_no` | | `business_status` | `business_status` |
| `vendor_ref` / `vendor_name` | `vendor_no` / `vendor_name` | | `review_status` | `review_status` |
| `project_ref` / `project_code` / `project_name` | `project_guid` / `pj_code` / `pj_name` | | `cost_code_ref` | `cost_id` |
| `description` | `description` | | `cost_ledger_ref` | `cost_ledger_id` |

Direction is fixed `CREDIT` (`Cr 291001` per the two-step model in
`REFS-ARCHITECTURE-V2.md` §6).

**`list_bank_transactions` → BANK_TRANSACTION**

`company_key ← company_code`, `bank_account_ref ← account_code` (six digits,
enforced), `business_date ← set_date`, `debit_amount ← debtor`,
`credit_amount ← lender`, `payee/payee_no`, `come_from`, `child_come_from`,
`child_count`, `statistical_business`, `review_status ← review`, `turn_flag`,
`description`, `source_document_ref ← sys_id`.
Direction is derived: `debtor > 0` ⇒ `DEBIT`, `lender > 0` ⇒ `CREDIT`; both or
neither ⇒ no direction ⇒ scoped exception.

**`list_autorec_details` → AUTOREC_PAYMENT_DETAIL**

`batch_ref ← batch_guid`, `business_type ← biz_type`, `bank_account_ref ← cb_id`,
`cost_code_ref ← cost_code`, `data_source`, `deposit_amount ← deposit`,
`payment_amount ← payment`, `business_date ← incurred_date`, `clear_date`,
`match_ref ← match_guid`, `match_status`, `project_ref ← project_guid`,
`released_by`, `released_date`, `status`, `vendor_ref ← vendor_no`,
`source_document_ref ← pd_pv_guid`.
**This source carries no company field.** The company must be pinned by the read
scope; otherwise a `WBS_LINEAGE_CROSS_COMPANY` exception is raised rather than a
guess.

**`list_autorec_banks` → AUTOREC_CASE_CONTROL**

`company_key ← company_code`, `company_name`, `bank_account_ref ← ah_id`,
`bank_account_name ← ah_name`, `debit_amount`, `pay_amount`, `quantity`,
`released_count ← released`, `released_quantity`, `incurred_count ← incurred`,
`reconciliation_start_date`, `status`.
Case control only — never a transaction producer.

**`list_journal_entries` → LEDGER_EVIDENCE**

`company_key ← company`, `account_code ← account` (six digits, enforced),
`bill_no`, `bank_account_ref ← cb_id`, `period_closed ← closed`, `come_from`,
`cost_code_ref ← cost_code`, `debit_amount ← debtor`, `credit_amount ← lender`,
`journal_no`, `project_code ← pj_code`, `project_ref ← project`,
`accounting_date ← posting_date`, `business_date ← set_date`,
`reversal_flag ← reverse`, `review_status ← review`, `reviewer`,
`source_document_ref ← sys_id`.
Evidence only. A line on the subsidiary clearing net `291000`–`291031` requires
a `member`; the member is never inferred.

**`list_control_totals` → CONTROL_EVIDENCE**

`company_key ← company`, `period_code ← period`, `formula`, `quality`,
`cell_count`, `total_balance`, `total_credit`, `total_debit`.
`CONTROL_EVIDENCE_ONLY`: may reconcile totals, never creates a source document.

**`trace_by_key` → TRACE_EVIDENCE**

`company_key ← company_code`, `traced_source_module`, `traced_source_record_id`,
`traced_source_version`, `source_document_ref ← source_document_id`, `bill_no`,
`journal_no`, `links`.

**`get_meta` → METADATA**

`contract_version`, `environment`, `generated_at`, `declared_tools ← tools`,
`company_codes`. Terminates at `RECEIPT`; it is inventory, not evidence.

---

## 3. Stable keys and idempotent replay

The canonical key is `source_system + source_id + source_version`.

```text
source_id      = <source_module> ":" <stable-key parts joined by "~">
source_version = "content:" sha256(canonical-sorted-compact(row))     [see 3.1]
composite      = source_system "|" source_id "|" source_version
stable_key     = "sha256:" sha256(composite)
```

Properties, all asserted by tests:

- **Deterministic.** The same row content always produces the same key.
- **Order-independent.** Reordering JSON keys in a row does not change the key
  (canonical sorted-compact serialization, shared with `request-hash.mjs`).
- **Unique.** The same stable key appearing twice in one window is a
  `WBS_LINEAGE_STABLE_KEY_DUPLICATE` exception; the first occurrence still maps.
- **Replayable from zero.** Two independent stateless runs over the same pages
  produce identical keys and structurally identical results.

### 3.1 Why `source_version` is a content revision

The frozen envelope contract records `has_revision_contract: false`,
`has_cdc_contract: false`, `has_tombstone_contract: false` and
`requires_snapshot_diff: true`. WBS therefore publishes no row revision number,
no change feed and no tombstone. Rather than invent one, the mapper derives the
version from the row content hash. Consequences:

- an unchanged row replays to the identical key, so replay is idempotent;
- a changed row produces a *different* `source_version` for a *known*
  `source_id`, which is exactly the condition that must be escalated rather than
  silently upserted (see `WBS_LINEAGE_REVISION_UNKNOWN`);
- if WBS later publishes a real revision or CDC field, the catalog gains a
  declared revision field and this derivation is replaced without changing the
  key shape.

This lineage-level key is distinct from, and must not be confused with, the
database `raw_event` key
`UNIQUE(tenant_id, source_system, source_module, source_entity_id, source_record_id, source_version)`
in `server/db/migrations/001_wbs_accounting_core.sql`, or the business
idempotency key on `idempotency_receipt`. Per `REFS-ARCHITECTURE-V2.md` §6 the
three must never be mixed.

---

## 4. Exception taxonomy

Every class below is explicit and scoped. A scoped exception carries
`scope = { level, tool, row_index, stable_key, source_id, company_key, cursor }`
and hard `false` flags: `inferred`, `can_infer`, `can_write_wbs`, `can_allocate`,
`can_create_draft`, `can_dispatch`, `can_post`. `level` is `ENVELOPE` (the whole
page is rejected and the cursor is blocked), `ROW` (that row only) or `WINDOW`
(a cross-window observation). Nothing is ever silently handled and nothing is
ever inferred.

| Code | Level | Meaning | Scope / effect |
|---|---|---|---|
| `WBS_LINEAGE_SCHEMA_INVALID` | ENVELOPE, ROW | The envelope failed the frozen read-only contract, or a row violates the declared closed schema: missing required field, wrong type, invalid calendar date, **undeclared field**, or an account code that is not exactly six digits. | Row is not normalized. Raw is still retained so a human can see what arrived. A four-digit account is never widened; a six-digit account is never degraded. |
| `WBS_LINEAGE_CROSS_COMPANY` | ROW | The row's company differs from the requested read scope, **or** the source cannot attest a company (`list_autorec_details`) and the scope pins none. | Row stops before Normalized. Company is never inferred from a sibling row, a batch or a bank account. |
| `WBS_LINEAGE_REVISION_UNKNOWN` | ROW, WINDOW | *Changed replay*: a known `source_id` reappeared with different content. *Unconfirmed absence*: a key seen in a previous completed window is absent from this one. With no CDC and no tombstone contract, absence means **unconfirmed**, never **deleted**, and an amendment cannot be distinguished from a correction. | Row does not advance to Staging. Absence raises a `WINDOW` exception carrying `absence_meaning: "UNCONFIRMED"` and `never: "DELETED"`, and requires a snapshot diff for resolution. |
| `WBS_LINEAGE_HASH_MISMATCH` | ENVELOPE | `content_sha256` does not equal the SHA-256 of the canonical sorted-compact rows. | The whole page is rejected, no Raw is admitted, and the cursor is blocked so the same window is re-read. |
| `WBS_LINEAGE_STABLE_KEY_MISSING` | ROW | One or more declared stable-key parts are absent or blank, so the row cannot be replayed idempotently. | Row stops before Normalized. |
| `WBS_LINEAGE_STABLE_KEY_DUPLICATE` | ROW | The same stable key occurred twice inside one window. | The duplicate occurrence is rejected; the first occurrence is unaffected. |
| `WBS_LINEAGE_CURRENCY_UNSUPPORTED` | ENVELOPE, ROW | A currency other than `USD`. Row-level currency is rejected by the frozen envelope validator; a non-USD read *scope* is rejected at row level. | No amount is converted, ever. |
| `WBS_LINEAGE_MAPPING_AMBIGUOUS` | ROW | More than one approved, effective, equal-highest-priority mapping candidate resolves to different accounts. | No account is chosen. Equal-priority mappings are never resolved by row order — asserted by mapping the same row with the candidate list in both orders and requiring the same exception. |
| `WBS_LINEAGE_MAPPING_MISSING` | ROW | Zero approved effective candidates (none approved, or all outside their effective window). Pairs with frozen code `3020 GL_MAPPING_MISSING`. | No Draft is produced. |
| `WBS_LINEAGE_TRACE_INCOMPLETE` | ROW | The row has no `source_document_id`/`source_document_ref`, or a subsidiary-ledger line (`291000`–`291031`) has no `member`. Pairs with frozen code `3030 SOURCE_TRACE_MISSING` and red line `4020 SUBSIDIARY_MEMBER_MISSING`. | A transaction row may still be staged for review but can never reach the standard JE request seam. Trace and ledger evidence never reach the evidence seam. |
| `WBS_LINEAGE_CURSOR_INVALID` | — | A cursor for an unapproved tool, a malformed cursor object, or a cursor token that is not an opaque bounded token (`:` and `/` are excluded so a cursor can never carry a URL or a host). | Thrown as `WbsLineageError`; no page is processed. |

---

## 5. Cursor semantics

```js
createWbsCursor({ tool, company_key })   // the zero cursor
advanceWbsCursor(cursor, { cursorNext, capturedAt, rowCount, blocked })
reconcileWbsWindowAbsence({ tool, previousKeys, currentKeys, cursor })
replayWbsLineage({ pages, scope, mappingCandidatesByKey, memberByKey, priorState })
```

- **Zero cursor.** `mode: 'FULL_REPLAY_FROM_ZERO'`, `position: null`,
  `high_water_mark: null`, `pages: 0`, `rows_seen: 0`, `exhausted: false`.
  Stateless replay from zero always starts here and requires no stored state.
- **Incremental.** Each page carries `cursor_next` from the envelope. A non-null
  token moves the cursor to `mode: 'INCREMENTAL_IN_PROGRESS'` with
  `position = token`; `rows_seen` and `pages` accumulate; `high_water_mark`
  tracks the maximum `captured_at` observed.
- **Window complete.** `cursor_next === null` sets
  `mode: 'INCREMENTAL_WINDOW_COMPLETE'`, `exhausted: true`, `position: null`.
  Only a completed window is a valid basis for absence reconciliation.
- **Fail-closed.** Any `ENVELOPE`-level exception sets
  `mode: 'BLOCKED_REREAD_SAME_WINDOW'`, `blocked: true`, and leaves `position`
  and `pages` untouched, so the same window is re-read on the next run. A
  partially-read window never advances the cursor.
- **Token hygiene.** The token is opaque, at most 512 characters, restricted to
  `[A-Za-z0-9._~+=-]`. It cannot contain `:` or `/`, so a cursor can never carry
  a route, a URL or a host reference.
- **Replay from zero vs. incremental.** `replayWbsLineage` with no `priorState`
  is a full stateless replay: identical stable keys, identical results. Passing
  the previous run's result as `priorState` performs an incremental pass; an
  unchanged window produces zero exceptions, a changed row produces
  `WBS_LINEAGE_REVISION_UNKNOWN`, and a vanished key produces the
  `WINDOW`-scoped unconfirmed-absence exception.

Note that `sync_cursor` in the database (`UNIQUE (tenant_id, connector_code,
source_module, source_entity_id)`) is the persistent home for this value. The
lineage cursor is the in-memory projection of one connector/module/entity row;
persisting it is a kernel command and is out of scope for this read-only mapper.

---

## 6. Mapping coverage

| Metric | Value |
|---|---|
| Sources catalogued | 8 / 8 |
| Declared, typed fields | 112 |
| Fields mapped (normalized alias, stable key, or source-document ref) | 112 |
| Coverage ratio | 1.0 |
| Sources whose schema is asserted against the frozen row-field allowlist | 6 / 8 |
| Sources whose schema is REFS-declared pending provider confirmation | 2 / 8 (`get_meta`, `trace_by_key`) |
| Exception classes implemented | 11 |
| Transaction producers reaching a JE request *seam* | 2 (`list_payables`, `list_bank_transactions`) |
| Sources terminating at AutoRec Review | 2 (`list_autorec_details`, `list_autorec_banks`) |
| Sources terminating at an evidence seam | 3 (`list_journal_entries`, `list_control_totals`, `trace_by_key`) |
| Sources terminating at Receipt | 1 (`get_meta`) |

`describeWbsMappingCoverage()` returns these numbers at runtime, and
`verify-wbs-mcp-lineage.mjs` fails if this document and the catalog disagree.

---

## 7. Accounting red lines held by this mapping

- **AI/automation never posts.** The furthest any source can go is a
  `STANDARD_JE_REQUEST_SEAM` record whose `can_create_draft`, `can_dispatch`,
  `can_post` and `can_write_wbs` are all `false`. A test serializes an entire
  eight-source replay and asserts no `"can_post": true`, `"can_create_draft":
  true`, `"can_dispatch": true`, `"can_allocate": true` or `"can_write_wbs":
  true` appears anywhere in the output.
- **Posted is immutable.** This mapper produces no journal and touches no
  posted record.
- **Six-digit account codes.** `account_code` and `account` are typed
  `account_code` and must match `^\d{6}$`. A four-digit code is a scoped schema
  exception; it is never widened, and a six-digit code is never degraded. A
  mapping candidate whose `account_code` is not six digits is rejected.
- **Subsidiary ledger lines carry a member.** Any resolved account in
  `291000`–`291031` sets `requires_member: true`; a missing member is
  `WBS_LINEAGE_TRACE_INCOMPLETE` with `missing: ["member"]`.
- **Loan draw shape.** A bank line whose `come_from` is `Const Loan` or
  `FINDRAW` carries `expected_shape: "Dr Cash / Cr Loan Payable"` on the review
  seam as a reviewer hint. It is a declaration for the human, not a posting.
- **Read-only.** No write path, no network call, no credential, no host.

---

## 8. Running it

```powershell
npm.cmd run test:wbs-mcp-lineage
node --test server/tests/wbs-mcp-lineage.test.mjs
node verify-wbs-mcp-lineage.mjs
```

All fixtures are sanitized and synthetic. No live WBS access, no credential and
no production data is required or permitted.
