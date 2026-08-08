# WBS read-only source evidence register

This register supplements [WBS-MCP-INBOUND-LINEAGE.md](WBS-MCP-INBOUND-LINEAGE.md).
It records source discovery evidence separately from REFS admission rules. A
table name is not proof of a field meaning, relationship, business transition,
or permission.

## Observation record

- Observation method: authenticated WBS read-only metadata connector,
  `list_tables`; no WBS write was attempted.
- Observation date: 2026-08-09.
- Business values, credentials, cookies, and tokenized URLs were neither
  retained nor exported.
- Field metadata was retrieved through the approved read-only provider path
  after an initial connector transport failure. The table/field findings below
  are **OBSERVED schema evidence**, not a license to bypass the signed provider
  receipt, mapping, Staging/Exception, or human-review gates.

## Observed source inventory

| Database | Observed table | Intended evidence role | Confidence | Not yet established |
| --- | --- | --- | --- | --- |
| `wbsdata` | `account_book_payable_info` | Payable-report candidate source | OBSERVED table only | immutable payable key, posting date, amount, currency, mapping fields |
| `wbsdata` | `accountbook` | Bank/account-book candidate source | OBSERVED table only | immutable bank-record key, signed amount direction, account and company scope |
| `wbsdata` | `accountbookpaymentset` | Bank/payment configuration or relation candidate | OBSERVED table only | cardinality, lifecycle, and whether it is transactional |
| `wbsdata` | `autopaymentbank` | AutoRec bank/control candidate source | OBSERVED table only | immutable `pb` key, period/control-total field semantics |
| `wbsdata` | `fast_auto_payment_detail` | AutoRec payment/detail candidate source | OBSERVED table only | immutable `pd` key, deposit/payment direction, bank/payable relation |
| `wbsdata` | `match_business_info` | Matching relation candidate source | OBSERVED table only | relationship keys, allocation meaning, state-history semantics |
| `accounting` | `accounting_info` | WBS accounting trace candidate source | OBSERVED table only | immutable journal key, posting/review/approval state semantics |
| `accounting` | `accounting_log` | Accounting audit/log candidate source | OBSERVED table only | actor/event identity, append-only behavior, linkage to journal evidence |
| `accounting` | `accounting_monthly_relation` | Monthly reconciliation/control relation candidate | OBSERVED table only | period key, company scope, control-total definition |
| `accounting` | `accounting_monthly_setting` | Monthly settings candidate | OBSERVED table only | whether setting is approved/effective and admissible as a mapping |
| `accounting` | `accounting_cost_relation` | Cost GL control relation candidate | OBSERVED table only | fourteen metric definitions and REFS mapping semantics |
| `accounting` | `fastautopaymentbank1` | AutoRec accounting/control candidate source | OBSERVED table only | whether it duplicates or projects `wbsdata.autopaymentbank` |

## Observed AutoRec and Payable schema facts

| Source | Observed keys and accounting fields | Evidence classification | REFS consequence |
| --- | --- | --- | --- |
| `autopaymentbank` | `PB_GuId` is the non-null primary key; `PB_CompanyCode` is indexed; it stores Pay/Debit/Released/Incurred amounts, Quantity, bank-account ID/name, Status, M/R/C months, start transaction date, and check status/date. | VERIFIED schema | It is a company-scoped control source. It may contribute receipt-bound M/R/C and quantity/amount controls, never an allocation, release, incur, Draft, or post command. |
| `fast_auto_payment_detail` | `pd_guid` is the non-null primary key; indexed relation-like fields include `pd_cbid`, project keys, clear/incurred/check dates and business type. It stores Deposit/Payment, vendor, project, cost, memo, status, release/incur actors/dates, source data, and `pd_pvguid`/`pd_batchguid`. | VERIFIED schema | `pd_guid` is the only observed candidate immutable detail key. Deposit/Payment needs signed-direction validation. `pd_cbid` and `pd_pvguid` are retained relation evidence, not REFS keys or state authority. |
| `match_business_info` | `MB_Id` is the primary key. `MB_BusinessType`, `MB_BusinessId`, and `MB_BatchGuId` are indexed; it also has create time and source. | VERIFIED schema | A match relation exists, but cardinality/history meaning is UNKNOWN. It cannot by itself create an AutoRec allocation or change a REFS state. |
| `account_book_payable_info` | `uuid` is the primary key; indexed `type`/`long_id`; it stores company, amount, invoice/incurred/posting/clear dates, vendor/project/cost dimensions, payment/review status, account/journal data, and `cb_id`. | VERIFIED schema | It is the observed Payable candidate. Do not equate `uuid` with formal `ap_guid` without provider contract proof. `cb_id`, journal, and posting fields are trace only until receipt-backed mapping verifies them. |
| `accountbook` | `ID` is the primary key and `ComCode` is indexed; it stores account code/name, company, book type, balances, bank balance/date, and operational configuration. | VERIFIED schema | Bank-account master/control evidence, not an observed bank-transaction feed. It cannot enter AutoRec as a bank source row. |
| `accountbookpaymentset` | `APS_GuId` is the primary key and company is indexed; it holds project/entity/account settings and status. | VERIFIED schema | A partial value-level join from `APS_AccountId` to `accountbook.ID` exists, but unmatched settings remain. Treat as configuration evidence only until effective-date, approval, and company/cardinality semantics are proven. |

## Tested relationship findings

The following aggregate-only read checks were executed without selecting a
business row:

1. `fast_auto_payment_detail.pd_batchguid` has populated values, but no value
   matched `autopaymentbank.PB_GuId` in the tested source. It is therefore
   **not a verified AutoRec batch foreign key** and must never fill `pb_guid`.
