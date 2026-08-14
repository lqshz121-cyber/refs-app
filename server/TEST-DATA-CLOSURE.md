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

## Production boundary

These are release-readiness tests, not production evidence. Production
acceptance additionally requires an exact deployed release stamp, authenticated
OIDC/API readback, granted roles, and a separately approved immutable scenario.
Never substitute fixtures for Provider-signed source data or the authoritative
API.
