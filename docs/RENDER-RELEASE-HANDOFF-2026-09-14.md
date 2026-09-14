# Render release handoff — 2026-09-14

## Frozen candidate

- Git SHA: d254ad2dce92120ef0778979e6221ca2d70946e9
- Authoritative staging API: refs-accounting-api-staging
- Authoritative static client: refs-app
- Internal read-only API: refs-internal-test-api
- Internal read-only client: refs-internal-test

## Required internal-test values

| Service | Key | Value |
| --- | --- | --- |
| refs-internal-test-api | REFS_HTTP_ALLOWED_ORIGINS | https://refs-internal-test.onrender.com |
| refs-internal-test | REFS_PUBLIC_ACCOUNTING_API_BASE_URL | https://refs-internal-test-api.onrender.com |
| refs-internal-test | REFS_PUBLIC_PERIOD_ID | 7e484808-34e7-446b-afc2-d119291636cc |

Deploy both internal services from the frozen SHA after saving the values. The API must become ready before accepting the static client.

## Required authoritative staging repair

The API currently reports the frozen SHA while the static client has an older release stamp. Manually deploy refs-app from the same frozen SHA before treating staging as released. Do not deploy the API alone.

## Read-only verification

```powershell
$env:REFS_RELEASE_SHA = 'd254ad2dce92120ef0778979e6221ca2d70946e9'
$env:REFS_STAGING_API_BASE_URL = 'https://refs-accounting-api-staging.onrender.com'
$env:REFS_STAGING_WEB_ORIGIN = 'https://refs-app.onrender.com'
node server/runtime/verify-render-staging-release.mjs
```

For the internal endpoint, verify /health/ready reports the same SHA, the static refs-build.js reports the same SHA, the runtime mode is INTERNAL_TEST_READONLY, and a write request receives 403 INTERNAL_TEST_READ_ONLY.
