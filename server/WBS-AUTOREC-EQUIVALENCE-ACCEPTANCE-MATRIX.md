# WBS Auto Bank Reconciliation equivalence acceptance matrix

This matrix is the release gate for the WBS Finance-to-REFS integration. A
`LOCAL_TESTED` item proves only the REFS boundary contract with sanitized
fixtures. `OBSERVED` means read-only WBS schema or page evidence exists.
`UNKNOWN` must not be represented as production equivalence.

| Requirement | REFS implementation/evidence | Classification | Release condition still required |
| --- | --- | --- | --- |
| Payable Report as business-side input | Receipt-gated Payable -> Raw/Normalized/Staging -> non-dispatchable business-side review candidate; valid posting date is mandatory accounting-date evidence, while journal/check/clear fields remain trace only | LOCAL_TESTED + OBSERVED schema | Signed nonempty Payable response with immutable provider key, direction convention and revision/replay semantics |
| Bank Transaction Journal Entries as bank-side input | Separate immutable Bank Transaction admission and review candidate; exact company/currency/bank-account/direction/date/amount checks | LOCAL_TESTED + OBSERVED page/schema context | Signed nonempty bank-row response with immutable bank transaction key; no synthesis from WBS journal or `cb_id` |
| AutoRec Detail and payment relation | `pd_guid` only as detail candidate key; deposit/payment direction convention; bank-to-AUTOC relation retained only with receipt-bound evidence | LOCAL_TESTED + OBSERVED schema | Signed Detail/Match relation receipt proving cardinality, provider company/currency and `pd_guid` relation semantics |
| AutoRec Bank M/R/C company controls | Receipt-bound quantity/pay/debit/released/incurred control evidence; signed provider formula required | LOCAL_TESTED + OBSERVED controls | Official scoped control formula, currency/period semantics and treatment of missing M/R/C values |
| WBS four-step workflow | Company Screening, Data Processing & Release, Incur, Incurred List retained in `WBS_AUTOREC_OBSERVED_WORKFLOW_V1`; raw codes retained as `UNVERIFIED_SOURCE_CODE` | LOCAL_TESTED + OBSERVED page labels/codes | Signed canonical WBS state transition graph, actor/SoD/cancel/reopen semantics; until then WBS cannot transition REFS |
| Matching and review logic | Exact scope, opposite direction, rule-owned date window/amount tolerance, source-version de-duplication, bank/business mapping-version binding; one-to-one/one-to-many/many-to-one/partial proposals | LOCAL_TESTED | Production approved matching-rule/mapping repository and kernel reservation recheck under locks |
| Release, cancel, incur, reverse | Explicitly outside inbound authority; all WBS actions remain forbidden | LOCAL_TESTED boundary | Authoritative REFS kernel execution with source reservation, SoD, period, audit and compensation/saga proof |
| Standard Draft request scope | Reviewed Staging, approved mapping, and non-dispatchable Draft request must retain one exact company, ISO currency, and WBS posting/accounting date; Raw/document/source/version/type trace is carried forward | LOCAL_TESTED | Integrated kernel Draft command must preserve the same scope and return an immutable request/receipt readback |
| Standard JE and G11 accounting result | Read verifier requires exactly one posted `PAYABLE_INCUR` + one posted `AUTOC`; both legs must each carry matching, nonzero `291001` member clearing evidence with opposite net effects, then net to zero by member. Both legs must echo the exact reviewed company/currency/bank, two receipt refs/SHA-256 hashes, two Source Document IDs, both business/accounting dates, audit/source/ledger links. | LOCAL_TESTED | Integrated kernel PG evidence with actual posted rows, standard approval and ledger immutability; no WBS JE inference |
| Cost General Ledger control reconciliation | Exactly fourteen receipt-bound metrics with tenant/entity/company/period/currency and approved mapping; exact four-decimal differences/trace | LOCAL_TESTED + OBSERVED configuration candidates | Provider-defined metric names/formulas and signed nonempty Cost GL receipt |
| Property Comparison control reconciliation | Receipt-bound tenant/entity/company/property/date/currency/bank scope with approved mapping; forward/reverse trace | LOCAL_TESTED + OBSERVED configuration candidates | Provider report join/calculation and signed nonempty Property receipt |
| 12 golden scenarios | [`contracts/wbs-autorec-golden-scenarios-v1.json`](contracts/wbs-autorec-golden-scenarios-v1.json) fixes exact, partial, one-to-many, many-to-one, cross-company, tolerance, duplicate, reopen boundary, NUL isolation, invalid date, 291001 trace and the Cost GL/Property report-as-source block. The latter permits only `RECONCILED`/`DIFFERENCE` control evidence through WBS snapshot → approved mapping → REFS metric snapshot trace. | LOCAL_TESTED | De-identified provider sample set and source-vs-target control-total comparison |
| Raw -> Normalized -> Staging/Exception provenance | Immutable receipt/key/version, idempotency and atomic ingress seams; missing facts become Exception | LOCAL_TESTED | Production receipt store, signature keyring, PostgreSQL persistence and replay test |
| Forward and reverse trace | Source receipt/key/version -> Raw/Normalized/Staging -> review proposal -> REFS mapping/JE/ledger readback; `trace_by_key` rejects display identifiers | LOCAL_TESTED | Live receipt-backed persisted trace plus browser refresh across the authoritative REFS UI |
| Security and mutation boundary | WBS allowlist is read-only; no WBS write, no provider credential/token/business row in source/logs; Cost/Property cannot transact | LOCAL_TESTED | Independent production security review of configured provider client, receipt store and logs |

## Acceptance sequence

1. Supply and validate the signed, nonempty provider receipts named above.
2. Run the actual provider responses through the same fail-closed ingress.
3. Persist and read back receipt, source version, Raw, Normalized, Staging and
   Exception rows in PostgreSQL.
4. Reconcile the twelve de-identified golden scenarios and their control totals.
5. Let only the authoritative REFS kernel reserve/release/incur/create/review/
   approve/post, then validate G11 and ledger trace. The two posted legs must
   echo the exact two-source receipt/document/scope trace and each carry a
   nonzero, opposite `291001` member effect; a zero balance inside one leg or
   only across an unrelated pair is insufficient.
6. Independently audit the exact integration SHA, PG/browser evidence and
   configured production controls.

Until all rows have the required production evidence, the overall verdict is
**PARTIAL**, not functional-equivalence or production-release PASS.
