# Staging configuration handoff

Target application revision: `b874bc00e19449e2b532c8e446897299d4ffbabc` on `release/b874bc0-staging`.

This checklist contains names and operational requirements only. Supply values through the deployment provider's encrypted secret store; never commit, paste into browser configuration, or place them in logs.

## Accounting API

| Variable | Purpose | Minimum privilege |
| --- | --- | --- |
| `DATABASE_URL` | Runtime PostgreSQL role | Application DML only for the REFS schema; no DDL or superuser. |
| `MIGRATION_DATABASE_URL` | Pre-deploy migration role | DDL only during a controlled deployment. |
| `CONTEXT_ISSUER_DATABASE_URL` | Request-context role | Can issue tenant-scoped context only. |
| `GRANT_SYNC_DATABASE_URL` | Grant synchronization role | Can maintain authorized grants only. |
| `OIDC_ISSUER` | Token issuer identity | HTTPS issuer; RS256 tokens only. |
| `OIDC_AUDIENCE` | Required access-token audience | Dedicated REFS API audience. |
| `OIDC_JWKS_URI` | Signing-key discovery | HTTPS, issuer-controlled endpoint. |
| `REFS_HTTP_ALLOWED_ORIGINS` | Browser CORS allowlist | Exact staging web origin only. |
| `REFS_ATTACHMENT_MODE` | Attachment integration boundary | `DISABLED` in Stage 1; `REQUIRED` only with accepted provider evidence. |
| `REFS_WBS_INGEST_MODE` | WBS receipt integration boundary | `DISABLED` in Stage 1; `REQUIRED` only with an accepted keyring and signed receipt. |

## Attachments and WBS receipts

These values are not Stage 1 prerequisites. They belong to the separate
`render.integrations.yaml` release and become mandatory only when the matching
API mode is changed to `REQUIRED`.

| Variable | Purpose | Minimum privilege |
| --- | --- | --- |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION` | Versioned object storage location | TLS endpoint and one staging bucket. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Runtime storage identity | Object read/write only for the staging prefix plus `GetBucketLocation`; no bucket administration. |
| `VIRUS_SCANNER_ENDPOINT`, `VIRUS_SCANNER_TOKEN` | Scanner bridge | TLS health and scan capability only. |
| `VIRUS_SCANNER_CA_PEM` (or `VIRUS_SCANNER_CA_FILE`), `VIRUS_SCANNER_SERVER_NAME` | Scanner TLS verification | Render should inject the CA as the encrypted PEM secret; use a file only where the platform provides a secret mount. Trust only the scanner CA/name. |
| `ATTACHMENT_SCANNER_ACTOR_ID` | Scanner audit principal | Dedicated non-human actor with attachment scan scope only. |
| `ATTACHMENT_CLEANUP_ACTOR_ID`, `ATTACHMENT_CLEANUP_SCOPES` | Cleanup worker identity | Delete only expired objects already authorized by REFS policy. |
| `WBS_SNAPSHOT_ED25519_PUBLIC_KEYS` | Trusted WBS receipt keyring | JSON key-id to public PEM map; public keys only. |

## Static application configuration

Set these as public deployment coordinates for the static site, never as secrets: `REFS_PUBLIC_ACCOUNTING_API_BASE_URL`, `REFS_PUBLIC_ENTITY_ID`, `REFS_PUBLIC_PERIOD_ID`, `REFS_PUBLIC_CASH_ACCOUNT_CODE`, `REFS_PUBLIC_OIDC_ISSUER`, `REFS_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT`, `REFS_PUBLIC_OIDC_TOKEN_ENDPOINT`, `REFS_PUBLIC_OIDC_REDIRECT_URI`, `REFS_PUBLIC_OIDC_CLIENT_ID`, `REFS_PUBLIC_OIDC_AUDIENCE`, and `REFS_PUBLIC_OIDC_SCOPE`.

## Acceptance commands

After the provider has applied the values and migrated the API, set exact HTTPS URLs locally and run:

```powershell
cd server
$env:REFS_STAGING_API_BASE_URL = 'https://api.example'
$env:REFS_STAGING_WEB_ORIGIN = 'https://app.example'
npm.cmd run test:staging:smoke
```

Expected result is exit `0`: API readiness, exact CORS origin, and anonymous accounting-read rejection. Then record an authenticated OIDC browser login and refresh on Dashboard, Reports, Rule Center, Integration Hub, Accounting, Expenses, Reconcile, and Bank Transactions; run a versioned S3 upload/scan/read/delete-lifecycle test; finally import one signed, nonempty, read-only WBS receipt and retain only its immutable receipt reference, version, and hash in release evidence.

Until those records exist, this revision remains a local integrated candidate, not a staging or production release.

## Preview and promotion

GitHub Pages deploys only `main`; pushing `release/b874bc0-staging` deliberately does not publish it. A Platform administrator must either create a protected pull request preview for that branch or configure a Render preview from its exact commit SHA. Do not force-push or retarget `main` to create a preview.

Before starting the API/static/worker preview, load values into the provider secret store from `.env.staging.example` and run `cd server; npm.cmd run validate:staging-env`. It prints variable names only. Then run `test:staging:smoke`; authenticated browser capture, S3/scanner, and WBS receipt gates require their respective external services and cannot be simulated by this checklist.
