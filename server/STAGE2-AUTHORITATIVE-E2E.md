# Stage 2 authoritative reconciliation readback

This is the production evidence gate for one reconciliation that has already
been approved and posted.  It is deliberately read-only: it does not create a
bank transaction, match, clearance, reconciliation, journal, report, or WBS
snapshot.

The verifier first rejects a mixed release.  API liveness, API readiness, and
the authoritative web build stamp must all match `REFS_RELEASE_SHA`.  It then
reads one isolated scenario and proves the retained identifiers are visible
through this chain:

`bank source -> bank match -> immutable cleared signed snapshot -> reconciled bank close -> posted JE -> GL -> TB / BS / cash flow`

## Inputs

Supply a scoped read token and a JSON scenario.  The token is never written to
an artifact or printed by the verifier.

```json
{
  "entityId": "11111111-1111-4111-8111-111111111111",
  "periodId": "22222222-2222-4222-8222-222222222222",
  "bankAccountRef": "BANK-OPERATING-001",
  "statementEndingDate": "2026-07-31",
  "reconciliationId": "33333333-3333-4333-8333-333333333333",
  "bankSourceId": "44444444-4444-4444-8444-444444444444",
  "bankMatchId": "55555555-5555-4555-8555-555555555555",
  "journalEntryId": "66666666-6666-4666-8666-666666666666",
  "journalLineId": "77777777-7777-4777-8777-777777777777",
  "ledgerLineId": "88888888-8888-4888-8888-888888888888",
  "sourceDocumentId": "99999999-9999-4999-8999-999999999999",
  "cashAccountCode": "111000",
  "expectedAmount": "100.1234"
}
```

Run it only after the reconciliation is signed off:

```powershell
$env:REFS_STAGING_API_BASE_URL = 'https://refs-accounting-api-staging.onrender.com'
$env:REFS_STAGING_WEB_ORIGIN = 'https://refs-app.onrender.com'
$env:REFS_RELEASE_SHA = '<40-character promoted Git SHA>'
$env:REFS_STAGE2_E2E_READ_ACCESS_TOKEN = '<scoped read-only bearer token>'
$env:REFS_STAGE2_E2E_SCENARIO_PATH = 'C:\secure\stage2-scenario.json'
npm.cmd run test:stage2:authoritative-e2e
```

Success emits only the release stamps, scenario reconciliation ID, and the
checks performed.  It must not be treated as a WBS admission receipt: WBS
provider packages remain subject to their independent signed-delivery gate.
