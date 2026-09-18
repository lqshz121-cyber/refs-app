# REFS Release Governance (P15)

Session: claude-9c9cd162 · 2026-09-18 · applies to branch `claude/2026-09-16-n-batch-9c9cd162`

---

## 1. Main Branch Protection Requirements

Branch: `main`

| Rule | Setting | Rationale |
|---|---|---|
| Require PR before merging | ✓ — minimum 1 review | All changes reviewed |
| Require status checks to pass | CI: test, lint, migration-check | Gate broken builds |
| Require branches to be up to date | ✓ | Prevent merge-and-break |
| Require signed commits | Recommended | Audit trail |
| No force-push to main | ✓ — enforced | History is immutable |
| No deletion of main | ✓ | Prevent accidental wipe |
| Include administrators | ✓ | No self-merge by owners |
| Dismiss stale reviews on push | ✓ | Re-review after any push |

### Merge requirements checklist

Before any PR can be merged to main:

```
□ All CI checks green (test suite, lint, migration-check)
□ At least 1 reviewer approval (different from author)
□ No unresolved review comments
□ Branch up to date with main
□ Migration chain is forward-only (no db:down in PR diff)
□ MIGRATION_RESET_BLOCKED barrier not violated
□ OpenAPI spec updated if any route or schema changed
□ MIGRATION_MANIFEST updated if any new migration added
□ Receipt / ADR placed for P/Q-pack items
```

---

## 2. CI Gate Definition

### 2.1 Required checks (must pass before merge)

| Check | Command | Failure threshold |
|---|---|---|
| Unit + kernel tests | `node --test server/tests/` | Any failure |
| HTTP contract tests | `node --test server/tests/*http*` | Any failure |
| Migration chain check | `node server/runtime/migrate.mjs check` | Any gap or mismatch |
| Ledger digest check | Custom script (see §3.2) | Digest mismatch |
| OpenAPI lint | `node scripts/validate-openapi.mjs` | Any schema error |
| Dependency audit | `npm audit --audit-level=high` | High+ severity |

### 2.2 Recommended checks (non-blocking initially)

| Check | Command |
|---|---|
| SBOM generation | `cyclonedx-npm --output sbom.json` |
| CodeQL scan | GitHub Actions CodeQL |
| E2E offline scenarios | `REFS_OFFLINE_E2E=1 node --test server/tests/e2e-scenarios-p15.test.mjs` |

---

## 3. Migration Validation Gate

Before deploying any release, run:

```bash
# 1. Manifest digest check
node -e "
import('./server/runtime/migration-manifest.mjs').then(async m => {
  const {Pool} = (await import('./server/node_modules/pg/lib/index.js')).default;
  const pool = new Pool({connectionString: process.env.DATABASE_URL});
  const rows = (await pool.query('SELECT migration_name,checksum FROM refs_schema_migration ORDER BY migration_name')).rows;
  const {ledgerDigest, manifestDigest} = await import('./server/runtime/test-logical-restore-drill.mjs');
  const live = ledgerDigest(rows);
  const expected = manifestDigest(m.MIGRATION_MANIFEST);
  if(live !== expected) throw new Error('LEDGER DIGEST MISMATCH');
  console.log('✓ Ledger digest matches manifest');
  await pool.end();
});
"

# 2. Forward-only check — no db:down allowed in production
grep -r 'db:down\|migrateDown\|rollback_migration' server/runtime/migrations.mjs || echo "✓ No db:down in runner"

# 3. Chain head matches deployed version
EXPECTED_HEAD="433_outbox_health_read.sql"
node -e "
const m = require('./server/runtime/migration-manifest.mjs');
const head = m.MIGRATION_MANIFEST[m.MIGRATION_MANIFEST.length-1].name;
if(head !== process.argv[1]) throw new Error('HEAD MISMATCH: ' + head);
console.log('✓ Chain head verified: ' + head);
" "$EXPECTED_HEAD"
```

---

## 4. Four-Service Version Consistency

REFS runs four services that must be at the same commit SHA and migration chain:

| Service | Role | Version pin |
|---|---|---|
| `refs-api` | REST API + kernel | `REFS_VERSION` env var |
| `refs-migrator` | Migration runner (init container) | `REFS_VERSION` env var |
| `refs-scheduler` | Background jobs (outbox pump) | `REFS_VERSION` env var |
| `refs-static` | Frontend (React build) | `REFS_BUILD_SHA` embedded in HTML |

