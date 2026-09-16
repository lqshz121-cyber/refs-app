import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateDown} from '../runtime/migrations.mjs';

function fakePool(identity){
  const queries=[];
  const client={
    async query(text){
      queries.push(String(text));
      if(String(text).startsWith('SELECT current_database()'))return {rows:[identity],rowCount:1};
      if(String(text).startsWith("SELECT current_setting('statement_timeout')"))return {rows:[{statement_timeout:'10s',lock_timeout:'5s'}],rowCount:1};
      return {rows:[],rowCount:0};
    },
    release(){queries.push('RELEASE');}
  };
  return {queries,async connect(){return client;}};
}

test('down safety uses the actual connected database rather than the runtime URL',async()=>{
  const pool=fakePool({database_name:'refs_production',current_user:'refs_migrator',session_user:'refs_migrator'});
  // runtimeConfig() rejects the four role URLs unless they agree on endpoint and
  // database, so overriding MIGRATION_DATABASE_URL alone made this test throw
  // "must target the same database endpoint" and never reach the down guard
  // whenever the process already carried a real database environment - which is
  // exactly the configuration production and the fresh gate run under.
  const roleUrls={
    DATABASE_URL:'postgresql://refs_runtime:strong-test-only@localhost/refs_production',
    MIGRATION_DATABASE_URL:'postgresql://refs_migrator:strong-test-only@localhost/refs_production',
    CONTEXT_ISSUER_DATABASE_URL:'postgresql://refs_context_issuer:strong-test-only@localhost/refs_production',
    GRANT_SYNC_DATABASE_URL:'postgresql://refs_grant_sync:strong-test-only@localhost/refs_production'
  };
  const prior=Object.fromEntries(Object.keys(roleUrls).map(key=>[key,process.env[key]]));
  Object.assign(process.env,roleUrls);
  try{await assert.rejects(()=>migrateDown(pool,{all:true}),error=>error.code==='DB_DOWN_FORBIDDEN');}
  finally{for(const [key,value] of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  assert.ok(pool.queries.some(query=>query.includes('pg_advisory_lock')));
  assert.ok(pool.queries.some(query=>query.includes('pg_advisory_unlock')));
  assert.ok(pool.queries.some(query=>query.includes("set_config('statement_timeout','0',false)")));
  assert.ok(pool.queries.some(query=>query.includes("set_config('lock_timeout','0',false)")));
  assert.ok(pool.queries.some(query=>query.includes("set_config('statement_timeout',$1,false)")));
  assert.ok(!pool.queries.some(query=>/\b(DROP|ALTER|DELETE|CREATE)\b/i.test(query)));
});

test('runtime and issuer identities cannot run destructive migrations',async()=>{
  for(const user of ['refs_runtime','refs_context_issuer','refs_app']){
    const pool=fakePool({database_name:'refs_kernel_test',current_user:user,session_user:user});
    await assert.rejects(()=>migrateDown(pool),error=>error.code==='MIGRATION_IDENTITY_REJECTED');
    assert.ok(!pool.queries.some(query=>/\b(DROP|ALTER|DELETE|CREATE)\b/i.test(query)));
  }
});

test('migration rejects a connection to a database other than MIGRATION_DATABASE_URL',async()=>{
  const pool=fakePool({database_name:'wrong_test',current_user:'refs_migrator',session_user:'refs_migrator'});
  await assert.rejects(()=>migrateDown(pool),error=>error.code==='MIGRATION_DATABASE_REJECTED');
  assert.ok(!pool.queries.some(query=>/\b(DROP|ALTER|DELETE|CREATE)\b/i.test(query)));
});
