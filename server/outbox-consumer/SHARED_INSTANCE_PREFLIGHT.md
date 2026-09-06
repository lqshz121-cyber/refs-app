# Staging shared-instance cost/safety preflight

This is a read-only assessment of an **optional staging** consumer logical database on the existing staging PostgreSQL instance. It does not change the default independent-instance deployment, authorize provisioning, or permit production to share staging. A dedicated consumer HTTP service, independent LOGIN/database, immutable tenant/entity scope, and independent backups remain required. No new physical PostgreSQL purchase is proposed; HTTP service cost still needs approval.

## Evidence and limits

Operator-supplied snapshot at 2026-09-06 00:08 UTC: PostgreSQL 18; accounting database 4,226,922,175 bytes; server max_connections 103 (provider UI 100); 6 client connections; other active, idle-in-transaction and lock waits all zero. Instance storage 15 GB, 27.6% used; plan 0.1 CPU / 256 MB RAM. The 12-hour/7-day metrics were unavailable. These observations are **not a performance PASS**. Consumer database and runtime group were absent at that observation, not guaranteed absent now.

Root operator's separate live SELECT at 2026-09-06 00:25:12 UTC on `refs_accounting_staging` confirmed PUBLIC database CONNECT and TEMPORARY; one non-system schema with PUBLIC USAGE; 16 PUBLIC-executable SECURITY DEFINER routines; and two PUBLIC default ACL entries. Only catalog aggregates were read, not routine bodies, actors or secrets. **The proposed reuse is currently STOP:** these ACLs do not satisfy denial of accounting connections to a future consumer LOGIN. This is not proof that an existing actor exploited a vulnerability or that those routines are unsafe. Do not automatically REVOKE PUBLIC without the accounting/operations identity allowlist and impact review. This live observation was supplied by root; the new script itself has not been run against that database.

