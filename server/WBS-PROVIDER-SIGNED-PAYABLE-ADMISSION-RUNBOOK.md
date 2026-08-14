# WBS Provider-Signed Payable Production Admission

This is the single production handoff and execution contract. It separates provider delivery, REFS service authorization, evidence admission, and later accounting approval. Do not send secrets in tickets, chat, command-line arguments, or captured output.

## 1. One-time platform configuration

The REFS release owner must configure the API service, never the static site, with:

- `WBS_PROVIDER_SIGNED_TRUST`: pinned provider trust JSON containing `issuer`, `key_id`, Ed25519 `public_key`, and the verified SPKI DER SHA-256 fingerprint.
- `WBS_SNAPSHOT_ED25519_PUBLIC_KEYS`: JSON keyring containing the same active `key_id` and public key. Keep retired public keys while historical packages remain verifiable.
- `WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID`: exact OIDC M2M access-token `sub`, not a human user, client display name, or browser session.
- `REFS_WBS_INGEST_MODE=REQUIRED`: enable only after all three settings above and the database grant below are verified.

The IAM/DB owner must grant that exact service subject only the required `WBS.SNAPSHOT.IMPORT` capability for each authorized REFS tenant/entity. Its token must carry the configured issuer, audience, tenant UUID claim, and the same subject.

Each REFS entity must have an approved immutable company binding:

- `entity.source_system = WBS`
- `entity.source_entity_id = <exact WBS company_code>`
- one WBS company maps to the intended REFS entity; do not infer it from a company name, bank account, or browser page.

## 2. Complete provider delivery for every company and data domain

Deliver one independently signed package per exact tenant/entity/company scope. A multi-company package is rejected. For full 2026 coverage, the delivery plan must enumerate every active WBS company and every required source domain, with full snapshot, deltas, and tombstones where the source supports changes/deletions.

Every package directory must contain exactly:

1. `receipt.json`
2. `request.raw`
3. `response.raw`
4. `package.json` (canonical UTF-8 JSON bytes)

The receipt and package must bind the exact:

- `tenant_id`, `entity_id`, and WBS `company_code`
- provider `issuer`, `key_id`, unique nonce, immutable version, signed time, and expiry no more than 15 minutes later
- SHA-256 of `request.raw`, `response.raw`, and `package.json`
- production V2 snapshot, Ed25519 signatures, complete extraction, snapshot consistency, and primary-key seek pagination
- view name, company scope, row count, first/last primary key, content hash, source version, capture time, and 2026 requested range
- record-level source identifiers, currencies, amounts, directions, account/project/property/vendor dimensions, attachments or immutable attachment references, and source lifecycle/tombstone status required by the relevant accounting domain

The provider trust pin is configuration only. It is not a data package and cannot create an admitted row by itself.

## 3. Production command

Place the M2M and optional human reviewer tokens in process environment variables. The command never accepts or prints tokens:

```powershell
$env:REFS_PROVIDER_M2M_ACCESS_TOKEN='<OIDC M2M access token>'
$env:REFS_PAYABLE_REVIEW_ACCESS_TOKEN='<optional separate reviewer read token>'

npm.cmd --prefix server run wbs:provider-signed-payables:admit -- `
  --api-base-url https://refs-accounting-api-staging.onrender.com `
  --provider-trust C:\secure\wbs-provider-trust.json `
  --receipt C:\secure\WBPA\receipt.json `
  --request-raw C:\secure\WBPA\request.raw `
  --response-raw C:\secure\WBPA\response.raw `
  --package-raw C:\secure\WBPA\package.json `
  --tenant-id 6fb25daf-0799-4805-bede-be54230da33c `
  --entity-id ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3 `
  --company-code WBPA
```

Before any network request, the tool verifies trust, both signatures, raw hashes, nonce/TTL, canonical package bytes, production V2 schema, non-empty rows, and exact tenant/entity/company scope. A mismatch performs zero API calls.

The tool then:

1. sends one idempotent service-only admission request;
2. requires `PERSISTED_PAYABLE_STAGING_REVIEW_REQUIRED`, `signature_verified=true`, a positive row count, and matching raw hashes;
3. optionally reads the closed review-candidate queue with a separate reviewer token;
4. prints only IDs, counts, hashes, HTTP statuses, and no-action flags.

It never creates a Draft, approves, posts, or writes WBS.

## 4. Accounting-chain prerequisites after admission

Signed admission alone intentionally stops at immutable inbound evidence. To reach Draft and Posted accounting, configure all of these before executing the existing workflow:

- `REFS_ATTACHMENT_MODE=REQUIRED` with approved S3-compatible storage, malware scanner, CA/server identity, and scanner actor configuration;
- verified-clean row-bound source attachments;
- an open accounting period;
- approved WBS Payable accounting setting and mapping snapshots;
- exact vendor/member, AP, expense/CWIP/prepaid, cash/clearing, and dimension master data;
- separate Maker, Reviewer, Approver, and Poster OIDC subjects and grants.

The workflow remains:

`signed delivery -> immutable inbound evidence -> clean attachment -> independent review -> Draft JE -> submit -> review -> approve -> Poster-only Post -> GL/TB/financial reports/AP aging`

Bank statements use their separate provider-signed Bank admission contract and then the reconciliation state machine. Do not submit Payable four-file bodies to the Bank endpoint.

## 5. Acceptance evidence retained for every run

Retain the safe output and API network evidence containing:

- deployed API release SHA and readiness HTTP 200;
- admission HTTP status, admission ID, snapshot ID, company, row count, idempotent flag;
- request/response/package hashes and signature verification result;
- readback HTTP status, inbound row IDs, source IDs/versions, receipt/evidence hashes, and review readiness;
- later review/Draft/transition/Post actor IDs, timestamps, revisions, idempotency receipts, audit/outbox IDs;
- same-JE GL, trial balance, statements, and AP-aging readback;
- negative tamper, expired receipt, nonce replay, wrong service subject, wrong tenant/entity/company, and cross-company zero-write results.

No step may be reported as production-complete from fixture, local database, unsigned GET, or a trust pin alone.
