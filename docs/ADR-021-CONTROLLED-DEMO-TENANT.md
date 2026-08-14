# ADR-021: controlled DEMO tenants use a separate authoritative tenant

## Decision

A demo is a distinct `tenant` whose `tenant_code` begins with `DEMO_` and has an immutable `controlled_demo_tenant` marker. The marker is the non-real provenance for every accounting row in that tenant because every accounting table is tenant-scoped. A production tenant has no marker and cannot be reclassified through this mechanism.

`REFS_CONTROLLED_DEMO_MODE` is `DISABLED` unless explicitly set to `ENABLED`. Enabling the setting alone creates no tenant, data, grant, Draft, or posting action.

## Consequences

- OIDC context and PostgreSQL RLS continue to scope every read/write by `tenant_id`; a session for a real tenant cannot read the DEMO marker, and a DEMO session cannot read a real tenant.
- The same Postgres workflow, audit and outbox are used when a later owner provisions the demo scenario. Browser mocks, `localStorage`, `seed.js`, and a separate demo site are prohibited.
- Expiry makes the marker inactive. Retirement is append-only and emits an audit/outbox event. Neither path deletes journals, ledger rows, source evidence, or audit history.
- This migration does not weaken WBS Pilot rules. Unsigned WBS data remains `UNSIGNED / GET ONLY / NOT POSTABLE` in every tenant, including DEMO.

## Deferred work

The integration owner must add an administrator-authorized bootstrap command and an exact source-provenance convention before inserting any scenario data. The resulting end-to-end demo must be labeled `DEMO / NON-REAL EVIDENCE` in the authoritative UI.
