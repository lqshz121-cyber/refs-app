// P10 — the dispatch backlog is now observable (migration 433). Counts, ages, attempts and a
// backlog_state, scoped by OPS.OUTBOX.VIEW, with payloads never leaving the database.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

const config=runtimeConfig();
let admin=null,runtime=null,issuer=null,unavailable=null;
const hash=v=>`sha256:${createHash('sha256').update(String(v)).digest('hex')}`;

before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-p10-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-p10-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-p10-issuer',max:2});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});

async function grant(ids,actorId,permission){
  const a=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL,authority_class=EXCLUDED.authority_class,valid_until=EXCLUDED.valid_until`,[ids.tenantId,actorId,ids.entityId,permission,a]);
}
const kernelFor=(ids,actorId)=>{
  const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});
  return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});
};
const rejects=async(fn,code)=>{try{await fn();assert.fail('expected rejection '+code);}catch(e){assert.equal(e.code,code,e.message);}};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

async function seed(tag){
  const tenantId=randomUUID(),entityId=randomUUID(),otherEntityId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),`p10-${tag}`]);
  for(const [id,code] of [[entityId,'E1'],[otherEntityId,'E2']])
    await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,$3,'USD')",[id,tenantId,code]);
  const ids={tenantId,entityId,otherEntityId};
  await grant(ids,'ops','OPS.OUTBOX.VIEW');await grant(ids,'stranger','GL.REPORT.VIEW');
  return ids;
}
const emit=(ids,{entityId=ids.entityId,type='JOURNAL_POSTED',status='PENDING',attempts=0,ageMinutes=0,availableInMinutes=0,error=null,secret='x'}={})=>
  admin.query(`INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash,status,attempt_count,available_at,published_at,last_error,created_at)
    VALUES($1,$2,'JOURNAL_ENTRY',$3,$4,$5::jsonb,$6,$7::outbox_status,$8,clock_timestamp()+make_interval(mins=>$9),CASE WHEN $7::text='PUBLISHED' THEN clock_timestamp() END,$10,clock_timestamp()-make_interval(mins=>$11))`,
    [ids.tenantId,entityId,randomUUID(),type,JSON.stringify({secret_business_detail:secret}),hash(randomUUID()),status,attempts,availableInMinutes,error,ageMinutes]);
const health=(ids,args={})=>kernelFor(ids,'ops').readOutboxHealth({tenantId:ids.tenantId,entityId:ids.entityId,...args});

pgTest('P10-1: backlog counts, ages, attempts and state, scoped per company',async()=>{
  const ids=await seed('counts');
  const drained=await health(ids);
  assert.equal(drained.schema_version,'OUTBOX_HEALTH_V1');assert.equal(drained.can_dispatch,false);assert.equal(drained.can_delete,false);
  assert.equal(drained.backlog_state,'DRAINED');assert.equal(Number(drained.totals.pending_count),0);
  assert.deepEqual(drained.by_event_type,[]);assert.deepEqual(drained.oldest_unpublished,[]);

  await emit(ids,{ageMinutes:0});                                   // fresh pending, due now
  await emit(ids,{ageMinutes:120,attempts:3,error:'consumer 404'}); // stale, retried
  await emit(ids,{availableInMinutes:30});                          // deferred by backoff
  await emit(ids,{status:'PUBLISHED',type:'AP_BILL_POSTED'});
  await emit(ids,{entityId:ids.otherEntityId,ageMinutes:500});      // another company: must not leak

  const h=await health(ids);
  assert.equal(Number(h.totals.pending_count),3);
  assert.equal(Number(h.totals.published_count),1);
  assert.equal(Number(h.totals.due_now_count),2);
  assert.equal(Number(h.totals.deferred_count),1);
  assert.equal(Number(h.totals.stale_pending_count),1,'only the two-hour-old event is stale at the 15 minute default');
  assert.equal(Number(h.totals.retried_count),1);
  assert.equal(h.totals.max_attempt_count,3);
  assert.equal(Number(h.totals.errored_count),1);
  assert.ok(Number(h.totals.oldest_pending_age_seconds)>=7000,'oldest pending age reflects the two-hour-old event');
  assert.equal(h.backlog_state,'STALE_BACKLOG');
  // the other company's 500-minute-old event did not move this company's numbers
  const other=await kernelFor(ids,'ops').readOutboxHealth({tenantId:ids.tenantId,entityId:ids.otherEntityId}).catch(e=>e);
  assert.equal(other.code,'42501','the grant is per company');

  // widening the window reclassifies the same rows without changing them
  const wide=await health(ids,{staleMinutes:240});
  assert.equal(Number(wide.totals.stale_pending_count),0);assert.equal(wide.backlog_state,'PENDING_WITHIN_WINDOW');
  await rejects(()=>health(ids,{staleMinutes:0}),'22023');
  await rejects(()=>health(ids,{staleMinutes:99999}),'22023');
  await rejects(()=>kernelFor(ids,'stranger').readOutboxHealth({tenantId:ids.tenantId,entityId:ids.entityId}),'42501');
});

pgTest('P10-2: per-event-type breakdown, FAILED state, and payloads never leave the database',async()=>{
  const ids=await seed('detail');
  await emit(ids,{type:'JOURNAL_POSTED',ageMinutes:60,secret:'journal payload body'});
  await emit(ids,{type:'JOURNAL_POSTED',ageMinutes:30,attempts:2});
  await emit(ids,{type:'AP_BILL_POSTED',status:'FAILED',attempts:8,error:'dead letter: max attempts exhausted',secret:'bill payload body'});
  await emit(ids,{type:'AP_BILL_POSTED',status:'PUBLISHED'});

  const h=await health(ids);
  assert.equal(h.backlog_state,'FAILED_EVENTS_PRESENT','a dead-lettered event dominates the summary');
  assert.equal(Number(h.totals.failed_count),1);
  const byType=Object.fromEntries(h.by_event_type.map(t=>[t.event_type,t]));
  assert.equal(Number(byType.JOURNAL_POSTED.pending_count),2);
  assert.equal(byType.JOURNAL_POSTED.max_attempt_count,2);
  assert.equal(Number(byType.AP_BILL_POSTED.failed_count),1);
  assert.equal(byType.AP_BILL_POSTED.max_attempt_count,8);
  assert.ok(!('AP_BILL_POSTED' in byType)||Number(byType.AP_BILL_POSTED.pending_count)===0,'published events are not counted as pending');
  assert.equal(h.by_event_type[0].event_type,'JOURNAL_POSTED','the biggest backlog sorts first');

  assert.equal(h.oldest_unpublished.length,3,'published events are excluded from the detail list');
  assert.equal(h.oldest_unpublished[0].event_type,'JOURNAL_POSTED');
  for(const row of h.oldest_unpublished){
    assert.match(row.payload_hash,/^sha256:[0-9a-f]{64}$/);
    assert.ok(!('payload' in row),'the payload is never returned');
  }
  const failed=h.oldest_unpublished.find(r=>r.status==='FAILED');
  assert.equal(failed.attempt_count,8);assert.match(failed.last_error,/dead letter/);
  const serialised=JSON.stringify(h);
  assert.ok(!serialised.includes('journal payload body')&&!serialised.includes('bill payload body'),'no business payload appears anywhere in the response');

  // the read is side-effect free: it neither dispatches nor mutates the queue
  const before=(await admin.query('SELECT status,attempt_count,available_at FROM outbox_event WHERE tenant_id=$1 ORDER BY created_at',[ids.tenantId])).rows;
  await health(ids);
  const after=(await admin.query('SELECT status,attempt_count,available_at FROM outbox_event WHERE tenant_id=$1 ORDER BY created_at',[ids.tenantId])).rows;
  assert.deepEqual(after,before);
});
