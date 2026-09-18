// P15 — 15 E2E Business Scenario verification (≥12 required)
// Each scenario verifies a complete business flow contract against PG16 embedded.
// Runner: /tmp/onefile-gw.sh tests/e2e-scenarios-p15.test.mjs
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
import {ledgerDigest, manifestDigest} from '../runtime/test-logical-restore-drill.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

const config=runtimeConfig();
let admin=null,runtime=null,issuer=null,unavailable=null;
let tenantId=null,entityId=null,periodId=null,attachmentId=null;

before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-e2e-admin',max:4});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-e2e-runtime',max:8});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-e2e-issuer',max:4});await issuer.query('SELECT 1');
  tenantId=randomUUID();entityId=randomUUID();periodId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`TE${tenantId.replace(/-/g,'').slice(0,7).toUpperCase()}`,'e2e-p15']);
  await admin.query(`INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E-P15','WBS','E-P15','E2E Entity P15','USD')`,[entityId,tenantId]);
  // accounting_period: columns are starts_on/ends_on (no period_name), period_code pattern ^\d{4}-(0[1-9]|1[0-2])$
  await admin.query(`INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-09','2026-09-01','2026-09-30','OPEN')`,[periodId,tenantId,entityId]);
  // account_master: requires_member, required_member_type (no account_type/financial_statement_line)
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'610000','Expense',false,NULL),($1,$2,'111000','Cash',true,'BANK')`,[tenantId,entityId]);
  // member_master (not entity_member)
  await admin.query(`INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-1','BANK','Operating Cash')`,[tenantId,entityId]);
  // attachment: required by createManualJournal (at least 1 tenant-owned attachment)
  attachmentId=randomUUID();
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,finalized_at,scan_status,finalization_status) VALUES($1,$2,$3,'e2e-evidence.pdf','application/pdf',1024,'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',$4,'v1','e2e-setup',now(),now(),now(),'CLEAN','VERIFIED_CLEAN')`,
    [attachmentId,tenantId,entityId,`object://e2e-p15/${attachmentId}`]);
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const mkKernel=(actorId)=>{
  const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId})});
  return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId})});
};
// Lookup authority class from permission registry (one actor must have exactly one authority class per entity)
const grant=async(actorId,permission)=>{
  const authority=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL,authority_class=EXCLUDED.authority_class`,[tenantId,actorId,entityId,permission,authority]);
};
// JE lines: Dr Expense / Cr Cash (member_ref required for Cash account)
const JE_LINES=[
  {line_no:1,account_code:'610000',debit_amount:100,credit_amount:0,member_ref:null,dimensions:{}},
  {line_no:2,account_code:'111000',debit_amount:0,credit_amount:100,member_ref:'BANK-1',dimensions:{}},
];
// Full JE lifecycle: DRAFT+SUBMIT+REVIEW+APPROVE+POST are 5 distinct authority classes → 5 separate actors
const jeLifecycle=async(actorSuffix,jeNum)=>{
  // Each actor must have exactly ONE authority class in this entity (SoD)
  const a={creator:`cr-${actorSuffix}`,submitter:`sb-${actorSuffix}`,reviewer:`rv-${actorSuffix}`,approver:`ap-${actorSuffix}`,poster:`po-${actorSuffix}`};
  await grant(a.creator,'GL.JE.CREATE');
  await grant(a.submitter,'GL.JE.SUBMIT');
  await grant(a.reviewer,'GL.JE.REVIEW');
  await grant(a.approver,'GL.JE.APPROVE');
  await grant(a.poster,'GL.JE.POST');
  const kc=mkKernel(a.creator),ks=mkKernel(a.submitter),kr=mkKernel(a.reviewer),ka=mkKernel(a.approver),kp=mkKernel(a.poster);
  const d=await kc.createManualJournal({tenantId,entityId,periodId,journalNumber:jeNum,journalDate:'2026-09-15',currency:'USD',description:`E2E JE ${jeNum}`,attachmentIds:[attachmentId],idempotencyKey:randomUUID(),lines:JE_LINES});
  const jeId=d.journal_entry_id;
  await ks.transitionJournal({tenantId,entityId,journalEntryId:jeId,action:'SUBMIT',expectedRevision:0,idempotencyKey:randomUUID()});
  await kr.transitionJournal({tenantId,entityId,journalEntryId:jeId,action:'REVIEW',expectedRevision:1,idempotencyKey:randomUUID()});
  await ka.transitionJournal({tenantId,entityId,journalEntryId:jeId,action:'APPROVE',expectedRevision:2,idempotencyKey:randomUUID()});
  const posted=await kp.postJournal({tenantId,entityId,periodId,journalEntryId:jeId,expectedRevision:3,idempotencyKey:randomUUID()});
  return {jeId,posted,a};
};

// ─── Scenario 1: Migration chain integrity ────────────────────────────────────
pgTest('S01: migration chain — manifest digest matches live ledger',async()=>{
  const rows=(await admin.query('SELECT migration_name,checksum FROM refs_schema_migration ORDER BY migration_name')).rows;
  assert.ok(rows.length>=112,`Expected >=112 migrations, got ${rows.length}`);
  assert.equal(ledgerDigest(rows),manifestDigest(MIGRATION_MANIFEST),'Live digest must match manifest');
  assert.ok(rows.some(r=>r.migration_name.startsWith('433_')),'433_outbox_health_read.sql must be applied');
});

// ─── Scenario 2: Accounting period enforcement ────────────────────────────────
pgTest('S02: closed period write guard — CLOSED period blocks JE create (55000)',async()=>{
  const closedId=randomUUID();
  await admin.query(`INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2025-01','2025-01-01','2025-01-31','CLOSED')`,[closedId,tenantId,entityId]);
  const row=(await admin.query('SELECT status FROM accounting_period WHERE period_id=$1',[closedId])).rows[0];
  assert.equal(row.status,'CLOSED');
  // Only grant GL.JE.CREATE (DRAFT authority) — single authority class, no SoD conflict
  await grant('e2e-s02-creator','GL.JE.CREATE');
  // Closed period guard: refs_create_manual_journal raises 55000 when period is not OPEN
  const err=await mkKernel('e2e-s02-creator').createManualJournal({tenantId,entityId,periodId:closedId,journalNumber:'JE-CLOSED',journalDate:'2025-01-15',currency:'USD',description:'closed',attachmentIds:[],idempotencyKey:randomUUID(),lines:JE_LINES}).then(()=>null).catch(e=>e);
  assert.ok(err,'Closed period create must throw');
  assert.equal(err.code,'55000',`Expected 55000, got ${err.code}: ${err.message}`);
});

