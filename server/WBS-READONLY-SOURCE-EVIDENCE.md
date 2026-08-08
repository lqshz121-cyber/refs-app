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
| `wbsdata` | `pjcat_property_relation` | Property Comparison relation candidate | OBSERVED table only | authoritative report join, company/currency/period scope, and report semantics |
| `wbsdata` | `pjcat_unit_report` | Property Comparison control candidate | OBSERVED table only | report grain, property relation, company/currency/period scope, and source-of-truth calculation |
| `wbsdata` | `costcode_account_relation` | Cost/account mapping candidate | OBSERVED table only | company/effective-date/approval scope and whether it is the Cost GL metric source |

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
5. Some Payable primary-key rows have a shared `cb_id` with WBS-source
   `accounting_info` lines. This is the only observed Payable-to-accounting
   relation in the tested candidates. `long_id -> business_guid` and
   `journal_no -> journal_no` produced zero matches and must remain external
   display trace, not join keys.
6. `match_business_info.MB_BusinessId` matches
   `fast_auto_payment_detail.pd_guid` only for the observed business types
   `AUTOC`, `AUTOP`, and (except for a small unmatched remainder) `AUTOR`.
   It has no observed match to Payable `uuid`; `MB_BatchGuId` has no observed
   match to either PB key or Detail batch key.

These negative findings are material: the REFS adapter must reject any future
provider mapping that silently derives a PB key from `pd_batchguid`,
`MB_BatchGuId`, `pd_pvguid`, a memo, a reference number, or a display sequence.

`match_business_info` is a multi-business routing/relation table, not an
AutoRec-only allocation table. A direct Detail relation is admissible only if
a signed provider receipt identifies its immutable `MB_Id`, has one of the
observed Detail-compatible business types, and binds `MB_BusinessId` exactly
to the receipt's `pd_guid`. Even then it is retained as relation evidence;
it cannot reserve, split, release, incur, reverse, or post anything. All other
business types and any unmatched row remain outside the AutoRec Detail path.

## Observed Property Comparison and Cost mapping facts

| Source | Verified schema facts | REFS role and boundary |
| --- | --- | --- |
| `pjcat_property_relation` | `PPR_Guid` is the primary key; property code and property-unit code/guid are indexed. It carries vertical/property/HOA/Yardi identifiers, version, status, lock, and create/modify fields. | Property association/control evidence only. It has no observed company, currency, period, monetary comparison, or AutoRec transaction key. |
| `pjcat_unit_report` | `UR_GuId` is the primary key; it contains unit/project/owner fields and budget, released, incurred, total, balance, loan/draw/repayment and many date/status fields. | Potential Property Comparison control input only. It has no observed company/currency/receipt version or verified relation to `pjcat_property_relation`, so it cannot create a source document, bank row, allocation, Draft, or posting. |
| `wbsdata.costcode_account_relation` | `id` is the primary key; cost code/name, WBS and Yardi account/name, type, business type, and status exist. The documented status domain is `0` normal and `1` disabled. | Candidate mapping evidence only. It lacks observed company, effective date, approval actor and receipt version; REFS still requires its own approved scoped mapping. |
| `accounting.costcode_account_relation` + `setting_cost_relation` + `setting_project_relation` + `accounting_setting` | Accounting-side configuration has cost/project-to-setting relations, company, account/journal, date range, business type and source fields. Aggregate joins to `accounting_setting` are partial. | Configuration/audit evidence only; partial joins preclude an automatic mapping. No configuration row can authorize Draft/post or replace REFS mapping approval. |
| `accounting_report_approval` | Schema provides company, Balance/Income report month/type, review/approval/rejection actor/time fields. The observed aggregate was empty. | Defines a possible report-approval evidence shape only; it does not prove any approval, Cost GL result, Property Comparison result, or REFS posting authority. |

The attempted direct join `pjcat_property_relation.PPR_PropertyUnitGuid` to
`pjcat_unit_report.UR_GuId` produced zero matches. This is explicit negative
evidence: neither value may be used as a Property Comparison relation key until
the provider supplies the report's actual immutable join contract. Likewise,
the partial Cost/Project-setting joins may not be filled in by fallback rules.

## Observed accounting, report, and state evidence

