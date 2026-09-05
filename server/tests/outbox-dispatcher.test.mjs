import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {payloadHash,serializeOutboxEvent} from '../runtime/outbox-wire-contract.mjs';
import {secretPayloads} from './helpers/outbox-secret-cases.mjs';
import {HttpOutboxPublisher,OutboxDispatchService,validateClaimedOutboxEvent} from '../runtime/outbox-dispatcher.mjs';
import {OutboxDispatchWorker,outboxDispatchHealthResponse} from '../runtime/outbox-dispatch-worker.mjs';
import {outboxDispatchConfig} from '../runtime/start-outbox-dispatch-worker.mjs';
import {OutboxDispatchPreflight,validateOutboxDispatchScopes} from '../runtime/outbox-dispatch-preflight.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',eventId='33333333-3333-4333-8333-333333333333',aggregateId='44444444-4444-4444-8444-444444444444';
const row=(overrides={})=>{const {payload={journal_entry_id:aggregateId},...rest}=overrides;const text=JSON.stringify(payload);return {aggregate_id:aggregateId,aggregate_type:'JOURNAL_ENTRY',attempt_count:1,available_at:new Date('2026-08-24T00:00:00.000Z'),created_at:new Date('2026-08-24T00:00:00.000Z'),entity_id:entityId,event_type:'JOURNAL_POSTED',last_error:null,locked_at:new Date('2026-08-24T00:00:01.000Z'),locked_by:'outbox-service',outbox_event_id:eventId,payload_canonical_text:text,payload_hash:payloadHash(text),published_at:null,status:'PENDING',tenant_id:tenantId,...rest};};
const completion=(status='PUBLISHED')=>({schema_version:'OUTBOX_DISPATCH_COMPLETION_V1',outbox_event_id:eventId,status,attempt_count:1,retry_scheduled:status==='PENDING',available_at:'2026-08-24T00:00:05.000Z'});

test('publisher retains PostgreSQL numeric scale and precision without JSON roundtrip',async()=>{
  const text='{"amount": 12.0000, "precise": 9007199254740993.1200}';
  const event=validateClaimedOutboxEvent(row({payload_canonical_text:text,payload_hash:payloadHash(text)}),{tenantId});
  assert.ok(serializeOutboxEvent(event).includes(text));
  assert.notEqual(JSON.stringify(event.payload),text);
  await assert.rejects(new HttpOutboxPublisher({endpoint:'https://example.test',token:'synthetic-test-token-123',fetcher:()=>{throw new Error('must not run');}}).publish({...event}),error=>error.code==='OUTBOX_EVENT_CANONICAL_PAYLOAD_REQUIRED');
});
test('publisher secret deny matches AI baseline plus cookie/database/JWT/OAuth with zero network calls',async()=>{
  let calls=0;const publisher=new HttpOutboxPublisher({endpoint:'https://example.test',token:'synthetic-test-token-123',fetcher:()=>{calls++;}});
  for(const payload of secretPayloads)assert.throws(()=>validateClaimedOutboxEvent(row({payload}),{tenantId}),error=>error.code==='OUTBOX_EVENT_SECRET_DENIED');
  assert.throws(()=>validateClaimedOutboxEvent(row({event_type:'ya29.syntheticOAuthToken123'}),{tenantId}),error=>error.code==='OUTBOX_EVENT_SECRET_DENIED');
  await assert.rejects(publisher.publish({...validateClaimedOutboxEvent(row(),{tenantId}),payload:{token:'synthetic'}}));
  assert.equal(calls,0);
});

test('claimed event contract is closed, exact-scope, and never accepts a published or unlocked row',()=>{
  const event=validateClaimedOutboxEvent(row(),{tenantId});assert.equal(event.schema_version,'REFS_OUTBOX_EVENT_V1');assert.equal(event.created_at,'2026-08-24T00:00:00.000Z');
  assert.throws(()=>validateClaimedOutboxEvent(row({authorization:'Bearer secret'}),{tenantId}),error=>error.code==='OUTBOX_EVENT_CONTRACT_INVALID');
  assert.throws(()=>validateClaimedOutboxEvent(row({payload:{access_token:'Bearer abcdefghijklmnop'}}),{tenantId}),error=>error.code==='OUTBOX_EVENT_SECRET_DENIED');
  assert.throws(()=>validateClaimedOutboxEvent(row({tenant_id:entityId}),{tenantId}),error=>error.code==='OUTBOX_EVENT_SCOPE_INVALID');
  assert.throws(()=>validateClaimedOutboxEvent(row({status:'PUBLISHED',published_at:new Date()}),{tenantId}),error=>error.code==='OUTBOX_EVENT_STATE_INVALID');
});

