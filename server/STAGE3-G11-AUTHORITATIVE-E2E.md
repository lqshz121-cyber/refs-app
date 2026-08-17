# Stage 3 authoritative G11 readback

This production verifier is deliberately GET-only. It validates API live,
API ready, and authoritative web build stamps against the same exact
40-character `REFS_RELEASE_SHA`, then reads one immutable accepted AutoRec
review, its G11 evidence, and both period-scoped journal details.

It recomputes the PostgreSQL JSONB candidate and completion evidence hashes,
plus the accounting controls, from raw rows. It does not trust `g11_linked`,
`incurred`, a journal count, or a precomputed net by itself. The required chain
is:

`ACCEPTED review -> released candidate -> PAYABLE_INCUR + AUTOC events -> two distinct AUTO POSTED JEs -> exact journal/ledger lines -> 291001 member two-leg net zero -> RELEASED to INCURRED`

## Scenario

All amounts are fixed four-decimal strings. IDs and hashes come from the exact
approved production evidence; do not use local simulation IDs.

```json
{
  "entityId": "11111111-1111-4111-8111-111111111111",
  "periodId": "22222222-2222-4222-8222-222222222222",
  "reviewId": "33333333-3333-4333-8333-333333333333",
  "reviewCandidateId": "sha256:<64 hex>",
  "candidateHash": "sha256:<64 hex>",
  "reviewEvidenceHash": "sha256:<64 hex>",
  "completionId": "44444444-4444-4444-8444-444444444444",
  "releaseExecutionReceiptId": "55555555-5555-4555-8555-555555555555",
  "incurExecutionReceiptId": "66666666-6666-4666-8666-666666666666",
  "payableIncurAccountingEventId": "77777777-7777-4777-8777-777777777777",
  "autocAccountingEventId": "88888888-8888-4888-8888-888888888888",
  "payableIncurJournalEntryId": "99999999-9999-4999-8999-999999999999",
  "autocJournalEntryId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "clearingMemberRef": "VENDOR-1",
  "expectedAllocationAmount": "100.0000"
}
```

```powershell
$env:REFS_STAGING_API_BASE_URL = 'https://refs-accounting-api-staging.onrender.com'
$env:REFS_STAGING_WEB_ORIGIN = 'https://refs-app.onrender.com'
$env:REFS_RELEASE_SHA = '<40-character promoted Git SHA>'
$env:REFS_STAGE3_G11_E2E_READ_ACCESS_TOKEN = '<scoped read-only bearer token>'
$env:REFS_STAGE3_G11_E2E_SCENARIO_PATH = 'C:\secure\stage3-g11-scenario.json'
npm.cmd run test:stage3:g11-authoritative-e2e
```

The token is used only in authenticated GET headers and is never printed or
written to an artifact. This verifier proves retained REFS G11 output only. It
does not prove WBS provider admission, Insurance/Prepaid admission, Property
Operations/Rent Pickup admission, or create/approve/post/finalize anything.
