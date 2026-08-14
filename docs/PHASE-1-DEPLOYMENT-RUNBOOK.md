# Phase 1 deployment runbook - putting the live site on authoritative data

This runbook is the owner-side half of Phase 1. The code-side half is done and
merged on `claude/phase1-runtime`: the client can no longer render browser
demonstration data on an authoritative build, and every way the authoritative
API can be unavailable now reaches a named error state instead of a demo screen.

Nothing below can be executed by the engineering sandbox. Every step needs cloud
credentials, a provisioned database, and an identity provider tenant. That is
why this is a runbook and not a script.

No secret, token, hostname or account identifier appears in this document.
Configuration is referred to by name only. Set the values in the provider's own
secret store; never in a source file, and never in this repository.

---

## 0. What the code now guarantees, and what it does not

**Guaranteed (proved by gates in this repository):**

- A published client renders the demonstration data set only when the
  deployment adapter (`refs-runtime-config.js`) declares `LOCAL_MOCK` *and* the
  build stamp (`refs-build.js`) declares the `PUBLIC_DEMONSTRATION` channel.
  Both are written by the same build step from the same environment.
- A missing adapter, an unrecognised mode, a demonstration adapter under an
  authoritative build stamp, or an authoritative adapter under a demonstration
  build stamp all render an explicit error page. None of them renders demo data.
- The build refuses to render a demonstration adapter if any authoritative
  deployment coordinate is present in the environment.
- The client separates: cannot reach the API, API returned 5xx, configuration
  missing or invalid, unauthenticated (401), and not authorised for this entity
  or tenant (403).

**Not guaranteed until the steps below are done:**

- That the deployed API actually returns those statuses. The client's behaviour
  for each status is proved against simulated responses in
  `tests/accounting-api-client.test.js`. No live endpoint was contacted.
- Anything visual. There is no browser in the engineering sandbox, so no gate in
  this repository has rendered a page. Screens are asserted as server-rendered
  markup strings, not as pixels.

---

## 1. Provision PostgreSQL

Create the managed PostgreSQL instance for the accounting kernel, then create
the roles the kernel expects. The kernel uses separate connection strings so
that migration, context issuance and grant synchronisation do not share one
superuser.

Configuration names to set on the API service (`server/`):

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Runtime application connection, least privilege |
| `MIGRATION_DATABASE_URL` | Schema migration connection |
| `CONTEXT_ISSUER_DATABASE_URL` | Request-context issuance connection |
| `GRANT_SYNC_DATABASE_URL` | Grant synchronisation connection |
| `REFS_PG_REQUIRED` | Must be `1`. The kernel refuses to start without PostgreSQL |

Run migrations from the service's pre-deploy command (`npm run db:up` in
`server/`, already wired in `render.yaml`).

**Verification**

```
cd server && npm run db:up
cd server && npm test
```

**Acceptance evidence:** migrations report applied with no pending versions, and
the kernel test suite exits 0. Record the migration version reached.

---

## 2. Configure OIDC

Create the confidential-free browser client in the identity provider:
authorization code flow with PKCE, no client secret, one exact redirect URI, and
an audience dedicated to the accounting API.

On the API service:

| Name | Purpose |
|---|---|
| `OIDC_ISSUER` | Token issuer that the API validates against |
| `OIDC_AUDIENCE` | Audience the API requires in an access token |
| `OIDC_JWKS_URI` | Key set the API fetches to verify signatures |

On the static client build:

| Name | Purpose |
|---|---|
| `REFS_PUBLIC_OIDC_ISSUER` | Same issuer, HTTPS |
| `REFS_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT` | HTTPS authorization endpoint |
| `REFS_PUBLIC_OIDC_TOKEN_ENDPOINT` | HTTPS token endpoint |
| `REFS_PUBLIC_OIDC_REDIRECT_URI` | HTTPS redirect URI, exactly as registered |
| `REFS_PUBLIC_OIDC_CLIENT_ID` | Public client identifier |
| `REFS_PUBLIC_OIDC_AUDIENCE` | Same audience the API requires |
| `REFS_PUBLIC_OIDC_SCOPE` | Must include `openid` |

The build refuses any of these over plain HTTP, and refuses a scope set that
does not contain `openid`.

**Verification**

```
npm run test:oidc
cd server && npm test
```

**Acceptance evidence:** the OIDC client test suite exits 0, and the kernel's
`oidc-authenticator` tests exit 0. These prove the validation rules, not the
provider configuration; the provider itself is proved in step 5.

---

## 3. Deploy `server/`

