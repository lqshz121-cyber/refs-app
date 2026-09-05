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

### Creation is a deployment, not a staging operation

Do not click **Deploy Blueprint** on either complete accounting manifest for the
initial cutover. Render provisions/deploys its resources together; the service
setting `autoDeployTrigger: off` is not a create-without-deploy switch. The initial
procedure below creates services individually in the Render Dashboard, using each
manifest's service block as the configuration specification. Do not create the
next service until the current gate passes. Pausing means leaving later services
uncreated, not assuming that a newly created worker is suspended.

Before creating any service, create an approved frozen release branch pointing
to the approved full Git SHA, restrict updates/deletion, and record its name and
`git ls-remote` SHA. Select this branch explicitly in every service creation form
(not the default branch). Recheck the remote branch SHA immediately before each
creation; abort if it changed. A Blueprint's linked branch is not a substitute for
the service's own `branch` setting. Set service Auto-Deploy to Off before creation.
This pins the initial build without relying on a post-creation redeploy to correct
an unapproved first build. Later manual deployments must specify the full SHA
through Deploy a specific commit or the API `commitId`, never latest-commit deploy.

Copy all service fields, including commands, root directory, health path, static
routes/headers, and disabled test modes. Enter `sync:false` coordinates privately
in the creation form. For a worker's `fromService` entries, privately enter the
approved values from its named producer (never staging); record the relationship,
not credentials, in release evidence. These manually managed bindings must be
rotated with their producer until Blueprint adoption. Have a second operator check
configuration and branch before clicking the create/deploy action.

Blueprint adoption is a separate approved configuration deployment after staged
acceptance, not part of this initial procedure. Each resource must have only one
Blueprint owner. Before the first sync, review the complete diff, explicitly set
each Git service's `branch` to the frozen release branch, and ensure existing
resource names/configuration match; reject unexpected creation or replacement.
Keep the Blueprint source branch frozen during adoption. Immediately after creation
set **Auto Sync to No** in **every production Blueprint's Settings** (including the
consumer), and record verification before permitting further source changes.
For existing Blueprints, verify Auto Sync is No before any YAML update. Keep
service Auto-Deploy Off as well: these are independent controls. Only approved
Manual Sync is allowed, and it can redeploy affected services, so stage/review
its affected set and recheck exact-SHA readiness before continuing.

Platform references: [Blueprint creation and Auto Sync](https://render.com/docs/infrastructure-as-code),
[service branch defaults](https://render.com/docs/blueprint-spec), and
[specific-commit deployment](https://render.com/docs/deploys).

### Gated service sequence

1. Record the approved full Git SHA and take a restorable production database
   backup. Test restore in a separate database before the first production cutover.
2. Create the isolated consumer database, initialize its approved roles/schema,
   then individually create its consumer service using the resource specifications
   in `render.outbox-consumer.production.yaml`. Reuse this manifest as the source
   of configuration; do not apply it as a whole during staged creation. Verify
   consumer readiness before proceeding. Its tenant/entity must equal the
   approved dispatcher scope, but its database must remain independent of the
   accounting database.
3. Prepare the base API creation form from `render.production.yaml`, but do not
   submit it until its settings are reviewed. Enter all `sync:false` values.
   Database URLs must address the independently approved production
   database and distinct least-privilege roles. OIDC and allowed origins must use
   only the production API/Web applications and domains.
4. Review `OUTBOX_DISPATCH_SCOPES` as a closed JSON array of approved production
   tenant/entity pairs. Grant the dedicated actor exactly `OUTBOX.DISPATCH` with
   the approved finite expiry. Point `OUTBOX_PUBLISH_URL` only to the production
   consumer and enter its independent token.
5. Create/deploy only the base API at the approved SHA. Run migrations through its
   `preDeployCommand`, then require `/health/live` and `/health/ready` to return
   `no-store` and the exact SHA. Run the dispatch preflight before enabling the
   worker: create the dispatcher only after API readiness passes, then require its
   startup permission/backlog preflight and fresh health evidence. Pause on failure;
   leave Web uncreated until API and worker readiness pass.
6. Set every static public coordinate to the approved production API/OIDC/Web
   origins and scope. Confirm both test switches remain `DISABLED`, create/deploy the
   exact same SHA, then verify `/refs-build.js` and the API release agree.
7. Individually create the integrations API using its manifest only after provider trust,
   immutable storage, scanner TLS, evidence retention, service actors, and scopes
   pass independent review. Its four least-privilege database roles must target the
   same approved production accounting database endpoint as the base API; never
   create a second accounting ledger or copy values from staging. Deploy the exact
   same SHA, validate the API first, then individually create cleanup and
   integrations-dispatch workers, requiring each worker's health before continuing.
   After acceptance, change the Web client to the integrations API as one atomic
   origin switch. Browser reads and commands must never split across both APIs.
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