test('HTTP publisher sends one idempotent closed envelope and requires an exact no-store receipt',async()=>{
  let request;const publisher=new HttpOutboxPublisher({endpoint:'https://events.example.test/v1/refs',token:'publisher-token-0001',fetcher:async(url,init)=>{request={url,init};return new Response(JSON.stringify({accepted:true,outbox_event_id:eventId,payload_hash:row().payload_hash,schema_version:'REFS_OUTBOX_PUBLISH_RECEIPT_V1'}),{status:202,headers:{'cache-control':'private, no-store','content-type':'application/json'}});},nodeEnv:'production'}),event=validateClaimedOutboxEvent(row(),{tenantId}),receipt=await publisher.publish(event);
  assert.equal(receipt.accepted,true);assert.equal(request.init.headers['idempotency-key'],eventId);assert.equal(request.init.headers['x-refs-payload-hash'],event.payload_hash);assert.equal(JSON.parse(request.init.body).tenant_id,tenantId);assert.equal(request.init.redirect,'error');
  const bad=new HttpOutboxPublisher({endpoint:'https://events.example.test/v1/refs',token:'publisher-token-0001',fetcher:async()=>new Response(JSON.stringify({...receipt,outbox_event_id:aggregateId}),{status:200,headers:{'cache-control':'no-store','content-type':'application/json'}}),nodeEnv:'production'});await assert.rejects(bad.publish(event),error=>error.code==='OUTBOX_PUBLISH_RECEIPT_INVALID');
  assert.throws(()=>new HttpOutboxPublisher({endpoint:'http://events.example.test',token:'publisher-token-0001',nodeEnv:'production'}),error=>error.code==='OUTBOX_PUBLISHER_CONFIG_INVALID');
});

async function localPublisher(t,handler,{timeoutMs=3000}={}){
  const server=createServer((request,response)=>{request.resume();handler(request,response);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return new HttpOutboxPublisher({endpoint:`http://127.0.0.1:${server.address().port}/events`,token:'publisher-token-0001',nodeEnv:'test',timeoutMs});
}

test('HTTP publisher deadline includes a real response body stalled after headers',{timeout:5000},async t=>{
  let headersSent=false,closed;
  const disconnected=new Promise(resolve=>{closed=resolve;}),publisher=await localPublisher(t,(_request,response)=>{
    response.on('close',closed);response.writeHead(202,{'cache-control':'no-store','content-type':'application/json'});response.write('{');headersSent=true;
  },{timeoutMs:1000});
  await assert.rejects(publisher.publish(validateClaimedOutboxEvent(row(),{tenantId})),error=>error.code==='OUTBOX_PUBLISH_TRANSPORT_FAILED'&&error.retryable===true);
  assert.equal(headersSent,true);
  await disconnected;
});

test('HTTP publisher cancels a real oversized streaming receipt before EOF without leaking its body',{timeout:5000},async t=>{
  let closed;
  const disconnected=new Promise(resolve=>{closed=resolve;}),publisher=await localPublisher(t,(_request,response)=>{
    response.on('close',closed);response.writeHead(202,{'cache-control':'no-store','content-type':'application/json'});
    response.write('private-body-marker'.padEnd(4096,'x'));setImmediate(()=>response.write('x'));
    // Deliberately never end: the byte limit must reject independently of EOF.
  });
  await assert.rejects(publisher.publish(validateClaimedOutboxEvent(row(),{tenantId})),error=>{
    assert.equal(error.code,'OUTBOX_PUBLISH_RECEIPT_INVALID');assert.equal(error.retryable,false);
    assert.equal(String(error).includes('private-body-marker'),false);return true;
  });
  await disconnected;
});

test('HTTP publisher accepts an exact 4096-byte streamed bound receipt and preserves idempotency',{timeout:5000},async t=>{
  const event=validateClaimedOutboxEvent(row(),{tenantId}),receipt={accepted:true,outbox_event_id:eventId,payload_hash:event.payload_hash,schema_version:'REFS_OUTBOX_PUBLISH_RECEIPT_V1'};
  let requestHeaders;
  const publisher=await localPublisher(t,(request,response)=>{
    requestHeaders=request.headers;response.writeHead(202,{'cache-control':'no-store','content-type':'application/json'});
    const raw=JSON.stringify(receipt).padEnd(4096,' ');response.write(raw.slice(0,2048));setImmediate(()=>response.end(raw.slice(2048)));
  });
  assert.deepEqual(await publisher.publish(event),receipt);
  assert.equal(requestHeaders['idempotency-key'],eventId);assert.equal(requestHeaders['x-refs-payload-hash'],event.payload_hash);
});

test('HTTP publisher cancels an unread response on terminal header rejection',async()=>{
  let cancelled=false;
  const publisher=new HttpOutboxPublisher({endpoint:'https://events.example.test/v1/refs',token:'publisher-token-0001',nodeEnv:'production',fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:404})});
  await assert.rejects(publisher.publish(validateClaimedOutboxEvent(row(),{tenantId})),error=>error.code==='OUTBOX_PUBLISH_REJECTED'&&error.retryable===false);
  assert.equal(cancelled,true);
});

