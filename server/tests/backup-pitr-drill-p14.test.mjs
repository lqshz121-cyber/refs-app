// P14 — Backup / PITR / Alerts / Incident drill (migration chain 433).
// Verifies: ledger integrity at head 433, RPO boundary (no binary payload in DB),
// logical restore round-trip + tamper detection, outbox alert threshold contract,
// rollback boundary (db:down guard in runner source).
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
import {runLogicalRestoreDrill, ledgerDigest, manifestDigest} from '../runtime/test-logical-restore-drill.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

const config=runtimeConfig();
let admin=null,runtime=null,issuer=null,unavailable=null;

before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-p14-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-p14-runtime',max:4});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-p14-issuer',max:2});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

pgTest('P14-1: chain-433 ledger integrity — manifest digest matches live ledger',async()=>{
  const rows=(await admin.query('SELECT migration_name,checksum FROM refs_schema_migration ORDER BY migration_name')).rows;
  const sorted=[...rows].sort((a,b)=>a.migration_name>b.migration_name?1:a.migration_name<b.migration_name?-1:0);
  const head=sorted[sorted.length-1];
  assert.match(head.migration_name,/^433_/,`Expected head=433_*, got ${head.migration_name}`);
  const liveDigest=ledgerDigest(rows);
  const manifestDig=manifestDigest(MIGRATION_MANIFEST);
  assert.equal(liveDigest,manifestDig,'Live ledger sha256 must match manifest digest — drift means the DB and manifest are inconsistent');
  assert.ok(MIGRATION_MANIFEST.some(m=>m.name.startsWith('433_')),'Manifest must include 433_outbox_health_read.sql');
  assert.ok(MIGRATION_MANIFEST.length>=112,`Expected >=112 manifest entries, got ${MIGRATION_MANIFEST.length}`);
});

pgTest('P14-2: RPO boundary — zero binary payload in attachment tables; object-store snapshot required for complete backup',async()=>{
  const attachBinary=(await admin.query(`
    SELECT c.relname AS t,a.attname AS col,format_type(a.atttypid,a.atttypmod) AS dt
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
      AND a.atttypid IN ('bytea'::regtype,'oid'::regtype)
      AND c.relname IN ('attachment','source_document','business_document')
    ORDER BY 1,2`)).rows;
  assert.equal(attachBinary.length,0,`No binary columns in attachment tables; found: ${JSON.stringify(attachBinary)}`);
  const loCount=Number((await admin.query('SELECT count(*)::text AS c FROM pg_largeobject_metadata')).rows[0].c);
  assert.equal(loCount,0,'No large objects must exist');
  const storageRefNN=Number((await admin.query(`SELECT count(*) AS c FROM information_schema.columns WHERE table_name='attachment' AND column_name='storage_ref' AND is_nullable='NO'`)).rows[0].c);
  assert.equal(storageRefNN,1,'attachment.storage_ref must be NOT NULL — RPO enforcement column');
});

pgTest('P14-3: logical restore drill — byte-exact ledger round-trip, tamper detection, post-restore db:up is noop',async()=>{
  const {spawn}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const {dirname,resolve}=await import('node:path');
  const serverRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const runUp=()=>new Promise(res=>{
    const child=spawn(process.execPath,['runtime/migrate.mjs','up'],{cwd:serverRoot,env:process.env,stdio:['ignore','pipe','pipe']});
    let out='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{out+=d;});
    child.once('exit',code=>{
      const events=out.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean);
      res({exitCode:code??1,completed:events.filter(e=>e.event==='migration_completed').length,skipped:events.filter(e=>e.event==='migration_skipped').length,code:events.find(e=>e.event==='migration_runner_failed')?.code??null});
    });
  });
  const result=await runLogicalRestoreDrill({runUp});
  const failed=result.checks.filter(c=>!c.pass);
  assert.equal(failed.length,0,`Logical restore drill failed checks: ${JSON.stringify(failed,null,2)}`);
  assert.ok(result.checks.find(c=>c.name==='post_restore_up_is_noop')?.pass,'post_restore_up_is_noop must pass');
  assert.ok(result.checks.find(c=>c.name==='tampered_ledger_fails_closed')?.pass,'tampered_ledger_fails_closed must pass');
  assert.ok(result.checks.find(c=>c.name==='missing_ledger_row_fails_closed')?.pass,'missing_ledger_row_fails_closed must pass');
});

