# Render staging release verification — 2026-09-13

Status: prepared; not executed.

## Target

- Service: `refs-accounting-api-staging`
- Render dashboard path: `/web/srv-d9s2po7avr4c73abnd5g`
- Git ref: `main`
- Required source commit: `8154e64981ab07f94b4baa223770d03a20b0f22b`
- Functional accounting commit included by that ref: `5500ceac1891b4dfb707df90b8d5decff24a8f45`

## Operator action

Deploy the existing **staging API service only** from the required `main` commit. Do not change environment variables, OIDC configuration, database credentials, roles, scopes, billing plans, or data.

The service's configured pre-deploy command applies migrations. Treat a failed migration or failed readiness check as a failed release; do not retry by editing migration metadata.

## Required readback

1. `GET https://refs-accounting-api-staging.onrender.com/health/ready` returns HTTP 200 and JSON `ok:true`, `status:"ready"`.
2. Its `release` is either the full `8154e64981ab07f94b4baa223770d03a20b0f22b` or an exact Git prefix of it.
3. The static release's `https://refs-app.onrender.com/refs-build.js` must carry a matching release. If it still carries `5500ceac...`, redeploy the static client from the same ref before user acceptance.
4. Anonymous `GET /api/v1/accounting-scopes` remains HTTP 401.
5. Then perform authenticated browser acceptance separately; do not use anonymous health responses as business acceptance.

No production completion is claimed by this document.

