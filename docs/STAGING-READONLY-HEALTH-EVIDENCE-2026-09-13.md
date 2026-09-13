# Staging Read-only Health Evidence — 2026-09-13

Scope: read-only, unauthenticated transport checks against the currently configured staging endpoints. No business object, account, credential, or accounting write was requested or performed.

| Check | Result |
| --- | --- |
| Static browser endpoint | `https://refs-app.onrender.com/` returned HTTP 200. Its runtime configuration points to the dedicated staging API, not to same-origin API paths. |
| API liveness | `GET https://refs-accounting-api-staging.onrender.com/health/live` returned HTTP 200 JSON `{ "ok": true, "status": "live" }`. |
| API readiness | `GET https://refs-accounting-api-staging.onrender.com/health/ready` returned HTTP 200 JSON `{ "ok": true, "status": "ready" }`. |
| Release stamp | Both health endpoints reported `4a7bac2b31723ea6bce9e534591cc2c1508ce928`. |
| Anonymous accounting reads | Anonymous requests to accounting-settings and journal-entries endpoints both returned HTTP 401 with `AUTHENTICATION_REQUIRED`; no accounting data was returned. |

This confirms availability and unauthenticated access denial for the deployed staging API only. It does not prove database migration execution for unmerged commits, authenticated workflow correctness, or production readiness.