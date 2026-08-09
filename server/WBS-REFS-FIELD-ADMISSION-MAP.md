# WBS to REFS field-admission map

This is the integration-facing map for the WBS Finance & Accounting boundary.
It describes where a receipt-backed provider field may go in REFS. It does
not authorize a WBS write, a REFS allocation, a journal command, or posting.
The observed source facts and negative joins are maintained in
[`WBS-READONLY-SOURCE-EVIDENCE.md`](WBS-READONLY-SOURCE-EVIDENCE.md); the
pipeline and matching rules are maintained in
[`WBS-MCP-INBOUND-LINEAGE.md`](WBS-MCP-INBOUND-LINEAGE.md).

## Universal admission envelope

Every transaction-producer row needs these provider-owned facts before it can
pass from **Raw** to **Normalized** to **Staging**:

| Fact | REFS representation | Missing or mismatched result |
| --- | --- | --- |
| Provider receipt identity | `receipt_id`, `receipt_ref`, `receipt_hash`, storage version, signature/key verification | Exception; no candidate or dispatch |
| Immutable source identity | `source_type`, `source_record_id`, `source_version` | Exception; do not use sequence, memo, Ref No., journal number, `cb_id`, or a batch value |
| Scope | tenant, entity, company, currency; bank account for bank-side records | Exception; never cross company/currency/account |
| Accounting facts | valid business/posting date, signed direction, nonzero amount, approved mapping ID/version | Exception; no Draft request |
| Provenance | Raw event, normalized row, source document, Staging item, review event | Retained in every review proposal and reverse trace |

The scope values above are REFS-owned after authentication; a WBS display
field never overrides them. A receipt must bind the actual provider payload.
The provider still owes revision/CDC/tombstone semantics, so an absent later
row is `ABSENT_UNCONFIRMED`, not a deletion.

## Source-specific routing

| WBS upstream source | Observed/provider fields retained | REFS route | Explicitly forbidden |
| --- | --- | --- | --- |
| Payable Report / `account_book_payable_info` | Provider immutable payable key (observed table primary key is `uuid`). The live report visibly exposes `GuId`, Payable No., Match/Pay/Posting Status, vendor/account/invoice, amount, invoice/incurred/pay-due/rolling/check/clear dates, owner/company/division/project/activity/unit/cost dimensions, journal/check trace, remarks and aging. Its visible **Posting Date** drill-down opens an accounting `sourceDetail` view with observed relation labels `source=PAYABLE` (occasionally `Direct`), `comeFrom=EXPA`, `sourceType=payable`, and a payable long-ID. REFS exposes those three labels as optional `source_detail_*` trace fields and retains them only when a signed row carries all labels plus the long ID; they remain bounded `payable_trace` / source-relation evidence. **Posting Date is a separate visible accounting-date field.** The AutoRec bank-account scope is supplied only by one approved immutable REFS mapping that is effective on that Posting Date, not by `cb_id` or a page locator. Treat every display field and drill-down parameter as observed trace until a signed receipt binds it to the immutable provider key/version. | Transaction **business side** only: Raw -> Normalized -> reviewed Staging -> AutoRec review candidate | Substituting incurred date for a missing/invalid posting date; promoting visible `GuId`, Payable No., `cb_id`, long ID, `sourceDetail` parameters, journal/check number, memo, or any `payable_trace` field into an immutable bank/match key or posting authority without provider proof; direct Draft/Post |
| Bank Transaction Journal provider feed | Provider immutable `bank_transaction_id`, company, bank account, currency, valid transaction date and posting date (accounting date), direction, amount, payee/vendor, memo/ref, deposit/payment display values, project/department/cost/brief dimensions, attachment/invoice evidence, user/reviewer/comments-log and source trace. Non-empty display fields are retained as bounded `bank_trace` evidence only. | Transaction **bank side** only: Raw -> Normalized -> reviewed Staging -> AutoRec review candidate | Reusing transaction date for a missing/invalid posting date; synthesizing a bank transaction from `accounting_info`, account master, journal, `cb_id`, Ref No., or any `bank_trace` field; treating download/upload/release/split/set-vendor/project/cost/user controls as inbound capabilities |
| AutoRec Detail / `fast_auto_payment_detail` | `pd_guid`, signed Deposit or Payment, company/currency receipt scope, valid business and posting date, vendor/project/cost, `pd_cbid`/`pd_pvguid` relation trace, reviewer/log; `MB_Id`/`MB_BusinessId` relation only when signed and detail-compatible | Optional business-side evidence; relation/audit trace retained in the review candidate | Reusing incurred/clear date for a missing/invalid posting date; using `pd_batchguid`, `MB_BatchGuId`, `pd_pvguid`, `pd_cbid`, Seq No., or Ref No. as a PB/bank/allocation key; WBS Release/Incur state transition |
| AutoRec Bank / `autopaymentbank` | `PB_GuId`, company, M/R/C periods, quantity, Pay/Debit/Released/Incurred amounts, bank-account display/control fields, provider formula/version | Receipt-bound **control totals** only | Per-row capacity inference, allocation, Release, Incur, Draft, Post; treating blank M/R/C as zero |
| WBS Accounting Journal / `accounting_info`, log/history | WBS journal `id`, `cb_id`, debit/credit/amount, accounting dates, source, journal/bill/check trace, review/approval/closed fields, project/cost/unit, audit log | External journal/ledger/audit **trace** only; used to explain a REFS posted evidence chain | Using nonunique `cb_id` as bank key; treating WBS review/approval/closed values as REFS posting authority |
| Cost General Ledger / accounting controls | Exact provider-defined fourteen metrics, tenant/entity/company/period (`YYYY-MM`)/uppercase ISO currency, immutable receipt whose embedded scope **and canonical metric fingerprint** exactly match reconciliation input, approved scoped control mapping, four-decimal totals | `WBS_COST_GL_CONTROL_RECONCILIATION` control comparison with forward/reverse trace | Source document, bank row, allocation, Draft JE, ledger posting; reuse of a receipt from another company/period/currency; substitute metric set |
| Property Comparison / property-unit reports | Observed relation key `PPR_Guid` plus property/unit/version/status trace; provider immutable report/snapshot key, tenant/entity/company/property, inclusive period, uppercase ISO currency, bank account, signed receipt whose embedded scope **and canonical metric fingerprint** exactly match reconciliation input, approved scoped control mapping | `WBS_PROPERTY_CONTROL_RECONCILIATION` control comparison with forward/reverse trace | Inferring the property-unit join from codes; treating `PPR_Version` as receipt/source revision; a cross-company/property/period receipt or substituted metric set; transaction ingestion, allocation, Draft/Post |

