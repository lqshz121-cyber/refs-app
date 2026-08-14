# Isolated accounting closure fixtures

These commands create a fresh Docker PostgreSQL database named
`refs_kernel_gate_test`, apply all migrations, run only the named test-data
scenario, and remove the container, network, and volume afterwards. They do
not read, seed, or write a deployed environment.

Run any command from `server` with `POSTGRES_IMAGE` set to
`postgres:15-alpine`, `postgres:16-alpine`, or `postgres:18-alpine`.

| Command | Isolated evidence proved |
| --- | --- |
| `npm run test:postgres:fixture:controlled-ap-close` | HTTP AP Bill Draft, four-role approval, Post, GL, Trial Balance, AP Aging, and tenant isolation. |
| `npm run test:postgres:fixture:ar-rent-pickup-close` | Invoice and bank receipt through AR, JE, GL, Trial Balance, and reports. |
| `npm run test:postgres:fixture:signed-wbs-payable-post` | Signed WBS Payable admission, review, Draft, four-role Post, and same-JE reporting. |
| `npm run test:postgres:fixture:bank-reconcile` | Reconciled bank payment through Posted JE, GL, Trial Balance, and reports. |
| `npm run test:postgres:fixture:ai-exception-lineage` | Append-only AI exception finding and later exact signed-source link; it deliberately cannot Review, Draft, Approve, or Post. |
| `npm run test:postgres:fixture:real-estate-reports` | Cash Flow, CWIP, Construction Loan, Prepaid, Intercompany, Budget vs Actual, and Consolidation from POSTED fixed-decimal evidence. |

`npm run test:postgres:fixtures:closure` runs every fixture in a separate
fresh database and writes a JSON summary to stdout. Use `-- --fixture <id>` to
run one named fixture through the suite runner.

## Production boundary

These are release-readiness tests, not production evidence. Production
acceptance additionally requires the exact deployed release stamp, authenticated
OIDC/API readback, granted roles, and a separately approved immutable scenario.
Never substitute these fixtures for Provider-signed source data or a real
authoritative API response.
