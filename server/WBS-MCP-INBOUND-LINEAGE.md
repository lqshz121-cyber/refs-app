# WBS Finance → REFS Accounting Inbound Lineage

This document defines REFS-side admission for WBS data. It does not reproduce
WBS operations and it never writes to WBS. A successful read is evidence only;
it cannot allocate, create a Draft journal, approve, post, release, incur, or
cancel anything.

Source-table discovery and the evidence still needed to establish direct
provider field mappings are recorded in
[WBS-READONLY-SOURCE-EVIDENCE.md](WBS-READONLY-SOURCE-EVIDENCE.md). That
register deliberately distinguishes observed table inventory from unverified
column, relationship, and state semantics.

## Producer classification

| WBS Finance source | Formal MCP view | REFS role | Required identity / evidence | Result before human review |
| --- | --- | --- | --- | --- |
| Payable Report | `list_payables` | Transaction producer | `ap_guid`, company, currency, amount, posting/incurred date, envelope hash | Raw → Normalized → Staging review or Exception |
| Bank Transaction Journal Entries | `list_bank_transactions` | Bank-side transaction producer | `cb_id`, company, bank account, lender/debtor direction, envelope hash | Raw → Normalized → Staging review or Exception |
| Auto Bank Reconciliation detail | `list_autorec_details` | Business-side matching evidence | `pd_guid`, `cb_id` relation, deposit/payment direction, dimensions, envelope hash | Raw → Normalized → Staging review or Exception |
| Auto Bank Reconciliation company/bank summary | `list_autorec_banks` | Control evidence | `pb_guid`, company, quantity/amount/released/incurred fields, envelope hash | Control evidence only |
| WBS Journal Entries | `list_journal_entries` | Journal/ledger trace evidence | stable numeric `id`, company, posting date, journal reference, debit/credit evidence | Trace evidence only |
| Cost General Ledger | `list_control_totals` plus future scoped metric receipt | Control evidence | company, period, metric definition, immutable receipt | Never a source document or journal command |
| Property Comparison Report | no current transaction MCP producer | **UNKNOWN / control-only** | signed scoped report receipt and approved REFS control mapping | Blocked; cannot form a candidate |

## Observed Finance navigation boundary

On 2026-08-09, the authenticated WBS Finance & Accounting landing page exposed
Payable Report, Bank Transaction Journal Entries, Auto Bank Reconciliation,
Auto Payments Reconciliation, Cost General Ledger, Property Comparison Report,
and WBS Journal Entry as separate navigation entries. This proves that the
entries exist in the source application; it does **not** prove their row schema,
join keys, or posting authority. In particular, Auto Payments Reconciliation
is retained as an **UNKNOWN control/trace source** until the provider supplies a
signed nonempty read receipt with an immutable row key, company scope, currency,
amount direction, and explicit relationship to the AutoRec payment/bank key.
It must not be mapped to a REFS transaction, allocation, Draft journal, or
posting path merely because it appears beside Auto Bank Reconciliation.

`trace_by_key` is relation evidence only. It cannot make any row a transaction
producer. A WBS report therefore never becomes a posting instruction.

The observed WBS `accounting_info` data set is not a substitute for
`list_bank_transactions`: it has multiple accounting rows for a shared
`cb_id`, and therefore enters REFS only as Journal/ledger trace evidence. The
provider must expose the immutable bank record separately before a bank-side
transaction candidate can be admitted.

## State and matching boundary

```text
WBS immutable read envelope
  → verified hash + scoped receipt
  → Raw observation
  → Normalized WBS source record
  → Staging review | Exception
  → approved mapping + human review
  → read-only AutoRec review candidate
  → standard REFS Draft-JE request
  → standard REFS review / approval / posting / immutable ledger
```

The mapper accepts only the eight formal read-only MCP tools. It preserves the
provider's lack of revision, CDC, and tombstone guarantees: a source key absent
from the next snapshot is `ABSENT_UNCONFIRMED` and requires recheck; it is not a
deletion. Any mixed company scope, non-ascending stable keys, invalid content
hash, ambiguous debit/credit movement, missing currency/date/account/amount, or
missing immutable receipt remains blocked.

Calendar validation is strict at the snapshot adapter boundary: an impossible
source or posting date (for example `2026-02-30`) is quarantined before
Staging, AutoRec review, Draft request, or any accounting action.

The three transaction producer envelopes can be packaged into the existing
receipt-backed snapshot ingress only when they have one company, one captured
timestamp, ascending stable keys, and — in production — complete delivery
evidence plus an external detached signature. The package retains each MCP
envelope hash and row hash in normalized provenance. `pd_pv_guid` is not
treated as `pb_guid`; until that relationship is provider-verified, AutoRec
detail is quarantined by the existing `pbGuId` staging gate.

