# Render staging coordinated release verification — 2026-09-13

Status: prepared; not executed.

## Scope

Deploy the existing staging services as one release from one immutable, full
40-character Git commit SHA:

- API: `refs-accounting-api-staging`
- Static client: `refs-app`
- Related worker, when its code has changed: `refs-outbox-dispatch-staging`

Do not deploy only the API or only the static client. The browser rejects an
API whose release stamp differs from its own release stamp.

## Freeze the release

1. Start from a clean, reviewed `main` checkout and record its full SHA as
   `RELEASE_SHA`. Do not use a shortened SHA, a moving branch label after this
   point, or an unreviewed worktree revision.
2. In Render, select that exact repository commit for every service above.
3. Set `REFS_RELEASE_SHA` to exactly `RELEASE_SHA` for the post-deploy verifier
   environment. It is a verification input, not an application configuration
   override.
4. Do not alter OIDC settings, database credentials, roles, scopes, billing
   plans, migration metadata, or accounting data as part of this release.

The API pre-deploy command applies migrations. A migration, startup, or
readiness failure fails the release. Do not retry it by editing migration
metadata.

## Required readback

From a trusted operator shell after all selected services are live:

```powershell
$env:REFS_RELEASE_SHA = '<the frozen 40-character SHA>'
$env:REFS_STAGING_API_BASE_URL = 'https://refs-accounting-api-staging.onrender.com'
$env:REFS_STAGING_WEB_ORIGIN = 'https://refs-app.onrender.com'
node server/runtime/verify-render-staging-release.mjs
```

The command must exit 0 and report the same SHA for API liveness, API
readiness, and the static `refs-build.js` stamp. It also verifies that an
anonymous accounting-scope read is still HTTP 401.

Then perform authenticated browser acceptance separately. Health and release
parity are deployment evidence only; they do not prove accounting workflows or
user authorization.

## Rollback

If readiness or the verifier fails, roll every service in this release back to
the same previously verified full SHA. Re-run the verifier with that previous
SHA before reopening the site. Never leave a rolled-back API beside a newer
static client, or the inverse.

No production completion is claimed by this document.