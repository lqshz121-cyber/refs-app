// db:reset must refuse before the first down runs when the applied chain has
// crossed an irreversibility barrier.
//
// Measured on ff163552 before this change: `migrate reset` on a fully migrated
// database committed twenty down migrations (421 -> 402) and then died on
// down/401 with a bare P0001, leaving 407 of 427 migrations and a schema with
// one fewer table. `db:up` repaired it, but a recovery command that half
// destroys the schema before announcing it cannot proceed is a trap, not a
// guard. The preflight below inspects every applied down body up front and
// refuses with the schema head, the barrier and the recovery path, touching
// nothing.
//
// Only unconditional refusals are detectable statically. Forty-three other
// down files refuse conditionally (IF EXISTS(SELECT 1 FROM retained_table)
// THEN RAISE ...) and those still fire mid-reset on a database that holds the
// evidence they protect; that is correct behaviour and out of scope here.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {downMigrationRefusesUnconditionally,migrateDown} from '../runtime/migrations.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
import {safeMigrationErrorCode} from '../runtime/migration-observability.mjs';

const downDir=new URL('../db/migrations/down/',import.meta.url);

function fakePool(appliedDesc){
  const queries=[];
  const client={
    async query(text){
      const sql=String(text);queries.push(sql);
      if(sql.startsWith('SELECT current_database()'))return {rows:[{database_name:'refs_kernel_test',current_user:'refs_migrator',session_user:'refs_migrator'}],rowCount:1};
      if(sql.startsWith("SELECT current_setting('statement_timeout')"))return {rows:[{statement_timeout:'10s',lock_timeout:'5s'}],rowCount:1};
      if(sql.includes('FROM refs_schema_migration ORDER BY migration_name DESC'))return {rows:appliedDesc.map(migration_name=>({migration_name})),rowCount:appliedDesc.length};
      return {rows:[],rowCount:0};
    },
    release(){queries.push('RELEASE');}
  };
  return {queries,async connect(){return client;}};
}

const withUrls=async fn=>{
  const urls={DATABASE_URL:'postgresql://refs_runtime:x@localhost/refs_kernel_test',MIGRATION_DATABASE_URL:'postgresql://refs_migrator:x@localhost/refs_kernel_test',CONTEXT_ISSUER_DATABASE_URL:'postgresql://refs_context_issuer:x@localhost/refs_kernel_test',GRANT_SYNC_DATABASE_URL:'postgresql://refs_grant_sync:x@localhost/refs_kernel_test'};
  const prior=Object.fromEntries(Object.keys(urls).map(k=>[k,process.env[k]]));
  Object.assign(process.env,urls);
  try{return await fn();}finally{for(const [k,v] of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
};

test('the corpus has exactly one unconditional down barrier and it is 401',async()=>{
  const names=(await readdir(downDir)).filter(n=>/^\d+_.+\.sql$/.test(n)).sort();
  const barriers=[];
  for(const name of names)if(downMigrationRefusesUnconditionally(await readFile(new URL(name,downDir),'utf8')))barriers.push(name);
  assert.deepEqual(barriers,['401_native_settlement_bank_account_control.sql'],
    'a new unconditional barrier moves the reset boundary - record it here deliberately');
});

test('the detector separates unconditional refusals from evidence-conditional ones',async()=>{
  // Real conditional barrier: refuses only while retained rows exist.
  const conditional=await readFile(new URL('122_ai_prepaid_coverage_findings.sql',downDir),'utf8');
  assert.equal(downMigrationRefusesUnconditionally(conditional),false);
  // Unconditional inside a guarded one - the 401 shape.
  assert.equal(downMigrationRefusesUnconditionally("BEGIN;\nDO $$\nBEGIN\n  IF EXISTS (SELECT 1 FROM t) THEN\n    RAISE EXCEPTION 'a';\n  END IF;\n  RAISE EXCEPTION 'b';\nEND;\n$$;\nCOMMIT;"),true);
  // Message text and DDL IF EXISTS must not be read as PL/pgSQL blocks.
  assert.equal(downMigrationRefusesUnconditionally("DO $$ BEGIN IF EXISTS(SELECT 1 FROM t) THEN RAISE EXCEPTION 'if this end if'; END IF; EXECUTE 'DROP TABLE IF EXISTS t'; END $$;"),false);
  // A RAISE inside a restored function body is not a refusal.
  assert.equal(downMigrationRefusesUnconditionally("CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'x'; END $$;"),false);
  // CASE nesting counts as a block.
  assert.equal(downMigrationRefusesUnconditionally("DO $$ BEGIN CASE WHEN true THEN RAISE EXCEPTION 'x'; ELSE NULL; END CASE; END $$;"),false);
});

test('reset on a chain that crossed 401 is refused before any down statement runs',async()=>{
  const applied=MIGRATION_MANIFEST.map(m=>m.name).reverse();
  const events=[];
  const pool=fakePool(applied);
  await withUrls(()=>assert.rejects(migrateDown(pool,{all:true,onEvent:e=>events.push(e)}),error=>{
    assert.equal(error.code,'MIGRATION_RESET_BLOCKED');
    assert.equal(error.details.first_irreversible_migration,'401_native_settlement_bank_account_control.sql');
    assert.equal(error.details.schema_head,MIGRATION_MANIFEST.at(-1).name);
    assert.equal(error.details.applied_count,MIGRATION_MANIFEST.length);
    assert.match(error.details.recovery,/backup/);
    assert.match(error.details.recovery,/forward/);
    return true;
  }));
  // ensureMetadata's CREATE TABLE IF NOT EXISTS refs_schema_migration is the
  // one CREATE allowed before the refusal; nothing else may touch the schema.
  const destructive=pool.queries.filter(q=>/\b(DROP|ALTER|DELETE|CREATE)\b/i.test(q)&&!/CREATE TABLE IF NOT EXISTS refs_schema_migration/.test(q));
  assert.deepEqual(destructive,[],'no destructive statement may run');
  assert.ok(!pool.queries.some(q=>q.includes('DELETE FROM refs_schema_migration')),'the ledger must be untouched');
  assert.ok(pool.queries.some(q=>q.includes('pg_advisory_unlock')),'the advisory lock is released on refusal');
  const blocked=events.find(e=>e.event==='migration_reset_blocked');
  assert.ok(blocked,'operators get the details as an event, not only an error code');
  assert.equal(blocked.first_irreversible_migration,'401_native_settlement_bank_account_control.sql');
  assert.equal(safeMigrationErrorCode({code:'MIGRATION_RESET_BLOCKED'}),'MIGRATION_RESET_BLOCKED','the code must survive redaction');
});

test('reset on a chain that has not crossed a barrier is not refused by the preflight',async()=>{
  const applied=MIGRATION_MANIFEST.map(m=>m.name).filter(n=>n<'401').reverse().slice(-3);
  const pool=fakePool(applied);
  let error=null;
  await withUrls(async()=>{try{await migrateDown(pool,{all:true});}catch(e){error=e;}});
  assert.notEqual(error?.code,'MIGRATION_RESET_BLOCKED');
});

test('single-step down is not affected by the preflight',async()=>{
  const pool=fakePool(MIGRATION_MANIFEST.map(m=>m.name).reverse());
  let error=null;
  await withUrls(async()=>{try{await migrateDown(pool);}catch(e){error=e;}});
  assert.notEqual(error?.code,'MIGRATION_RESET_BLOCKED');
});
