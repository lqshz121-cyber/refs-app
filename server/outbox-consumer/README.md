# Durable outbox consumer (staging)

This is an independent delivery-evidence service, not an accounting command API,
message broker, business workflow executor, or proof that a downstream business
process ran. It accepts authenticated `REFS_OUTBOX_EVENT_V1` envelopes and seals an
append-only PostgreSQL receipt before returning `REFS_OUTBOX_PUBLISH_RECEIPT_V1`.

## Architecture and authority

`accounting outbox → existing dispatcher → HTTPS /outbox/events → consumer DB`

The consumer uses its own PostgreSQL instance/database, own runtime LOGIN and
Bearer secret. It has no accounting DB URL, context issuer, grant-sync authority,
OIDC human role, WBS credential or accounting mutations. Startup rejects accidental
accounting credential environment variables. One instance is pinned to exactly
one tenant/entity; deploy a separately configured instance for additional scopes.
The token authorizes only delivery into that pinned scope. No token/body/URL is
logged; HTTP errors contain stable codes only. HTTPS terminates at Render; the
dispatcher must use its HTTPS URL (never direct public HTTP).

The dedicated runtime LOGIN inherits `refs_outbox_consumer_runtime`, which has
only schema USAGE and EXECUTE on `ready`/`accept`; it has no table read/write,
DDL, accounting, grant or administrative permissions. Readiness rejects a
superuser, database owner, role creator, database creator, BYPASSRLS or REPLICATION identity,
missing initialized scope and detectable accounting schema. Credentials still
need operator verification that this is a separate database/instance; naming is
not a substitute for that check.

The database itself recomputes the existing PostgreSQL `refs_jsonb_hash` algorithm:
SHA256 of UTF-8 `payload::jsonb::text`. JavaScript sorted JSON is **not** equivalent.
Payload hash mismatch is a permanent 400, with zero retained writes. The v3 claim
repository now selects `payload::text AS payload_canonical_text`, not a node-postgres
parsed JSON payload. The publisher seals that text against the source hash and
inserts those exact JSON bytes into the closed V1 envelope. The consumer passes the
original UTF-8 envelope to PostgreSQL without JSON.stringify. JSON.parse is used
only for shape/scope/secret validation, never to regenerate authoritative payload
bytes. Numeric `12.0000` and values beyond JavaScript safe precision survive exactly;
real PG15/16/18 tests cover source hash → transport → stored hash and PUBLISHED.
Never relabel rejected events PUBLISHED.

Publisher and HTTP consumer share the AI secret-safety baseline plus token, secret,
cookie/set-cookie, api-key, database_url, JWT and OAuth-shaped value detection.
The SQL accept function independently traverses nested JSON with equivalent deny
rules. The common synthetic negative corpus must leave zero additional ledger rows.

The primary key is `outbox_event_id`, with `(outbox_event_id,payload_hash)` unique.
Same ID/hash and identical immutable envelope replays the receipt. A changed
attempt count is allowed; different payload hash, scope, event/aggregate identity
or created time is 409. SQL uniqueness serializes concurrent deliveries. No
receipt is returned before the autocommit statement durably commits. HTTP loss
after commit is safe to retry. This is at-least-once delivery with idempotent
retention, not an exactly-once claim.

Only administrators can inspect ledger counts/evidence. The runtime has no GET
event/list endpoint. UPDATE/DELETE/TRUNCATE are rejected by privileges and triggers.
The owner remains a privileged trust boundary; backups and access audit are
required. There is intentionally no destructive down/reset command.

## Initialize the consumer database only

Use the new, empty database `refs_outbox_consumer_staging` from
`render.outbox-consumer.yaml`. Do not run accounting `db:up` here. Do not run this
bootstrap on the accounting database. Do not attach the admin URL to the web service.

In a secured operator session set (without printing values):

- `OUTBOX_CONSUMER_ADMIN_DATABASE_URL`: dedicated DB owner's connection URL.
- `OUTBOX_CONSUMER_DATABASE_NAME=refs_outbox_consumer_staging`.
- `OUTBOX_CONSUMER_TENANT_ID` and `OUTBOX_CONSUMER_ENTITY_ID`: approved exact scope.
- `OUTBOX_CONSUMER_INITIALIZE_CONFIRM=INITIALIZE:refs_outbox_consumer_staging`.

Run from `server`: `node outbox-consumer/initialize.mjs`.
The initializer rejects populated databases and existing accounting tables,
transactions the bootstrap, and records its SHA256. Repeating it is allowed only
for the same schema checksum and scope; changed bootstrap bytes fail closed.
Future schema revisions require new consumer-owned forward scripts, not edits to
an applied bootstrap and never an accounting migration number.

