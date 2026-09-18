# REFS — Backup / PITR / Alerts / Incident Runbook (P14)

Session: claude-9c9cd162 · 2026-09-18 · Migration chain head: 433\_outbox\_health\_read.sql

---

## 1. RPO / RTO Targets

| Tier | RPO | RTO | Mechanism |
|---|---|---|---|
| PostgreSQL WAL / continuous archiving | 0 s (stream) — 5 min (file) | < 30 min | pg\_basebackup + WAL archive → object store |
| Logical (migration ledger) | Last successful backup | < 60 min | pg\_dump → object store |
| Object-store attachments | 24 h (daily snapshot) | < 4 h | Cloud provider snapshot / replication |
| Full system (DB + object store coherent) | 24 h | < 4 h | Combined restore drill |

**Critical design constraint (verified by P14-2):** No binary payload is stored in the PostgreSQL attachment tables (`attachment`, `source_document`, `business_document`). All file content lives in object storage (`attachment.storage_ref NOT NULL`). A PostgreSQL restore without the object-store snapshot restores accounting data but not attached files — both must be restored together to reach a consistent state.

---

## 2. Backup Architecture

```
┌─────────────────────────────────────────────────┐
│  PostgreSQL 16 (embedded / managed)              │
│  Schema: refs_kernel_test / refs_kernel_prod      │
│  Migration ledger: refs_schema_migration (433 rows)│
└────────────────────┬────────────────────────────┘
                     │ WAL stream / archive
                     ▼
┌─────────────────────────────────────────────────┐
│  Object Store (WAL Archive bucket)               │
│  pg_basebackup snapshots                         │
│  pg_dump logical exports                         │
│  Attachment files (separate bucket)              │
└─────────────────────────────────────────────────┘
```

### 2.1 Continuous WAL archiving (PITR)

Recommended `postgresql.conf` settings (not applied automatically — requires operator action):

```ini
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://refs-wal-archive/%f'
restore_command = 'aws s3 cp s3://refs-wal-archive/%f %p'
```

### 2.2 Daily logical backup

```bash
pg_dump -h $DB_HOST -U refs_migrator -F c -f refs_$(date +%Y%m%d).dump $DB_NAME
aws s3 cp refs_$(date +%Y%m%d).dump s3://refs-backups/logical/
```

### 2.3 Attachment object-store backup

Follow cloud provider's snapshot / cross-region replication policy. Retention: 30 days minimum.

---

## 3. Data Verification Checks

### 3.1 Migration ledger digest (P14-1)

The migration manifest (`server/runtime/migration-manifest.mjs`) contains a deterministic SHA-256 digest of all 433 migration checksums. Run this check after every restore:

```javascript
import {ledgerDigest, manifestDigest} from './server/runtime/test-logical-restore-drill.mjs';
import {MIGRATION_MANIFEST} from './server/runtime/migration-manifest.mjs';
// Live rows from refs_schema_migration
const rows = (await pool.query('SELECT migration_name,checksum FROM refs_schema_migration ORDER BY migration_name')).rows;
const live = ledgerDigest(rows);
const expected = manifestDigest(MIGRATION_MANIFEST);
if (live !== expected) throw new Error(`LEDGER DIGEST MISMATCH: ${live} !== ${expected}`);
```

**Red:** any mismatch means the restored database is either corrupted, partially restored, or has had unauthorised schema changes.

### 3.2 RPO boundary (P14-2)

```sql
-- Must return 0 rows:
SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod)
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0
  AND NOT a.attisdropped
  AND a.atttypid IN ('bytea'::regtype, 'oid'::regtype)
  AND c.relname IN ('attachment', 'source_document', 'business_document');

-- Must return 0:
SELECT count(*) FROM pg_largeobject_metadata;
```

### 3.3 Post-restore db:up is noop (P14-3)

After restoring a backup, running the migration runner must produce zero new completions:

```bash
node server/runtime/migrate.mjs up
# Expected: {"event":"migration_skipped","migration_name":"..."} for all 433 entries
# Any {"event":"migration_completed"} indicates a partial restore
```

The `runLogicalRestoreDrill` function in `server/runtime/test-logical-restore-drill.mjs` automates this and also verifies tamper detection.

### 3.4 Tamper detection (P14-3)

The drill verifies that a single checksum modification in `refs_schema_migration` causes the ledger digest to mismatch (fails closed, never silently accepts drift).

---

## 4. Alerts and Metrics

### 4.1 Outbox health backlog\_state (P14-4)

| `backlog_state` | Severity | Meaning | Action |
|---|---|---|---|
| `DRAINED` | OK | No pending events | None |
| `PENDING_WITHIN_WINDOW` | INFO | Events pending but within normal window | Monitor |
| `STALE_BACKLOG` | WARNING | Events stuck beyond stale threshold | Investigate consumer; page on-call if > 30 min |
| `FAILED_EVENTS_PRESENT` | CRITICAL | Failed events in dead letter | Immediate response — see §6 incident runbook |

**Alert endpoint:** `GET /api/v1/entities/{entityId}/ops/outbox-health?staleMinutes=15`

Requires permission `OPS.OUTBOX.VIEW`.

Response envelope: `{ backlog_state, totals: { pending_count, failed_count, stale_pending_count }, ... }`

Prometheus scrape (example — operator must configure):

```yaml
# prometheus.yml scrape config (example)
- job_name: refs_outbox
  metrics_path: /api/v1/entities/<ENTITY_ID>/ops/outbox-health
  params:
    staleMinutes: ['15']
  bearer_token_file: /etc/refs/ops-token
  relabel_configs:
    - source_labels: [__address__]
      target_label: instance
```

