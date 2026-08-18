# Isolated accounting closure fixtures

The closure runner creates a fresh Docker PostgreSQL database named
`refs_kernel_gate_test`, applies every migration, runs one controlled scenario,
and removes its container, network, and volume. It never reads, seeds, or writes
a deployed environment.

Run from `server` with `POSTGRES_IMAGE` set to `postgres:15-alpine`,
`postgres:16-alpine`, or `postgres:18-alpine`:

```text
npm run test:postgres:fixtures:closure
```

The current suite contains 24 fixture groups and 33 TAP assertions. Every group
runs in a separate fresh database and must contain at least one passing,
non-skipped assertion. Use `-- --fixture <id>` to replay one group.

## Security, admission, and source controls

- `signed-wbs-payable-post`
- `signed-cost-cwip-post`
- `signed-bank-same-source-close`
- `bank-match-unmatch-controls`
- `wbs-autorec-reserve-release`
- `reconciliation-governance-snapshot`
- `insurance-pc-mapping-controller`

These prove controlled signing, receipt/source binding, replay protection,
segregation of duties, fail-closed mismatch handling, and zero accounting writes
where a source has not been admitted. Test-generated keys are not Provider
production signatures.

## API and accounting closures

- `controlled-ap-close`
- `ar-rent-pickup-close`
- `bank-reconcile-close`
- `reconciliation-lifecycle-close`
- `ai-amortization-human-close`
- `wbs-autorec-event-foundation`

These cover Draft, four-role Post, Match/Unmatch, reconciliation adjustment,
Clear/Review/Sign-off/Reopen, JE, GL, trial balance, AP/AR, and immutable lineage
using controlled test data.

## AI and exception evidence

- `ai-exception-lineage`

The AI layer may retain and explain an exception or propose a Draft, but it does
not gain Review, approval, posting, or source-admission authority.

## Real-estate financial reporting

- `dimension-profitability-close`
- `cash-flow-close`
- `cwip-rollforward-close`
- `construction-loan-rollforward-close`
- `prepaid-rollforward-close`
- `intercompany-reconciliation-close`
- `budget-vs-actual-close`
- `consolidation-close`
- `real-estate-profitability-lineage`
- `real-estate-reports`

These cover Property/Project/Unit/Lot profitability, Cash Flow, CWIP,
construction loans, prepaid rollforward, intercompany, consolidation,
elimination evidence, budget variance, statement versions, and report-to-GL-to-
JE-to-source drillback using PostgreSQL numeric/controlled fixed-point evidence.

## Machine-readable eight-dimension matrix

```text
npm run test:controlled-maturity-matrix
node runtime/controlled-maturity-matrix.mjs
```

The matrix checks Security, API, Accounting, WBS, AI, Reporting, UI, and Release.
It can report 10/10 only for `CONTROLLED_TEST_DATA_ONLY`. The result always keeps
`executionPass=false` and `productionPass=false`: its score records defined
fixture and command coverage, while raw PG15/16/18 runs remain separate evidence.
Controlled completeness cannot be promoted into a live release claim.

To execute and bind every group to one exact commit across all three supported
PostgreSQL versions, set the full current SHA and run:

```text
REFS_RELEASE_SHA=<40-character-current-HEAD> npm run verify:controlled-maturity-execution
```

This command reports `controlledExecutionPass=true` only when PG15, PG16, and
PG18 each return the exact 24 groups and 33 non-skipped TAP assertions and no
owned Docker container, network, or volume remains. It still reports
`productionPass=false`.

## Production boundary

Production acceptance additionally requires all of the following on the exact
deployed release:

- approved OIDC authenticated readback;
- deployed migrations and grants;
- Provider-signed production receipts;
- same-release browser and API workflow evidence.

Never substitute fixtures, test-generated signatures, local Docker results,
Pages, demo data, seed data, or browser storage for authoritative production
evidence.