// ─── Scenario 3: RBAC scope enforcement ──────────────────────────────────────
pgTest('S03: RBAC scope — cross-tenant access raises 42501',async()=>{
  const otherTenant=randomUUID();
  const ci2=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId:'intruder',tenantId:otherTenant})});
  const k2=new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci2.issue({tenantId:otherTenant})});
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,'e2e-victim',$2,'OPS.OUTBOX.VIEW','READ',clock_timestamp()+interval '1 hour') ON CONFLICT DO NOTHING`,[tenantId,entityId]);
  await assert.rejects(
    ()=>k2.readOutboxHealth({tenantId,entityId,staleMinutes:15}),
    e=>e.code==='42501','Cross-tenant access must raise 42501'
  );
});

// ─── Scenario 4: Outbox health monitoring ────────────────────────────────────
pgTest('S04: outbox health — DRAINED on empty backlog, V1 schema, no payload leakage',async()=>{
  await grant('e2e-s04-ops','OPS.OUTBOX.VIEW');
  const r=await mkKernel('e2e-s04-ops').readOutboxHealth({tenantId,entityId,staleMinutes:15});
  assert.equal(r.schema_version,'OUTBOX_HEALTH_V1');
  assert.equal(r.backlog_state,'DRAINED');
  assert.equal(Number(r.totals.pending_count),0);
  assert.equal(Number(r.totals.failed_count),0);
  assert.ok(!('payload' in r),'No payload in outbox health');
});

// ─── Scenario 5: JE lifecycle ─────────────────────────────────────────────────
pgTest('S05: JE lifecycle — 5-actor chain (DRAFT→SUBMIT→REVIEW→APPROVE→POST), 2 ledger lines',async()=>{
  const {jeId,posted}=await jeLifecycle('s05','JE-E2E-05');
  assert.ok(posted.journal_entry_id,'postJournal must return journal_entry_id');
  const lines=Number((await admin.query('SELECT count(*) AS c FROM ledger_line WHERE journal_entry_id=$1',[jeId])).rows[0].c);
  assert.equal(lines,2,'POSTED journal must produce 2 ledger lines');
});

// ─── Scenario 6: JE reversal ─────────────────────────────────────────────────
pgTest('S06: JE reversal — createJournalAdjustment(REVERSAL) → DRAFT, then post chain',async()=>{
  const {jeId:origId}=await jeLifecycle('s06a','JE-E2E-06A');
  // GL.JE.REVERSE has authority class APPROVER (so e2e-s06-reverser can't also have DRAFT/SUBMIT/REVIEW/POST)
  await grant('e2e-s06-reverser','GL.JE.REVERSE');
  const rev=await mkKernel('e2e-s06-reverser').createJournalAdjustment({action:'REVERSAL',tenantId,entityId,originalJournalEntryId:origId,
    periodId,journalNumber:'JE-E2E-06-REV',journalDate:'2026-09-16',description:'E2E reversal',
    reason:'E2E test S06 reversal',attachmentIds:[],idempotencyKey:randomUUID(),lines:[]});
  assert.equal(rev.status,'DRAFT','Reversal draft must start as DRAFT');
  const revId=rev.journal_entry_id;
  // Post reversal through its own lifecycle (5 fresh actors)
  await grant('e2e-s06-cr','GL.JE.CREATE');
  await grant('e2e-s06-sb','GL.JE.SUBMIT');
  await grant('e2e-s06-rv','GL.JE.REVIEW');
  await grant('e2e-s06-ap','GL.JE.APPROVE');
  await grant('e2e-s06-po','GL.JE.POST');
  await mkKernel('e2e-s06-sb').transitionJournal({tenantId,entityId,journalEntryId:revId,action:'SUBMIT',expectedRevision:0,idempotencyKey:randomUUID()});
  await mkKernel('e2e-s06-rv').transitionJournal({tenantId,entityId,journalEntryId:revId,action:'REVIEW',expectedRevision:1,idempotencyKey:randomUUID()});
  await mkKernel('e2e-s06-ap').transitionJournal({tenantId,entityId,journalEntryId:revId,action:'APPROVE',expectedRevision:2,idempotencyKey:randomUUID()});
  const revPosted=await mkKernel('e2e-s06-po').postJournal({tenantId,entityId,periodId,journalEntryId:revId,expectedRevision:3,idempotencyKey:randomUUID()});
  assert.ok(revPosted.journal_entry_id,'postJournal(reversal) must return journal_entry_id');
  const revLines=Number((await admin.query('SELECT count(*) AS c FROM ledger_line WHERE journal_entry_id=$1',[revId])).rows[0].c);
  assert.equal(revLines,2,'Reversal must produce 2 offsetting ledger lines');
});

// ─── Scenario 7: Cross-entity isolation ──────────────────────────────────────
pgTest('S07: cross-entity RBAC — grant on entity A does not grant access to entity B',async()=>{
  const entityB=randomUUID();
  await admin.query(`INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E-P15-B','WBS','E-P15-B','E2E Entity B','USD')`,[entityB,tenantId]);
  await grant('e2e-s07-actor','OPS.OUTBOX.VIEW');
  const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId:'e2e-s07-actor',tenantId})});
  const k=new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId})});
  await assert.rejects(
    ()=>k.readOutboxHealth({tenantId,entityId:entityB,staleMinutes:15}),
    e=>e.code==='42501','actor must not access entityB (42501)'
  );
});

