// db:up runs as Render's preDeployCommand for every deploy, including a
// "rollback to previous deploy". The previous build's migrateUp used to
// iterate only the files it ships, mark each 'skipped' because the ledger
// already held them, and never notice the ledger rows written by the newer
// release. Old code then served a newer schema with no signal anywhere.
// Application rollback in this system is forward-only (see
// PRODUCTION-RECOVERY-RUNBOOK.md); this preflight turns that policy into a
// refusal at the only place it can be enforced automatically.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {migrateUp} from '../runtime/migrations.mjs';
import {safeMigrationErrorCode} from '../runtime/migration-observability.mjs';

const upDir=new URL('../db/migrations/',import.meta.url);

function fakePool(ledgerRows){
  const queries=[];
  const client={
    async query(text,params){
      const sql=String(text);queries.push({sql,params});
      if(sql.startsWith('SELECT current_database()'))return {rows:[{database_name:'refs_kernel_test',current_user:'refs_migrator',session_user:'refs_migrator'}],rowCount:1};
      if(sql.startsWith("SELECT current_setting('statement_timeout')"))return {rows:[{statement_timeout:'10s',lock_timeout:'5s'}],rowCount:1};
      if(sql.includes('FROM refs_schema_migration ORDER BY migration_name'))return {rows:ledgerRows,rowCount:ledgerRows.length};
      if(sql.includes('FROM refs_schema_migration WHERE migration_name=$1')){const row=ledgerRows.find(r=>r.migration_name===params[0]);return row?{rows:[{checksum:row.checksum}],rowCount:1}:{rows:[],rowCount:0};}
      return {rows:[],rowCount:0};
    },
    release(){queries.push({sql:'RELEASE'});}
  };
  return {queries,async connect(){return client;}};
}

test('a ledger holding migrations this build does not ship refuses before any migration statement runs',async()=>{
  const files=(await readdir(upDir)).filter(name=>name.endsWith('.sql')).sort();
  const head=files[files.length-1];
  const ledger=[{migration_name:'998_future_release_a.sql',checksum:'a'.repeat(64)},{migration_name:'999_future_release_b.sql',checksum:'b'.repeat(64)}];
  const pool=fakePool(ledger);
  const events=[];
  await assert.rejects(migrateUp(pool,{onEvent:event=>events.push(event)}),error=>{
    assert.equal(error.code,'MIGRATION_LEDGER_AHEAD');
    assert.equal(error.details.release_head,head);
    assert.equal(error.details.schema_head,'999_future_release_b.sql');
    assert.deepEqual(error.details.unknown_migrations,['998_future_release_a.sql','999_future_release_b.sql']);
    assert.match(error.details.recovery,/forward-only/);
    return true;
  });
  assert.equal(safeMigrationErrorCode({code:'MIGRATION_LEDGER_AHEAD'}),'MIGRATION_LEDGER_AHEAD');
  assert.deepEqual(events.map(e=>e.event),['migration_ledger_ahead']);
  // Nothing was executed or recorded: no BEGIN, no INSERT into the ledger.
  assert.equal(pool.queries.filter(q=>/^(BEGIN|INSERT INTO refs_schema_migration)/.test(q.sql)).length,0);
  // The advisory lock was released on the way out.
  assert.ok(pool.queries.some(q=>q.sql.includes('pg_advisory_unlock')));
});

test('a ledger that is a strict prefix of the shipped chain still proceeds (normal forward deploy)',async()=>{
  const files=(await readdir(upDir)).filter(name=>name.endsWith('.sql')).sort();
  // Ledger = everything applied with the real checksums is expensive to fake;
  // an empty ledger is the fresh-database case and must not be mistaken for
  // "ahead". Statements run through the fake and are recorded.
  const pool=fakePool([]);
  const events=[];
  await migrateUp(pool,{onEvent:event=>events.push(event)});
  assert.equal(events.filter(e=>e.event==='migration_ledger_ahead').length,0);
  assert.equal(pool.queries.filter(q=>q.sql.startsWith('INSERT INTO refs_schema_migration')).length,files.length);
});
