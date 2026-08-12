import test from 'node:test';
import assert from 'node:assert/strict';
import {isTransientPostgresStartupError,waitForPostgresReadiness} from '../runtime/postgres-readiness.mjs';

test('PostgreSQL readiness retries only transient startup and unavailable connection errors',()=>{
  for(const code of ['57P03','ECONNREFUSED','ECONNRESET','ECONNABORTED','EPIPE','ETIMEDOUT'])assert.equal(isTransientPostgresStartupError({code}),true,code);
  assert.equal(isTransientPostgresStartupError(new Error('Connection terminated unexpectedly')),true,'pg startup socket terminated without an error code');
  assert.equal(isTransientPostgresStartupError(new Error('password authentication failed')),false,'message-only errors stay fail closed unless exactly allowlisted');
  for(const code of ['28P01','3D000','42P01','XX000'])assert.equal(isTransientPostgresStartupError({code}),false,code);
});

test('PostgreSQL readiness retries a startup race until the probe succeeds',async()=>{
  let calls=0,clock=0;
  const result=await waitForPostgresReadiness({
    probe:async()=>{calls+=1;if(calls<3){const error=new Error('the database system is starting up');error.code='57P03';throw error;}},
    timeoutMs:100,intervalMs:10,now:()=>clock,sleep:async delay=>{clock+=delay;}
  });
  assert.deepEqual(result,{attempts:3,elapsedMs:20});
});

test('PostgreSQL readiness retries the exact pg startup disconnect without an error code',async()=>{
  let calls=0,clock=0;
  const result=await waitForPostgresReadiness({
    probe:async()=>{calls+=1;if(calls===1)throw new Error('Connection terminated unexpectedly');},
    timeoutMs:100,intervalMs:10,now:()=>clock,sleep:async delay=>{clock+=delay;}
  });
  assert.deepEqual(result,{attempts:2,elapsedMs:10});
});

test('PostgreSQL readiness fails immediately for a non-transient error',async()=>{
  const error=Object.assign(new Error('password authentication failed'),{code:'28P01'});
  let calls=0;
  await assert.rejects(waitForPostgresReadiness({probe:async()=>{calls+=1;throw error;}}),received=>received===error);
  assert.equal(calls,1);
});

test('PostgreSQL readiness fails closed when transient errors exceed the bounded timeout',async()=>{
  let clock=0,calls=0;
  await assert.rejects(waitForPostgresReadiness({
    probe:async()=>{calls+=1;throw Object.assign(new Error('the database system is starting up'),{code:'57P03'});},
    timeoutMs:20,intervalMs:10,now:()=>clock,sleep:async delay=>{clock+=delay;}
  }),error=>error.code==='PG_READINESS_TIMEOUT'&&error.cause?.code==='57P03');
  assert.equal(calls,3);
});