### Date matching rule is provider evidence, not an inferred Posting Date rule

Payable and Bank Transaction Journal both expose a Posting Date, while their
business, transaction, incurred, clear, and check dates can differ. A
receipt-backed AutoRec matching policy must therefore state one approved
`date_match_basis`: `BUSINESS_ONLY`, `ACCOUNTING_ONLY`, or
`BUSINESS_AND_ACCOUNTING`, together with its bounded day window. REFS records
that basis in the review-plan control totals and policy trace. Missing or
unknown WBS date semantics blocks the provider-backed review plan; REFS does
not silently assume that Posting Date equals the bank transaction date.

The live Payable Report is paginated and supports a broad filter set, including
company, vendor, project, account, posting date, incurred date, pay/check/clear
dates, status, match status and journal/check references. REFS must never use a
browser page, displayed aggregate, sort order, or page number as an ingest
watermark. A provider snapshot must pin the selected company/filter scope,
capture instant, immutable record keys, page cursor and snapshot token before
all pages can form a control population.

The live page has separate business-form, transaction, check, accounting
Source Detail, comments-log, and WBS `Not Match` surfaces. They explain how a
Payable row was processed in WBS, but they do not widen REFS authority:

```
Payable receipt/key/version
  -> Raw -> Normalized -> Staging or Exception
  -> review-only business-side candidate
  -> (separate REFS bank evidence + approved mapping/policy)
  -> authoritative REFS allocation and accounting workflow

WBS business/transaction/check/source-detail/log/not-match pages
  -> receipt-bound external trace only
```

In particular, WBS `Not Match`, Forward, Refresh, status change, upload,
account-setting, and log actions are excluded from the adapter allowlist. The
accounting `sourceDetail` labels (`source`, `comeFrom`, `sourceType`, long-ID)
remain trace-only even when they are visible from Posting Date; they cannot
provide a match key or state transition.

## AutoRec review-plan contract

Only separate reviewed REFS bank-side and business-side records can enter a
review plan. They must have the same company, currency and bank account,
opposite receipt-verified directions, valid business and accounting dates,
and an exact matching policy. The policy is a REFS-approved, receipt-bound
record containing:

- policy, matching-rule and policy-mapping IDs/versions;
- exact bank-side and business-side mapping IDs/versions;
- exact company, currency and bank account scope;
- date-window and amount-tolerance values; and
- immutable receipt identity/hash for the approved policy evidence.

The plan may expose one-to-one, one-to-many, many-to-one, partial and
tolerance-aware **review** allocations and control totals. It is never a
source reservation: `can_allocate`, `can_release`, `can_dispatch`,
`can_create_draft`, and `can_post` remain false. The REFS authoritative kernel
must re-check reservation, SoD, version, approval, period and ledger rules.
Each proposed edge carries a deterministic `allocation_edge_id` over both
source types/keys/versions, both receipt hashes, amount, currency and approved
date-match basis. Provider-backed plans additionally bind that edge to one
receipt-bound `review_plan_id`, the policy-specific proposal-edge identity, and
the approved matching-policy receipt. These identities must be echoed by the
review request and both posted accounting legs. They are trace handles only;
none can be reused as a kernel reservation, WBS identifier, or posting
authority.

## WBS workflow evidence, not state authority

