import test from 'node:test';
import assert from 'node:assert/strict';
import {withSerializableRetry} from '../runtime/db.mjs';

function fakePool(){
  const clients=[];
  return {
    clients,
    async connect(){
      const queries=[];
      const client={queries,released:false,async query(sql){queries.push(sql);return {rows:[],rowCount:0};},release(){this.released=true;}};
      clients.push(client);
      return client;
    }
  };
}

test('serializable retry uses fresh transactions and bounded jitter for transient conflicts',async()=>{
  const pool=fakePool(),delays=[];let attempts=0;
  const result=await withSerializableRetry(pool,async()=>{
    attempts+=1;
    if(attempts===1)throw Object.assign(new Error('serialization'),{code:'40001'});
    if(attempts===2)throw Object.assign(new Error('deadlock'),{code:'40P01'});
    return 'committed';
  },{maxRetries:2,baseDelayMs:20,maxDelayMs:500,random:()=>0.5,sleep:async delay=>delays.push(delay)});
  assert.equal(result,'committed');
  assert.equal(attempts,3);
  assert.deepEqual(delays,[30,60]);
  assert.deepEqual(pool.clients.map(client=>client.queries),[
    ['BEGIN','SET TRANSACTION ISOLATION LEVEL SERIALIZABLE','ROLLBACK'],
    ['BEGIN','SET TRANSACTION ISOLATION LEVEL SERIALIZABLE','ROLLBACK'],
    ['BEGIN','SET TRANSACTION ISOLATION LEVEL SERIALIZABLE','COMMIT']
  ]);
  assert.equal(pool.clients.every(client=>client.released),true);
});

test('serializable retry stops at the configured bound and preserves the database error',async()=>{
  const pool=fakePool(),delays=[];let attempts=0;
  const expected=Object.assign(new Error('still conflicted'),{code:'40001'});
  await assert.rejects(withSerializableRetry(pool,async()=>{attempts+=1;throw expected;},{maxRetries:2,baseDelayMs:10,maxDelayMs:12,random:()=>1,sleep:async delay=>delays.push(delay)}),error=>error===expected);
  assert.equal(attempts,3);
  assert.deepEqual(delays,[12,12]);
  assert.equal(pool.clients.every(client=>client.released),true);
});

test('serializable retry never retries a non-transient error',async()=>{
  const pool=fakePool();let attempts=0,sleeps=0;
  const expected=Object.assign(new Error('authorization denied'),{code:'42501'});
  await assert.rejects(withSerializableRetry(pool,async()=>{attempts+=1;throw expected;},{sleep:async()=>{sleeps+=1;}}),error=>error===expected);
  assert.equal(attempts,1);
  assert.equal(sleeps,0);
  assert.deepEqual(pool.clients[0].queries,['BEGIN','SET TRANSACTION ISOLATION LEVEL SERIALIZABLE','ROLLBACK']);
});

test('serializable retry default permits seven transient retries before succeeding',async()=>{
  const pool=fakePool();let attempts=0,sleeps=0;
  const result=await withSerializableRetry(pool,async()=>{
    attempts+=1;
    if(attempts<8)throw Object.assign(new Error('serialization'),{code:'40001'});
    return 'committed-after-seven-retries';
  },{random:()=>0,sleep:async()=>{sleeps+=1;}});
  assert.equal(result,'committed-after-seven-retries');
  assert.equal(attempts,8);
  assert.equal(sleeps,7);
});
