# External dependency contracts (S09)

Scope: every dependency REFS reaches outside its own PostgreSQL database —
object storage (S3), the virus scanner bridge, the OIDC issuer, the signed WBS
receipt provider, and the WBS live-read pilot gateway. For each one this file
records the configuration switch, the readiness probe, the test double that
proves the contract without the real service, the failure-compensation path, and
the staging variables an operator must supply.

This document describes code at candidate SHA `8d340a50c598cc31618bb8b49811b7ee5f6e54e4`
plus the S09 changes committed alongside it. It claims no live-service evidence:
no S3, scanner, issuer, or provider endpoint was contacted, and no credential was
handled.

## 1. Dependency register

| # | Dependency | Enabled by | Off state |
|---|---|---|---|
| D1 | Object storage (S3-compatible, versioned) | `REFS_ATTACHMENT_MODE=REQUIRED` or `REFS_WBS_INGEST_MODE=REQUIRED` | No storage client is constructed; attachment and signed-evidence routes have no capability. |
| D2 | Virus scanner bridge (ClamAV behind an HTTPS sidecar) | `REFS_ATTACHMENT_MODE=REQUIRED` | No scanner client; attachments cannot be admitted. |
| D3 | OIDC issuer (RS256 access tokens + JWKS) | always, except `REFS_INTERNAL_TEST_MODE` | Boot fails: `OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI are required`. |
| D4 | Signed WBS receipt provider (Ed25519 keyring + trust pin) | `REFS_WBS_INGEST_MODE=REQUIRED` | Signed admission is unavailable; no keyring is loaded. |
| D5 | WBS live-read pilot gateway (Cloudflare Access + `X-REFS-Auth`) | `REFS_WBS_LIVE_PILOT_MODE=ENABLED` | No live pilot client; provider reads are unavailable. |

Modes are strict enums. `REFS_ATTACHMENT_MODE` / `REFS_WBS_INGEST_MODE` accept
only `REQUIRED` or `DISABLED`; `REFS_WBS_LIVE_PILOT_MODE` only `ENABLED` or
`DISABLED`. There is no "auto" or "best effort" mode, so a dependency cannot be
half-configured: either its variables are complete or the process refuses to
start.

## 2. Per-dependency contract

### D1 — Object storage