### Consistency check script

```bash
#!/bin/bash
# run-version-check.sh — compare all services to expected SHA
EXPECTED_SHA="${RELEASE_SHA:-$(git rev-parse HEAD)}"

for SVC in refs-api refs-migrator refs-scheduler refs-static; do
  SVC_SHA=$(curl -sf "https://${SVC}.internal/api/health" | jq -r '.build_sha // empty')
  if [ "$SVC_SHA" != "$EXPECTED_SHA" ]; then
    echo "FAIL: $SVC reports $SVC_SHA, expected $EXPECTED_SHA"
    exit 1
  fi
  echo "✓ $SVC: $SVC_SHA"
done
echo "All four services at $EXPECTED_SHA"
```

**Deployment is blocked if any service is on a different SHA.**

---

## 5. Canary Release Plan

### 5.1 Traffic split (recommended)

| Phase | Traffic to canary | Duration | Abort criterion |
|---|---|---|---|
| Canary 5% | 5% | 30 min | Error rate > 1%, p95 latency > 2s |
| Canary 20% | 20% | 2 h | Error rate > 0.5%, outbox FAILED |
| Full rollout | 100% | — | Monitor 24 h |

### 5.2 Canary health gates

Monitor during each phase:

```
□ HTTP 5xx rate < 0.1% (vs baseline)
□ p95 API latency < 500ms
□ outbox backlog_state not FAILED_EVENTS_PRESENT for > 5 min
□ refs_schema_migration row count matches MIGRATION_MANIFEST.length
□ No MIGRATION_COMPLETED events in canary logs (migrations must be idempotent noop at rollout time)
```

---

## 6. Rollback Prerequisites

Rollback is **only** valid if:

1. No new migration has been applied in the canary window. If migrations ran, rollback requires a full database restore — see P14 runbook §6.2.
2. The previous release artifact is available (tagged and accessible in the registry).
3. The outbox backlog has been drained to DRAINED state before rollback (or is being held in PENDING).
4. A rollback decision is made by at least one Owner (not the deploying engineer).

### Rollback procedure

```bash
# 1. Verify no new migration has been applied
PREV_COUNT=$(cat .release/migration_count_at_deploy)
LIVE_COUNT=$(psql -t -c "SELECT count(*) FROM refs_schema_migration")
if [ "$LIVE_COUNT" -gt "$PREV_COUNT" ]; then
  echo "STOP: $((LIVE_COUNT-PREV_COUNT)) new migrations applied — rollback requires DB restore"
  exit 1
fi

# 2. Switch traffic back to previous release
kubectl rollout undo deployment/refs-api deployment/refs-scheduler

# 3. Verify all four services back to previous SHA
./run-version-check.sh "$PREVIOUS_SHA"

# 4. Verify outbox not in FAILED state
curl -sf https://api.internal/api/v1/entities/$ENTITY_ID/ops/outbox-health | jq '.backlog_state'
```

---

## 7. Owner Sign-off Record Template

```markdown
# Release Sign-off: REFS v{VERSION}

Release SHA: {SHA}
Migration chain head: {MIGRATION_HEAD}
Release date: {DATE}
Deploying engineer: {NAME}

## Pre-deployment checklist

□ CI green (link: {CI_URL})
□ Ledger digest check passed
□ Four-service version consistent
□ Canary 5% → 20% → 100% completed without abort
□ P14 backup/PITR drills passed (date: {DRILL_DATE})
□ All P/Q-pack receipts accepted by Owner

## Owner approvals

| Name | Role | Approval date | Scope |
|---|---|---|---|
| {OWNER_1} | Tech Lead | {DATE} | Code review |
| {OWNER_2} | Product Owner | {DATE} | Business acceptance |
| {OWNER_3} | Security | {DATE} | Security review |

## Post-deployment verification

□ All four services at release SHA
□ No MIGRATION_COMPLETED events in first 10 min
□ Outbox backlog_state = DRAINED after 30 min
□ E2E smoke test passed (link: {SMOKE_TEST_RESULT})

## Incidents / issues

None / {description}

## Decision

☐ APPROVED for full rollout
☐ PARTIAL ROLLOUT — canary only, pending {condition}
☐ ROLLBACK REQUIRED — reason: {reason}

Signed: _________________ Date: _________
```

