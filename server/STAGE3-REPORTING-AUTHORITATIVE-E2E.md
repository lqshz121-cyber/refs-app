# Stage 3 authoritative Source-to-TB-to-report matrix

This GET-only production gate reuses the Stage 4 immutable snapshot verifier.
It requires three exact report scenarios in one entity, period, and approved
statement snapshot:

- source -> POSTED JE -> GL -> Trial Balance -> Balance Sheet
- source -> POSTED JE -> GL -> Trial Balance -> Income Statement
- source -> POSTED JE -> GL -> Trial Balance -> Cash Flow

Each report row and its paired Trial Balance row must retain the same exact
account, journal, journal-line, ledger-line, source-document, and snapshot IDs.
`expectedAmount` must be MONEY4 text. API live, API ready, and authoritative web
stamps must equal the same full 40-character `REFS_RELEASE_SHA`.

The scenario JSON has `balanceSheet`, `incomeStatement`, and `cashFlow` objects.
Each object uses the Stage 4 scenario shape documented in
`STAGE4-AUTHORITATIVE-E2E.md`, has its corresponding `statementType`, and sets
`"pairedTrialBalance": true`. All three objects must use the same `entityId`,
`periodId`, and `financialStatementSnapshotId`.

```powershell
$env:REFS_STAGING_API_BASE_URL = 'https://refs-accounting-api-staging.onrender.com'
$env:REFS_STAGING_WEB_ORIGIN = 'https://refs-app.onrender.com'
$env:REFS_RELEASE_SHA = '<40-character promoted Git SHA>'
$env:REFS_STAGE3_REPORTING_E2E_READ_ACCESS_TOKEN = '<scoped read-only bearer token>'
$env:REFS_STAGE3_REPORTING_E2E_SCENARIO_PATH = 'C:\secure\stage3-reporting-scenario.json'
npm.cmd run test:stage3:reporting-authoritative-e2e
```

The token is used only in authenticated GET headers and is never printed or
written to an artifact. This readback proves retained REFS reporting lineage;
it does not prove WBS provider admission, Insurance/Prepaid admission, Property
Operations/Rent Pickup admission, or the human Review/SoD workflow.
