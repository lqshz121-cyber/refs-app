# Stage 3 Cost-to-CWIP authoritative readback

This is the same-release production evidence gate for one retained Cost-to-CWIP
output. It is deliberately read-only and sends authenticated `GET` requests
only. It creates no source document or journal, performs no review, approval or
posting action, and never writes to WBS.

API liveness, API readiness, and the authoritative web build stamp must all
equal the exact 40-character `REFS_RELEASE_SHA`. The verifier then proves:

`WBS_COST_CWIP source document -> POSTED JE -> debit CWIP GL leg + credit offset GL leg -> Trial Balance -> Balance Sheet / Income Statement`

Every source, journal-line and ledger-line identifier must survive into the
report rows. Every observed accounting amount must be a fixed four-decimal
string (`MONEY4`); JavaScript numbers are rejected.

## Inputs

The scoped token is used only in `Authorization` headers and is never printed
or written to an artifact. Put the remaining identifiers in a scenario file:

```json
{
  "entityId": "11111111-1111-4111-8111-111111111111",
  "periodId": "22222222-2222-4222-8222-222222222222",
  "sourceDocumentId": "33333333-3333-4333-8333-333333333333",
  "journalEntryId": "44444444-4444-4444-8444-444444444444",
  "cwipJournalLineId": "55555555-5555-4555-8555-555555555555",
  "offsetJournalLineId": "66666666-6666-4666-8666-666666666666",
  "cwipLedgerLineId": "77777777-7777-4777-8777-777777777777",
  "offsetLedgerLineId": "88888888-8888-4888-8888-888888888888",
  "cwipAccountCode": "164100",
  "offsetAccountCode": "610000",
  "expectedAmount": "125.5000"
}
```

```powershell
$env:REFS_STAGING_API_BASE_URL = 'https://refs-accounting-api-staging.onrender.com'
$env:REFS_STAGING_WEB_ORIGIN = 'https://refs-app.onrender.com'
$env:REFS_RELEASE_SHA = '<40-character promoted Git SHA>'
$env:REFS_STAGE3_COST_CWIP_E2E_READ_ACCESS_TOKEN = '<scoped read-only bearer token>'
$env:REFS_STAGE3_COST_CWIP_E2E_SCENARIO_PATH = 'C:\secure\stage3-cost-cwip-scenario.json'
npm.cmd run test:stage3:cost-cwip-authoritative-e2e
```

This verifier must be paired with `verify:wbs-live-acceptance`, the offline
provider-signed admission gate. This readback proves the retained Cost-to-CWIP
output, not provider signature admission, Review/SoD actions, or unsupported
Insurance/Prepaid and Property Operations/Rent Pickup domains. Those require
their own evidence gates before Stage 3 can be closed.