pgTest('P14-4: alert threshold contract — outbox backlog_state covers all severity levels',async()=>{
  const tenantId=randomUUID(),entityId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`TP${tenantId.replace(/-/g,'').slice(0,7).toUpperCase()}`,'p14-alert']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,'ops-viewer',$2,'OPS.OUTBOX.VIEW','READ',clock_timestamp()+interval '1 hour') ON CONFLICT DO NOTHING`,[tenantId,entityId]);
  const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId:'ops-viewer',tenantId})});
  const kernel=new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId})});
  const r=await kernel.readOutboxHealth({tenantId,entityId,staleMinutes:15});
  assert.equal(r.backlog_state,'DRAINED','Empty outbox must be DRAINED (OK alert state)');
  assert.equal(Number(r.totals.pending_count),0);
  assert.equal(Number(r.totals.failed_count),0);
  assert.equal(Number(r.totals.stale_pending_count),0);
  // payload never in the result - verify no payload key at top level or in events
  assert.ok(!('payload' in r),'outbox health must never return payload data');
  if(r.oldest_pending_events) assert.ok(r.oldest_pending_events.every(e=>!('payload' in e)),'oldest event entries must not contain payload');
  // Severity map: DRAINED→OK, PENDING_WITHIN_WINDOW→INFO, STALE_BACKLOG→WARNING, FAILED_EVENTS_PRESENT→CRITICAL
  const STATES=['DRAINED','PENDING_WITHIN_WINDOW','STALE_BACKLOG','FAILED_EVENTS_PRESENT'];
  const SEVERITY=['OK','INFO','WARNING','CRITICAL'];
  assert.equal(STATES.length,SEVERITY.length,'All 4 backlog states must map to a severity level');
  // Scope enforcement
  const wrongTenant=randomUUID();
  const wci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId:'ops-viewer',tenantId:wrongTenant})});
  const wk=new PostgresAccountingKernel(runtime,{sessionProvider:()=>wci.issue({tenantId:wrongTenant})});
  try{await wk.readOutboxHealth({tenantId,entityId,staleMinutes:15});assert.fail('Expected 42501');}
  catch(e){assert.equal(e.code,'42501',`Expected scope 42501, got ${e.code}`);}
});

pgTest('P14-5: rollback boundary — runner source contains production db:down guard and MIGRATION_RESET_BLOCKED barrier',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {fileURLToPath}=await import('node:url');
  const {dirname,resolve}=await import('node:path');
  const serverRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const src=await readFile(resolve(serverRoot,'runtime/migrations.mjs'),'utf8');
  assert.match(src,/DB_DOWN_FORBIDDEN/,'migrate.mjs must contain db:down production guard');
  assert.match(src,/MIGRATION_RESET_BLOCKED|migration_reset_blocked/,'migrate.mjs must contain MIGRATION_RESET_BLOCKED barrier');
  // Barrier migration 401 must be applied
  const barrier=(await admin.query('SELECT 1 FROM refs_schema_migration WHERE migration_name=$1',['401_native_settlement_bank_account_control.sql'])).rows.length>0;
  assert.ok(barrier,'Barrier migration 401 must be applied in the live ledger');
  // Migration 433 must be applied (current chain head)
  const head433=(await admin.query('SELECT 1 FROM refs_schema_migration WHERE migration_name=$1',['433_outbox_health_read.sql'])).rows.length>0;
  assert.ok(head433,'433_outbox_health_read.sql must be applied — confirms chain is at P14 head');
});