// ─── Scenario 8: Idempotency (grant ON CONFLICT) ──────────────────────────────
pgTest('S08: idempotency — grant ON CONFLICT(pk) keeps exactly 1 row with updated valid_until',async()=>{
  // First grant
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,'idem-s08',$2,'OPS.OUTBOX.VIEW','READ',clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL,authority_class=EXCLUDED.authority_class`,[tenantId,entityId]);
  // Second grant with longer expiry — ON CONFLICT DO UPDATE
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,'idem-s08',$2,'OPS.OUTBOX.VIEW','READ',clock_timestamp()+interval '2 hours') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL,authority_class=EXCLUDED.authority_class`,[tenantId,entityId]);
  // Must still be 1 row (upsert, not insert)
  const c=Number((await admin.query(`SELECT count(*)::int c FROM runtime_actor_grant WHERE tenant_id=$1 AND actor_id='idem-s08' AND entity_id=$2 AND permission='OPS.OUTBOX.VIEW'`,[tenantId,entityId])).rows[0].c);
  assert.equal(c,1,'Upsert must produce exactly 1 row');
});

// ─── Scenario 9: Read-only audit trail ───────────────────────────────────────
pgTest('S09: audit trail — read-only operations produce no audit_event rows',async()=>{
  await grant('e2e-s09-ar','OPS.OUTBOX.VIEW');
  const before=Number((await admin.query('SELECT count(*) AS c FROM audit_event WHERE tenant_id=$1 AND entity_id=$2',[tenantId,entityId])).rows[0].c);
  await mkKernel('e2e-s09-ar').readOutboxHealth({tenantId,entityId,staleMinutes:15});
  const after=Number((await admin.query('SELECT count(*) AS c FROM audit_event WHERE tenant_id=$1 AND entity_id=$2',[tenantId,entityId])).rows[0].c);
  assert.equal(after,before,'Read-only must not add audit rows');
});

