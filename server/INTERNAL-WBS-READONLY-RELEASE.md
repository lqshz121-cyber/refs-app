# Internal WBS Read-Only Test Release

This release creates two isolated Render services only after the candidate commit is
selected: `refs-internal-test-api` and `refs-internal-test`.

## Boundaries

- The browser receives only an HTTPS API URL, entity, period, and cash account.
- The API has a fixed internal actor and rejects every method except `GET` and `HEAD`.
- WBS credentials remain Render service references. The client never receives them.
- The internal API has no OIDC configuration, test-import mode, attachment mode, AI mode,
  signed WBS ingestion, posting, or external write path.
- The fixed actor must already have only `AP.VIEW`, `AR.VIEW`, `BANK.VIEW`, `GL.JE.VIEW`,
  `GL.REPORT.VIEW`, and `WBS.AUTOREC.VIEW` for tenant
  `6fb25daf-0799-4805-bede-be54230da33c` and entity
  `ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3`.

## Render values set after the static URL is allocated

1. Create `refs-internal-test-api` from the candidate branch with Auto Deploy off.
2. Set `REFS_HTTP_ALLOWED_ORIGINS` to exactly the HTTPS origin of
   `refs-internal-test`. Do not use a wildcard or a comma-separated list.
3. Create `refs-internal-test` from the same candidate branch with Auto Deploy off.
4. Set `REFS_PUBLIC_ACCOUNTING_API_BASE_URL` to the HTTPS origin of
   `refs-internal-test-api` and `REFS_PUBLIC_PERIOD_ID` to an existing period in the
   fixed entity.
5. Return to the API and set its one allowed origin to the static service origin.

## Required release checks

Run in order and retain the status plus release SHA:

1. `GET /health/ready` on the internal API returns `200` and its release matches
   the static build release.
2. Open the static site without an OIDC redirect.
3. Load one WBS live-pilot view such as `list_payables`; it must return
   `status=NOT_ADMITTED`, `observation_mode=UNSIGNED_PILOT`, all action flags false,
   a provider hash, observation hash, and a bounded record count.
4. Load GL, AP/AR aging, and report pages. They must derive from existing posted-ledger
   projections and retain their ordinary report drill paths.
5. Send a test `POST` to an internal API route. It must return HTTP `403` and
   `INTERNAL_TEST_READ_ONLY`; no accounting object or WBS action may be created.

Do not deploy if any fixed actor permission, period, CORS value, WBS read response,
release SHA, or write-denial check is missing.

## Exact read-only API preflight

With `API_ORIGIN`, `ENTITY_ID`, and `PERIOD_ID` set to the newly created internal
services' values, retain the response bodies and HTTP status for these requests.
They must all be plain `GET` requests without an `Authorization`, `Idempotency-Key`,
or `If-Match` header:

1. `GET $API_ORIGIN/health/ready` returns `200`, `ok=true`, and the exact deployed
   40-character candidate SHA.
2. `GET $API_ORIGIN/api/v1/entities/$ENTITY_ID/access/self` returns `200`; its
   `actor_id` is `refs-internal-readonly`, tenant and entity match the configured
   scope, `session_refresh_required=false`, and both `permissions` and
   `configured_permissions` are exactly `AP.VIEW`, `AR.VIEW`, `BANK.VIEW`,
   `GL.JE.VIEW`, `GL.REPORT.VIEW`, and `WBS.AUTOREC.VIEW`.
3. `GET $API_ORIGIN/api/v1/entities/$ENTITY_ID/scope?periodId=$PERIOD_ID` returns
   `200` and confirms the configured period scope.
4. `GET $API_ORIGIN/api/v1/entities/$ENTITY_ID/general-ledger/entries?periodId=$PERIOD_ID&limit=25&offset=0`
   and `GET $API_ORIGIN/api/v1/entities/$ENTITY_ID/reports/financial-statements?periodId=$PERIOD_ID`
   both return `200` from the posted-ledger projection.
5. `GET $API_ORIGIN/api/v1/entities/$ENTITY_ID/wbs/live-pilot?tool=list_payables&limit=10`
   returns `200` with `status=NOT_ADMITTED`, `observation_mode=UNSIGNED_PILOT`,
   `signature_verified=false`, a provider content hash, an observation hash, a
   bounded record count, and every `can_*` action flag false.
6. `POST` any accounting command path with a minimal JSON object returns `403`
   with `INTERNAL_TEST_READ_ONLY`. Do not use a WBS provider endpoint for this
   check. Record that no object was created.
