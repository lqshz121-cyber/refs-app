# WBS to REFS Source Contract

Status: mock-ready, read-only contract. Real WBS production access is deliberately
not required for the current development phase. This document does not authorize
a WBS write, a REFS Draft, a journal post, or a production-release claim.

## 1. Current development boundary

REFS must complete the accounting architecture against the replaceable mock
adapter before a real WBS connector is introduced. The current authoritative
seams are:

- `src/wbs-accounting-foundation.js` for contracts, mock data, accounting events,
  deterministic rules, suggested journals, mock posting, GL, Trial Balance, and
  amortization;
- `server/domain/wbs-readonly-mcp.mjs` for the future read-only MCP boundary;
- `server/domain/wbs-readonly-snapshot.mjs` for immutable snapshot packages;
- `tools/verify-external-release-gate.mjs` for fail-closed provider evidence;
- `outputs/REFS-WBS-MOCK-ACCOUNTING-READINESS.md` for the current mock readiness
  matrix.

Browser pages, screenshots, report downloads, display numbers, descriptions, and
navigation URLs are never accounting source keys.

## 2. Read-only producer classes

The future connector may admit transaction evidence only from an explicitly
approved read-only producer:

- Payable detail;
- Bank Transaction Journal detail;
- Auto Reconciliation Payment detail.

Auto Reconciliation Match is append-only relationship evidence, not a transaction
producer. Cost General Ledger and Property Comparison are
`CONTROL_EVIDENCE_ONLY`; they may reconcile totals but never create source
documents, allocations, Drafts, journals, or postings.

## 3. Required adapter contract

Every admitted record and line must expose the common contract fields used by the
mock adapter:

- immutable `id`, `external_source_id`, source module, record ID, line ID,
  revision, and tombstone semantics;
- tenant, entity, company, currency, bank-account scope where applicable;
- project, property, unit, vendor/customer, cost code, account, and source-document
  references;
- transaction, business, accounting, posting, creation, and update timestamps;
- signed amount, direction, status, confidence score, and audit-trail identity;
- mapping, setting, and rule version, effective date, approval state, and hash;
- stable pagination/export cursor and replay-window semantics.

Display-only `BillNo`, `JournalNo`, labels, memo text, or browser GUIDs may be
retained for trace display, but they cannot replace immutable keys.

## 4. Canonical REFS accounting path

```text
signed receipt
  -> immutable receipt store and replay check
  -> Raw
  -> Normalized
  -> Staging or controlled exception
  -> CODE / SPLIT / UNSPLIT
  -> source reservation and release freeze
  -> Draft JE
  -> Review
  -> Approve
  -> Post
  -> append-only ledger, audit, source trace, and reports
```

Only the REFS Accounting Kernel may perform Draft, Review, Approve, and Post
transitions. WBS never authorizes a local state transition. Reversal is a new
balanced, source-linked journal workflow and never edits a posted journal.

For payable settlement, INCUR requires existing POSTED AUTO `PAYABLE_INCUR` and
`AUTOC` legs, complete source and ledger links, and per-member `291001` net zero.

## 5. Future Gate 4 signed nonempty receipt

When the user later authorizes real WBS access, WBS/IT must provide one nonempty,
read-only response from an approved producer. The evidence bundle must contain:

- exact response bytes and SHA-256;
- HTTPS route, HTTP method, request/filter hash, cursor, request ID, and HTTP
  status;
- issuer, `kid`, Ed25519 algorithm, detached signature, pinned public key or
  certificate chain, and key rotation policy;
- signed timestamp, expiry, clock skew, nonce/export ID, and replay policy;
- immutable tenant, entity, company, currency, and bank-account scope;
- immutable source record, line, revision, and tombstone fields.

The same `(issuer, kid, nonce)` may replay only when its exact response hash and
entire signed scope are identical.

## 6. Fail-closed behavior

Each condition below must produce zero Raw promotion, source document, Staging
allocation, Draft, post, ledger row, or WBS write:

- empty, malformed, unsigned, expired, replayed, or hash-swapped evidence;
- missing immutable record, line, revision, cursor, or tombstone semantics;
- tenant, entity, company, currency, bank account, amount, direction, or date
  mismatch;
- missing, unapproved, expired, or ambiguous mapping, setting, or rule;
- report-only, display-only, navigation-only, or unstable source identity;
- cross-company, missing member trace, closed period, missing source document, or
  unbalanced journal lines.

## 7. Executable local verification

These commands validate the current mock adapter and REFS-side fail-closed
boundary without calling real WBS:

```powershell
npm.cmd run test:wbs-accounting-foundation
npm.cmd run test:wbs-accounting-acceptance
node verify-wbs-e2e-flow-evidence.mjs
node verify-wbs-report-impact.mjs
node --test server/tests/wbs-contract.test.mjs server/tests/wbs-readonly-mcp.test.mjs server/tests/wbs-snapshot-package.test.mjs server/tests/wbs-snapshot-signature.test.mjs
```

The local release simulation is explicitly non-production:

```powershell
npm.cmd run test:release-harness
npm.cmd run test:release-simulation
```

## 8. Future provider admission command

Do not run this until the user supplies and authorizes real provider evidence:

```powershell
$env:REFS_WBS_PROVIDER_TRUST_FILE='C:\secure\wbs-provider-trust.json'
$env:REFS_WBS_SIGNED_RECEIPT_FILE='C:\secure\wbs-signed-receipt.json'
$env:REFS_WBS_REQUEST_RAW_FILE='C:\secure\wbs-request.raw'
$env:REFS_WBS_RESPONSE_RAW_FILE='C:\secure\wbs-response.raw'
$env:REFS_WBS_PACKAGE_RAW_FILE='C:\secure\wbs-package.raw'
npm.cmd run verify:release-wbs-receipt
```

`REFS_WBS_PROVIDER_TRUST_FILE` is deployment-managed trust configuration, not
provider evidence. It pins exactly one `issuer`, `key_id`, and Ed25519 public key.
The verifier ignores any keyring supplied alongside the receipt, recomputes all
three SHA-256 hashes from the exact captured request/response/package bytes, and
requires the provider signature over the canonical receipt claims. The provider-backed
run must retain redacted raw output and an exit code. No credentials, cookies,
authorization headers, or raw business payloads belong in repository logs. Exit `0`
is necessary but does not replace the immutable receipt, signature, scope, version,
cursor, and replay evidence.

## 9. Discovery provenance

Earlier read-only discovery observed WBS accounting routes for company journals,
source detail, account/cost/payable/batch settings, mappings, GL, financial
statements, intercompany reports, company review controls, and property comparison.
Those observations remain discovery evidence, not frozen API semantics. The
future adapter must use an approved read-only API or MCP contract; it must not
scrape browser pages or infer production keys from report output.

Until the future Gate 4 receipt is admitted, the correct status is:

- local mock/accounting readiness: testable;
- REFS-side read-only admission behavior: fail-closed;
- real WBS semantics and production equivalence: not claimed.
