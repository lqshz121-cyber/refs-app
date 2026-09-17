# Outbox dispatcher release

The dispatcher is released only for an approved, explicit tenant/entity set. It never discovers or widens its own scope.

## Before promotion

1. Apply migration `299_outbox_dispatch_entity_revision_claim.sql`. Do not edit migration 298 and do not update live grants with direct SQL.
2. Replace every legacy tenant-only `OUTBOX_DISPATCH_SCOPES` secret such as `[{"tenantId":"..."}]` with the approved closed form `[{"tenantId":"...","entityId":"..."}]`. Obtain both UUIDs from the signed release coordinates. Never infer “all entities”.
3. Through the standard grant-sync workflow, give the dedicated SERVICE actor exactly `OUTBOX.DISPATCH` for each listed entity. Do not combine it with another permission.
4. Run `npm run preflight:outbox-dispatch-release` in the worker environment. The only successful output is a redacted `OUTBOX_DISPATCH_RELEASE_CONFIG_V1` receipt with `ready:true` and aggregate tenant/scope counts. This check makes no network or database request.
5. Start the worker only after the database migration and exact grants are present. Startup performs an authoritative permission, grant-revision and backlog preflight before the dispatch loop.

## Hang and shutdown deadlines

A dispatch cycle claims outbox rows under a database lease of `OUTBOX_DISPATCH_LEASE_SECONDS`. If the claim, the publish, or the completion stalls, the cycle itself must be bounded, otherwise the loop is pinned forever: no error is ever raised, the consecutive-error budget never trips, the worker never exits, and — because Render background workers receive no inbound health probe — nothing restarts it while the backlog grows.

- `OUTBOX_DISPATCH_CYCLE_TIMEOUT_MS` (default `min(lease, 120000)`) bounds one cycle including its readiness preflight. On expiry the worker emits `outbox_dispatch_cycle_timeout`, counts the cycle as an error, backs off, and eventually exits through the consecutive-error budget for the process supervisor. Startup rejects a value larger than the lease window, so an abandoned cycle is always released before another worker can reclaim the same rows.
- `OUTBOX_DISPATCH_STOP_TIMEOUT_MS` (default `15000`) bounds graceful shutdown. Without it, `SIGTERM` during a hung cycle waits forever and the platform eventually `SIGKILL`s the process with pools still open. On expiry the worker records a forced stop, emits `outbox_dispatch_stop_timeout`, and lets the supervisor close resources and exit.
- An abandoned cycle keeps its leases until they expire. Recovery is the normal lease reclaim in `refs_claim_outbox_v3`: another worker re-claims the row after `locked_at` ages past the lease, `attempt_count` increments, and the retry / dead-letter state machine in `refs_complete_outbox_v2` is unchanged. Publishes are idempotent per `outbox_event_id`, so a reclaim after a stall cannot duplicate a delivery downstream.

## Acceptance

- The old v2 tenant-wide claim is denied to `refs_app`; v3 claims only configured entities.
- A sibling-entity event remains `PENDING` with its `attempt_count`, `locked_by`, `locked_at`, `last_error`, and `available_at` unchanged.
- A stale grant-set revision or an extra effective permission fails before an outbox row is locked.
- `/health/ready` is `503` until a successful cycle, during backoff, after consecutive errors, or when readiness/success evidence is stale. Its response contains no IDs, timestamps, counts, URLs, tokens, or error text.
- A cycle that never settles fails on `OUTBOX_DISPATCH_CYCLE_TIMEOUT_MS`, and `stop()` returns within `OUTBOX_DISPATCH_STOP_TIMEOUT_MS` even while a cycle is hung.
- Render background workers do not receive inbound health probes. The loop exits nonzero after the configured consecutive-error budget so Render can restart it. The loopback endpoint is diagnostic evidence from inside the worker instance only.

## Rollback

Stop the worker before applying the migration 299 down script. The down script is deliberately fail-closed: it leaves the v3 function installed but denies `refs_app` access to both v2 and v3, so dispatch cannot resume through the unsafe tenant-wide claim. Do not restore a tenant-only secret, broaden a grant, or manually re-grant either claim function. Resume dispatch only through a reviewed forward migration that preserves the entity and grant-revision boundary. Record the exact release coordinates, grant-sync receipt, migration receipt, sanitized preflight receipt, and worker stop outcome.