Using the provider's secure administrative mechanism, provision a **new non-owner
LOGIN** with a generated secret, INHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
NOREPLICATION and NOBYPASSRLS; grant it only `refs_outbox_consumer_runtime` membership.
Do not embed generated passwords in logs or this repository. Use that LOGIN's URL
as `OUTBOX_CONSUMER_DATABASE_URL`; the service intentionally will not start with
the owner URL. Keep database external ingress denied (`ipAllowList: []`) and use
the internal same-region connection with appropriate provider TLS settings.

## Deploy runbook / release gates

1. Review exact candidate SHA and require consumer PG15/16/18 CI plus existing
   accounting/full frontend/build gates. `Outbox Consumer Gate` runs a fresh,
   isolated database; missing test coordinates fail rather than skip.
2. Provision the **separate** consumer Blueprint/database only after operator
   approval of resources/cost. No cloud resources are created by this commit.
3. Bootstrap and provision the limited LOGIN as above; verify provider backups,
   recovery and exact tenant/entity scope. Set consumer secret in Render without
   copying it into source or chat. Deploy consumer at the approved final SHA.
4. Verify `/health/live` and `/health/ready`: HTTP 200, no-store and exact release.
   Ready tests schema/scope/role on each request. Body is bounded and contains no
   business facts. Missing DB/permission returns 503, never cached.
5. Keep the old dispatcher suspended. Complete accounting migrations and its
   standard exact SERVICE `OUTBOX.DISPATCH` grant/preflight separately. Never
   resume a pre-299 claim-v2 worker after migration299.
6. Set existing dispatcher `OUTBOX_PUBLISH_URL` to
   `https://refs-outbox-consumer-staging.onrender.com/outbox/events` **only after
   verifying that is the actual created service URL**. Set `OUTBOX_PUBLISH_TOKEN`
   equal to consumer `OUTBOX_CONSUMER_TOKEN` in secure Render configuration.
   Existing `OUTBOX_DISPATCH_ACTOR_ID` and exact grant-revision scopes remain
   mandatory. Deploy dispatcher at the same final SHA and start at a small batch.
7. Verify a real committed event: source ID/hash → one consumer ledger row →
   exact receipt → accounting PUBLISHED. Retry/restart must keep count=1. Verify
   no accounting/business changes arose merely from consuming it. Review old
   FAILED events explicitly; do not SQL-update backlog statuses to fabricate success.
8. Monitor 15 minutes: ready, publisher errors, PENDING age, FAILED count, consumer
   DB connections/storage. Keep signed evidence, source lineage and authenticated
   business E2E as separate acceptance requirements.

Rollback triggers: hash/scope conflicts, missing durable receipt, unauthorized
access, ready failure, or growing publication errors. Suspend dispatcher first;
keep ledger/backups intact. Fix configuration or roll back compatible application
bytes; never drop ledger, remove its idempotency rows, or replay accounting commands.
Secret rotation is coordinated: pause dispatcher, rotate both endpoints securely,
verify readiness, resume and replay retained event IDs. This MVP has no business
consumer fan-out or archival/partitioning: revisit these before unbounded scale.

## Local tests

From `server`: `node --test tests/outbox-consumer.test.mjs` (also in `npm test`).
For a **fresh disposable local** PG15/16/18 database named exactly
`refs_outbox_consumer_test`, securely set `OUTBOX_CONSUMER_TEST_ADMIN_URL`, then run
`node --test outbox-consumer/postgres.test.mjs`. It refuses non-loopback hosts and
other database names. It verifies real hash recomputation, first commit, concurrent
retry, restart replay, 409 conflicts, wrong scope/open shape/hash rejection,
runtime privilege denial, owner startup denial and immutable ledger count.
The test intentionally does not drop databases or roles; dispose only the test
container/volume you created. CI's service container is fresh per matrix job.

Blueprint fields follow the [Render specification](https://render.com/docs/blueprint-spec).
## Same-SHA production promotion

`render.outbox-consumer.production.yaml` defines a **separate consumer-only**
production web service and database. Both manifests explicitly freeze Oregon,
one Starter web instance, Basic-256mb PostgreSQL18 and denied external DB ingress.
These are resource specifications, not proof that resources exist or are deployed.
The production accounting/API/Web/dispatcher stack remains separately coordinated.

After staging acceptance, record the exact immutable 40-character commit SHA and
manually deploy that **same SHA** to the production consumer and its approved
production dispatcher. Auto-deploy is off; do not deploy whichever main is current.
Use a separate production DB, LOGIN, token and approved tenant/entity coordinates;
never reuse staging credentials or infer production scope. Verify both health
release stamps, backup/restore, unauthorized rejection, exact hash/receipt and
one-row replay before resuming production dispatch. No production creation,
deployment or completion is claimed by this commit.