The read-only pull service calls only `list_payables`,
`list_bank_transactions`, and `list_autorec_details` with structured MCP tool
arguments. Each response must use the selected company and the same capture
timestamp before a snapshot can be presented for signature verification. A
read, scope, or timing failure produces no persistence request and no
accounting command.

For AutoRec Detail, exactly one signed Deposit or Payment value must be
non-zero to derive direction. A zero/zero or both-nonzero row is an Exception.
Observed PB controls do not support a universal simple Released/Incurred versus
Pay Amount capacity formula and do not always contain M/R/C periods; they stay
control evidence until the provider supplies scoped signed control semantics.

The pipeline invokes the existing receipt-backed atomic REFS ingress only after
an independent detached-signature verifier returns true. It performs no
AutoRec allocation, release, incur, Draft-JE creation, approval, or posting;
the persisted result must explicitly keep all such dispatch flags false.

## Retained accounting trace (not command authority)

The inbound record retains provider-visible accounting context only to make a
reviewer traceable. These values are never stable REFS keys, permissions, or
posting instructions.

| Producer | Retained external trace | Explicitly not authoritative for |
| --- | --- | --- |
| Payable | `ap_long_id`, type/status, posting date, journal/check/clear references, bank and cost-ledger relations, vendor/project | Draft, Post, or match-key selection |
| Bank Transaction | transaction date, bank account, payee, memo, source/review fields, direction indicators | source key, account assignment, or release |
| AutoRec Detail | batch/type, clear/incurred/released evidence, matching/status evidence, bank/AUTOC relations, vendor/project/cost dimensions | REFS release/incur state, payment key, or posting |

`pd_pv_guid` and `cb_id` are retained relations, not a `pb_guid` substitute.
WBS `Released` and `Incurred` values are observed control evidence. They do
not authorize a REFS state transition, JE action, or ledger mutation.

The WBS screens presently evidence four workflow labels — Company Screening,
Data Processing & Release, Incur, and Incurred List. REFS retains those as
`WBS_AUTOREC_OBSERVED_WORKFLOW_V1`: a not-matched or released detail belongs
to the observed Data Processing & Release step, while an incurred detail
belongs to the observed Incurred List step. The action-level Incur event is
not inferred from a later row. The canonical WBS transition graph is
**UNKNOWN** until the provider supplies signed state/transition evidence;
every observed step remains non-dispatchable and cannot alter REFS state.

Observed WBS relation rows can identify a Detail only when the signed relation
receipt binds `MB_BusinessId` to `pd_guid` under the compatible `AUTOC`,
`AUTOP`, or `AUTOR` source type. That edge is relation evidence only; no
`MB_BatchGuId` or generic business type may become a PB key, allocation or
REFS state transition.

The source-table evidence identifies a Payable-to-accounting trace through
shared `cb_id`, but no tested direct relation through Payable long ID or
journal number. The `cb_id` trace is one-to-many on the accounting side; the
Payable immutable source key remains separate and none of these values is an
AutoRec match key or posting authority.

Reverse lookup through `trace_by_key` first reads and exactly verifies the
persisted REFS source under tenant, entity, company, source type/key/version,
and receipt hash. It then accepts only that immutable source key (`ap_guid`,
`cb_id`, `pd_guid`, `pb_guid`, or journal `id`). It rejects display references
such as Ref No., memo, `cb_id` relation fields, and `pd_pv_guid` as lookup
substitutes. Returned relations remain read-only evidence.

## Accounting and AutoRec rules enforced at the boundary

1. Payable, Bank Transaction, and AutoRec Detail can be transaction candidates
   only after a signed immutable provider receipt is persisted.
2. Bank and business sides must be separately reviewed REFS staging rows with
   the same company, currency, and bank account, opposite directions, approved
   date window and amount tolerance before an AutoRec **review** candidate.
   A provider-backed proposal obtains the date window and tolerance only from
   one exact scoped, APPROVED, receipt-bound REFS matching policy
   (`policy/matching-rule` IDs and versions plus the exact bank-side and
   business-side mapping IDs and versions). UI/import parameters cannot widen
   the policy. A missing, stale, ambiguous, cross-scope, or source-mapping
   mismatch is blocked;
   this remains a review plan rather than a reservation.
3. Review candidates have `can_allocate=false`, `can_create_draft=false`, and
   `can_post=false`; allocation/release/incur/posting remain authoritative REFS
   workflows with their own permissions, SoD, versioning, audit, and ledger
   rules.
