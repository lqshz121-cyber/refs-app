# WBS Provider-Signed Payable Production Admission

This is the single production handoff and execution contract. It separates provider delivery, REFS service authorization, evidence admission, and later accounting approval. Do not send secrets in tickets, chat, command-line arguments, or captured output.

## 1. One-time platform configuration

Before enabling ingestion, the REFS release owner must prove that the target is the intended authoritative environment:

- all four role-specific database URLs are configured: `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `CONTEXT_ISSUER_DATABASE_URL`, and `GRANT_SYNC_DATABASE_URL`;
- `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI`, and `REFS_HTTP_ALLOWED_ORIGINS` are configured and the issuer/JWKS URLs use HTTPS;
- `npm.cmd --prefix server run db:up` completed under the migration role and the deployed migration manifest includes the provider-signed admission migrations;
- `/health/ready` returns HTTP 200 and its release SHA equals the intended Git commit; the static `refs-build.js` stamp must equal the same SHA before browser acceptance;
- `REFS_HTTP_MAX_BODY_BYTES=10485760`. The three raw artifacts are base64 encoded into one JSON request; the default 1 MiB body limit is insufficient.

Then configure the API service, never the static site, with:

- `WBS_PROVIDER_SIGNED_TRUST`: pinned provider trust JSON containing `issuer`, `key_id`, Ed25519 `public_key`, and the verified SPKI DER SHA-256 fingerprint.
- `WBS_SNAPSHOT_ED25519_PUBLIC_KEYS`: JSON keyring containing the same active `key_id` and public key. Keep retired public keys while historical packages remain verifiable.
- `WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID`: exact OIDC M2M access-token `sub`, not a human user, client display name, or browser session.
- `REFS_WBS_INGEST_MODE=REQUIRED`: enable only after all three settings above and the database grant below are verified.

Record the independently calculated trust fingerprint and compare it with both the provider's out-of-band value and the approved Render secret change. A local `--provider-trust` file validates the package but does not prove that Render has the same pin.

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
$apiBase='<authoritative API HTTPS origin>'
$ready=Invoke-RestMethod "$apiBase/health/ready"
if(-not $ready.ok -or $ready.status -ne 'ready'){ throw 'Target API is not ready' }

$env:REFS_PROVIDER_M2M_ACCESS_TOKEN='<OIDC M2M access token>'
$env:REFS_PAYABLE_REVIEW_ACCESS_TOKEN='<optional separate reviewer read token>'

npm.cmd --prefix server run wbs:provider-signed-payables:admit -- `
  --api-base-url $apiBase `
  --provider-trust C:\secure\wbs-provider-trust.json `
  --receipt C:\secure\WBPA\receipt.json `
  --request-raw C:\secure\WBPA\request.raw `
  --response-raw C:\secure\WBPA\response.raw `
  --package-raw C:\secure\WBPA\package.json `
  --tenant-id 6fb25daf-0799-4805-bede-be54230da33c `
  --entity-id ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3 `
  --company-code WBPA
```

Never substitute a staging URL into a production run or a production URL into a staging rehearsal. Record the ready response, release SHA, tenant, entity, and company before executing the command. The optional read token requires exactly the server-authorized `WBS.PAYABLE.REVIEW` and `AP.VIEW` reads; it must not be the same token as the importer token.

Before any network request, the tool verifies trust, both signatures, raw hashes, nonce/TTL, canonical package bytes, production V2 schema, non-empty rows, and exact tenant/entity/company scope. A mismatch performs zero API calls.

The tool then:

1. sends one idempotent service-only admission request;
2. requires `PERSISTED_PAYABLE_STAGING_REVIEW_REQUIRED`, `signature_verified=true`, a positive row count, and matching raw hashes;
3. optionally reads the closed review-candidate queue with a different reviewer token and attributes only rows whose source version and receipt hash match this signed package; server-side OIDC subjects and grants remain the authoritative separation-of-duties proof;
4. prints only IDs, counts, hashes, HTTP statuses, and no-action flags.

It never creates a Draft, approves, posts, or writes WBS.

## 4. Accounting-chain prerequisites after admission

Signed admission alone intentionally stops at immutable inbound evidence. To reach Draft and Posted accounting, configure all of these before executing the existing workflow:

- `REFS_ATTACHMENT_MODE=REQUIRED` with approved S3-compatible storage, malware scanner, CA/server identity, and scanner actor configuration;
- API storage variables: `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (and `S3_SESSION_TOKEN` when issued);
- API scanner variables: `VIRUS_SCANNER_ENDPOINT`, `VIRUS_SCANNER_TOKEN`, `VIRUS_SCANNER_CA_PEM` or `VIRUS_SCANNER_CA_FILE`, `VIRUS_SCANNER_SERVER_NAME`, and `ATTACHMENT_SCANNER_ACTOR_ID`;
- a healthy TLS scanner sidecar whose certificate chains to the configured CA, whose server name matches, and whose malware engine and object-storage access both pass the container readiness test;
- cleanup worker variables `ATTACHMENT_CLEANUP_ACTOR_ID`, `ATTACHMENT_CLEANUP_SCOPES`, the same S3 location/credentials, and a healthy cleanup service; cleanup scopes must enumerate only approved tenant/entity pairs;
- verified-clean row-bound source attachments;
- an open accounting period;
- approved WBS Payable accounting setting and mapping snapshots;
- exact vendor/member, AP, expense/CWIP/prepaid, cash/clearing, and dimension master data;
- separate importer, uploader, scanner, attachment binder, Maker, Reviewer, Approver, and Poster subjects/grants wherever the existing server policy assigns those responsibilities; one token name or UI session is never accepted as proof of separation.

Run a read-only preflight before accounting commands and retain its results: migration version, M2M `WBS.SNAPSHOT.IMPORT` grant, exact entity WBS binding, open period, approved Payable setting/mapping, vendor and account master readiness, scanner health, and attachment storage health. The reviewer read itself requires `WBS.PAYABLE.REVIEW` plus `AP.VIEW`.

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