test('malformed claimed payload is terminally sealed and never reaches the publisher',async()=>{let published=0;const completions=[],kernel={claimOutboxV3:async()=>[row({payload:{client_secret:'hidden'}})],completeOutboxV2:async args=>{completions.push(args);return completion('FAILED');}},service=new OutboxDispatchService({kernelFactory:async()=>kernel,publisher:{publish:async()=>{published++;}}}),result=await service.runOnce({trusted:true,actorId:'outbox-service'},{tenantId,scopes:[{entityId,grantSetVersion:4}]});assert.equal(published,0);assert.equal(result[0].status,'FAILED');assert.equal(completions[0].retryable,false);assert.equal(completions[0].errorCode,'OUTBOX_EVENT_SECRET_DENIED');});

test('service publishes, then seals the exact claim without exposing payload in results',async()=>{
  const calls=[],kernel={claimOutboxV3:async args=>{calls.push(['claim',args]);return [row()];},completeOutboxV2:async args=>{calls.push(['complete',args]);return completion();}},service=new OutboxDispatchService({kernelFactory:async()=>kernel,publisher:{publish:async()=>({accepted:true})}}),result=await service.runOnce({trusted:true,actorId:'outbox-service'},{tenantId,scopes:[{entityId,grantSetVersion:4}],limit:10});
  assert.equal(result[0].status,'PUBLISHED');assert.equal(calls[0][1].leaseSeconds,300);assert.deepEqual(calls[1][1],{tenantId,eventId,success:true,maxAttempts:8,retryBaseSeconds:5});assert.equal(JSON.stringify(result).includes('journal_entry_id'),false);
});

test('retryable transport failure schedules retry while terminal receipt failure dead-letters',async()=>{
  for(const [retryable,status] of [[true,'PENDING'],[false,'FAILED']]){const completions=[],kernel={claimOutboxV3:async()=>[row()],completeOutboxV2:async args=>{completions.push(args);return completion(status);}},publisher={publish:async()=>{throw Object.assign(new Error('redacted'),{code:retryable?'OUTBOX_PUBLISH_RETRYABLE':'OUTBOX_PUBLISH_REJECTED',retryable});}},service=new OutboxDispatchService({kernelFactory:async()=>kernel,publisher});const result=await service.runOnce({trusted:true,actorId:'outbox-service'},{tenantId,scopes:[{entityId,grantSetVersion:4}]});assert.equal(result[0].status,status);assert.equal(completions[0].retryable,retryable);assert.equal(completions[0].errorCode,retryable?'OUTBOX_PUBLISH_RETRYABLE':'OUTBOX_PUBLISH_REJECTED');}
});