| Source | Verified schema facts | REFS role and boundary |
| --- | --- | --- |
| `accounting.accounting_info` | `id` is the primary key; `cb_id`, company, account, source, set date and journal number are indexed. It contains DR/CR, amount, posting/clear/check dates, `come_from`, `bill_no`, `journal_no`, review/approval/closed fields, project/cost/unit dimensions, and attachment relation references. A `data_source='WBS'` population is observed. | Journal/ledger trace evidence only. In the WBS population, `cb_id` is intentionally non-unique (multiple accounting rows per bank-record relation); its own `id` and state fields do not prove a bank transaction, posted REFS journal, immutable REFS ledger line, or authority to transition a REFS AutoRec case. |
| `accounting.accounting_log` | `id` is the primary key; company, `cb_id`, system/source, bill, operation type, user, time, and relation-content fields exist. | External audit/relation trace only. Append-only and row-to-journal cardinality are UNKNOWN. |
| `accounting.accounting_info_history` | Mirrors accounting-line fields and adds `history_create_date`, but exposes no observed immutable pointer to a current `accounting_info` row, no source revision number, and no tombstone operation. | Historical observation only. It cannot supply CDC, a REFS source version, or deletion semantics. |
| `accounting.accounting_closed` | Has company, period, `closed`, create/update actor and time. The observed close-flag domain is `Y`/`N`. | WBS period-close control evidence only. It cannot close or reopen a REFS period. |
| `accounting.accounting_report_check_red` | Has company, report month, account/subaccount, Balance/Income parameter type, report/source amounts, and check time. | Balance/Income variance-control evidence only. It is not Cost GL's fourteen-metric receipt or a transaction producer. |
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

### Bank-record to journal relation boundary

An aggregate-only cross-database existence check confirms that some WBS-source
`accounting_info.cb_id` values occur in
`fast_auto_payment_detail.pd_cbid`. The WBS accounting population also has
many more journal rows than distinct `cb_id` values. This proves a shared
relation domain, not a one-to-one relationship or a transaction source key.

The observed `wbsdata.accountbook` table is an account master, while
`accounting_info` is a multi-line accounting trace. No directly admissible
immutable bank-record table was identified from the observed `wbsdata` and
`accounting` metadata inventory. Therefore the future provider must still
deliver the formal `list_bank_transactions` record with its own immutable
`cb_id`, company, bank account, date, currency, direction, amount and receipt
version. REFS must never synthesize that bank record from `accounting_info.id`,
`cb_id`, journal number, memo, or a relation row.

### Payable to accounting-trace boundary

The observed Payable table has its own immutable `uuid`; its `cb_id` can
participate in a receipt-bound forward/reverse trace to WBS accounting lines.
This relation is not unique on the accounting side and therefore must retain
both the payable source identity and each accounting-line identity. It cannot
replace the provider's formal Payable immutable key or turn an accounting line
into a source payable.

The tested alternatives, Payable `long_id` to accounting `business_guid` and
Payable `journal_no` to accounting `journal_no`, had zero matching key values.
REFS must retain them as masked external references only; it must not use them
for joins, replay identity, allocation, matching, or posting.

### AutoRec match-relation boundary

`MB_Id` is the observed match-relation primary key, while `MB_BusinessId` is
not globally a Detail key. The exact Detail-compatible subset is currently
limited to `AUTOC`, `AUTOP`, and `AUTOR`; it is a scope guard, not a state
machine. The provider must supply a signed receipt containing the relation ID,
business type, business ID, capture time, company scope and source version
before REFS can retain this edge. No observed table join proves whether these
rows are append-only history, current state, or allocation history, so REFS
continues to use its own match-group/allocation history and control totals.

### Incremental and close-control boundary

The observed `accounting_info_history` schema has a distinct history primary
key and capture time but no version number, immutable parent accounting-line
key, or tombstone field. Its current observed population is too small and too
weakly linked to establish change data capture. No source table examined so far
provides a provider-approved revision/CDC/tombstone contract for Payable, Bank
Transaction, AutoRec Detail, Property, or Cost controls.

`accounting_closed` exposes WBS company-period close flags and
`accounting_report_check_red` exposes Balance/Income report-vs-source checks.
Both are receipt-bound external controls. REFS must preserve its own period
status, authority, audit and reopening rules; it may record a mismatch or
block a review according to approved policy, but cannot translate a WBS `Y/N`
flag into a REFS state transition.

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
