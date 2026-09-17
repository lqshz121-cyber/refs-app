import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {OutboxDispatchWorker,outboxDispatchHealthResponse} from '../runtime/outbox-dispatch-worker.mjs';
import {outboxDispatchConfig} from '../runtime/start-outbox-dispatch-worker.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222';
const readiness=(checkedAt=new Date().toISOString())=>({schema_version:'OUTBOX_DISPATCH_READINESS_V1',ready:true,scope_count:1,pending_count:0,failed_count:0,oldest_pending_at:null,checked_at:checkedAt,scopes:[{tenant_id:tenantId,entity_id:entityId,grant_set_version:4,permission:'OUTBOX.DISPATCH',pending_count:0,failed_count:0,oldest_pending_at:null}]});
const never=()=>new Promise(()=>{});
const build=(service,options={})=>new OutboxDispatchWorker({service,principal:{trusted:true,actorId:'outbox-service'},scopes:[{tenantId,entityId}],readinessProbe:async()=>readiness(),intervalMs:10,maxBackoffMs:40,cycleTimeoutMs:120,stopTimeoutMs:120,logger:{error:()=>{},info:()=>{}},...options});

test('a claim/publish/completion that never settles fails the cycle on its deadline instead of pinning the worker',async()=>{
  const worker=build({runOnce:never});
  const started=Date.now();
  await assert.rejects(worker.runCycle(),error=>error.code==='OUTBOX_DISPATCH_CYCLE_TIMEOUT');
  const elapsed=Date.now()-started;
  assert.ok(elapsed>=100&&elapsed<5000,`cycle must fail near its 120ms deadline, took ${elapsed}ms`);
  assert.equal(worker.metrics.cycleTimeouts,1);
  assert.equal(worker.metrics.cycleErrors,1);
  assert.equal(worker.metrics.consecutiveErrors,1);
  assert.equal(worker.metrics.cycles,0);
  assert.equal(worker.metrics.lastSuccessAt,null);
  assert.equal(worker.health().ok,false);
  assert.equal(outboxDispatchHealthResponse(worker).status,503);
});

test('a readiness probe that never settles is also bounded by the cycle deadline',async()=>{
  const worker=build({runOnce:async()=>[]},{readinessProbe:never});
  await assert.rejects(worker.runCycle(),error=>error.code==='OUTBOX_DISPATCH_CYCLE_TIMEOUT');
  assert.equal(worker.metrics.cycleTimeouts,1);
});

test('the deadline only bounds the cycle: a healthy worker keeps publishing and never times out',async()=>{
  const worker=build({runOnce:async()=>[{status:'PUBLISHED'},{status:'PENDING'},{status:'FAILED'}]},{cycleTimeoutMs:60000});
  const results=await worker.runCycle();
  assert.equal(results.length,3);
  assert.deepEqual([worker.metrics.published,worker.metrics.retried,worker.metrics.deadLettered,worker.metrics.cycleTimeouts,worker.metrics.cycleErrors],[1,1,1,0,0]);
  assert.equal(worker.metrics.cycles,1);
  assert.equal(worker.metrics.consecutiveErrors,0);
  assert.notEqual(worker.metrics.lastSuccessAt,null);
});

test('a hung cycle backs off, and the loop recovers on the next healthy cycle',async()=>{
  let calls=0;const delays=[];
  const worker=build({runOnce:async(_principal,scope)=>{assert.deepEqual(scope.scopes,[{entityId,grantSetVersion:4}]);calls++;if(calls===1)return never();return [{status:'PUBLISHED'}];}},{
    sleeper:async ms=>{delays.push(ms);if(delays.length===2)worker.abort.abort();},
  });
  worker.start();
  await worker.loopPromise;
  assert.deepEqual(delays,[20,10],'a timed-out cycle backs off and a recovered cycle returns to the interval');
  assert.equal(worker.metrics.cycleTimeouts,1);
  assert.equal(worker.metrics.published,1);
  assert.equal(worker.metrics.consecutiveErrors,0);
  assert.equal(worker.health().running,false);
});

test('a permanently hung worker exits for the process supervisor instead of hanging forever',async()=>{
  const worker=build({runOnce:never},{maxConsecutiveErrors:2,sleeper:async()=>{}});
  await assert.rejects(worker.start(),error=>error.code==='OUTBOX_DISPATCH_UNHEALTHY'&&error.cause?.code==='OUTBOX_DISPATCH_CYCLE_TIMEOUT');
  assert.equal(worker.metrics.cycleTimeouts,2);
  assert.equal(worker.running,false);
});

test('stop() returns within its deadline when the cycle is hung, so shutdown never deadlocks',async()=>{
  const worker=build({runOnce:never},{cycleTimeoutMs:600000,sleeper:async()=>{}});
  worker.start();
  while(worker.metrics.lastCycleStartedAt===null)await new Promise(resolve=>setTimeout(resolve,1));
  const started=Date.now();
  await worker.stop();
  const elapsed=Date.now()-started;
  assert.ok(elapsed<5000,`stop must not wait for a hung cycle, took ${elapsed}ms`);
  assert.equal(worker.metrics.forcedStops,1);
  assert.equal(worker.health().running,false);
  assert.equal(worker.health().ok,false);
  assert.equal(outboxDispatchHealthResponse(worker).status,503);
});

