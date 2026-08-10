# WBS Finance to REFS Auto Bank Reconciliation: Physical Ingress Map

Status labels: **OBSERVED** means a read-only WBS schema or screen fact; **IMPLEMENTED_LOCAL** means a REFS adapter/test contract; **UNKNOWN** requires a signed nonempty WBS receipt or an approved business rule. WBS is never written by this flow.

## Producer and control boundary

| WBS source | Stable key | REFS role | Admission boundary | REFS result |
| --- | --- | --- | --- | --- |
| `wbsdata.account_book_payable_info` (Payable Report) | `uuid` | Transaction producer | Same company, signed result receipt, amount, incurred date, posting date, type-direction rule | Raw -> Normalized -> Staging/Exception; later standard Draft request only after REFS mapping/review |
| Bank Transaction Journal result | provider `bank_transaction_id` | Bank transaction producer | `bank_transaction_id` is mandatory; `cb_id`, journal number and ref number are trace only | Raw -> Normalized -> Staging/Exception; bank side of review plan |
| `wbsdata.fast_auto_payment_detail` (AutoRec Detail) | `pd_guid` | AutoRec review evidence | Same-key result supplies Posting Date; vendor/project/cost/memo required; signed `pd_guid -> pb_guid` relation required | Case-scoped review staging only; no WBS state transition or JE command |
| `wbsdata.autopaymentbank` | `PB_GuId` / provider `pb_guid` | Company/case control evidence | Same-key result may supply `released_quantity`; provider must attest formula and period before totals are used | Control-only; no source document, allocation, Draft or post |
| `accounting.accounting_info` | numeric `id` | Journal/ledger trace evidence | Company-scoped; `cb_id` is relation trace, not a bank key | Trace only; supports G11 readback, not a producer |
| Cost General Ledger relations and Property Comparison relations | provider-defined immutable control key | Control evidence | Signed control receipt plus one approved control mapping to the matching REFS metric scope | `RECONCILED` or `DIFFERENCE`; never a transaction, allocation, Draft or post |

## Field and evidence rules

1. Payable preserves WBS amount, incurred date, posting date, vendor/project/cost and journal trace. Its account code is not a bank-account proof.
2. Bank Journal preserves account, transaction/posting dates, amount direction, memo/ref and payee trace. Only the provider-issued bank transaction ID is a source key.
3. AutoRec Detail preserves `pd_pvguid` and `pd_cbid` as navigation/reverse trace. They cannot bind a case. The only admissible binding is a signed, same-company/currency/snapshot `pd_guid -> pb_guid` relation, and the PB row supplies the bank account scope.
4. Detail Posting Date must be a same-`pd_guid` result field. It is never copied from incurred date, clear date or another row.
5. PB Quantity/Pay/Debit/Released/Incurred are observed controls. `released_quantity`, period and a provider `ROW_SUM` formula are mandatory before REFS treats them as control totals.
6. WBS display states (for example Released or Incurred) are evidence only. REFS owns Draft -> Review -> Approve -> Posted and the immutable ledger workflow.

## REFS state and accounting flow

```text
signed WBS receipt
  -> Raw (immutable payload/reference/hash/version)
  -> Normalized (company, currency, amount, business + posting date, direction)
  -> Staging or Exception
  -> receipt-bound, mapping-bound AutoRec review proposal
  -> authoritative reservation/release/incur in REFS
  -> standard Draft JE -> review/approval -> Posted
  -> ledger/audit/G11 trace
```

The ingress layer emits no allocation, release, incur, Draft, approval or posting command. Missing key/date/company/currency/mapping/amount/direction evidence remains an Exception.

## Controls and trace

- Every review edge contains source type/key/version, receipt hash, company/currency/bank account, amount, date basis, approved mapping-policy trace and (when present) company M/R/C control snapshot hash.
- A source may appear once per review plan/version. Duplicate source keys, cross-company/currency/account rows, same-side direction, incompatible dates and missing immutable receipt evidence are blocked.
- Split plans use exact four-decimal capacity accounting. One-to-many and many-to-one proposals are review-only; the authoritative REFS reservation service repeats global conservation under locks.
- G11 requires both existing Posted standard REFS `PAYABLE_INCUR` and `AUTOC` legs, their audit/ledger links, source trace and per-member `291001` net zero. WBS journal rows alone never satisfy this.

## Golden acceptance coverage

`server/contracts/wbs-autorec-golden-scenarios-v1.json` and `server/tests/wbs-autorec-golden-scenarios.test.mjs` cover exact, partial, one-to-many, many-to-one, amount/date tolerance, cross-company, duplicate replay, reopen evidence, NUL isolation, invalid date, 291001 trace and report-as-source blocking. The physical-to-provider adapter regression is `server/tests/wbs-provider-readonly-row-adapter.test.mjs`.

## Remaining external evidence

- **UNKNOWN:** signed, nonempty WBS provider receipts for each source/result view, including immutable `bank_transaction_id`, Detail `pd_guid`, signed detail-to-case relation, currencies, provider snapshot token and result-field semantics.
- **UNKNOWN:** WBS's canonical transition graph and whether observed Released/Incurred statuses permit cancellation/reopen. REFS deliberately does not infer it.
- **UNKNOWN:** definitive PB released-quantity/amount formulas and Cost GL/Property metric populations. They remain control-only until an approved receipt-bound mapping and formula are supplied.