4. A standard Draft JE request needs reviewed staging, an approved versioned
   mapping, balanced lines, and complete Raw/Normalized/Staging trace. A POSTED
   trace needs separate review, approval, post audit evidence, and ledger-line
   identifiers.
   For AutoRec Incurrence evidence, the G11 verifier additionally requires
   exactly one POSTED `PAYABLE_INCUR` and one POSTED `AUTOC` REFS journal, an
   `AUTO_JOURNAL_CREATED` audit for each, exact reviewed-pair source trace, and
   a per-member `291001` net of zero. This verifier creates no journal and
   cannot transition the AutoRec case. Its composition seam reads the reviewed
   candidate and both journal receipts from a scoped, read-only REFS kernel
   repository; it does not accept caller-supplied journal evidence.
5. Cost GL and Property Comparison reconcile controls only. They cannot create
   source documents, AutoRec allocations, Draft JEs, or ledger postings.

Cost GL requires exactly fourteen metrics and an exact scoped, approved
`WBS_COST_GL_CONTROL_RECONCILIATION` mapping including tenant, entity, company,
period, and currency. Property Comparison requires an exact scoped, approved
`WBS_PROPERTY_CONTROL_RECONCILIATION` mapping including tenant, entity, company,
property, inclusive date range, currency, and bank account. Both produce only
`RECONCILED` or `DIFFERENCE`, exact four-decimal comparisons, control totals,
and Raw/receipt/mapping/target reverse trace. Incomplete metric sets, receipts,
or mappings are blocked rather than treated as zero.

AutoRec Bank company summaries remain observed control evidence until the
provider supplies an explicit signed control receipt. The executable control
contract accepts a summary total only when the receipt hash binds the exact
MCP envelope, its verification key/algorithm/verification identifier are
present, and the provider attests a `ROW_SUM` formula version for one exact
company, currency, period, and bank-account scope. The six admitted totals
are quantity, released quantity, pay amount, released amount, incurred amount
and debit amount. No universal PB balance formula is inferred. A missing or
mismatched formula, scope, receipt, or total is rejected; the result remains
`can_allocate=false`, `can_release=false`, `can_incur=false`,
`can_create_draft=false`, and `can_post=false`.
The read-only service exposes this only through
`pullAutoRecBankControlEvidence`; it has no persistence, allocation, release,
incur, journal or posting dependency.

Bank Transaction `debtor` and `lender` are likewise not self-proving
directions. A transaction snapshot now requires a receipt-bound direction
convention for every bank account: exact company/currency/account scope, rule
id/version, a receipt hash that equals the Bank Transaction envelope hash, and
opposite declared directions for the two fields. Without it, the bank row is
an `WBS_MCP_BANK_DIRECTION_CONVENTION_REQUIRED` Exception and no snapshot can
enter the Raw/Normalized/Staging path. This convention is provider evidence,
not a REFS-side assumption about WBS debit/credit terminology.

Payable Report amounts also require a receipt-bound `ap_type` direction
convention. Each selected payable type must have an exact company/currency
scope, rule id/version and declared DEBIT or CREDIT direction tied to the
Payable envelope hash. A missing convention yields
`WBS_MCP_PAYABLE_DIRECTION_CONVENTION_REQUIRED`; it cannot form a snapshot or
become an AutoRec candidate. This preserves Posting Date and payable/journal
fields as trace without treating the report amount as an implied accounting
sign.

AutoRec Detail Deposit/Payment requires the same provider evidence by
`biz_type`: one receipt-bound rule with exact company/currency scope,
rule id/version, and opposite Deposit/Payment directions. Missing rules yield
`WBS_MCP_AUTOREC_DIRECTION_CONVENTION_REQUIRED`; the detail cannot form a
review candidate. This is separate from the existing exactly-one-non-zero
Deposit/Payment rule, which still rejects both-non-zero and zero/zero detail
rows.

## Sanitized golden scenarios

The executable golden set covers exact matching, one-to-many, many-to-one,
partial/remainder handling, amount and date tolerances, cross-company/currency
and bank-account blocks, out-of-window dates, missing receipt evidence, and
same-direction blocks. The plan exposes source-level and aggregate control
totals (`bank_total`, `business_total`, `allocated_total`, remainders and
four-decimal difference), plus forward and reverse source versions/hashes.
It intentionally remains a reviewer proposal (`can_allocate=false`): actual
reservation, release and posting must be made by the authoritative kernel.

## Verification status

- **VERIFIED locally:** formal-envelope validation, canonical hash validation,
  stable-key mapping, scope-bound snapshot diff, ambiguous-movement exception,
  and control-only report admission are covered by
  `tests/wbs-mcp-inbound-lineage.test.mjs`.
- **OBSERVED:** WBS Payable and AutoRec screens expose the business concepts
  above; WBS AutoRec uses company/data-processing/release/incur/incurred-list
  stages. Their operational buttons are intentionally excluded.
- **UNKNOWN / release gate:** live signed nonempty WBS receipts, provider
  revision semantics, full field semantics for lender/debtor and
  deposit/payment, Property Comparison receipt endpoint, and live control-total
  reconciliation. None may be represented as production-complete until verified.