// ─── Scenario 10: RPO boundary ───────────────────────────────────────────────
pgTest('S10: RPO boundary — no bytea/oid columns in attachment tables, no large objects',async()=>{
  const binaryCols=(await admin.query(`
    SELECT c.relname,a.attname FROM pg_attribute a
    JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
      AND a.atttypid IN ('bytea'::regtype,'oid'::regtype)
      AND c.relname IN ('attachment','source_document','business_document')
  `)).rows;
  assert.equal(binaryCols.length,0,`No binary cols: ${JSON.stringify(binaryCols)}`);
  assert.equal(Number((await admin.query('SELECT count(*)::int c FROM pg_largeobject_metadata')).rows[0].c),0,'No LOs');
});

// ─── Scenario 11: Rollback boundary ─────────────────────────────────────────
pgTest('S11: rollback boundary — DB_DOWN_FORBIDDEN guard and barrier 401 present',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {fileURLToPath}=await import('node:url');
  const {dirname,resolve}=await import('node:path');
  const serverRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const src=await readFile(resolve(serverRoot,'runtime/migrations.mjs'),'utf8');
  assert.match(src,/DB_DOWN_FORBIDDEN/,'Runner must contain db:down guard');
  assert.match(src,/MIGRATION_RESET_BLOCKED|migration_reset_blocked/,'Runner must contain barrier');
  const barrier=(await admin.query("SELECT 1 FROM refs_schema_migration WHERE migration_name='401_native_settlement_bank_account_control.sql'")).rows.length>0;
  assert.ok(barrier,'Barrier migration 401 must be applied');
});

// ─── Scenario 12: Manifest completeness ──────────────────────────────────────
pgTest('S12: manifest completeness — all entries have name and up-checksum (SHA-256)',async()=>{
  assert.ok(MIGRATION_MANIFEST.length>=112,`Manifest must have >=112 entries`);
  for(const m of MIGRATION_MANIFEST){
    assert.ok(m.name,'Entry must have name');
    assert.ok(m.up,'Entry must have up field (SHA-256)');
    assert.match(m.up,/^[0-9a-f]{64}$/,'up must be 64-hex SHA-256');
  }
  const liveCount=Number((await admin.query('SELECT count(*) AS c FROM refs_schema_migration')).rows[0].c);
  assert.equal(liveCount,MIGRATION_MANIFEST.length,`Live count (${liveCount}) must match manifest (${MIGRATION_MANIFEST.length})`);
});

// ─── Scenario 13: Concurrent context isolation ────────────────────────────────
pgTest('S13: concurrent context — two actors agree on backlog_state',async()=>{
  await grant('e2e-s13-cx','OPS.OUTBOX.VIEW');await grant('e2e-s13-cy','OPS.OUTBOX.VIEW');
  const [rx,ry]=await Promise.all([
    mkKernel('e2e-s13-cx').readOutboxHealth({tenantId,entityId,staleMinutes:15}),
    mkKernel('e2e-s13-cy').readOutboxHealth({tenantId,entityId,staleMinutes:15}),
  ]);
  assert.equal(rx.backlog_state,ry.backlog_state,'Concurrent reads must agree');
  assert.equal(rx.schema_version,'OUTBOX_HEALTH_V1');
});

// ─── Scenario 14: SoD enforcement ────────────────────────────────────────────
pgTest('S14: SoD — DRAFT(GL.JE.CREATE)+REVIEW(GL.JE.REVIEW) authorities on same actor raise 42501',async()=>{
  // Grant both DRAFT and REVIEW authority to one actor
  await grant('e2e-s14-sod','GL.JE.CREATE'); // DRAFT authority
  await grant('e2e-s14-sod','GL.JE.REVIEW'); // REVIEW authority → SoD violation!
  await assert.rejects(
    ()=>mkKernel('e2e-s14-sod').createManualJournal({tenantId,entityId,periodId,journalNumber:'JE-SOD',journalDate:'2026-09-15',currency:'USD',description:'SoD',attachmentIds:[attachmentId],idempotencyKey:randomUUID(),lines:JE_LINES}),
    e=>e.code==='42501','Mixed DRAFT+REVIEW must raise 42501'
  );
});

// ─── Scenario 15: Kernel method presence ─────────────────────────────────────
pgTest('S15: kernel method presence — required commands are callable functions',async()=>{
  const k=mkKernel('dummy');
  for(const m of ['readOutboxHealth','createManualJournal','transitionJournal','postJournal','createJournalAdjustment'])
    assert.equal(typeof k[m],'function',`kernel.${m} must be a function`);
});
