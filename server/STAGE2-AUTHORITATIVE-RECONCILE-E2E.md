# Stage 2 authoritative reconciliation readback

After a controlled reconciliation has reached `RECONCILED`, run this command
with a read-only authenticated workflow token and a secure external scenario
file. The verifier performs only six `GET` requests; it cannot match, unmatch,
clear, sign off, reopen, create an adjustment or post a journal.

```powershell
$env:REFS_STAGING_API_BASE_URL = 'https://api.example'
$env:REFS_STAGE2_E2E_READ_ACCESS_TOKEN = '<OIDC read token>'
$env:REFS_STAGE2_E2E_SCENARIO_PATH = 'C:\secure\stage2-reconciled.json'
npm.cmd run test:stage2:authoritative-reconcile-e2e
```

The JSON file must name one tenant/entity/period and the exact
`statementReceiptId`, `reconciliationId`, `snapshotId`, `bankSourceId`, `journalEntryId`,
`bankAccountRef`, and `statementEndingDate` from that completed chain. The gate
requires no-store authoritative responses and proves those identifiers are
retained through the admitted statement receipt, reconciliation worksheet and
summary, posted adjustment journal, general ledger, and financial statements.
Missing IDs, an unreconciled state, an unposted JE, a cacheable/API failure, or
a placeholder token fails closed.