WBS currently exposes the labels Company Screening, Data Processing & Release,
Incur and Incurred List. REFS records them under
`WBS_AUTOREC_OBSERVED_WORKFLOW_V1` only. A not-matched/released detail is an
observation of Data Processing & Release; an incurred detail is an observation
of Incurred List. The action-level Incur event and the WBS canonical transition
graph are **UNKNOWN**. No observed WBS status can reopen, release, incur,
reverse, create a journal, approve, post, or close a REFS case.

When supplied in a receipt, raw Detail and Match status codes are retained as
bounded `UNVERIFIED_SOURCE_CODE` evidence. They are displayed/audited exactly
as source observations and are rejected if malformed; they are never
translated into a REFS state without a signed provider transition contract.

## Read-only trace to accounting evidence

After the REFS kernel independently completes its standard workflow, G11
readback expects one POSTED `PAYABLE_INCUR` and one POSTED `AUTOC` journal,
`AUTO_JOURNAL_CREATED` audit evidence for each, complete source/ledger links,
and zero net `291001` by member. This is a read verifier, not a journal
creator. Any missing receipt, source version, scoped mapping, audit record,
ledger link, second journal leg, or `291001` imbalance remains blocked.

## Integration sequence

1. Verify signed provider receipt and snapshot scope; do not log credentials,
   URL tokens, cookies, or business rows.
2. Persist receipt, Raw, Normalized and Staging/Exception atomically with an
   idempotency key.
3. Apply the source-specific admission map and approved mapping/version.
4. Create a non-dispatchable AutoRec review plan only through the exact
   receipt-bound matching policy.
5. Hand the plan to the authoritative REFS allocation/release/incur/JE
   workflow; never invoke WBS actions.
6. Read the resulting REFS audit/ledger chain back against WBS control totals
   and source receipts; show a difference or blocked evidence rather than
   assuming success.

A WBS-originated standard Draft request must preserve the reviewed staging
source's company, ISO currency, and accounting/posting date verbatim. Its
approved mapping and Draft header must carry the same scope. A missing or
cross-scoped value blocks the request; it cannot be corrected by a later JE
workflow or by a WBS report field.
The posted REFS evidence must echo the complete reviewed source trace
(`Raw`/document/source/version/type/company/currency/accounting date); a
posted journal with a different trace is not a valid WBS accounting result.
For AutoRec G11 readback, both posted legs must additionally carry the exact
reviewed company, currency, bank account, each source's business and
accounting dates, and the immutable reviewed allocation amount before the
per-member `291001` zero-net control can pass. Each leg's aggregate `291001`
clearing must equal that reviewed amount. For policy-bound proposals, both
legs and the persisted review request must also echo the same `review_plan_id`,
allocation edge, proposal edge, and approved policy receipt.
The review pair keeps both receipt reference/hash and Source Document ID; an
ID-only receipt or a journal without the exact two source-document links is
not an auditable WBS-to-REFS result.

For a `PRODUCTION` WBS snapshot, a syntactically present detached signature is
not enough. The adapter verifies it against a pinned Ed25519 keyring before it
prepares any Raw, Normalized, Staging, Exception, or persistence plan. Caller-
supplied prepared rows are compared with this verified preparation and cannot
substitute a different result.
The synchronous preparation method refuses all production snapshots, so a
caller cannot bypass verification by calling an internal-looking helper.

For `trace_by_key`, REFS calls WBS only with an immutable persisted producer
key (`ap_guid`, `cb_id`, `pd_guid`, `pb_guid`, or journal `id`). The returned
receipt scope must echo that exact pair as `trace_key_type` and
`trace_key_value`, in addition to company scope. A same-company trace page
without this echo is blocked and cannot be retained as a bank-to-AUTOC,
Payable, or journal relation.
The trace page additionally requires its own immutable receipt (`ref`,
`version`, and `issued_at`) and detached-signature verification. Its signed
canonical manifest binds the tool, complete response scope, capture time,
content hash, receipt reference, receipt version, and issuance time. A signed
page cannot consequently be replayed for a different company or source key.
Each retained relation must also contain an immutable `relation_id`, both
source and related source key types/values, and a relation type. Missing
fields leave the entire reverse-trace request blocked; relation evidence never
becomes a match instruction, state transition, or posting authority.
Duplicate relation IDs or edges, and self-relations, are equally blocked so a
provider page cannot multiply or circularly assert an accounting lineage.

Cost GL and Property control reads are composed only from persisted WBS and
REFS metric snapshots plus an approved mapping. All three reads must agree on
tenant, entity, and the complete control scope; the composition is read-only
and exposes no transaction, allocation, Draft, or posting capability.
It emits and requires a persisted WBS control snapshot ID and REFS metric
snapshot ID in both directions of the trace; a receipt or mapping alone is
not enough to prove the control lineage. A nonzero control difference is
returned as `READ_ONLY_CONTROL_DIFFERENCE`, never as a reconciled result.
The WBS-side snapshot must also retain a verified Ed25519 receipt manifest
hash, key ID, and algorithm; a hash-only WBS control receipt is blocked. REFS
target metric snapshots are internal evidence and do not inherit this WBS
provider-signature requirement.
The database adapter accepts only those three authenticated read capabilities;
it cannot execute WBS calls, SQL text, or any accounting command.
