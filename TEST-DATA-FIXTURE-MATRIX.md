# Test-data accounting closure matrix

This matrix is the repeatable, isolated PostgreSQL evidence used before a
Provider-signed or production readback is available.  It is not production
evidence, does not import Provider data, and does not grant authority to post
from an unsigned source.

## Run the suite

From `server/`:

```powershell
$env:POSTGRES_IMAGE = 'postgres:18-alpine'
node runtime/run-postgres-fixture-suite.mjs
```

Run exactly one named closure on all supported PostgreSQL versions:

```powershell
foreach($image in 'postgres:15-alpine','postgres:16-alpine','postgres:18-alpine') {
  $env:POSTGRES_IMAGE = $image
  node runtime/run-postgres-fixture-suite.mjs --fixture <fixture-id>
}
```

Every result must report `pass:true`, a non-zero TAP test count, zero failures,
and zero skips.  The fresh gate owns and removes its Docker container, network,
and volume on exit.

## Closures included

| Fixture | Proves with isolated data | Does not claim |
| --- | --- | --- |
| `controlled-ap-close` | AP bill through HTTP Draft, four-role Post, GL, TB, and AP aging; tenant isolation | Production bill or payment-provider delivery |
| `ar-rent-pickup-close` | Rent invoice and bank receipt through AR, JE, GL, TB, and reports | Production property-operation admission |
| `signed-wbs-payable-post` | Provider-signed Payable admission through controlled review and Post | Admission for any other WBS source |
| `signed-wbs-cost-cwip-post` | Signed construction cost to CWIP Draft, Post, GL, and TB | Unsigned Cost admission |
| `bank-reconcile-close` | Bank match/reconciliation evidence through posted JE, GL, TB, and reports | External bank-feed connectivity |
| `signed-wbs-bank-reconciliation-close` | Signed WBS bank statement replay/tamper guards, exact bank sources, reconciliation SoD, posted adjustment, GL/report trace | A live Provider statement |
| `ai-insurance-amortization-close` | AI proposal requires a different controller to accept an exact Draft before normal four-role Post and report trace | Autonomous AI posting |
| `real-estate-reports` | Cash flow, CWIP, construction-loan, prepaid, intercompany, BvA, and consolidation report controls | A production financial close |
| `real-estate-profitability` | Property, project, unit, and lot profitability use only exact POSTED dimensions and never infer a missing dimension | Browser-side allocation or derived zero balances |

## Current verified targeted evidence

The following commands have been run in this worktree on 2026-08-15 with
fresh Docker cleanup and `0` skips:

| Closure | PostgreSQL versions |
| --- | --- |
| Entire fixture suite: 11 closures / 17 TAP tests | 15, 16, 18 |
| Signed WBS bank reconciliation | 15, 16, 18 |
| Real-estate profitability | 15, 16, 18 |
| AI insurance amortization | 15, 16, 18 |
| Controlled AP closure | 15, 16, 18 |
| AR rent pickup closure | 15, 16, 18 |

## Non-negotiable production boundary

Production acceptance remains separate: it requires an authoritative API and
database at the deployed SHA, approved OIDC read credentials, and a retained
immutable scenario.  Until Provider trust, signature, version, and replay
controls are present, every unsupported WBS source remains `UNSIGNED GET ONLY`:
it may be read for a Pilot but cannot create Draft, Review, Approve, or Post.