Deploy the Stage 1 API service and static client from `render.yaml`. It sets
`REFS_ATTACHMENT_MODE=DISABLED` and `REFS_WBS_INGEST_MODE=DISABLED`, so
authenticated reads and the unsigned WBS pilot remain available while every
attachment or signed-ingest accounting action stays unavailable.

Additional Stage 1 configuration the API needs, all by name only:

- `REFS_HTTP_ALLOWED_ORIGINS` - the exact origin the static client is served
  from. Anything else is refused with a CORS failure.
- `REFS_ATTACHMENT_MODE=DISABLED` - attachment-dependent accounting actions
  are unavailable in the Stage 1 read deployment.
- `REFS_WBS_INGEST_MODE=DISABLED` - signed WBS admission is unavailable in the
  Stage 1 read deployment.

Deploy the cleanup worker declared in `render.integrations.yaml` only as a
separate integrations release. That release may set both modes to `REQUIRED`
after provider-backed S3/scanner evidence and every required WBS trust variable
are configured; startup fails closed if any is absent.

**Verification**

```
cd server && npm run validate:staging-env
```

**Acceptance evidence:** the validator exits 0 and names no missing variable.
The readiness endpoint returns HTTP 200 with `no-store` (checked in step 5).

---

## 4. Point the static client at the HTTPS API

Set the remaining public coordinates on the static site build:

| Name | Purpose |
|---|---|
| `REFS_PUBLIC_ACCOUNTING_API_BASE_URL` | HTTPS base URL of the deployed API |
| `REFS_PUBLIC_ENTITY_ID` | UUID of the entity this deployment reads |
| `REFS_PUBLIC_PERIOD_ID` | UUID of the accounting period |
| `REFS_PUBLIC_CASH_ACCOUNT_CODE` | Cash account code used for settlements |

Rules the build enforces, so a misconfiguration fails the deploy rather than the
user:

- All ten public coordinates must be present together. A partial set throws
  `Runtime public configuration is incomplete`.
- Every URL must be HTTPS with no embedded credentials.
- Entity and period must be UUIDs.
- `REFS_PUBLIC_RUNTIME_MODE` must **not** be set on this service. Setting it to
  `LOCAL_MOCK` while any of the coordinates above is present is refused with
  `A public demonstration build must not carry authoritative deployment
  coordinates`.

**Verification**

```
npm run build
npm run verify:runtime-deployment-assets
node verify-runtime-fail-closed.mjs
```

**Acceptance evidence:** the asset verifier prints
`mode REQUIRES_AUTHORITATIVE_API, channel AUTHORITATIVE`, and
`dist/refs-runtime-config.js` contains the HTTPS API base with no environment
placeholder and no token.

### GitHub Pages stays a demonstration

`.github/workflows/deploy.yml` builds Pages with `REFS_PUBLIC_RUNTIME_MODE:
LOCAL_MOCK` and nothing else. The workflow then re-verifies the artifact with
`node verify-runtime-fail-closed.mjs` under the same mode. Do not add any
`REFS_PUBLIC_*` coordinate to the Pages workflow or to Pages repository secrets:
the build will fail, by design.

---

## 5. Acceptance evidence to capture

Each row is a separate observation. Capture the request, the HTTP status, and
what the client showed. Do not merge rows: the whole point of Phase 1 is that
these are distinguishable.

| # | Scenario | How to produce it | Expected HTTP | Expected client state |
|---|---|---|---|---|
| 1 | Authenticated read succeeds | Sign in with an account granted access to the configured entity, open Control overview | 200 | Counts render; the page states records are loaded from the configured accounting API |
| 2 | Unauthenticated read is refused | Call the AP bills endpoint for the configured entity with no `Authorization` header | 401 with body code `AUTHENTICATION_REQUIRED` and `no-store` | `Sign in again to continue`, with a sign-in action |
| 3 | Expired token is refused | Let the access token expire, then trigger a refresh in the app | 401, or no request at all if the client detects expiry first | `Sign in again to continue`. The client re-runs the PKCE authorization code flow; it does **not** hold a refresh token (see Known gaps) |
| 4 | Cross-entity access is refused | Sign in with an account that has no grant on the configured entity, load any workspace | 403 | `Not authorised for this entity`, no retry offered, no statement about what other entities exist |
| 5 | Cross-tenant access is refused | Sign in with an account from a different tenant | 403 | Same as row 4. The message must not differ between "entity you may not see" and "entity that does not exist for you" |
| 6 | Server failure is not disguised | Stop the database or force a 5xx from the API | 5xx | `The accounting API reported a server error`, with a retry action |
| 7 | API unreachable is not disguised | Block the API origin at the network level | no HTTP response | `Cannot reach the accounting API`, stating the browser cannot distinguish network, DNS, TLS or a stopped service |
| 8 | Refresh preserves identity and route | Navigate to Reconciliation, press reload | 200 | The same signed-in principal and the Reconciliation page, not the default overview |
| 9 | No demonstration data anywhere | Search the loaded page for demonstration vendor and journal names | n/a | Nothing from `src/seed.js` appears on any screen |

