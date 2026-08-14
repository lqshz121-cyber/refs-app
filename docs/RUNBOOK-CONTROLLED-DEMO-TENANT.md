# Controlled DEMO tenant runbook

## Use this only for the isolated demo environment

This procedure provisions an authoritative Postgres tenant boundary for a non-real accounting scenario. It does not import WBS, admit unsigned data, or post anything automatically.

## Preconditions

1. Migration `116_controlled_demo_tenant_isolation.sql` is applied through the isolated migration role.
2. `REFS_CONTROLLED_DEMO_MODE=ENABLED` is explicitly configured for the intended environment. The default is disabled.
3. An administrator chooses a new tenant code in the `DEMO_` namespace, a finite expiry, and a scenario label. Never reuse a real tenant ID or entity ID.

## Provisioning interface

The future bootstrap owner must create the tenant and marker atomically through the migration/admin connection:

```sql
INSERT INTO tenant(tenant_code,name) VALUES ('DEMO_AP_BANK_2026','Non-real AP and Bank scenario') RETURNING tenant_id;
INSERT INTO controlled_demo_tenant(tenant_id,scenario_code,display_label,created_by,expires_at)
VALUES (:tenant_id,'AP_BANK_CLOSURE','DEMO — non-real evidence','oidc|demo-admin',clock_timestamp()+interval '14 days');
```

The application runtime checks its own tenant status with:

```sql
SELECT * FROM refs_read_controlled_demo_tenant(:tenant_id);
```

Expected active status: `is_demo=true`, `lifecycle_status='ACTIVE_DEMO'`. The marker can never be inserted for a tenant whose code does not begin with `DEMO_`.

## Expiry and cleanup

At `expires_at`, the reader reports `EXPIRED` and `is_demo=false`. To retire early, an authorized administrator uses the migration/admin path:

```sql
SELECT refs_retire_controlled_demo_tenant(:tenant_id,'Demo validation complete','oidc|demo-admin');
```

This appends a retirement record plus `CONTROLLED_DEMO_RETIRED` audit/outbox events. It intentionally does not delete accounting evidence. Any later physical purge requires a separately approved retention procedure and must preserve the release audit trail.

## Verification

Run the controlled demo contract plus PostgreSQL kernel tests. Confirm a real-tenant OIDC context cannot query the DEMO tenant status, and the DEMO context cannot query a real tenant status. Confirm the UI labels the tenant as `DEMO / non-real` before running any non-real scenario.
