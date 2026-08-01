import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateDown} from '../runtime/migrations.mjs';

function fakePool(identity){
  const queries=[];
  const client={
    async query(text){
      queries.push(String(text));
      if(String(text).startsWith('SELECT current_database()'))return {rows:[identity],rowCount:1};
      return {rows:[],rowCount:0};
    },
    release(){queries.push('RELEASE');}
  };
  return {queries,async connect(){return client;}};
}

test('down safety uses the actual connected database rather than the runtime URL',async()=>{
  const pool=fakePool({database_name:'refs_production',current_user:'refs_migrator',session_user:'refs_migrator'});
  await assert.rejects(()=>migrateDown(pool,{all:true}),error=>error.code==='DB_DOWN_FORBIDDEN');
  assert.ok(pool.queries.some(query=>query.includes('pg_advisory_lock')));
  assert.ok(pool.queries.some(query=>query.includes('pg_advisory_unlock')));
  assert.ok(!pool.queries.some(query=>/\b(DROP|ALTER|DELETE|CREATE)\b/i.test(query)));
});

test('runtime and issuer identities cannot run destructive migrations',async()=>{
  for(const user of ['refs_runtime','refs_context_issuer','refs_app']){
    const pool=fakePool({database_name:'refs_kernel_test',current_user:user,session_user:user});
    await assert.rejects(()=>migrateDown(pool),error=>error.code==='MIGRATION_IDENTITY_REJECTED');
    assert.ok(!pool.queries.some(query=>/\b(DROP|ALTER|DELETE|CREATE)\b/i.test(query)));
  }
});
