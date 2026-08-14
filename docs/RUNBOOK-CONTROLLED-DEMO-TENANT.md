# Controlled DEMO tenant runbook

## Use this only for the isolated demo environment

This procedure provisions an authoritative Postgres tenant boundary for a non-real accounting scenario. It does not import WBS, admit unsigned data, create a Draft, grant a role, or post anything automatically.

## Preconditions

1. Migration `116_controlled_demo_tenant_isolation.sql` is applied through the isolated migration role.
2. `REFS_CONTROLLED_DEMO_MODE=ENABLED` is explicitly configured. The default is disabled.
3. An administrator chooses new tenant and entity UUIDs, `DEMO_` namespaced codes, a complete calendar month, a finite UTC expiry, and an idempotency key. Never reuse a real tenant or entity ID.
4. The approved secret store supplies `MIGRATION_DATABASE_URL`; never put it in a shell history or source file.

## Provisioning interface

Use only the server-side administrator command. It creates the tenant, immutable marker, entity, and one open monthly period in one SERIALIZABLE PostgreSQL transaction, then appends audit and outbox events. It has no browser or HTTP entry point.

```powershell
$env:REFS_CONTROLLED_DEMO_MODE='ENABLED'
$env:REFS_CONTROLLED_DEMO_ADMIN_CONFIRM='CREATE_NON_REAL_DEMO_TENANT'
# Set all REFS_CONTROLLED_DEMO_* identifiers, period, scenario, expiry,
# administrator, and idempotency values through the approved secret store.
npm.cmd run demo:provision
```

The command is idempotent only for an identical request and idempotency key. A reused key with different scope fails. It does not grant roles, so role provisioning remains a separately approved action.

The application runtime can check its own tenant status with:

```sql
SELECT * FROM refs_read_controlled_demo_tenant(:tenant_id);
```

Expected active status: `is_demo=true`, `lifecycle_status='ACTIVE_DEMO'`. The marker cannot be inserted for a tenant outside the `DEMO_` namespace.

## Expiry and cleanup

At `expires_at`, the reader reports `EXPIRED` and `is_demo=false`. To retire early, an authorized administrator uses the migration/admin path:

```sql
SELECT refs_retire_controlled_demo_tenant(:tenant_id,'Demo validation complete','platform-demo-admin');
```

This appends a retirement record plus `CONTROLLED_DEMO_RETIRED` audit/outbox events. It intentionally does not delete accounting evidence. Any later physical purge requires a separately approved retention procedure and must preserve the release audit trail.

## Verification

Run the controlled demo bootstrap/tenant contracts and PostgreSQL kernel tests. Confirm a real-tenant OIDC context cannot query the DEMO tenant status, and the DEMO context cannot query a real tenant status. Confirm the authoritative UI labels the tenant as `DEMO / non-real` before running any non-real scenario.