[Render supports multiple logical databases on one instance](https://render.com/docs/postgresql-creating-connecting#adding-multiple-databases-to-a-single-instance). CPU, memory, connections, WAL, disk, maintenance and outages remain shared. A separate database is not a resource quota or fault boundary. Preserve the independent production environment.

## Read-only assessment

Prerequisites: approved staging target and operator catalog access; Node with this server's installed dependencies; exact accounting database, proposed new consumer database and LOGIN names. Do not obtain credentials from another task or log connection URLs. The acknowledgement below is an operator scope acknowledgement, **not database deployment attestation**. Confirm immutable staging deployment identity separately before any later provisioning; this script intentionally does not read identity/scope rows or claim it has attested staging.

Set these environment variables through the approved secret mechanism (no credential arguments):

| Variable | Meaning |
| --- | --- |
| `SHARED_PREFLIGHT_DATABASE_URL` | Approved existing accounting database connection; preserve required TLS verification |
| `SHARED_PREFLIGHT_ACCOUNTING_DATABASE` | Exact expected URL/current database name |
| `SHARED_PREFLIGHT_CONSUMER_DATABASE` | Proposed `refs_outbox_consumer_*` name, distinct from accounting |
| `SHARED_PREFLIGHT_CONSUMER_LOGIN` | Proposed `refs_outbox_consumer_*` LOGIN, not the fixed runtime group |
| `SHARED_PREFLIGHT_CONFIRM` | `STAGING_COST_EVALUATION_ONLY` |
| `SHARED_PREFLIGHT_PROVIDER_CONNECTION_LIMIT` | Verified provider ceiling; use 100 for the supplied snapshot |
| `SHARED_PREFLIGHT_EXISTING_PEAK_CONNECTIONS` | Optional complete sum of existing configured pool maxima including rolling overlap and jobs; never substitute observed 6 |

From `server`, run `node outbox-consumer/refs-outbox-shared-instance-preflight.mjs`. It uses one connection, startup default read-only, `BEGIN READ ONLY`, 5-second statement and 1-second lock timeouts, and always rolls back. It outputs only anonymous ACL counts, conflict booleans converted into gates, and connection arithmetic. Exit 2 means STOP; exit 3 means NOT_PROVEN. No output can authorize deployment. Query/permission errors fail closed with a redacted diagnostic.

For a manual approved SQL session, the adjacent `refs-outbox-shared-instance-preflight.sql` is executable catalog-only SQL. Wrap it with `BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '1s';`, then `ROLLBACK;`. First independently check exact `current_database()`. The module also exports parameterized `targetSql` for database/group/LOGIN existence and capacity; pass the exact accounting name, proposed database, proposed LOGIN as `$1`, `$2`, `$3`. It does not list actual roles, actors, object names, payloads or routine bodies.

## Stop and unproven gates

- PUBLIC database CONNECT means any future LOGIN inherits accounting connection permission. A role-specific REVOKE cannot negate PUBLIC. PUBLIC TEMPORARY/CREATE also requires remediation. Catalog defaults matter: NULL ACL is not no access. See [PostgreSQL privilege rules](https://www.postgresql.org/docs/18/ddl-priv.html).
- Inventory includes non-system schema, relation/view/partition/foreign table, sequence, column, routine (including SECURITY DEFINER), and explicit default-ACL PUBLIC grants. Review every category with the accounting owner. Routine default EXECUTE can be dangerous even without table grants. Counts are triage, not proof of safe function semantics. Explicit default ACL counts do not enumerate all future owners' implicit defaults.
- Existing proposed database, LOGIN, or cluster-wide `refs_outbox_consumer_runtime` group is a collision: STOP for ownership review. Do not reuse or alter it automatically. Current initializer unconditionally creates the fixed runtime group; it cannot safely provision a second installation on the same cluster without a separate design.
- Any later PUBLIC ACL change requires a separately approved explicit allowlist for existing accounting/operations clients. Do not revoke broadly during preflight. New runtime LOGIN must have no elevated attributes, no accounting role membership (including transitive/SET ROLE access), no ownership, and only the consumer runtime membership. Actual effective CONNECT/TEMP/CREATE denial to accounting and other disallowed databases must be tested using the real future LOGIN, plus consumer function-only success. CONNECT revocation does not terminate already connected sessions; handle that separately, not here.
- Existing consumer startup pool max is **5**, not configurable. Dispatcher has two pools default **10 each**. The conservative proposed peak is `(5 + 10 + 10) * 2 = 50`, plus 10 operations/backup reserve. Capacity is `min(provider ceiling, server max_connections) - reserved - superuser_reserved`. Add all existing configured peaks and rollout overlap. Unknown existing peak is NOT_PROVEN; excess is STOP. This task does not add pool settings or change defaults.
- Dispatcher batch/concurrency do not reduce pool maxima. Consumer currently has no hard HTTP concurrency/rate/backlog budget. This preflight does not establish throughput safety; missing historical CPU/RAM/I/O/storage and representative load evidence remain NOT_PROVEN. Do not infer headroom from an idle snapshot, enable storage autoscaling, or purchase capacity automatically.

## Later deployment prerequisites — separate authorization required

1. Approve staging identity, cost, shared fault-domain risk, ACL allowlist/impact and connection budget. Obtain representative history and load/lock/latency evidence with explicit stop thresholds before dispatch starts.
2. Independently authorize logical database/LOGIN provisioning. The existing initializer requires an empty exact-name database, explicit confirmation and frozen scope/hash; it must never target accounting. Consumer readiness does **not** prove cross-database isolation. Keep accounting credentials out of the consumer service.
3. Back up each database independently, plus approved role/ACL metadata; [Render requires per-database pg_dump or pg_dumpall for multi-database backups](https://render.com/docs/postgresql-backups). Test isolated restore and receipt/replay with the same logical database name and scope: initialization identity is immutable. Do not edit the sealed configuration to make a restore ready. Account for backup/restore I/O and storage shared with accounting.
4. Obtain exact-SHA consumer readiness, real receipt, duplicate replay, dispatcher PUBLISHED evidence, accounting isolation negatives and business invariants. No production completion claim follows from this preflight.

Rollback for this assessment is connection close: no application mutation is performed. If any STOP occurs, leave dispatcher/provisioning unchanged and escalate the anonymous report to the accounting/database owner. A later deployment incident should pause dispatch first, preserve accepted append-only receipts and accounting outbox, and follow the normal independent-instance recovery runbook; never delete/reset either database as rollback.

## Local test

`node --test outbox-consumer/refs-outbox-shared-instance-preflight.test.mjs`

These are deterministic configuration/transaction/query-contract tests, not a live PostgreSQL or performance gate. Actual authorized catalog execution and future cross-LOGIN isolation/restore evidence remain outstanding.
