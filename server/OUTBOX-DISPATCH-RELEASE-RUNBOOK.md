# Outbox dispatcher release

The dispatcher is released only for an approved, explicit tenant/entity set. It never discovers or widens its own scope.

## Before promotion

1. Apply migration `299_outbox_dispatch_entity_revision_claim.sql`. Do not edit migration 298 and do not update live grants with direct SQL.
2. Replace every legacy tenant-only `OUTBOX_DISPATCH_SCOPES` secret such as `[{"tenantId":"..."}]` with the approved closed form `[{"tenantId":"...","entityId":"..."}]`. Obtain both UUIDs from the signed release coordinates. Never infer “all entities”.
3. Through the standard grant-sync workflow, give the dedicated SERVICE actor exactly `OUTBOX.DISPATCH` for each listed entity. Do not combine it with another permission.
4. Run `npm run preflight:outbox-dispatch-release` in the worker environment. The only successful output is a redacted `OUTBOX_DISPATCH_RELEASE_CONFIG_V1` receipt with `ready:true` and aggregate tenant/scope counts. This check makes no network or database request.
5. Start the worker only after the database migration and exact grants are present. Startup performs an authoritative permission, grant-revision and backlog preflight before the dispatch loop.

## Acceptance

- The old v2 tenant-wide claim is denied to `refs_app`; v3 claims only configured entities.
- A sibling-entity event remains `PENDING` with its `attempt_count`, `locked_by`, `locked_at`, `last_error`, and `available_at` unchanged.
- A stale grant-set revision or an extra effective permission fails before an outbox row is locked.
- `/health/ready` is `503` until a successful cycle, during backoff, after consecutive errors, or when readiness/success evidence is stale. Its response contains no IDs, timestamps, counts, URLs, tokens, or error text.
- Render background workers do not receive inbound health probes. The loop exits nonzero after the configured consecutive-error budget so Render can restart it. The loopback endpoint is diagnostic evidence from inside the worker instance only.

## Rollback

Stop the worker before applying the migration 299 down script. The down script is deliberately fail-closed: it leaves the v3 function installed but denies `refs_app` access to both v2 and v3, so dispatch cannot resume through the unsafe tenant-wide claim. Do not restore a tenant-only secret, broaden a grant, or manually re-grant either claim function. Resume dispatch only through a reviewed forward migration that preserves the entity and grant-revision boundary. Record the exact release coordinates, grant-sync receipt, migration receipt, sanitized preflight receipt, and worker stop outcome.
