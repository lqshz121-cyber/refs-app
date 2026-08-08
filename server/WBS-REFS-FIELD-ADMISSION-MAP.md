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
| Payable Report / `account_book_payable_info` | Provider immutable payable key (observed table primary key is `uuid`), company, amount, invoice/incurred/posting/clear dates, vendor/project/cost dimensions, type/status, journal/check/`cb_id` trace | Transaction **business side** only: Raw -> Normalized -> reviewed Staging -> AutoRec review candidate | Treating `cb_id`, long ID, journal number, memo, or display reference as a bank/match key; direct Draft/Post |
| Bank Transaction Journal provider feed | Provider immutable bank transaction key, company, bank account, currency, transaction/posting date, direction, amount, payee/vendor, memo/ref, source/review trace | Transaction **bank side** only: Raw -> Normalized -> reviewed Staging -> AutoRec review candidate | Synthesizing a bank transaction from `accounting_info`, account master, journal, `cb_id`, or Ref No. |
| AutoRec Detail / `fast_auto_payment_detail` | `pd_guid`, signed Deposit or Payment, company/currency receipt scope, dates, vendor/project/cost, `pd_cbid`/`pd_pvguid` relation trace, reviewer/log; `MB_Id`/`MB_BusinessId` relation only when signed and detail-compatible | Optional business-side evidence; relation/audit trace retained in the review candidate | Using `pd_batchguid`, `MB_BatchGuId`, `pd_pvguid`, `pd_cbid`, Seq No., or Ref No. as a PB/bank/allocation key; WBS Release/Incur state transition |
| AutoRec Bank / `autopaymentbank` | `PB_GuId`, company, M/R/C periods, quantity, Pay/Debit/Released/Incurred amounts, bank-account display/control fields, provider formula/version | Receipt-bound **control totals** only | Per-row capacity inference, allocation, Release, Incur, Draft, Post; treating blank M/R/C as zero |
| WBS Accounting Journal / `accounting_info`, log/history | WBS journal `id`, `cb_id`, debit/credit/amount, accounting dates, source, journal/bill/check trace, review/approval/closed fields, project/cost/unit, audit log | External journal/ledger/audit **trace** only; used to explain a REFS posted evidence chain | Using nonunique `cb_id` as bank key; treating WBS review/approval/closed values as REFS posting authority |
| Cost General Ledger / accounting controls | Exact provider-defined fourteen metrics, tenant/entity/company/period/currency, immutable receipt, approved scoped control mapping, four-decimal totals | `WBS_COST_GL_CONTROL_RECONCILIATION` control comparison with forward/reverse trace | Source document, bank row, allocation, Draft JE, ledger posting |
| Property Comparison / property-unit reports | Immutable report/snapshot key, tenant/entity/company/property, inclusive period, currency, bank account, signed receipt, approved scoped control mapping | `WBS_PROPERTY_CONTROL_RECONCILIATION` control comparison with forward/reverse trace | Inferring the property-unit join; transaction ingestion, allocation, Draft/Post |

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
