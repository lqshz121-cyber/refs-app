# Stage 4 authoritative report lineage readback

This is the production evidence gate for one approved immutable financial
statement snapshot row. It is deliberately read-only: it does not prepare or
approve a snapshot, create or post a journal, alter the ledger, or mutate a
source document.

The verifier first rejects a mixed release. API liveness, API readiness, and
the authoritative web build stamp must all equal the full 40-character
`REFS_RELEASE_SHA`. It then proves this exact retained chain:

`statement snapshot row -> live statement row -> GL line -> POSTED JE -> source document`

## Inputs

Supply a scoped read token and a JSON scenario. The token is used only in
`Authorization` headers and is never printed or written to an artifact.

```json
{
  "entityId": "11111111-1111-4111-8111-111111111111",
  "periodId": "22222222-2222-4222-8222-222222222222",
  "financialStatementSnapshotId": "33333333-3333-4333-8333-333333333333",
  "statementType": "CASH_FLOW",
  "accountCode": "111000",
  "journalEntryId": "44444444-4444-4444-8444-444444444444",
  "journalLineId": "55555555-5555-4555-8555-555555555555",
  "ledgerLineId": "66666666-6666-4666-8666-666666666666",
  "sourceDocumentId": "77777777-7777-4777-8777-777777777777",
  "expectedAmount": "100.1234"
}
```

Allowed `statementType` values are `TRIAL_BALANCE`, `BALANCE_SHEET`,
`INCOME_STATEMENT`, and `CASH_FLOW`. Amounts are optional fixed four-decimal
strings; JavaScript numeric amounts are not accepted by the evidence contract.

Run this only after the snapshot has been approved and the source journal is
POSTED:

```powershell
$env:REFS_STAGING_API_BASE_URL = 'https://refs-accounting-api-staging.onrender.com'
$env:REFS_STAGING_WEB_ORIGIN = 'https://refs-app.onrender.com'
$env:REFS_RELEASE_SHA = '<40-character promoted Git SHA>'
$env:REFS_STAGE4_E2E_READ_ACCESS_TOKEN = '<scoped read-only bearer token>'
$env:REFS_STAGE4_E2E_SCENARIO_PATH = 'C:\secure\stage4-scenario.json'
npm.cmd run test:stage4:authoritative-e2e
```

Success emits only the release stamps, snapshot ID, and completed check names.
It does not prove WBS admission or create accounting state; provider-signed
source packages remain subject to their independent admission gate.
