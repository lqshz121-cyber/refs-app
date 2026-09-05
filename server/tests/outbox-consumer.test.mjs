import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { authorized, readConfig, validateEvent, receipt } from '../outbox-consumer/contract.mjs';
import { ConsumerRepository } from '../outbox-consumer/repository.mjs';
import { createConsumerServer } from '../outbox-consumer/server.mjs';
import { sealOutboxPayload } from '../runtime/outbox-wire-contract.mjs';
import { secretPayloads } from './helpers/outbox-secret-cases.mjs';
import { HttpOutboxPublisher } from '../runtime/outbox-dispatcher.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const token='consumer-test-token-not-a-real-secret-123456';
const config={tenantId,entityId,token,release:'a'.repeat(40),databaseName:'refs_outbox_consumer_test'};
export const fixture=()=>({schema_version:'REFS_OUTBOX_EVENT_V1',outbox_event_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',tenant_id:tenantId,entity_id:entityId,aggregate_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',aggregate_type:'JOURNAL_ENTRY',event_type:'JOURNAL_POSTED',payload:{amount:'12.0000',count:1},payload_hash:'sha256:'+createHash('sha256').update('{"count": 1, "amount": "12.0000"}').digest('hex'),attempt_count:1,created_at:'2026-09-05T00:00:00.000Z'});
const headers=e=>({'idempotency-key':e.outbox_event_id,'x-refs-payload-hash':e.payload_hash});
test('closed event binds header, server scope, canonical timestamp and rejects secret material',()=>{
  const e=fixture();assert.equal(validateEvent(e,config,headers(e)),e);
  for(const delta of [{extra:true},{tenant_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},{attempt_count:0},{created_at:'2026-02-30T00:00:00.000Z'},{payload:{authorization:'private'}},{payload:{memo:'Bearer secret-secret-token'}},{payload:{database_url:'synthetic'}}]) assert.throws(()=>validateEvent({...e,...delta},config,headers(e)));
  assert.throws(()=>validateEvent(e,config,{}));
});
test('startup only accepts dedicated database namespace, scope and token; rejects accounting credentials',()=>{
  const env={OUTBOX_CONSUMER_DATABASE_URL:'postgres://consumer:local@localhost/refs_outbox_consumer_test',OUTBOX_CONSUMER_DATABASE_NAME:config.databaseName,OUTBOX_CONSUMER_TOKEN:token,OUTBOX_CONSUMER_TENANT_ID:tenantId,OUTBOX_CONSUMER_ENTITY_ID:entityId};
  assert.equal(readConfig(env).databaseName,config.databaseName);
  for(const delta of [{DATABASE_URL:'acc'},{GRANT_SYNC_DATABASE_URL:'acc'},{OUTBOX_CONSUMER_DATABASE_NAME:'accounting'},{OUTBOX_CONSUMER_TOKEN:'short'},{PORT:'0'}]) assert.throws(()=>readConfig({...env,...delta}));
  assert.equal(authorized(`Bearer ${token}`,token),true);assert.equal(authorized(`Bearer ${token}x`,token),false);
});
test('repository returns only durable exact receipt and maps SQL conflicts/hash errors safely',async()=>{
  const e=fixture();let query;
  const repo=new ConsumerRepository({query:async(...args)=>{query=args;return {rows:[{receipt:receipt(e)}]};}},config);
  assert.deepEqual(await repo.accept(e,JSON.stringify(e)),receipt(e));assert.match(query[0],/refs_outbox_consumer.accept/);assert.equal(query[1][0],JSON.stringify(e));
  for(const [code,status] of [['P0409',409],['P0400',400],['XX000',503]]) {
    const bad=new ConsumerRepository({query:async()=>{throw Object.assign(new Error('password=do-not-leak'),{code});}},config);
    await assert.rejects(bad.accept(e,JSON.stringify(e)),err=>err.status===status&&!err.message.includes('password'));
  }
  await assert.rejects(new ConsumerRepository({query:async()=>({rows:[{receipt:{...receipt(e),extra:true}}]})},config).accept(e,JSON.stringify(e)));
});
async function withServer(repository,run){
  const server=createConsumerServer({repository,config});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run(`http://127.0.0.1:${server.address().port}`);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('existing dispatcher consumes exact durable HTTP receipt; retry keeps one retained event',async()=>{
  const records=new Map();let writes=0;
  await withServer({ready:async()=>true,accept:async e=>{if(!records.has(e.outbox_event_id)){records.set(e.outbox_event_id,e);writes++;}return receipt(e);}},async base=>{
    const publisher=new HttpOutboxPublisher({endpoint:base+'/outbox/events',token,nodeEnv:'test'});
    assert.deepEqual(await publisher.publish(sealOutboxPayload(fixture(),'{"count": 1, "amount": "12.0000"}')),receipt(fixture()));
    await publisher.publish(sealOutboxPayload({...fixture(),attempt_count:2},'{"count": 1, "amount": "12.0000"}'));assert.equal(writes,1);
    for(const path of ['/health/live','/health/ready']){const response=await fetch(base+path);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');}
  });
});
test('HTTP unauthorized/open scope/oversize/malformed/media failures perform zero persistence',async()=>{
  let writes=0;await withServer({ready:async()=>true,accept:async()=>{writes++;}},async base=>{
    const e=fixture();const good={authorization:`Bearer ${token}`,'content-type':'application/json',...headers(e)};
    for(const [body,custom,status] of [[JSON.stringify(e),{authorization:'Bearer invalid'},401],[JSON.stringify({...e,extra:true}),{},400],['{',{},400],[JSON.stringify(e),{'content-type':'text/plain'},415],[JSON.stringify({...e,payload:{memo:'x'.repeat(1000001)}}),{},413]]) {
      const response=await fetch(base+'/outbox/events',{method:'POST',headers:{...good,...custom},body});assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok((await response.text()).length<4096);
    }
    assert.equal(writes,0);
  });
});
test('health ready and DB failure return bounded generic no-store 503 without error disclosure',async()=>{
  await withServer({ready:async()=>{throw new Error('postgres://secret');},accept:async()=>{throw new Error('token secret');}},async base=>{
    for(const [path,options] of [['/health/ready',{}],['/outbox/events',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers(fixture())},body:JSON.stringify(fixture())}]]) {
      const response=await fetch(base+path,options);assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.doesNotMatch(await response.text(),/secret|postgres/);
    }
  });
});
test('consumer rejects every shared secret shape before persistence',async()=>{
  let writes=0;await withServer({ready:async()=>true,accept:async()=>{writes++;}},async base=>{
    for(const payload of secretPayloads){const e={...fixture(),payload};const response=await fetch(base+'/outbox/events',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers(e)},body:JSON.stringify(e)});assert.equal(response.status,400);assert.equal((await response.json()).code,'OUTBOX_SECRET_DENIED');}
    assert.equal(writes,0);
  });
});
test('consumer bootstrap and Blueprint preserve independent authority and append-only durable boundaries',async()=>{
  const sql=await readFile(new URL('../outbox-consumer/bootstrap.sql',import.meta.url),'utf8');
  assert.match(sql,/digest\(convert_to\(\(e->'payload'\)::text,'UTF8'\),'sha256'\)/);
  assert.match(sql,/ON CONFLICT\(outbox_event_id\) DO NOTHING/);assert.match(sql,/old.envelope<>stable/);
  assert.match(sql,/BEFORE UPDATE OR DELETE OR TRUNCATE/);assert.match(sql,/REVOKE ALL ON ALL TABLES/);
  const blueprint=await readFile(new URL('../../render.outbox-consumer.yaml',import.meta.url),'utf8');
  assert.match(blueprint,/databaseName: refs_outbox_consumer_staging/);assert.doesNotMatch(blueprint,/- key: (DATABASE_URL|MIGRATION_DATABASE_URL|GRANT_SYNC_DATABASE_URL)|db:up|fromService/);
  const production=await readFile(new URL('../../render.outbox-consumer.production.yaml',import.meta.url),'utf8');
  for(const manifest of [blueprint,production]){assert.equal((manifest.match(/region: oregon/g)||[]).length,2);assert.match(manifest,/plan: starter/);assert.match(manifest,/numInstances: 1/);assert.match(manifest,/autoDeployTrigger: off/);}
  assert.match(production,/databaseName: refs_outbox_consumer_production/);assert.doesNotMatch(production,/value: 6fb25daf|value: ca8d23c7/);
});