Map `backlog_state` to an alert rule:

```yaml
groups:
  - name: refs_outbox
    rules:
      - alert: OutboxStalledWarning
        expr: refs_outbox_backlog_state{state="STALE_BACKLOG"} == 1
        for: 5m
        severity: warning
      - alert: OutboxFailedCritical
        expr: refs_outbox_backlog_state{state="FAILED_EVENTS_PRESENT"} == 1
        for: 1m
        severity: critical
```

### 4.2 Key log correlation fields

All kernel operations emit structured JSON logs. Correlate incidents by:

| Field | Purpose |
|---|---|
| `tenant_id` | Tenant scope |
| `entity_id` | Entity scope |
| `journal_entry_id` | Specific journal |
| `outbox_event_id` | Specific outbox event |
| `migration_name` | Schema change correlation |
| `session_id` | Kernel session (from `refs_current_context()`) |

---

## 5. Rollback Boundaries (P14-5)

### 5.1 Production guard: `db:down` is forbidden

The migration runner (`server/runtime/migrations.mjs`) contains an unconditional production guard:

```javascript
// migrations.mjs line ~107
throw new KernelError('DB_DOWN_FORBIDDEN', ...)
```

`db:down` (destructive rollback) is **never permitted in production**. Schema rollback requires a deliberate restore from backup.

### 5.2 Irreversible barrier: `MIGRATION_RESET_BLOCKED`

Migration 401 (`401_native_settlement_bank_account_control.sql`) is a hard barrier. Once applied, the migration runner will refuse any attempt to reset the migration state past it:

```javascript
// migrations.mjs line ~186
throw new KernelError('MIGRATION_RESET_BLOCKED', ...)
```

**Meaning:** The only valid path forward after a destructive incident past migration 401 is a full database restore from a known-good backup.

### 5.3 Safe rollback boundary map

```
Migrations 001–400: individual down-scripts available (not used in production)
Migration 401 ←── BARRIER: MIGRATION_RESET_BLOCKED
Migrations 402–433: forward-only; rollback = full restore from backup
```

---

## 6. Incident Runbook

### 6.1 Outbox FAILED\_EVENTS\_PRESENT

1. **Page on-call** if not already alerted.
2. Query the failed events:
   ```sql
   SELECT outbox_event_id, event_type, created_at, retry_count, last_error
   FROM outbox_event
   WHERE tenant_id = $1 AND entity_id = $2 AND status = 'FAILED'
   ORDER BY created_at;
   ```
3. Determine if the failure is transient (network, downstream) or structural (schema mismatch, poison message).
4. For transient: reset status to `PENDING` to trigger retry:
   ```sql
   UPDATE outbox_event SET status = 'PENDING', retry_count = 0, scheduled_at = now()
   WHERE outbox_event_id = $1;
   ```
   Requires DBA approval and change record.
5. For structural (poison message): move to dead-letter bucket and alert engineering.
6. Verify `backlog_state` returns to `DRAINED` within one processing cycle.

### 6.2 PostgreSQL unavailable

1. Check WAL archive health (no gaps in sequence).
2. Initiate PITR restore to the last known good point:
   ```bash
   # 1. Stop application
   # 2. Restore base backup
   pg_restore_command="aws s3 cp s3://refs-wal-archive/%f %p"
   # 3. Set recovery_target_time in recovery.conf
   echo "recovery_target_time = '2026-09-18 10:00:00'" > $PGDATA/recovery.conf
   # 4. Start PostgreSQL — it will replay WAL to the target
   pg_ctl start -D $PGDATA
   ```
3. After PostgreSQL starts: run migration ledger digest check (§3.1).
4. Run `node server/runtime/migrate.mjs up` — must produce all skipped, zero completed.
5. Verify `backlog_state` is `DRAINED` before restoring application traffic.

### 6.3 Object-store unavailable (attachments inaccessible)

1. Accounting operations (journals, ledger queries) continue — no dependency on object store.
2. Attachment reads and uploads fail with 503.
3. Restore object-store from snapshot (follow cloud provider procedure).
4. Verify: `SELECT count(*) FROM attachment WHERE storage_ref IS NULL` → must be 0.

### 6.4 Schema corruption detected (ledger digest mismatch)

1. **Halt migration runner immediately.**
2. Preserve a forensic dump: `pg_dump -F c -f forensic_$(date +%Y%m%dT%H%M%S).dump $DB_NAME`
3. Alert security team — unauthorised schema changes are a security incident.
4. Restore from last backup whose ledger digest matches the manifest.
5. Re-run migration chain to current head (must produce all skipped).

---

## 7. Test Evidence (P14 acceptance)

All five acceptance checks executed against PG16 embedded, migration chain at head 433:

| Check | ID | Result |
|---|---|---|
| Chain-433 ledger integrity — manifest digest matches live ledger | P14-1 | ✓ PASS |
| RPO boundary — zero binary payload in attachment tables | P14-2 | ✓ PASS |
| Logical restore drill — round-trip, tamper detection, post-restore noop | P14-3 | ✓ PASS |
| Alert threshold contract — outbox backlog\_state covers all severity levels | P14-4 | ✓ PASS |
| Rollback boundary — db:down guard and MIGRATION\_RESET\_BLOCKED present | P14-5 | ✓ PASS |

Runner: `/tmp/onefile-gw.sh tests/backup-pitr-drill-p14.test.mjs`
Test file: `server/tests/backup-pitr-drill-p14.test.mjs`

Not deployed to production, not merged to main. Evidence: runnable test suite + this document.
