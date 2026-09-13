# Claude task: front-end authoritative-entry adversarial review

## Routing and capability

This task must be placed at the **root of your own `work\\refs-app\\` checkout** so the scheduled scan can find it. Do not assume that checkout contains `server/`, database migrations, tests, or a usable Git/Node runtime.

Perform a **read + reasoning + written review only**. Do not run tests, modify code, push a branch, inspect secrets, call external systems, or access QBO/WBS/Render.

## Context available in your checkout

The current deployed client has an authoritative entry flow that:
1. reads the public API `/health/ready` without an OIDC token;
2. compares its reported release to `window.__BUILD.sha`;
3. blocks startup if those releases differ;
4. otherwise begins ordinary OIDC sign-in and only then calls accounting APIs.

The observed live mismatch was:
- client: `5500ceac1891b4dfb707df90b8d5decff24a8f45`
- API: `4a7bac2b31723ea6bce9e534591cc2c1508ce928`

The intended behavior is to avoid login loops and show that the API release is pending. This does **not** weaken authentication, authorization, role separation, or business-command controls.

## Review questions

Using only the front-end files visible in your checkout, prepare a Markdown review that answers:

1. Can any route, cached state, redirect callback, or retry path load accounting data before the release comparison succeeds?
2. Does a failed release comparison ever get misrepresented as an OIDC/login failure?
3. Are there user-visible strings that would wrongly imply the user can fix an API deployment problem locally?
4. Could retry unintentionally start a new login, clear a valid session, or send a token/cookie to the readiness endpoint?
5. Identify any user-experience ambiguity or security regression risk, with precise file/line references when available.

## Deliverable

Write a new root-level file named:
`CLAUDE-REVIEW-2026-09-13-AUTHORITATIVE-ENTRY.md`

Use this format:
- **Verdict:** PASS / NEEDS CHANGE
- **Evidence inspected:** exact front-end paths
- **Findings:** numbered, severity-tagged
- **Recommended changes:** only if needed
- **Limits:** explicitly list what could not be verified because the server/test runtime is absent

Do not claim deployment, test execution, or production acceptance.