test('a failed database completion after accepted delivery is not rewritten as publish failure',async()=>{
  let completes=0;const kernel={claimOutboxV3:async()=>[row()],completeOutboxV2:async()=>{completes++;throw Object.assign(new Error('db response lost'),{code:'DB_RETRY_EXHAUSTED'});}},service=new OutboxDispatchService({kernelFactory:async()=>kernel,publisher:{publish:async()=>({accepted:true})}});await assert.rejects(service.runOnce({trusted:true,actorId:'outbox-service'},{tenantId,scopes:[{entityId,grantSetVersion:4}]}),error=>error.code==='DB_RETRY_EXHAUSTED');assert.equal(completes,1);
});

test('claim results outside the configured entity allowlist fail before payload validation, publish, or completion',async()=>{let published=0,completed=0;const otherEntity='55555555-5555-4555-8555-555555555555',kernel={claimOutboxV3:async()=>[row({entity_id:otherEntity,payload:{client_secret:'must-not-be-processed'}})],completeOutboxV2:async()=>{completed++;}};const service=new OutboxDispatchService({kernelFactory:async()=>kernel,publisher:{publish:async()=>{published++;}}});await assert.rejects(service.runOnce({trusted:true,actorId:'outbox-service'},{tenantId,scopes:[{entityId,grantSetVersion:4}]}),error=>error.code==='OUTBOX_EVENT_SCOPE_INVALID');assert.equal(published,0);assert.equal(completed,0);});

test('worker is unhealthy during backoff, recovers after a fresh success, and stops gracefully',async()=>{
  let now=Date.parse('2026-08-24T00:00:00.000Z');const ready=()=>({schema_version:'OUTBOX_DISPATCH_READINESS_V1',ready:true,scope_count:1,pending_count:0,failed_count:0,oldest_pending_at:null,checked_at:new Date(now).toISOString(),scopes:[{tenant_id:tenantId,entity_id:entityId,grant_set_version:4,permission:'OUTBOX.DISPATCH',pending_count:0,failed_count:0,oldest_pending_at:null}]});let calls=0,release;const service={runOnce:async(_principal,scope)=>{assert.deepEqual(scope.scopes,[{entityId,grantSetVersion:4}]);calls++;if(calls===1)throw Object.assign(new Error('temporary'),{code:'OUTBOX_PUBLISH_RETRYABLE'});return [{status:'PUBLISHED'}];}},delays=[],states=[],logs=[],worker=new OutboxDispatchWorker({service,principal:{trusted:true,actorId:'outbox-service'},scopes:[{tenantId,entityId}],readinessProbe:async()=>ready(),intervalMs:10,maxBackoffMs:40,clock:()=>now,logger:{error:value=>logs.push(value)},sleeper:async ms=>{delays.push(ms);states.push(outboxDispatchHealthResponse(worker).status);now+=ms;if(delays.length===2)worker.abort.abort();}});worker.start();await worker.loopPromise;assert.deepEqual(delays,[20,10]);assert.deepEqual(states,[503,200]);assert.equal(worker.metrics.cycleErrors,1);assert.equal(worker.metrics.published,1);assert.equal(worker.health().running,false);assert.equal(logs.length,1);assert.equal(logs[0].includes(tenantId)||logs[0].includes(entityId),false);
  const sleeping=new OutboxDispatchWorker({service:{runOnce:async()=>[]},principal:{trusted:true,actorId:'outbox-service'},scopes:[{tenantId,entityId}],readinessProbe:async()=>ready(),intervalMs:10,clock:()=>now,sleeper:()=>new Promise(resolve=>{release=resolve;})});sleeping.start();while(sleeping.metrics.cycles===0)await new Promise(resolve=>setTimeout(resolve,1));release();await sleeping.stop();assert.equal(sleeping.health().running,false);
});

test('worker exits for the process supervisor after its consecutive error budget',async()=>{const ready={schema_version:'OUTBOX_DISPATCH_READINESS_V1',ready:true,scope_count:1,pending_count:0,failed_count:0,oldest_pending_at:null,checked_at:new Date().toISOString(),scopes:[{tenant_id:tenantId,entity_id:entityId,grant_set_version:4,permission:'OUTBOX.DISPATCH',pending_count:0,failed_count:0,oldest_pending_at:null}]},worker=new OutboxDispatchWorker({service:{runOnce:async()=>{throw Object.assign(new Error('down'),{code:'OUTBOX_PUBLISH_RETRYABLE'});}},principal:{trusted:true,actorId:'outbox-service'},scopes:[{tenantId,entityId}],readinessProbe:async()=>ready,intervalMs:10,maxConsecutiveErrors:2,sleeper:async()=>{}});await assert.rejects(worker.start(),error=>error.code==='OUTBOX_DISPATCH_UNHEALTHY');assert.equal(worker.metrics.consecutiveErrors,2);assert.equal(worker.running,false);});