test('stop() still drains and reports a graceful shutdown when the cycle is healthy',async()=>{
  let release;
  const worker=build({runOnce:async()=>[]},{cycleTimeoutMs:60000,sleeper:()=>new Promise(resolve=>{release=resolve;})});
  worker.start();
  while(worker.metrics.cycles===0)await new Promise(resolve=>setTimeout(resolve,1));
  release();
  await worker.stop();
  assert.equal(worker.metrics.forcedStops,0);
  assert.equal(worker.health().running,false);
});

test('an abandoned hung cycle that later fails does not raise an unhandled rejection',async()=>{
  const rejections=[];
  const listener=error=>rejections.push(error);
  process.on('unhandledRejection',listener);
  try{
    let failLate;
    const worker=build({runOnce:()=>new Promise((_,reject)=>{failLate=reject;})});
    await assert.rejects(worker.runCycle(),error=>error.code==='OUTBOX_DISPATCH_CYCLE_TIMEOUT');
    failLate(Object.assign(new Error('late claim failure'),{code:'OUTBOX_PUBLISH_RETRYABLE'}));
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.deepEqual(rejections,[]);
  }finally{process.off('unhandledRejection',listener);}
});

test('cycle and stop deadlines are validated and must never outlive the dispatch lease',()=>{
  for(const invalid of [0,99,3600001,1.5,'120',null])assert.throws(()=>build({runOnce:async()=>[]},{cycleTimeoutMs:invalid}),/Outbox worker limits are invalid/);
  for(const invalid of [0,99,600001,1.5,'120',null])assert.throws(()=>build({runOnce:async()=>[]},{stopTimeoutMs:invalid}),/Outbox worker limits are invalid/);
  const env={DATABASE_URL:'postgres://refs_runtime:runtime_password_0001@127.0.0.1:5432/refs',MIGRATION_DATABASE_URL:'postgres://refs_migrator:migrator_password_0001@127.0.0.1:5432/refs',CONTEXT_ISSUER_DATABASE_URL:'postgres://refs_context_issuer:issuer_password_0001@127.0.0.1:5432/refs',GRANT_SYNC_DATABASE_URL:'postgres://refs_grant_sync:grant_password_0001@127.0.0.1:5432/refs',OUTBOX_DISPATCH_ACTOR_ID:'outbox-service',OUTBOX_DISPATCH_SCOPES:JSON.stringify([{tenantId,entityId}]),OUTBOX_PUBLISH_URL:'https://events.example.test/v1/refs',OUTBOX_PUBLISH_TOKEN:'publisher-token-0001'};
  const defaults=outboxDispatchConfig(env);
  assert.ok(defaults.cycleTimeoutMs<=defaults.leaseSeconds*1000,'a cycle must never outlive the lease it holds');
  assert.equal(defaults.stopTimeoutMs>0,true);
  assert.throws(()=>outboxDispatchConfig({...env,OUTBOX_DISPATCH_LEASE_SECONDS:'30',OUTBOX_DISPATCH_CYCLE_TIMEOUT_MS:'60000'}),/OUTBOX_DISPATCH_CYCLE_TIMEOUT_MS/);
  assert.equal(outboxDispatchConfig({...env,OUTBOX_DISPATCH_LEASE_SECONDS:'30',OUTBOX_DISPATCH_CYCLE_TIMEOUT_MS:'20000'}).cycleTimeoutMs,20000);
  assert.throws(()=>outboxDispatchConfig({...env,OUTBOX_DISPATCH_STOP_TIMEOUT_MS:'0'}),/OUTBOX_DISPATCH_STOP_TIMEOUT_MS/);
});

test('the release blueprints and runbook carry the hang deadlines the worker now enforces',async()=>{
  for(const blueprint of ['../../render.yaml','../../render.integrations.yaml']){
    const source=await readFile(new URL(blueprint,import.meta.url),'utf8'),start=source.indexOf('name: refs-outbox-dispatch'),worker=source.slice(start,source.indexOf('\n  - type:',start+1));
    assert.match(worker,/OUTBOX_DISPATCH_CYCLE_TIMEOUT_MS/,`${blueprint} must pin the cycle deadline`);
    assert.match(worker,/OUTBOX_DISPATCH_STOP_TIMEOUT_MS/,`${blueprint} must pin the shutdown deadline`);
  }
  const runbook=await readFile(new URL('../OUTBOX-DISPATCH-RELEASE-RUNBOOK.md',import.meta.url),'utf8');
  assert.match(runbook,/OUTBOX_DISPATCH_CYCLE_TIMEOUT_MS/);
  assert.match(runbook,/OUTBOX_DISPATCH_STOP_TIMEOUT_MS/);
  assert.match(runbook,/lease/i);
});
