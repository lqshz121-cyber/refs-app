# Production Render topology

These manifests define a production topology; they do not provision or prove a
production environment. Creating any Blueprint may create billable resources and
requires an independently approved Render workspace, database, domains, OIDC
application, actors, tenant/entity scopes, object storage, scanner, and release SHA.

## Manifests

- `render.production.yaml`: base accounting API, its dedicated outbox dispatcher,
  and the static Web client.
- `render.integrations.production.yaml`: provider-signed integrations API, its
  attachment cleanup worker, and its dedicated outbox dispatcher.
- `render.outbox-consumer.production.yaml`: the already-isolated production event
  consumer and consumer database. Reuse this manifest; do not place its database
  in either accounting Blueprint.

All services use `autoDeployTrigger: off`. No production manifest contains a
staging service reference, fixed tenant/entity UUID, actor identity, database URL,
OIDC domain, browser domain, storage credential, or delivery token. Every such
coordinate is entered as a reviewed `sync:false` value in Render.

## Promotion order

1. Record the approved full Git SHA and take a restorable production database
   backup. Test restore in a separate database before the first production cutover.
2. Create and initialize the isolated consumer from
   `render.outbox-consumer.production.yaml`. Its tenant/entity must equal the
   approved dispatcher scope, but its database must remain independent of the
   accounting database.
3. Create `render.production.yaml` without deploying it. Enter all `sync:false`
   values. Database URLs must address the independently approved production
   database and distinct least-privilege roles. OIDC and allowed origins must use
   only the production API/Web applications and domains.
4. Review `OUTBOX_DISPATCH_SCOPES` as a closed JSON array of approved production
   tenant/entity pairs. Grant the dedicated actor exactly `OUTBOX.DISPATCH` with
   the approved finite expiry. Point `OUTBOX_PUBLISH_URL` only to the production
   consumer and enter its independent token.
5. Deploy the base API at the approved SHA. Run migrations through its
   `preDeployCommand`, then require `/health/live` and `/health/ready` to return
   `no-store` and the exact SHA. Run the dispatch preflight before enabling the
   worker. Do not deploy Web until API and worker readiness pass.
6. Set every static public coordinate to the approved production API/OIDC/Web
   origins and scope. Confirm both test switches remain `DISABLED`, deploy the
   exact same SHA, then verify `/refs-build.js` and the API release agree.
7. Create `render.integrations.production.yaml` only after provider trust,
   immutable storage, scanner TLS, evidence retention, service actors, and scopes
   pass independent review. Never copy values from staging. Deploy the exact same
   SHA, validate the API first, then cleanup and integrations-dispatch workers.
8. Run authenticated read-only acceptance before any controlled business command.
   A production E2E is separate evidence and must use approved identities, exact
   role bundles, scope, idempotency, source evidence, and journal/GL/report readback.

## Required fail-closed settings

- Base API: all four database URLs, OIDC issuer/audience/JWKS, and allowed Web
  origins. Attachments and signed ingest remain `DISABLED` there.
- Integrations API: the base API requirements plus pinned WBS trust, provider
  service actor, evidence retention, S3 settings, scanner endpoint/token/CA/server
  name, and scanner actor. Attachments and signed ingest are `REQUIRED`.
- Dispatchers: their own API database references, dedicated actor, closed scopes,
  production consumer URL/token, and bounded retry/lease/health settings.
- Cleanup: integrations API database/storage references, dedicated actor, and
  closed cleanup scopes.
- Web: complete production API, entity/period/account, and OIDC public coordinates.

`REFS_WBS_LIVE_PILOT_MODE`, `REFS_WBS_TEST_IMPORT_MODE`, and
`REFS_CONTROLLED_TEST_AI_WORKFLOW_MODE` remain `DISABLED` in production. The
authoritative runtime's `REFS_CONTROLLED_DEMO_MODE` is also explicitly `DISABLED`. Do not add
Stage 1 self-grant/bootstrap settings or staging-only workflow grant ceremony to a
production service.

## Rollback triggers

Stop promotion and roll back the service release (not the database with `db:down`)
if release SHAs differ, readiness is not `200/no-store`, the dispatch preflight is
not ready, worker freshness expires, failed outbox events increase, OIDC scope is
wrong, storage/scanner trust fails, or authenticated readback crosses tenant/entity
scope. Keep workers stopped while the producer API is rolled back. Database recovery
uses the reviewed backup/PITR procedure; never use automatic down/reset migrations.
