# Isolated accounting closure fixtures

These commands create a fresh Docker PostgreSQL database named
`refs_kernel_gate_test`, apply all migrations, run only the named test-data
scenario, and remove the container, network, and volume afterwards. They do
not read, seed, or write a deployed environment.

Run any command from `server` with `POSTGRES_IMAGE` set to
`postgres:15-alpine`, `postgres:16-alpine`, or `postgres:18-alpine`.

| Command | Isolated evidence proved |
| --- | --- |
| `npm run test:postgres:fixture:controlled-ap-close` | REFS-owned controlled-demo AP Bill Draft through four-role Post, GL, trial balance, AP aging, and tenant isolation. |
| `npm run test:postgres:fixture:ar-rent-pickup-close` | Rent invoice and receipt through AR, journal, GL, trial balance, and reports. |
| `npm run test:postgres:fixture:signed-wbs-payable-post` | Test-generated-key signed Payable through Review, Draft, four-role Post, and reports; it is not a Provider delivery. |
| `npm run test:postgres:fixture:bank-reconcile` | Existing test bank-source/payment-match reconciliation through posted journal, GL, trial balance, and report rows; it does not exercise Provider-signed Bank statement admission. |
| `npm run test:postgres:fixture:ai-exception-lineage` | Append-only AI exception linked to later signed Payable evidence without review or posting authority. |
| `npm run test:postgres:fixture:real-estate-reports` | Cash flow, CWIP, construction loan, prepaid, intercompany, budget variance, and consolidation report evidence. |

`npm run test:postgres:fixtures:closure` runs every fixture in a separate
fresh database and writes a JSON summary to stdout. Use
`-- --fixture <id>` to run one named fixture through the suite runner.
Each fixture fails closed unless the selected PostgreSQL test reports at least
one executed, passing, non-skipped test; a renamed or unmatched test name is
therefore not a passing fixture.

## Recorded controlled-data run

On 2026-08-15, the complete suite was executed from commit
`01805c97754842c9eda7f2653d5c8c98d0a88863` against fresh PostgreSQL 15,
16, and 18 containers. Each run returned exit code `0`, reported 18 fixture
groups and 19 TAP tests (the match/unmatch group has two control assertions),
and reported zero skipped or failed tests. The fresh harness removed its
owned container, network, and volume after every fixture.

The complete run covers the individual scenarios below, in addition to the
shorter command table above:

- controlled AP close and AR rent pickup close;
- signed WBS Payable and signed Bank-source flows through standard posting;
- Bank match/unmatch separation, reconciliation governance, lifecycle,
  adjustment clearance and immutable sign-off;
- append-only AI exception lineage and human-owned amortization Draft to
  standard posted journal;
- property/project/unit/lot profitability, cash flow, CWIP, construction
  loan, prepaid, intercompany, budget-versus-actual and consolidation reads.

This result is strong isolated PostgreSQL evidence, but it does **not** claim
that the later `main` revision or a deployed environment contains those
records. Re-run the same command after rebasing to a new release candidate,
and complete the deployed release-stamp plus authenticated readback gates
before treating it as release evidence.

The same candidate also passed `server/npm.cmd test` on 2026-08-15 (531 TAP
tests, zero failures and zero skips) and the root `npm.cmd run test:visual`
gate (64 of 64 verifiers). Those static gates confirm the controlled closure's
contracts, English/readability and responsive boundaries; they do not replace
the deployed authenticated API readback requirement above.

## Maturity evidence matrix

| Required capability | Isolated test-data evidence | Required before it is called deployed |
| --- | --- | --- |
| Security and separation of duties | Four-role standard posting, cross-tenant isolation, unauthorized/cross-currency/ambiguous-match rejection, idempotency and audit evidence. | Production roles and authenticated denial/readback on the deployed API. |
| AP, AR, JE, GL and statement closure | AP Bill and rent-receipt fixtures reach standard Draft, approval, Post, GL, trial balance, aging and report rows. | A separately approved immutable scenario read through the same deployed release. |
| WBS accounting intake | Test-generated signed Payable and Bank evidence is replay-protected, scope-bound and only creates a standard human-controlled Draft. | Provider-issued signature, trusted key material and the granted WBS review role. |
| Bank and reconciliation | Exact Match/Unmatch separation, mixed-currency and non-posted-evidence rejection, lifecycle, reopen/sign-off, snapshot and posted adjustment evidence. | A signed bank-statement scenario and authenticated readback on the deployed API. |
| AI assistance | AI exceptions are append-only; amortization reaches a human-owned Draft and then the normal posting workflow. No AI path can approve or post. | Authorized user review of a separately approved source scenario. |
| Property reporting | Fixed-scale/fixed-point cash flow, CWIP, construction loan, prepaid, intercompany, budget variance, consolidation and profitability fixtures read POSTED evidence only. | Immutable report snapshots and report-to-source readback from the deployed release. |
| UI and accessibility | Static visual gate verifies 64 authoritative UI, English/readability, responsive and accessibility contracts. | Desktop and narrow-viewport authenticated browser evidence from the same deployed release. |
| Operations and release | Fresh PG15/16/18 runs create and remove their own Docker resources; release-stamp code fails closed on a mismatch. | API health and web build expose the exact same full SHA, migrations/roles are present, and authenticated E2E readback succeeds. |

## Production boundary

These are release-readiness tests, not production evidence. Production
acceptance additionally requires an exact deployed release stamp, authenticated
OIDC/API readback, granted roles, and a separately approved immutable scenario.
Never substitute fixtures for Provider-signed source data or the authoritative
API.