test('production config requires a dedicated actor, closed unique tenant/entity scopes, endpoint, and secret',()=>{
  const base={OUTBOX_DISPATCH_ACTOR_ID:'outbox-service',OUTBOX_DISPATCH_SCOPES:JSON.stringify([{tenantId,entityId}]),OUTBOX_PUBLISH_URL:'https://events.example.test/v1/refs',OUTBOX_PUBLISH_TOKEN:'publisher-token-0001'};const config=outboxDispatchConfig(base);assert.equal(config.actorId,'outbox-service');assert.equal(config.maxAttempts,8);assert.equal(config.maxConsecutiveErrors,6);assert.equal(config.healthFreshnessMs,30000);assert.throws(()=>outboxDispatchConfig({...base,OUTBOX_DISPATCH_SCOPES:'[]'}),/tenant\/entity/);assert.throws(()=>outboxDispatchConfig({...base,OUTBOX_DISPATCH_SCOPES:JSON.stringify([{tenantId}])}),/tenantId and entityId/);assert.throws(()=>outboxDispatchConfig({...base,OUTBOX_DISPATCH_SCOPES:JSON.stringify([{tenantId,entityId,extra:true}])}),/contain only/);assert.throws(()=>outboxDispatchConfig({...base,OUTBOX_DISPATCH_SCOPES:JSON.stringify([{tenantId,entityId},{tenantId,entityId}])}),/unique/);assert.throws(()=>outboxDispatchConfig({...base,OUTBOX_PUBLISH_TOKEN:''}),/required/);
});

test('startup preflight proves exact effective permission and emits closed backlog evidence',async()=>{const actorId='outbox-service',access={tenant_id:tenantId,entity_id:entityId,actor_id:actorId,grant_set_version:4,permissions:['OUTBOX.DISPATCH'],configured_permissions:['OUTBOX.DISPATCH'],session_refresh_required:false},backlog={tenant_id:tenantId,entity_id:entityId,pending_count:3,failed_count:2,oldest_pending_at:new Date('2026-08-23T00:00:00.000Z')},preflight=new OutboxDispatchPreflight({kernelFactory:async()=>({readCurrentActorAccess:async()=>access,readOutboxDispatchBacklog:async()=>backlog}),clock:()=>Date.parse('2026-08-24T00:00:00.000Z')}),evidence=await preflight.verify({trusted:true,actorId},{scopes:[{tenantId,entityId}]});assert.deepEqual(evidence,{schema_version:'OUTBOX_DISPATCH_READINESS_V1',ready:true,checked_at:'2026-08-24T00:00:00.000Z',scope_count:1,pending_count:3,failed_count:2,oldest_pending_at:'2026-08-23T00:00:00.000Z',scopes:[{tenant_id:tenantId,entity_id:entityId,grant_set_version:4,permission:'OUTBOX.DISPATCH',pending_count:3,failed_count:2,oldest_pending_at:'2026-08-23T00:00:00.000Z'}]});});

test('public readiness is no-store, state-only, and fail-closed',()=>{const readiness={schema_version:'OUTBOX_DISPATCH_READINESS_V1',ready:true,scope_count:1,pending_count:3,failed_count:2,oldest_pending_at:'2026-08-23T00:00:00.000Z',checked_at:'2026-08-24T00:00:00.000Z',scopes:[{tenant_id:tenantId,entity_id:entityId}]},worker={health:()=>({ok:true,state:'READY',scope_count:1,readiness})},response=outboxDispatchHealthResponse(worker),serialized=JSON.stringify(response);assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{schema_version:'OUTBOX_DISPATCH_PUBLIC_READINESS_V2',ready:true,worker_state:'READY',backlog_state:'FAILED_EVENTS'});for(const denied of [tenantId,entityId,'pending_count','failed_count','checked_at','oldest_pending_at'])assert.equal(serialized.includes(denied),false);const failed=outboxDispatchHealthResponse({health:()=>({ok:false,state:'BACKING_OFF',readiness:null})});assert.equal(failed.status,503);assert.equal(failed.body.backlog_state,'UNKNOWN');});

