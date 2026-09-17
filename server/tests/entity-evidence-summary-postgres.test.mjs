// P0-F6 live contract: an entity with nothing imported reports NO_EVIDENCE_IMPORTED;
// a draft journal -> EVIDENCE_WITHOUT_POSTINGS; a posted one -> POSTED_EVIDENCE;
// no GL.REPORT.VIEW grant -> 42501; unknown period -> 22023. Read-only function.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
const config=runtimeConfig();
let admin=null,runtime=null,issuer=null,unavailable=null;
before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-evidence-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-evidence-runtime',max:4});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-evidence-issuer',max:2});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
async function grant(ids,actorId,permission){const a=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL`,[ids.tenantId,actorId,ids.entityId,permission,a]);}
const kernelFor=(ids,actorId)=>{const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});};
async function seed(){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),code='E'+randomUUID().slice(0,5).toUpperCase();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'evidence']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,'Evidence Co','USD')",[entityId,tenantId,code]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await grant({tenantId,entityId},'reader','GL.REPORT.VIEW');
  return {tenantId,entityId,periodId};
}
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}
pgTest('a freshly provisioned entity is NO_EVIDENCE_IMPORTED with all counts zero',async()=>{
  const ids=await seed();const r=await kernelFor(ids,'reader').readEntityEvidenceSummary(ids);
  assert.deepEqual(r,{schema_version:'ENTITY_EVIDENCE_SUMMARY_V1',entity_id:ids.entityId,period_id:ids.periodId,journal_count:0,posted_journal_count:0,raw_event_count:0,staging_item_count:0,source_document_count:0,last_raw_event_at:null,evidence_state:'NO_EVIDENCE_IMPORTED'});
});
pgTest('a draft journal is EVIDENCE_WITHOUT_POSTINGS and a posted journal is POSTED_EVIDENCE',async()=>{
  const ids=await seed();const je=randomUUID();
  await admin.query("INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by) VALUES($1,$2,$3,$4,'EV-1','MANUAL','DRAFT','2026-07-10','USD','evidence','maker')",[je,ids.tenantId,ids.entityId,ids.periodId]);
  let r=await kernelFor(ids,'reader').readEntityEvidenceSummary(ids);assert.equal(r.evidence_state,'EVIDENCE_WITHOUT_POSTINGS');assert.equal(r.journal_count,1);
  await admin.query('ALTER TABLE journal_entry DISABLE TRIGGER USER');
  try{await admin.query("UPDATE journal_entry SET status='POSTED',reviewed_by='reviewer',approved_by='approver',posted_by='poster',posted_at=clock_timestamp() WHERE journal_entry_id=$1",[je]);}finally{await admin.query('ALTER TABLE journal_entry ENABLE TRIGGER USER');}
  r=await kernelFor(ids,'reader').readEntityEvidenceSummary(ids);assert.equal(r.evidence_state,'POSTED_EVIDENCE');assert.equal(r.posted_journal_count,1);
});
pgTest('no GL.REPORT.VIEW -> 42501; unknown period -> 22023; the function is read-only (no write happened)',async()=>{
  const ids=await seed();
  await assert.rejects(kernelFor(ids,'nobody').readEntityEvidenceSummary(ids),e=>e.code==='42501');
  await assert.rejects(kernelFor(ids,'reader').readEntityEvidenceSummary({...ids,periodId:randomUUID()}),e=>e.code==='22023');
  await kernelFor(ids,'reader').readEntityEvidenceSummary(ids);
  const types=(await admin.query('SELECT DISTINCT event_type FROM audit_event WHERE tenant_id=$1 ORDER BY 1',[ids.tenantId])).rows.map(r=>r.event_type);
  // context issuance / access-denial auditing is the session layer's business; the read itself must not add an evidence-summary event or any outbox row
  assert.ok(types.every(t=>!/EVIDENCE_SUMMARY/.test(t)),types.join(','));
  assert.equal((await admin.query('SELECT count(*)::int n FROM outbox_event WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,0);
});
