# Staging deployment gate

This blueprint is a deployment contract, not evidence of a live deployment.

1. Provision one TLS PostgreSQL endpoint with four distinct roles: runtime,
   migrator, context issuer, and grant sync.  Set the four corresponding URLs
   with `sslmode=verify-full`; do not reuse a role or password.
2. Provision an HTTPS OIDC issuer that returns RS256 access tokens containing
   `tenant_id` and `sub`, with the configured audience. Set the static service's
   `REFS_PUBLIC_ACCOUNTING_API_BASE_URL`, entity/period/cash-account values and
   all `REFS_PUBLIC_OIDC_*` values as one complete public configuration set.
   The build rejects a partial set and emits a PKCE-only adapter; never place an
   access token, client secret, or database credential in `refs-runtime-config.js`.
   Render serves that file and `/index.html` with `Cache-Control: no-store` so
   the adapter is replaced atomically with the UI deployment rather than read
   from a browser cache.
3. Provision versioned object storage, a TLS scanner bridge, its CA file, and a
   least-privileged cleanup worker identity plus DB-authorized entity scopes.
   The API storage identity must also have `s3:GetBucketLocation` on the configured
   bucket; `/health/ready` probes that permission and the scanner bridge's TLS
   `/health` endpoint before accepting traffic.
   Also provision `WBS_SNAPSHOT_ED25519_PUBLIC_KEYS` as a JSON keyring of
   trusted WBS public keys (`key_id` to PEM); do not put a private key in Render.
4. Set the exact static frontend URL as `REFS_HTTP_ALLOWED_ORIGINS`.  The API
   allows only explicit HTTPS origins and requires the OIDC bearer token on all
   accounting reads and commands.
5. Before traffic: run migrations with the migrator identity, verify
   `/health/ready`, then execute a real browser login, refresh, Draft →
   Approve → Post, refresh persistence, and a rejected cross-tenant request.

Before the browser step, run the no-write deployment smoke gate from `server`.
Set `REFS_STAGING_API_BASE_URL=https://api.example` and
`REFS_STAGING_WEB_ORIGIN=https://app.example`, then run
`npm run test:staging:smoke` (in PowerShell: set both with `$env:` first).
It verifies readiness, the exact CORS origin, and anonymous accounting-read rejection;
it neither accepts an access token nor creates accounting data.

The staging gate remains failed until those external resources and the browser
test have actual recorded evidence.

Before each staging promotion, take a provider-managed encrypted PostgreSQL
backup and retain its immutable restore-point identifier with the release
record. `cd server && npm run test:backup:restore` is an isolated `*_test`
restore drill only: it proves a fresh dump restores the migration manifest and
a persisted tenant row, then destroys its own Docker project and volumes. It
does not prove provider retention, PITR, or a production restore; those require
a separately recorded staging drill with the platform owner.

The two staging services intentionally use `autoDeployTrigger: off`; promote a
tested commit manually.  The API's `preDeployCommand` needs a Render plan that
supports pre-deploy commands.

The static-site response policy is deliberately conservative: `X-Frame-Options`
is `SAMEORIGIN`, MIME sniffing is disabled, and cross-origin requests receive
only the origin as their Referer.  Add a Content Security Policy only after the
OIDC bootstrap and every required third-party origin have been verified in a
real browser; an untested CSP can silently disable login.
