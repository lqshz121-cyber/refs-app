# Browser E2E matrix and blank-page triage (staging)

No real credentials are used by anything in this document. Scenarios marked
**needs OIDC** are executed by the release owner on staging with a dedicated
test identity; everything else runs against the static shell.

## A. How the shell can go blank, and what guards each path

| # | Failure path | Guard on `ff163552` (+T14) | Visible outcome |
|---|---|---|---|
| A1 | `refs-runtime-config.js` missing / not written at build | `refs-runtime-lock.js` installs a non-configurable mode slot; `resolveRuntimeBoundary` → `RUNTIME_CONFIG_MISSING` | `RuntimeErrorPage` with code (SSR test `startup-surface-matrix` #1) |
| A2 | Adapter installs an unknown mode | lock leaves `RUNTIME_MODE_REJECTED` → error surface | error page with code (#2, #4) |
| A3 | Mode/channel mismatch (e.g. internal-test bundle on production channel) | `RUNTIME_CHANNEL_MISMATCH` | error page (#3, #5) |
| A4 | Render-time throw inside the authoritative tree | `AuthoritativeRootBoundary.getDerivedStateFromError` → `ACCOUNTING_API_PROTOCOL` | error page (#6) |
| A5 | **Third-party CDN (Chart.js) slow/unreachable** | **Was a blocking classic `<script>` ahead of `bundle.js` → the app did not start until the CDN request timed out.** T14 makes it `async` with `data-refs-chartjs`; `useChart` re-renders on `load`. Charts degrade to their SVG/text fallback if the CDN never answers. | shell renders immediately (#7) |
| A6 | `bundle.js` 404 / cache key mismatch | `verify:runtime-deployment-assets` at build; Pages deploy waits for the same-SHA kernel gate (`verify-release-deploy-gate.mjs`) | build/deploy refuses; if it still happens the page is blank — **only remaining true blank-page path**, see B12 |
| A7 | Module-level throw before `createRoot` | none in-app; covered by build + SSR gate (`test:ssr` imports every module) | — |
| A8 | API unreachable / 5xx after start | per-workspace `StateBlock` error states; access-status surface | visible error, not blank |
| A9 | Auth/OIDC callback returns to a hash the router does not know | identity bootstrap + navigation catalog (`authoritative-navigation.js`) | needs browser check (B5–B7) |

## B. Scenario matrix (Playwright-ready; IDs stable for reporting)

| ID | Scenario | Preconditions | Steps | Pass criterion | Needs OIDC |
|---|---|---|---|---|---|
| B1 | Cold load, configured staging | runtime config present | open `/` | `#root` non-empty within 3 s; no console error | no |
| B2 | Cold load with CDN blocked | block `cdnjs.cloudflare.com` at network layer | open `/` | shell within 3 s; chart areas show fallback; no blank | no |
| B3 | Missing runtime config | serve `dist/` without `refs-runtime-config.js` | open `/` | `RUNTIME_CONFIG_MISSING` visible | no |
| B4 | Tampered runtime mode | inject `window.__REFS_RUNTIME_MODE__='x'` before bundle | open `/` | `RUNTIME_MODE_UNRECOGNISED`/`RUNTIME_MODE_REJECTED` visible | no |
| B5 | Unknown hash route | `/#/does-not-exist` | open | not blank; navigation lands on a known route or shows not-found copy | no |
| B6 | OIDC callback happy path | test identity | sign in → callback → app | authenticated shell; `release_sha` shown; no leftover `code=` in URL | **yes** |
| B7 | OIDC callback with `error=` | test identity, provider returns error | callback | error surface with provider error code; no blank | **yes** |
| B8 | Session expiry recovery | test identity, short TTL | idle past TTL, act | re-auth prompt or read-only fallback (`initialReadSession`), never blank | **yes** |
| B9 | Denied scope | identity with no entity grant | open any workspace | access-status surface explains denial; no blank | **yes** |
| B10 | Deep link to a workspace | test identity | open `/#/reports/general-ledger?…` | workspace renders with controls; back/forward works | **yes** |
| B11 | Reload mid-workflow | test identity, a Draft open | F5 | state re-hydrates or returns to safe list; no blank | **yes** |
| B12 | `bundle.js` 404 | serve `dist/` without bundle | open `/` | **blank by design gap** → must be caught by deploy gate; document as accepted risk or add inline `<noscript>`/pre-bundle fallback (proposal below) | no |
| B13 | Zoom 80/100/125/150 %, widths 360–1440 | none | open shell | no horizontal overflow; controls reachable | no |
| B14 | Console error budget | none | run B1, B5, B10 | zero uncaught errors, zero failed same-origin requests | partly |

## C. Staging execution steps

1. `npm ci && npm run build` on the candidate SHA; serve `dist/` locally for B2–B5, B12, B13 (`npx http-server dist -p 4173` or any static server).
2. For B2 use Playwright `page.route('**/cdnjs.cloudflare.com/**', r => r.abort())`.
3. B6–B11 run against the staging URL with the dedicated test identity; record `release_sha` from `/health/ready` in the report header.
4. Report format: one row per ID with pass/fail, screenshot path, console error count. A blank `#root` at any step is a **release blocker**, not a UI bug.

## D. Proposal for the remaining blank path (B12, not implemented)

Add to `index.html` a pre-bundle inline block that shows "loading…" and a `setTimeout` that, if `#root` is still empty after N seconds, replaces it with a static "application failed to start (release <sha>)" message read from `window.__BUILD`. This is presentation-only and needs Owner agreement on wording; not included in T14's patch.
