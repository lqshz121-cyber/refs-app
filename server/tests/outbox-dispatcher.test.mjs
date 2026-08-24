import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpOutboxPublisher,OutboxDispatchService,validateClaimedOutboxEvent} from '../runtime/outbox-dispatcher.mjs';
import {OutboxDispatchWorker} from '../runtime/outbox-dispatch-worker.mjs';
import {outboxDispatchConfig} from '../runtime/start-outbox-dispatch-worker.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',eventId='33333333-3333-4333-8333-333333333333',aggregateId='44444444-4444-4444-8444-444444444444';
const row=(overrides={})=>({aggregate_id:aggregateId,aggregate_type:'JOURNAL_ENTRY',attempt_count:1,available_at:new Date('2026-08-24T00:00:00.000Z'),created_at:new Date('2026-08-24T00:00:00.000Z'),entity_id:entityId,event_type:'JOURNAL_POSTED',last_error:null,locked_at:new Date('2026-08-24T00:00:01.000Z'),locked_by:'outbox-service',outbox_event_id:eventId,payload:{journal_entry_id:aggregateId},payload_hash:`sha256:${'a'.repeat(64)}`,published_at:null,status:'PENDING',tenant_id:tenantId,...overrides});
const completion=(status='PUBLISHED')=>({schema_version:'OUTBOX_DISPATCH_COMPLETION_V1',outbox_event_id:eventId,status,attempt_count:1,retry_scheduled:status==='PENDING',available_at:'2026-08-24T00:00:05.000Z'});

test('claimed event contract is closed, exact-scope, and never accepts a published or unlocked row',()=>{
  const event=validateClaimedOutboxEvent(row(),{tenantId});assert.equal(event.schema_version,'REFS_OUTBOX_EVENT_V1');assert.equal(event.created_at,'2026-08-24T00:00:00.000Z');
  assert.throws(()=>validateClaimedOutboxEvent(row({authorization:'Bearer secret'}),{tenantId}),error=>error.code==='OUTBOX_EVENT_CONTRACT_INVALID');
  assert.throws(()=>validateClaimedOutboxEvent(row({payload:{access_token:'Bearer abcdefghijklmnop'}}),{tenantId}),error=>error.code==='OUTBOX_EVENT_SECRET_DENIED');
  assert.throws(()=>validateClaimedOutboxEvent(row({tenant_id:entityId}),{tenantId}),error=>error.code==='OUTBOX_EVENT_SCOPE_INVALID');
  assert.throws(()=>validateClaimedOutboxEvent(row({status:'PUBLISHED',published_at:new Date()}),{tenantId}),error=>error.code==='OUTBOX_EVENT_STATE_INVALID');
});

test('HTTP publisher sends one idempotent closed envelope and requires an exact no-store receipt',async()=>{
  let request;const publisher=new HttpOutboxPublisher({endpoint:'https://events.example.test/v1/refs',token:'publisher-token-0001',fetcher:async(url,init)=>{request={url,init};return new Response(JSON.stringify({accepted:true,outbox_event_id:eventId,payload_hash:`sha256:${'a'.repeat(64)}`,schema_version:'REFS_OUTBOX_PUBLISH_RECEIPT_V1'}),{status:202,headers:{'cache-control':'private, no-store','content-type':'application/json'}});},nodeEnv:'production'}),event=validateClaimedOutboxEvent(row(),{tenantId}),receipt=await publisher.publish(event);
  assert.equal(receipt.accepted,true);assert.equal(request.init.headers['idempotency-key'],eventId);assert.equal(request.init.headers['x-refs-payload-hash'],event.payload_hash);assert.equal(JSON.parse(request.init.body).tenant_id,tenantId);assert.equal(request.init.redirect,'error');
  const bad=new HttpOutboxPublisher({endpoint:'https://events.example.test/v1/refs',token:'publisher-token-0001',fetcher:async()=>new Response(JSON.stringify({...receipt,outbox_event_id:aggregateId}),{status:200,headers:{'cache-control':'no-store','content-type':'application/json'}}),nodeEnv:'production'});await assert.rejects(bad.publish(event),error=>error.code==='OUTBOX_PUBLISH_RECEIPT_INVALID');
  assert.throws(()=>new HttpOutboxPublisher({endpoint:'http://events.example.test',token:'publisher-token-0001',nodeEnv:'production'}),error=>error.code==='OUTBOX_PUBLISHER_CONFIG_INVALID');
});

test('malformed claimed payload is terminally sealed and never reaches the publisher',async()=>{let published=0;const completions=[],kernel={claimOutboxV2:async()=>[row({payload:{client_secret:'hidden'}})],completeOutboxV2:async args=>{completions.push(args);return completion('FAILED');}},service=new OutboxDispatchService({kernelFactory:async()=>kernel,publisher:{publish:async()=>{published++;}}}),result=await service.runOnce({trusted:true,actorId:'outbox-service'},{tenantId});assert.equal(published,0);assert.equal(result[0].status,'FAILED');assert.equal(completions[0].retryable,false);assert.equal(completions[0].errorCode,'OUTBOX_EVENT_SECRET_DENIED');});

