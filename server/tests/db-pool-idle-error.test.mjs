// S32 read-back finding: the staging API restarted repeatedly with exit status 1
// and a dumped pg Client object. pg's Pool emits 'error' for idle clients whose
// backend disconnects; with no listener Node exits. createPool must attach a
// listener that records a safe event and keeps the process alive.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPool} from '../runtime/db.mjs';

const ENV={DATABASE_URL:'postgresql://refs_runtime:x@127.0.0.1:1/refs_kernel_test',MIGRATION_DATABASE_URL:'postgresql://refs_migrator:x@127.0.0.1:1/refs_kernel_test',CONTEXT_ISSUER_DATABASE_URL:'postgresql://refs_context_issuer:x@127.0.0.1:1/refs_kernel_test',GRANT_SYNC_DATABASE_URL:'postgresql://refs_grant_sync:x@127.0.0.1:1/refs_kernel_test'};
for(const [k,v] of Object.entries(ENV))process.env[k]=process.env[k]||v;

test('the pool has exactly one error listener and an idle-client error becomes a safe event instead of a crash',async()=>{
  const events=[];
  const pool=await createPool({onEvent:e=>events.push(e)});
  try{
    assert.equal(pool.listenerCount('error'),1);
    const error=Object.assign(new Error('Connection terminated unexpectedly'),{code:'ECONNRESET',client:{secretKey:1234,password:'never-logged'}});
    pool.emit('error',error,error.client); // what pg does for an idle client
    assert.deepEqual(events,[{event:'database_idle_client_error',code:'ECONNRESET'}]);
    pool.emit('error',Object.assign(new Error('x'),{code:'57P01'}));
    assert.equal(events[1].code,'57P01');
    pool.emit('error',new Error('no code'));
    assert.equal(events[2].code,'UNKNOWN');
    for(const e of events)assert.deepEqual(Object.keys(e).sort(),['code','event'],'no client object, no message, no secrets in the event');
  }finally{await pool.end();}
});
