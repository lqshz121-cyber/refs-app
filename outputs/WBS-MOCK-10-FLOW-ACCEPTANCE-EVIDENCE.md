# WBS Mock 10-Flow Acceptance Evidence

Status: **LOCAL_CONTRACT_TESTED / PARTIAL**. This index records the ten formal WBS-to-accounting mock flows that are currently executable in REFS. It links to the detailed readiness pack rather than duplicating its source contract or release requirements.

Scope: deterministic fixtures and local accounting projections only. No production WBS call, provider write, real-provider receipt, accounting API write, or production posting is performed by these checks.

## Canonical checks

Run from the repository root:

```powershell
node verify-wbs-e2e-flow-evidence.mjs
node verify-wbs-report-impact.mjs
npm.cmd run test:wbs-accounting-acceptance
npm.cmd run test:wbs-accounting-foundation
```

The first verifier is the canonical ten-flow terminal-evidence check. The report-impact verifier proves the allowed mock POSTED projections and tied statements. The two test scripts validate fixture isolation, field contracts, and acceptance invariants.

## Flow-to-evidence map

| ID | Formal mock flow | Permitted terminal state | Primary executable proof | Key fail-closed rule |
| --- | --- | --- | --- | --- |
| `PAYABLE_TO_ACCRUAL` | Payable Report → finding → accrual Draft → review | `POSTED_JE` (mock only) | `verify-wbs-e2e-flow-evidence.mjs`; `test:wbs-accounting-acceptance` | Same source document, reviewed balanced JE, GL/report and audit must agree. |
| `BANK_TO_EXCEPTION` | Bank statement → exception queue → reconciliation review | `CONTROL_REVIEW` | `verify-wbs-e2e-flow-evidence.mjs`; `test:wbs-accounting-acceptance` | An unmatched bank payment is retained; it cannot borrow a JE, GL, or report posting. |
| `COST_GL_TO_CWIP_REVIEW` | Cost GL → project classification → CWIP cutoff review | `CONTROL_REVIEW` | `verify-wbs-e2e-flow-evidence.mjs`; `test:wbs-accounting-acceptance` | A completed-project capitalization issue remains review-only; no inferred reclass posts. |
| `LOAN_DRAW_TO_REPORTS` | Construction loan draw → loan JE → GL → reports | `POSTED_JE` (mock only) | `verify-wbs-e2e-flow-evidence.mjs`; `verify-wbs-report-impact.mjs` | Cash and loan-payable lines must retain one reviewed source/JE lineage. |
| `INSURANCE_TO_AMORTIZATION` | Insurance payment → prepaid → amortization schedule | `POSTED_JE` (reviewed July mock line only) | `verify-wbs-e2e-flow-evidence.mjs`; `verify-wbs-report-impact.mjs` | The twelve-month schedule is retained; future monthly entries cannot be auto-posted. |
| `PROPERTY_TAX_TO_ACCRUAL` | Property-tax statement → accrual/prepaid decision | `POSTED_JE` (mock accrual only) | `verify-wbs-e2e-flow-evidence.mjs`; `verify-wbs-report-impact.mjs` | A controller-reviewed, balanced, source-bound accrual is required; future prepaid remains Draft-only. |
| `PROPERTY_OPS_TO_REVENUE` | Property operations → rent-income pickup → entity GL | `CONTROL_REVIEW` | `verify-wbs-e2e-flow-evidence.mjs`; `test:wbs-accounting-acceptance` | A rent-roll mismatch is retained for review and cannot infer a pickup JE. |
| `SOURCE_TO_TB` | Source transactions → JEs → trial balance | `AGGREGATE_POSTED` (mock only) | `verify-wbs-e2e-flow-evidence.mjs`; `verify-wbs-report-impact.mjs` | Multi-source POSTED lineage and a tied Trial Balance are mandatory. |
| `TB_TO_STATEMENTS` | Trial balance → BS / IS / cash flow | `AGGREGATE_POSTED` (mock only) | `verify-wbs-e2e-flow-evidence.mjs`; `verify-wbs-report-impact.mjs` | Statements must come from the tied POSTED aggregate, never browser-derived totals. |
| `GL_TO_AI_ANALYSIS` | Full GL → AI Audit Center → accounting analysis report | `AI_ANALYSIS` | `verify-wbs-e2e-flow-evidence.mjs`; `test:wbs-accounting-acceptance` | Analysis is audited read-only evidence; it has no AI posting path. |

## Completion semantics

`POSTED_JE` requires source data, accounting event, balanced suggested JE, review, same-lineage mock posted JE, GL impact, report impact, and audit trail. `CONTROL_REVIEW` requires source/event, terminal controller review, and audit, while expressly retaining no posting. `AGGREGATE_POSTED` adds a multi-source Trial-Balance trace. `AI_ANALYSIS` requires retained GL/report aggregate evidence and an audited terminal analysis state, never a posting.

`COMPLETE` in this document means only that every evidence item required by that flow's permitted local terminal state is present. It does **not** mean that an exception has been resolved, a controller has approved a live transaction, or a WBS provider fact has been verified.

## Provider-live exclusions (P0)

No authorized live WBS provider/API or signed-receipt bucket is available to this release task. Live extraction, provider writes, and imports are therefore intentionally **not attempted** here.

The mock suite cannot close any of the following gates:

- A signed, nonempty WBS provider envelope; pinned public key, key ID, algorithm, immutable receipt/hash, source version, replay, CDC, pagination, and tombstone semantics.
- A verified mapping from actual provider fields and immutable identifiers into Raw → Normalized → Staging/Exception.
- Real provider company, entity, currency, amount-direction, posting-date, allocation, matching, or state-transition semantics.
- Persistent kernel/API readback proving controller action, standard JE approval/posting, GL/report/audit lineage against non-mock provider rows.
- Authenticated staging/production browser evidence and the external release gates described in the readiness pack.

Until those gates have their own raw evidence, this phase remains **PARTIAL** and must not be described as a WBS-provider or production pass.

## Related artifacts

- [Mock readiness pack](REFS-WBS-MOCK-ACCOUNTING-READINESS.md)
- [Mock flow builder](../src/wbs-e2e-flow-evidence.js)
- [Mock acceptance test](../tests/wbs-accounting-acceptance.test.js)
- [WBS final inbound handoff](WBS-FINAL-INBOUND-HANDOFF.md)
- [WBS AutoRec equivalence matrix](../server/WBS-AUTOREC-EQUIVALENCE-ACCEPTANCE-MATRIX.md)
