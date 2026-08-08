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
- Field-level metadata retrieval is currently **UNKNOWN**: the follow-up
  `list_columns(wbsdata.autopaymentbank)` request failed at connector transport
  level before a response was received. It must be retried through the approved
  read-only provider path; do not infer columns from table names.

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