2. `match_business_info.MB_BatchGuId` likewise produced no match to
   `autopaymentbank.PB_GuId`. It is not a verified PB relation.
3. `account_book_payable_info.cb_id` and
   `fast_auto_payment_detail.pd_cbid` are both frequently populated, but their
   relationship/cardinality has not yet been proven. They remain retained
   bank-relation evidence only.
4. `accountbookpaymentset.APS_AccountId` partially matches `accountbook.ID`.
   The unmatched population prevents treating the join as an authoritative
   mapping or account admission rule.

These negative findings are material: the REFS adapter must reject any future
provider mapping that silently derives a PB key from `pd_batchguid`,
`MB_BatchGuId`, `pd_pvguid`, a memo, a reference number, or a display sequence.

## Observed accounting, report, and state evidence

| Source | Verified schema facts | REFS role and boundary |
| --- | --- | --- |
| `accounting.accounting_info` | `id` is the primary key; `cb_id`, company, account, source, set date and journal number are indexed. It contains DR/CR, amount, posting/clear/check dates, `come_from`, `bill_no`, `journal_no`, review/approval/closed fields, project/cost/unit dimensions, and attachment relation references. | Journal/ledger trace evidence only. Its own primary key and state fields do not prove a posted REFS journal, immutable REFS ledger line, or authority to transition a REFS AutoRec case. |
| `accounting.accounting_log` | `id` is the primary key; company, `cb_id`, system/source, bill, operation type, user, time, and relation-content fields exist. | External audit/relation trace only. Append-only and row-to-journal cardinality are UNKNOWN. |
| `accounting.accounting_monthly_relation` + `accounting_monthly_setting` | Relation has company, bank transaction (`cb_id`), month and setting ID. Setting has company, project, debit/credit account/journal fields, start/end date and reverse flag. An aggregate-only check found a partial setting-ID match; not every relation joined. | Potential monthly control/mapping evidence only. It is not an approved REFS mapping and cannot produce a Draft/post request. |
| `accounting.accounting_balance_cell` + `accounting_income_cell` | Both expose company, account/subaccount, fiscal period, balance/net/debit/credit and review flag. The observed balance review-flag domain is `N`, `R`, `C`; amount-type codes are documented as balance/debit/credit/net/opening. | Financial-statement control evidence, not a Cost GL producer or AutoRec source. Cost GL's required fourteen metrics still need a signed, scoped provider definition. |
| `accounting.fastautopaymentbank1` | It has the same observed PB primary/company/control field family as `wbsdata.autopaymentbank` (with a shorter column set). | A parallel accounting-side control projection is plausible but UNVERIFIED. Do not deduplicate, join, or substitute it for the WBS table without a signed relation contract. |

### Observed state values, not a translatable state machine

Aggregate-only source reads observed AutoRec Detail `pd_match_status` values
`Match` and `NotMatch`, together with `pd_status` values including empty,
`I`, `R`, `IR`, `RR`, `P`, `AUTOC`, and other source-specific values. AutoRec
Bank currently has status `N` in the observed aggregate. `accounting_info`
has observed `review` values null, `0`, and `1`; its current aggregate showed
only `approve_status=0`. Balance cells expose review flags `N`, `R`, and `C`.

These are **OBSERVED codes only**. The database comments and aggregate values
do not establish legal transitions, actor/permission rules, cancellation
semantics, SoD, period-close semantics, or equivalence to REFS states. The
REFS authoritative lifecycle remains its own review/approval/posting workflow;
WBS codes are retained only as receipt-bound display/audit evidence until an
official state/transition contract is received.

## Required read-only field evidence before provider mapping

The provider must supply a versioned metadata receipt showing the column name,
type, nullability, primary/unique-key membership, and foreign-key metadata for
each table above. The following checks are mandatory before replacing the
formal MCP mapping with direct provider mappings:

1. **Payable:** prove immutable key, company, currency, non-zero amount,
   posting date, payable status, and source-to-journal relation.
2. **Bank transaction:** prove immutable bank record key, company, bank account,
   transaction/posting date, amount plus unambiguous DR/CR direction, and
   retained memo/reference relation.
3. **AutoRec detail and control:** prove the `pd` and `pb` keys independently;
   demonstrate `pd` to bank/payable/AUTOC cardinality without promoting a
   display/reference field to a REFS key; prove quantity/released/incurred
   control semantics and signed conservation.
4. **Matching:** prove whether `match_business_info` is append-only history or
   current state, and its exact business/bank/allocation keys. Absence of a row
   may not be treated as unmatch or deletion without a tombstone contract.
5. **Accounting trace:** prove journal identity, posting/review/approval
   evidence, ledger line identity, and the two `PAYABLE_INCUR`/`AUTOC` legs
   required by the REFS G11 verifier. WBS state text never authorizes a REFS
   command.
6. **Cost GL and Property:** prove metric names, scope, period, currency and
   receipt version. These remain control evidence only; no finding can create
   a source document, allocation, Draft JE, or ledger posting.

## Safe next provider queries

Only after column metadata is available, collect aggregate-only evidence per
company and bounded date scope: row count, null count for each required key,
distinct-key count, min/max date, signed amount totals, and FK-orphan count.
Do not select identifiers, memo/vendor text, attachments, credentials, or
tokenized URLs. Store the response only as an immutable provider receipt hash
and version in REFS.

## Admission consequence

Until the required evidence is signed and nonempty, direct table access is
blocked from REFS persistence. The existing formal MCP boundary remains the
only allowed input shape and still requires its own detached signature,
scope/receipt checks, Raw -> Normalized -> Staging/Exception trace, and human
review. Nothing in this register grants Draft, approval, posting, release,
incur, split, upload, or WBS-write authority.