test('service publishes, then seals the exact claim without exposing payload in results',async()=>{
  const calls=[],kernel={claimOutboxV2:async args=>{calls.push(['claim',args]);return [row()];},completeOutboxV2:async args=>{calls.push(['complete',args]);return completion();}},service=new OutboxDispatchService({kernelFactory:async()=>kernel,publisher:{publish:async()=>({accepted:true})}}),result=await service.runOnce({trusted:true,actorId:'outbox-service'},{tenantId,limit:10});
  assert.equal(result[0].status,'PUBLISHED');assert.equal(calls[0][1].leaseSeconds,300);assert.deepEqual(calls[1][1],{tenantId,eventId,success:true,maxAttempts:8,retryBaseSeconds:5});assert.equal(JSON.stringify(result).includes('journal_entry_id'),false);
});

test('retryable transport failure schedules retry while terminal receipt failure dead-letters',async()=>{
  for(const [retryable,status] of [[true,'PENDING'],[false,'FAILED']]){const completions=[],kernel={claimOutboxV2:async()=>[row()],completeOutboxV2:async args=>{completions.push(args);return completion(status);}},publisher={publish:async()=>{throw Object.assign(new Error('redacted'),{code:retryable?'OUTBOX_PUBLISH_RETRYABLE':'OUTBOX_PUBLISH_REJECTED',retryable});}},service=new OutboxDispatchService({kernelFactory:async()=>kernel,publisher});const result=await service.runOnce({trusted:true,actorId:'outbox-service'},{tenantId});assert.equal(result[0].status,status);assert.equal(completions[0].retryable,retryable);assert.equal(completions[0].errorCode,retryable?'OUTBOX_PUBLISH_RETRYABLE':'OUTBOX_PUBLISH_REJECTED');}
});

test('a failed database completion after accepted delivery is not rewritten as publish failure',async()=>{
  let completes=0;const kernel={claimOutboxV2:async()=>[row()],completeOutboxV2:async()=>{completes++;throw Object.assign(new Error('db response lost'),{code:'DB_RETRY_EXHAUSTED'});}},service=new OutboxDispatchService({kernelFactory:async()=>kernel,publisher:{publish:async()=>({accepted:true})}});await assert.rejects(service.runOnce({trusted:true,actorId:'outbox-service'},{tenantId}),error=>error.code==='DB_RETRY_EXHAUSTED');assert.equal(completes,1);
});

test('worker exposes aggregate delivery state, backs off, and stops gracefully',async()=>{
  let calls=0,release;const service={runOnce:async()=>{calls++;if(calls===1)throw Object.assign(new Error('temporary'),{code:'OUTBOX_PUBLISH_RETRYABLE'});return [{status:'PUBLISHED'}];}},delays=[],worker=new OutboxDispatchWorker({service,principal:{trusted:true,actorId:'outbox-service'},scopes:[{tenantId}],intervalMs:10,maxBackoffMs:40,sleeper:async ms=>{delays.push(ms);if(delays.length===2)worker.abort.abort();}});worker.start();await worker.loopPromise;assert.deepEqual(delays,[20,10]);assert.equal(worker.metrics.cycleErrors,1);assert.equal(worker.metrics.published,1);assert.equal(worker.health().running,false);
  const sleeping=new OutboxDispatchWorker({service:{runOnce:async()=>[]},principal:{trusted:true,actorId:'outbox-service'},scopes:[{tenantId}],intervalMs:10,sleeper:()=>new Promise(resolve=>{release=resolve;})});sleeping.start();while(sleeping.metrics.cycles===0)await new Promise(resolve=>setTimeout(resolve,1));release();await sleeping.stop();assert.equal(sleeping.health().running,false);
});

test('production config requires a dedicated actor, unique tenant scopes, endpoint, and secret',()=>{
  const base={OUTBOX_DISPATCH_ACTOR_ID:'outbox-service',OUTBOX_DISPATCH_SCOPES:JSON.stringify([{tenantId}]),OUTBOX_PUBLISH_URL:'https://events.example.test/v1/refs',OUTBOX_PUBLISH_TOKEN:'publisher-token-0001'};const config=outboxDispatchConfig(base);assert.equal(config.actorId,'outbox-service');assert.equal(config.maxAttempts,8);assert.throws(()=>outboxDispatchConfig({...base,OUTBOX_DISPATCH_SCOPES:'[]'}),/tenantId/);assert.throws(()=>outboxDispatchConfig({...base,OUTBOX_DISPATCH_SCOPES:JSON.stringify([{tenantId},{tenantId}])}),/unique tenantId/);assert.throws(()=>outboxDispatchConfig({...base,OUTBOX_PUBLISH_TOKEN:''}),/required/);
});