Automated checks that back rows 1, 2 and the transport headers:

```
cd server && REFS_STAGING_API_BASE_URL=<api origin> REFS_STAGING_WEB_ORIGIN=<web origin> npm run test:staging:smoke
```

That smoke run asserts readiness returns 200, the web root ships the four
runtime assets in the safe order, the adapter is served `no-store`, CORS is
restricted to the configured origin, and an unauthenticated API call returns
`AUTHENTICATION_REQUIRED`. Supply the two origins as environment values at run
time; do not commit them.

The authenticated browser capture is accepted only through the Stage 1
evidence manifest gate. Store the manifest, screenshots, visible-text files and
network logs together under one release-evidence directory. The manifest must
bind the full frozen SHA, a clean worktree, the authoritative build stamp,
subject-preserving PKCE renewal, authenticated `200`, anonymous `401`, denied
cross-entity and cross-tenant reads, and a refresh that retains both subject and
route. Each of Dashboard, AP, AR, JE, Bank and Reports must contain a successful
authenticated API `GET` for its required endpoint; screenshots without network
records do not pass.

```powershell
$env:REFS_RELEASE_SHA = '<40-character frozen SHA>'
$env:REFS_AUTHORITATIVE_E2E_MANIFEST = '<absolute path to manifest.json>'
npm.cmd run verify:authoritative-runtime-evidence
```

Expected result is exit `0` and
`authoritative-runtime-e2e: 6/6 pages ... verified`. The verifier rejects demo
labels, CJK/mojibake, artifacts outside the manifest directory, same-token
"renewal", missing scope denials and hand-authored page claims without matching
network logs. The verifier validates captured evidence; it does not create a
provider session or contact staging on its own.

---

## 6. Repository and CI configuration

- Pages: no `REFS_PUBLIC_*` secret. Mode is pinned to `LOCAL_MOCK` in the
  workflow file.
- Authoritative static site: all ten `REFS_PUBLIC_*` coordinates, no
  `REFS_PUBLIC_RUNTIME_MODE`.
- API service and cleanup worker: the database, OIDC, storage, scanner and
  keyring names listed in steps 1-3.
- Nothing in either environment carries a bearer token for the browser. The
  browser obtains its own access token through PKCE.

---

## 7. Known gaps the owner should decide on

These are real limitations, stated rather than papered over.

1. **Silent renewal depends on the provider/browser pairing.**
   `src/oidc-client.js` now attempts a subject-bound `prompt=none` authorization
   code flow with a fresh PKCE verifier before expiry. It intentionally stores
   no refresh token. Providers that refuse framing, browsers that block the
   provider session cookie in a hidden frame, and providers that return a
   different subject all fail closed and show an explicit re-authentication
   warning. A real provider run must prove successful renewal; unit tests prove
   only the client decision paths. The authoritative static CSP permits HTTPS
   frames for this flow; the client still constructs the frame only from the
   validated deployment authorization endpoint and validates origin, frame,
   state, issuer, audience, subject and expiry before replacing a token.
2. **Route retention is per tab.** The current workspace is kept in the URL
   fragment and in tab session storage. Opening the site in a new tab starts at
   the overview page. Identity is likewise per tab, because the access token is
   held in session storage.
3. **No provider-backed visual verification exists in the repository.** The
   Stage 1 manifest verifier now rejects incomplete browser evidence, but the
   repository contains no real OIDC session, screenshot or live API response.
   Those artifacts must be captured from the deployed frozen SHA.
4. **The demonstration build still contains the seed data set.** Phase 1 makes
   it unreachable on an authoritative build; it does not delete it. Removing
   `src/seed.js` from the bundle is Phase 2b work and is tracked by
   `verify-frontend-data-boundary.mjs`, whose allowlist can only shrink.
5. **`npm run dev` no longer serves the demonstration by default.** The watch
   build does not run `scripts/write-runtime-config.mjs`, so it produces no
   channel stamp and therefore resolves to the authoritative surface. To work on
   demonstration screens locally, run a full
   `REFS_PUBLIC_RUNTIME_MODE=LOCAL_MOCK npm run build`.