test('health becomes stale when the last successful cycle or permission preflight is old',()=>{const now=Date.parse('2026-08-24T00:01:00.000Z'),worker=new OutboxDispatchWorker({service:{runOnce:async()=>[]},principal:{trusted:true,actorId:'outbox-service'},scopes:[{tenantId,entityId}],readinessProbe:async()=>({}),clock:()=>now,healthFreshnessMs:30000});worker.running=true;worker.readiness={schema_version:'OUTBOX_DISPATCH_READINESS_V1',ready:true,checked_at:'2026-08-24T00:00:00.000Z'};worker.metrics.lastSuccessAt='2026-08-24T00:00:59.000Z';assert.deepEqual({ok:worker.health().ok,state:worker.health().state},{ok:false,state:'STALE'});worker.readiness.checked_at='2026-08-24T00:00:59.000Z';assert.deepEqual({ok:worker.health().ok,state:worker.health().state},{ok:true,state:'READY'});});

test('startup preflight rejects expired, extra, stale, missing-entity, duplicate, oversized, and credential-shaped inputs',async()=>{const actorId='outbox-service',base={tenant_id:tenantId,entity_id:entityId,actor_id:actorId,grant_set_version:1,permissions:['OUTBOX.DISPATCH'],configured_permissions:['OUTBOX.DISPATCH'],session_refresh_required:false},backlog={tenant_id:tenantId,entity_id:entityId,pending_count:0,failed_count:0,oldest_pending_at:null},verify=access=>new OutboxDispatchPreflight({kernelFactory:async()=>({readCurrentActorAccess:async()=>access,readOutboxDispatchBacklog:async()=>backlog})}).verify({trusted:true,actorId},{scopes:[{tenantId,entityId}]});for(const access of [{...base,permissions:[]},{...base,permissions:['OUTBOX.DISPATCH','GL.JE.POST'],configured_permissions:['OUTBOX.DISPATCH','GL.JE.POST']},{...base,session_refresh_required:true},{...base,grant_set_version:0}])await assert.rejects(verify(access),error=>['OUTBOX_DISPATCH_ACCESS_DENIED','OUTBOX_DISPATCH_ACCESS_INVALID'].includes(error.code));assert.throws(()=>validateOutboxDispatchScopes([{tenantId}]),error=>error.code==='OUTBOX_DISPATCH_SCOPE_INVALID');assert.throws(()=>validateOutboxDispatchScopes([{tenantId,entityId},{tenantId,entityId}]),error=>error.code==='OUTBOX_DISPATCH_SCOPE_DUPLICATE');assert.throws(()=>validateOutboxDispatchScopes(Array.from({length:101},(_,index)=>({tenantId,entityId:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`}))),error=>error.code==='OUTBOX_DISPATCH_SCOPE_INVALID');await assert.rejects(new OutboxDispatchPreflight({kernelFactory:async()=>({})}).verify({trusted:true,actorId:'sk-abcdefghijklmnop'},{scopes:[{tenantId,entityId}]}),error=>error.code==='OUTBOX_DISPATCH_ACCESS_INVALID');});

test('production startup performs permission and backlog preflight before worker start and exposes a fatal-loop promise',async()=>{const source=await (await import('node:fs/promises')).readFile(new URL('../runtime/start-outbox-dispatch-worker.mjs',import.meta.url),'utf8');assert.match(source,/new OutboxDispatchPreflight/);assert.match(source,/await worker\.checkReadiness\(\)/);assert.ok(source.indexOf('await worker.checkReadiness()')<source.indexOf('healthServer=createServer'));assert.ok(source.indexOf('healthServer=createServer')<source.indexOf('worker.start()'));assert.match(source,/const loopPromise=worker\.start\(\),done=/);assert.match(source,/then\(runtime=>runtime\.done\)/);assert.match(source,/'127\.0\.0\.1'/);assert.doesNotMatch(source,/reconcile\(|refs_reconcile_actor_grants|INSERT INTO runtime_actor_grant/);});
