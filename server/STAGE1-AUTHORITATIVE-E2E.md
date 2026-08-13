# Stage 1 authoritative retained-evidence verification

This is the production readback gate for a signed WBS Payable that has already
been admitted and posted by the controlled workflow. It makes only GET requests:
it never imports a snapshot, uploads an attachment, creates a Bill or JE, or
posts a ledger line.

Run it only against the configured HTTPS staging or production accounting API:

```powershell
$env:REFS_STAGING_API_BASE_URL = 'https://api.example'
$env:REFS_STAGE1_E2E_READ_ACCESS_TOKEN = '<OIDC reader token>'
$env:REFS_STAGE1_E2E_SCENARIO_PATH = 'C:\secure\stage1-posted-payable.json'
npm.cmd run test:stage1:authoritative-e2e
```

The scenario file is deliberately external to the repository and must contain
these exact identifiers from one completed retained workflow:

```json
{
  "tenantId": "UUID",
  "entityId": "UUID",
  "periodId": "UUID",
  "wbsInboundRowId": "UUID",
  "reviewEvidenceId": "UUID",
  "attachmentId": "UUID",
  "attachmentObjectVersionId": "UUID",
  "attachmentSha256": "64 lowercase hex characters",
  "journalEntryId": "UUID",
  "asOf": "YYYY-MM-DD",
  "expected": { "debitAccountCode": "610000", "creditAccountCode": "220100" }
}
```

Passing output proves the authoritative retained API exposes the same WBS review
and immutable attachment identifiers through a `POSTED` journal, general ledger,
AP aging and financial statements. Missing configuration, non-HTTPS origins,
placeholder tokens, HTTP errors, cacheable reads, missing identifiers or a
non-posted journal fail closed. A pass is evidence of readback only; the signed
admission and workflow commands must be executed and separately retained before
this command is run.