- Config: `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, optional `S3_SESSION_TOKEN`.
  `server/runtime/attachment-storage.mjs` rejects any endpoint that is not a
  credential-free HTTPS URL (loopback HTTP only under an explicit test flag).
- Health: `S3AttachmentStorage.probe()` issues a SigV4-signed
  `GET ?location` against the bucket and throws `STORAGE_READINESS_FAILED` on a
  non-2xx. It is wired into `/health/ready` whenever the client exists
  (`server/runtime/accounting-server.mjs`), so a bucket outage takes the service
  out of rotation rather than surfacing as a per-request 500.
  `probeImmutable()` additionally asserts object-lock configuration for the WBS
  evidence bucket.
- Test double: `server/tests/attachment-storage.test.mjs` injects a `fetcher`
  and asserts the SigV4 canonical request, presign lifetime bounds, prefix and
  bucket confinement in `parseRef`, and version-id requirements — without a
  network. `server/compose.attachments.yaml` additionally defines a real MinIO +
  ClamAV + scanner-bridge stack for `tests/attachment-containers.test.mjs`.
- Failure compensation: a rejected reservation never leaves an upload capability
  or an untracked object (validation runs before presigning).
  `classifyCleanupFailure` maps retention locks (403/409/423) to
  `ATTACHMENT_RETENTION_ACTIVE` and partial version deletes to
  `ATTACHMENT_VERSION_DELETE_PARTIAL` so the cleanup worker retries instead of
  treating a retained object as deleted. `start-attachment-cleanup-worker.mjs`
  runs a dependency probe before claiming work and exposes `/health` + `/metrics`.

### D2 — Virus scanner bridge

- Config: `VIRUS_SCANNER_ENDPOINT`, `VIRUS_SCANNER_TOKEN`,
  `VIRUS_SCANNER_SERVER_NAME`, one of `VIRUS_SCANNER_CA_PEM` /
  `VIRUS_SCANNER_CA_FILE`, `ATTACHMENT_SCANNER_ACTOR_ID`, and the bounded
  `VIRUS_SCANNER_TIMEOUT_MS` (100..120000), `VIRUS_SCANNER_MAX_ATTEMPTS` (1..5),
  `VIRUS_SCANNER_RETRY_BASE_MS` (1..10000).
- Transport is pinned: HTTPS only, private CA required, `rejectUnauthorized:true`
  and an explicit `servername`; a private CA without a server name is refused at
  construction.
- Health: `HttpVirusScanner.probe()` calls `GET /health` and requires
  `{ok:true}`; wired into `/health/ready`.
- Test double: the same suite injects a fetcher to assert the retry ladder,
  timeout abort, malformed-response rejection, and the exact scan request body.
- Failure compensation: retries apply only to 5xx/429/timeout; a malformed
  response is non-retryable and fails closed. The scanner runs against a
  finalized object version (`storage_version` must not be `pending:`), so a
  clean verdict can never be attributed to a different byte stream.

### D3 — OIDC issuer

- Config: `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI` (all HTTPS-validated),
  plus the browser-side `REFS_PUBLIC_OIDC_*` coordinates.
- Verification: `server/api/oidc-authenticator.mjs` accepts RS256 only, refuses
  `crit`, pins issuer and audience, enforces clock skew and a maximum token
  lifetime, and resolves signing keys from a cached JWKS (5 min TTL, 5 s timeout,
  1 MiB cap, duplicate `kid` rejected, redirects refused).
- Test double: `server/tests/oidc-authenticator.test.mjs` mints tokens with a
  locally generated key pair and a stub JWKS fetcher.
- Failure compensation: JWKS failure denies the request
  (`INVALID_ACCESS_TOKEN`); it never falls back to an unverified token.
- **Gap (not changed here):** the issuer is the only dependency with no
  readiness probe in `/health/ready`. See §4, decision 1.

### D4 — Signed WBS receipt provider

- Config: `WBS_SNAPSHOT_ED25519_PUBLIC_KEYS` (JSON key-id → public PEM),
  `WBS_PROVIDER_SIGNED_TRUST` (issuer, key id, public key, canonical
  fingerprint), `WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID` (dedicated M2M `sub`),
  `REFS_WBS_EVIDENCE_RETENTION_DAYS` (1..3650), `REFS_HTTP_MAX_BODY_BYTES`
  fixed at `10485760`, and the D1 storage variables for immutable evidence.
- Health: immutable-evidence storage contributes `probeImmutable()` to
  `/health/ready`.
- Test double: the keyring and trust pin are validated from generated Ed25519
  key pairs in `tests/validate-staging-env.test.mjs`; admission and HTTP contract
  suites cover the signed path with fixtures.
- Failure compensation: verification is fail-closed — an unknown key id, a
  fingerprint mismatch, or an unpinned issuer rejects the delivery. Orphaned
  objects are retained under an object-lock marker rather than deleted.

### D5 — WBS live-read pilot gateway

- Config: `WBS_CF_ACCESS_CLIENT_ID`, `WBS_CF_ACCESS_CLIENT_SECRET`,
  `WBS_REFS_AUTH`, gated by `REFS_WBS_LIVE_PILOT_MODE`.
  `render.yaml` sets the pilot `ENABLED` for staging.
- Health: none. The pilot client has no probe and does not participate in
  `/health/ready`. See §4, decision 2.
- Failure compensation: read-only by construction; a failed provider read cannot
  post accounting effects.
- Fixed in this task: the pre-deploy checklist never knew about this dependency,
  so `npm run validate:staging-env` returned exit 0 with the pilot `ENABLED` and
  all three credentials absent, and the service then failed at boot. See §3.

## 3. Staging variable checklist and its drift gate

`server/runtime/validate-staging-env.mjs` is the single source of truth and now
exports `stagingEnvironmentKeys`. `server/tests/external-dependency-env-contract.test.mjs`
asserts that every key the validator can require is named in both
`.env.staging.example` and `staging-secrets-required.md`, that all three mode
switches default to `DISABLED` in the example file, and that the keys
`start-accounting-server.mjs` enforces at boot are in the same inventory.

Drift closed by this task:

| Variable | Was | Now |
|---|---|---|
| `REFS_WBS_EVIDENCE_RETENTION_DAYS` | Required by validator and boot; absent from both operator files. | Present in `.env.staging.example` and the handoff table. |
| `REFS_HTTP_MAX_BODY_BYTES` | Enforced as exactly `10485760` for signed ingest; only described in prose. | Named row in the handoff table. |
| `REFS_STAGING_API_BASE_URL`, `REFS_STAGING_WEB_ORIGIN` | Required by validator; appeared only inside a shell snippet. | Documented as acceptance coordinates. |
| `WBS_CF_ACCESS_CLIENT_ID` / `_SECRET`, `WBS_REFS_AUTH` | Required at boot when the pilot is enabled; not validated pre-deploy and undocumented. | Validated pre-deploy; named row in the handoff table. |

## 4. Open decisions for Owner / Codex

1. **OIDC readiness.** Should `/health/ready` probe the JWKS endpoint? It would
   detect an issuer outage before user traffic, but a transient JWKS blip would
   then take the whole API out of rotation even though cached keys are still
   valid. Not changed on a release candidate without a decision.
2. **Live pilot readiness.** The pilot gateway has no probe and no explicit
   timeout/retry policy of its own. If the pilot stays `ENABLED` in staging, it
   should get a bounded timeout and a readiness signal that is reported but does
   not gate `/health/ready` (it is a read-only side channel).
3. **Container evidence.** `tests/attachment-containers.test.mjs` is the only
   real-service proof for D1/D2 and requires MinIO + ClamAV + the scanner bridge.
   No container runtime is available in this environment, so that suite is
   reported blocked rather than passed; it must run in an environment that has
   Docker before attachment admission can be accepted.
