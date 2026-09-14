# Internal Full-Workflow Test Release

This release deploys the browser-facing internal test pair: `refs-internal-test-api`
and `refs-internal-test`. It is not a production release.

## Purpose and boundaries

- The internal test browser has no OIDC sign-in or user-managed role selection.
- The API maps each admitted action to a distinct, pre-provisioned internal test actor. A maker cannot approve or post their own work.
- WBS access is limited to the configured live-pilot **read-only** client. Browser WBS imports, provider writes, and creation of formal WBS-backed accounting records are not admitted.
- AI workflow, attachment upload, and signed WBS ingestion remain disabled in this environment.
- Test accounting commands may create controlled internal test drafts and move them through their normal server-authorized workflow. They are never a substitute for production authorization or a real WBS write.

## Deployment rule

Both services must be manually deployed from the **same full 40-character commit SHA**. Auto Deploy remains off. Do not release either service alone.

1. Record the candidate SHA from `main`.
2. Manually deploy `refs-internal-test-api` at that SHA.
3. Wait for `GET /health/ready` to return `200` with exactly that release SHA.
4. Manually deploy `refs-internal-test` at the same SHA.
5. Read `/refs-build.js` and confirm its `sha` exactly equals the API release.
6. Retain the two Render deploy URLs, SHA, timestamps, and readback responses.

The static site must keep `REFS_PUBLIC_RUNTIME_MODE=INTERNAL_TEST_FULL`, point only to the HTTPS internal API, and use the configured entity and period. The API must allow exactly the static-site HTTPS origin.

## Required readback checks

1. Open the static site without an OIDC redirect and confirm `Internal test session` is displayed.
2. Confirm the API health release and static build SHA are identical.
3. Read a WBS live-pilot view. It must identify itself as read-only observation, retain provider and observation hashes, have bounded results, and expose no WBS provider write action.
4. Load payables, general ledger, AP/AR aging, and financial reports. Their results must originate from server-backed, posted-ledger projections or retained WBS observation evidence.
5. Open Cash Transfer. The register must load without `CASH_TRANSFER_REGISTER` authorization denial. Open bank-account controls and confirm the approved control register is server-backed.
6. Open Direct bank expense. Its creation options must be server-backed; a bank choice appears only when an exact approved bank-to-cash-GL control is effective for the selected period.
7. Exercise only a dedicated internal-test draft path if a write smoke test is required. Retain the resulting workflow receipt and audit identity. Do not submit a production transaction, post to WBS, or create a real financial transaction.

Stop the release if the service SHAs differ, a scope or WBS-read boundary is missing, the Cash Transfer register is denied, a server-backed page falls back to client data, or any test action reaches WBS.
