# Render staging release verification — 2026-09-13

Status: prepared; not executed.

## Target

- Service: `refs-accounting-api-staging`
- Render dashboard path: `/web/srv-d9s2po7avr4c73abnd5g`
- Git ref: `main`
- Required source commit: `6debffbd009533532dd2dd0b8ead4ac759e64186`
- Functional accounting commit included by that ref: `5500ceac1891b4dfb707df90b8d5decff24a8f45`

## Operator action

Deploy the existing **staging API service only** from the required `main` commit. Do not change environment variables, OIDC configuration, database credentials, roles, scopes, billing plans, or data.

The service's configured pre-deploy command applies migrations. Treat a failed migration or failed readiness check as a failed release; do not retry by editing migration metadata.

## Required readback

1. `GET https://refs-accounting-api-staging.onrender.com/health/ready` returns HTTP 200 and JSON `ok:true`, `status:"ready"`.
2. Its `release` is either the full `6debffbd009533532dd2dd0b8ead4ac759e64186` or an exact Git prefix of it.
3. The static release's `https://refs-app.onrender.com/refs-build.js` may carry the functional client commit `5500ceac...`; it must match the API release or be an ancestor whose release-gate contract accepts the API release. If the client and API release gate reports a mismatch, redeploy the static client and API from the same source ref before user acceptance.
4. Anonymous `GET /api/v1/accounting-scopes` remains HTTP 401.
5. Then perform authenticated browser acceptance separately; do not use anonymous health responses as business acceptance.

No production completion is claimed by this document.


