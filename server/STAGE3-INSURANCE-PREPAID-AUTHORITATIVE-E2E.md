# Stage 3 Insurance to Prepaid authoritative readback

This current-release evidence gate is read-only. It sends authenticated `GET`
requests only and proves one retained chain:

`signed WBS payable admission/source -> coverage/proposal -> approved setting/mapping -> posted capitalization -> independent Review -> monthly AUTO journal -> standard POST -> expense and prepaid GL legs -> prepaid rollforward`

API liveness, API readiness, and the authoritative web build stamp must equal
the same exact 40-character `REFS_RELEASE_SHA`. IDs and hashes are matched to
the scenario exactly. Accounting values must be fixed four-decimal `MONEY4`
strings; JavaScript numbers and approximate comparisons are rejected.

The bearer token is used only in `Authorization` headers and is never printed
or written to an artifact. Use a token scoped for the selected entity and the
GET-only report, journal and GL permissions.

## Scenario

Store the required values in a protected JSON file. All `*Id` values below are
UUIDs and all `*Hash` values are `sha256:` plus 64 lowercase hexadecimal digits.

```json
{
  "entityId": "11111111-1111-4111-8111-111111111111",
  "periodId": "22222222-2222-4222-8222-222222222222",
  "scheduleId": "33333333-3333-4333-8333-333333333333",
  "scheduleLineId": "44444444-4444-4444-8444-444444444444",
  "signedAdmissionId": "55555555-5555-4555-8555-555555555555",
  "sourceDocumentId": "66666666-6666-4666-8666-666666666666",
  "sourceDocumentVersion": 0,
  "sourcePayloadHash": "sha256:<64 hex>",
  "coverageEvidenceId": "77777777-7777-4777-8777-777777777777",
  "coverageHash": "sha256:<64 hex>",
  "proposalHash": "sha256:<64 hex>",
  "settingSnapshotId": "88888888-8888-4888-8888-888888888888",
  "settingSnapshotHash": "sha256:<64 hex>",
  "mappingSnapshotId": "99999999-9999-4999-8999-999999999999",
  "mappingVersion": 1,
  "mappingSnapshotHash": "sha256:<64 hex>",
  "capitalizationJournalEntryId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "capitalizationJournalLineId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "capitalizationLedgerLineId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "reviewId": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "reviewEvidenceHash": "sha256:<64 hex>",
  "draftEvidenceId": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "draftEvidenceHash": "sha256:<64 hex>",
  "derivedSourceDocumentId": "ffffffff-ffff-4fff-8fff-ffffffffffff",
  "journalEntryId": "12121212-1212-4212-8212-121212121212",
  "journalRevision": 4,
  "expenseJournalLineId": "13131313-1313-4313-8313-131313131313",
  "prepaidJournalLineId": "14141414-1414-4414-8414-141414141414",
  "expenseLedgerLineId": "15151515-1515-4515-8515-151515151515",
  "prepaidLedgerLineId": "16161616-1616-4616-8616-161616161616",
  "prepaidAccountCode": "141500",
  "expenseAccountCode": "610100",
  "expectedAmount": "8.3333",
  "expectedOpeningBalance": "0.0000",
  "expectedPeriodAdditions": "100.0000",
  "expectedPeriodAmortization": "8.3333",
  "expectedClosingBalance": "91.6667",
  "independentReviewerActorId": "insurance-controller",
  "draftMakerActorId": "insurance-draft-maker"
}
```

## Execute

```powershell
$env:REFS_STAGING_API_BASE_URL = 'https://refs-accounting-api-staging.onrender.com'
$env:REFS_STAGING_WEB_ORIGIN = 'https://refs-app.onrender.com'
$env:REFS_RELEASE_SHA = '<40-character promoted Git SHA>'
$env:REFS_STAGE3_INSURANCE_PREPAID_E2E_READ_ACCESS_TOKEN = '<scoped read-only bearer token>'
$env:REFS_STAGE3_INSURANCE_PREPAID_E2E_SCENARIO_PATH = 'C:\secure\stage3-insurance-prepaid-scenario.json'
node runtime/verify-stage3-insurance-prepaid-authoritative-e2e.mjs
```

Run from the `server` directory. A successful result reports
`READ_ONLY_SIGNED_INSURANCE_PREPAID_EVIDENCE`. Any release, identifier, hash,
actor, amount, status, GL-leg or rollforward mismatch fails closed.

This verifier observes retained evidence; it does not execute Review, Draft
creation, Submit, journal Review, Approve, or Post. It must be paired with the
offline provider trust, signature verification, and replay gate. It does not
prove possession of provider private keys or admit unsupported provider data.
