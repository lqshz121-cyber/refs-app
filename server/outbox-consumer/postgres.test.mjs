import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { HttpOutboxPublisher, OutboxDispatchService } from '../runtime/outbox-dispatcher.mjs';
import { createConsumerServer } from './server.mjs';
import { secretPayloads } from '../tests/helpers/outbox-secret-cases.mjs';
import { ConsumerRepository } from './repository.mjs';

test('fresh isolated PostgreSQL consumer: durable replay, conflict, concurrency, closed scope, append-only and no owner authority',async()=>{
  const raw=process.env.OUTBOX_CONSUMER_TEST_ADMIN_URL;
  assert.ok(raw,'OUTBOX_CONSUMER_TEST_ADMIN_URL is required; no skipped database gate');
  const url=new URL(raw);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
  assert.equal(url.pathname,'/refs_outbox_consumer_test','test may only initialize exact disposable local database');
  const admin=new pg.Client({connectionString:raw});await admin.connect();
  let pool;
  try{
    const tables=await admin.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')");assert.equal(tables.rows[0].count,0,'fresh database is required');
    await admin.query(await readFile(new URL('./bootstrap.sql',import.meta.url),'utf8'));
    const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
    await admin.query('INSERT INTO refs_outbox_consumer.configuration(database_name,tenant_id,entity_id,bootstrap_sha256) VALUES($1,$2,$3,$4)',['refs_outbox_consumer_test',tenantId,entityId,'test']);
    const password=randomBytes(24).toString('hex');
    await admin.query(`CREATE ROLE consumer_test_login LOGIN INHERIT PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query('GRANT refs_outbox_consumer_runtime TO consumer_test_login');
    url.username='consumer_test_login';url.password=password;
    pool=new pg.Pool({connectionString:url.toString(),max:4});
    const config={databaseName:'refs_outbox_consumer_test',tenantId,entityId};
    const repo=new ConsumerRepository(pool,config);assert.equal(await repo.ready(),true);
    assert.equal((await admin.query('SELECT refs_outbox_consumer.ready($1,$2,$3) AS ready',[config.databaseName,tenantId,entityId])).rows[0].ready,false);
    const payload={amount:'12.0000',count:1};
    const hash=(await admin.query("SELECT 'sha256:'||encode(digest(convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex') AS hash",[JSON.stringify(payload)])).rows[0].hash;
    assert.equal(hash,'sha256:'+createHash('sha256').update('{"count": 1, "amount": "12.0000"}').digest('hex'));
    const e={schema_version:'REFS_OUTBOX_EVENT_V1',outbox_event_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',tenant_id:tenantId,entity_id:entityId,aggregate_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',aggregate_type:'JOURNAL_ENTRY',event_type:'JOURNAL_POSTED',payload,payload_hash:hash,attempt_count:1,created_at:'2026-09-05T00:00:00.000Z'};
    const first=await repo.accept(e,JSON.stringify(e));assert.equal(first.accepted,true);
    const replay=await Promise.all(Array.from({length:8},(_,i)=>repo.accept({...e,attempt_count:i+2},JSON.stringify({...e,attempt_count:i+2}))));assert.ok(replay.every(r=>r.payload_hash===hash));
    await pool.end();pool=new pg.Pool({connectionString:url.toString()});
    assert.deepEqual(await new ConsumerRepository(pool,config).accept(e,JSON.stringify(e)),first,'process restart replay is durable');
    const different={other:'value'};const differentHash=(await admin.query("SELECT 'sha256:'||encode(digest(convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex') AS hash",[JSON.stringify(different)])).rows[0].hash;
    await assert.rejects(new ConsumerRepository(pool,config).accept({...e,payload:different,payload_hash:differentHash},JSON.stringify({...e,payload:different,payload_hash:differentHash})),err=>err.status===409);
    await assert.rejects(new ConsumerRepository(pool,config).accept({...e,event_type:'DIFFERENT'},JSON.stringify({...e,event_type:'DIFFERENT'})),err=>err.status===409);
    for(const delta of [{payload_hash:'sha256:'+'0'.repeat(64)},{schema_version:null},{entity_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},{extra:true},{payload:{access_token:'secret'}}]) await assert.rejects(pool.query('SELECT refs_outbox_consumer.accept($1::jsonb)',[JSON.stringify({...e,...delta})]));
    for(const sql of ['SELECT * FROM refs_outbox_consumer.event_ledger','DELETE FROM refs_outbox_consumer.event_ledger','TRUNCATE refs_outbox_consumer.event_ledger','UPDATE refs_outbox_consumer.configuration SET bootstrap_sha256=\'changed\'']) await assert.rejects(pool.query(sql),err=>err.code==='42501');
    await assert.rejects(admin.query('DELETE FROM refs_outbox_consumer.event_ledger'),err=>err.code==='42501');
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM refs_outbox_consumer.event_ledger')).rows[0].count,1);
    for(const payload of secretPayloads){
      const secretHash=(await admin.query("SELECT 'sha256:'||encode(digest(convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex') hash",[JSON.stringify(payload)])).rows[0].hash;
      await assert.rejects(pool.query('SELECT refs_outbox_consumer.accept($1::jsonb)',[JSON.stringify({...e,outbox_event_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',payload,payload_hash:secretHash})]),err=>err.code==='P0400');
    }
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM refs_outbox_consumer.event_ledger')).rows[0].count,1,'all secret cases leave zero additional durable rows');
    const numeric=(await admin.query("SELECT p::text payload_canonical_text, 'sha256:'||encode(digest(convert_to(p::text,'UTF8'),'sha256'),'hex') payload_hash FROM (SELECT '{\"amount\":12.0000,\"precise\":9007199254740993.1200}'::jsonb p) s")).rows[0];
    const claimed={aggregate_id:e.aggregate_id,aggregate_type:e.aggregate_type,attempt_count:1,available_at:e.created_at,created_at:e.created_at,entity_id:entityId,event_type:e.event_type,last_error:null,locked_at:e.created_at,locked_by:'test-worker',outbox_event_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',...numeric,published_at:null,status:'PENDING',tenant_id:tenantId};
    const token='synthetic-consumer-test-token-123456';const server=createConsumerServer({repository:new ConsumerRepository(pool,config),config:{...config,token,release:'a'.repeat(40)}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const completions=[];const service=new OutboxDispatchService({kernelFactory:async()=>({claimOutboxV3:async()=>[claimed],completeOutboxV2:async args=>{completions.push(args);return {status:args.success?'PUBLISHED':'FAILED'};}}),publisher:new HttpOutboxPublisher({endpoint:`http://127.0.0.1:${server.address().port}/outbox/events`,token,nodeEnv:'test'})});
      const result=await service.runOnce({trusted:true,actorId:'test-worker'},{tenantId,scopes:[{entityId,grantSetVersion:1}]});
      assert.equal(result[0].status,'PUBLISHED');assert.equal(completions[0].success,true,'valid numeric backlog never takes FAILED path');
      const stored=(await admin.query("SELECT payload_hash,envelope->'payload' AS parsed,(envelope->'payload')::text AS canonical FROM refs_outbox_consumer.event_ledger WHERE outbox_event_id=$1",[claimed.outbox_event_id])).rows[0];
      assert.equal(stored.payload_hash,numeric.payload_hash);assert.equal(stored.canonical,numeric.payload_canonical_text);assert.match(stored.canonical,/12\.0000/);assert.match(stored.canonical,/9007199254740993\.1200/);
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await admin.query('ALTER ROLE consumer_test_login REPLICATION');
    await assert.rejects(new ConsumerRepository(pool,config).ready(),'replication-capable runtime must be rejected');
    await assert.rejects(new ConsumerRepository(pool,config).accept(e,JSON.stringify(e)));
    await admin.query('ALTER ROLE consumer_test_login NOREPLICATION');
    await admin.query('GRANT INSERT ON refs_outbox_consumer.event_ledger TO consumer_test_login');
    await assert.rejects(new ConsumerRepository(pool,config).ready(),'unexpected direct privileges must fail readiness');
    await assert.rejects(new ConsumerRepository(pool,config).accept(e,JSON.stringify(e)),'unexpected privileges must prevent publish receipts');
    assert.equal((await admin.query("SELECT to_regclass('public.journal_entry') AS journal")).rows[0].journal,null);
  }finally{await pool?.end();await admin.end();}
});
