# WBS to REFS Source Contract

Status: read-only discovery and production-admission handoff. This document does
not authorize a WBS write, a REFS Draft, a journal post, or a production release.

## Gate 4: signed nonempty receipt

WBS/IT must provide one nonempty, read-only response from exactly one producer:

- Payable
- Bank Transaction Journal
- AutoRec Payment Detail

The delivery must contain the exact response bytes and the complete request
context: HTTPS route, HTTP method, filters, pagination or export cursor, request
identifier, HTTP status, and response hash. A browser screenshot, an HTML report,
or an unversioned display identifier is not a receipt.

### Required signed envelope

The detached JWS or equivalent signature must bind all of the following:

- issuer, `kid`, allowed algorithm, signature format, pinned public key or
  certificate chain, and key activation, retirement, and rotation policy;
- SHA-256 of the exact response bytes and SHA-256 of the canonical request and
  filter context;
- signed timestamp, expiry, allowed clock skew, nonce or export identifier, and
  replay policy;
- immutable tenant, entity, company, currency, and, for Bank Journal, bank-account
  scope;
- immutable source system/module, record ID, line ID, revision, and tombstone or
  deletion semantics.

The same `(issuer, kid, nonce)` may replay only when the response hash and the
entire signed scope are identical. A changed response or scope is rejected.

## Producer fields required for admission

Each transaction producer must supply immutable IDs and versioning plus occurred,
business, accounting, and posting dates; signed amount and direction; currency;
bank account where applicable; vendor, project, property, unit, cost, and account
dimensions; immutable source-document and attachment references; mapping and
setting version, effective date, approval, and hash; workflow actor, time, reason,
and status; and stable cursor plus tombstone semantics.

`BillNo`, `JournalNo`, display GUIDs, descriptions, navigation URLs, report rows,
and browser labels are trace-only. They cannot be source keys or posting commands.

## REFS admission and accounting boundary

1. Verify the signed receipt, exact hashes, replay claim, scope, immutable keys,
   and nonempty result before any receipt-store or REFS persistence write.
2. Persist the immutable receipt envelope, then Raw, Normalized, and Staging or a
   controlled exception. Missing or ambiguous mapping stays an exception.
3. Only the existing REFS command path may CODE, SPLIT, UNSPLIT, and reserve
   sources. Release freezes the source-level reservation.
4. INCUR requires existing POSTED AUTO `PAYABLE_INCUR` and `AUTOC` legs, complete
   source and ledger trace, and per-member `291001` net zero.
5. REVIEW and REVERSE remain REFS workflows. Reversal is a new posted Draft
   workflow; WBS never authorizes a local state transition.

AutoRec Match is append-only relation evidence, not a transaction producer.
Cost General Ledger and Property Comparison are immutable `CONTROL_EVIDENCE_ONLY`:
they never create source documents, allocations, Drafts, journals, or postings.

## Fail-closed conditions

The following conditions produce zero Raw promotion, source document, Staging,
allocation, Draft, post, ledger, or WBS write:

- empty, malformed, unsigned, expired, replayed, or hash-swapped receipt;
- missing immutable record, line, revision, cursor, or tombstone semantics;
- tenant, entity, company, currency, bank account, amount, direction, or date
  mismatch;
- missing, unapproved, expired, or ambiguous mapping, setting, or rule;
- report-only, display-only, navigation-only, or unstable source identity.

## Acceptance command and artifacts

After WBS/IT supplies the receipt and key material, run:

```powershell
cd server
node --test tests/wbs-live-signed-receipt-handoff.test.mjs tests/wbs-receipt-authenticity.test.mjs tests/wbs-receipt-replay-guard.test.mjs
```

The provider-backed admission run must save raw command output, exit code, and a
redacted evidence record at `outputs/staging/wbs-receipt-admission.log`. Exit `0`
is necessary but insufficient without the immutable receipt reference, version,
hash, signature metadata, scope, and cursor evidence. No credentials, cookies,
authorization headers, or raw business payloads may be placed in logs.

## Current boundary

REFS-side contracts, tests, and PostgreSQL gates validate fail-closed behavior.
They do not verify WBS live semantics. Until the signed nonempty receipt above is
accepted, Gate 4 remains blocked and production equivalence must not be claimed.
