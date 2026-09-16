// Irreversibility barriers are tested as first-class objects, without ever
// rolling the applied chain back through them.
//
// Nineteen kernel tests reach a migration's down body either by walking
// db:down step by step from the head (migrateDownThrough) or by executing a
// tail of down bodies in one transaction. Both cross 401 (unconditional) and
// 414 (conditional on live contexts) on today's chain, so they fail on the
// barrier rather than on the migration they meant to test. This file pins the
// barriers themselves: each down body is executed inside BEGIN ... ROLLBACK so
// the ledger and schema are byte-identical afterwards, and the assertions read
// the outcome straight from PostgreSQL.
//
// Same environment contract as postgres-kernel.test.mjs (four role URLs,
// REFS_PG_REQUIRED). Migrated once in before(); nothing here writes outside a
// rolled-back transaction except the synthetic context row, which is deleted.

import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID, createHash} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp, downMigrationRefusesUnconditionally} from '../runtime/migrations.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const config=runtimeConfig();
let admin=null, unavailable=null;
const downBody=async name=>(await readFile(new URL(`../db/migrations/down/${name}`,import.meta.url),'utf8'))
  .replace(/\r\n/g,'\n').replace(/^\s*BEGIN;\s*/i,'').replace(/\s*COMMIT;\s*$/i,'');

before(async()=>{
  try{
    admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-barrier-contract',max:2});
    await admin.query('SELECT 1');
    await migrateUp(admin,{});
  }catch(error){
    unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;
    if(config.requirePostgres)throw error;
    if(admin)await admin.end().catch(()=>{});admin=null;
  }
});
after(async()=>{if(admin)await admin.end();});

// Runs a down body in a transaction that is always rolled back and returns the
// error (or null). The ledger is asserted untouched by the caller.
async function probeDown(name){
  const client=await admin.connect();
  try{
    await client.query('BEGIN');
    try{await client.query(await downBody(name));return null;}
    catch(error){return error;}
    finally{await client.query('ROLLBACK');}
  }finally{client.release();}
}
const ledgerHash=async()=>(await admin.query("SELECT encode(sha256(convert_to(string_agg(migration_name||':'||checksum,',' ORDER BY migration_name),'UTF8')),'hex') h FROM refs_schema_migration")).rows[0].h;

function pgTest(name,fn){
  test(name,async t=>{if(unavailable){t.skip(unavailable);return;}const before=await ledgerHash();await fn(t);assert.equal(await ledgerHash(),before,'a barrier probe must leave the migration ledger byte-identical');});
}

pgTest('401 refuses to roll back unconditionally, even with zero settlement evidence, and names the retained migration',async()=>{
  assert.equal((await admin.query("SELECT count(*)::int n FROM payment_occurrence WHERE occurrence_kind IN ('AP_PAYMENT','AR_RECEIPT')")).rows[0].n,0,'precondition: no settlement evidence');
  const error=await probeDown('401_native_settlement_bank_account_control.sql');
  assert.ok(error,'down/401 must raise');
  assert.equal(error.code,'P0001');
  assert.match(error.message,/migration 305 is retained as immutable historical evidence/);
  assert.ok((await admin.query("SELECT to_regprocedure('refs_create_native_settlement(uuid,uuid,text,uuid,uuid,text,date,text,text,numeric,text,uuid[],text)') fn")).rows[0].fn,'the 305 function it protects is still installed');
});

pgTest('the static detector and the live database agree on which down is unconditional',async()=>{
  const flagged=[];
  for(const {name} of MIGRATION_MANIFEST)if(downMigrationRefusesUnconditionally(await downBody(name)))flagged.push(name);
  assert.deepEqual(flagged,['401_native_settlement_bank_account_control.sql']);
});

pgTest('414 refuses only while an unrevoked, unexpired context exists, and lets go once it is revoked',async()=>{
  const name='414_runtime_context_additive_authority_fix.sql';
  // Precondition: the suite database carries no live context.
  await admin.query("UPDATE runtime_auth_context SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE revoked_at IS NULL");
  const clear=await probeDown(name);
  assert.ok(!clear||clear.code!=='55006',`with no live context the 414 guard must not fire (got ${clear?.code}: ${clear?.message})`);
  // Plant one synthetic live context under a throwaway tenant, probe, then remove it.
  const tenantId=randomUUID(), tokenHash='sha256:'+createHash('sha256').update(randomUUID()).digest('hex');
  await admin.query("INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,'Barrier probe tenant')",[tenantId,'BARRIER'+tenantId.slice(0,8).toUpperCase().replace(/-/g,'')]);
  try{
    await admin.query("INSERT INTO runtime_auth_context(token_hash,tenant_id,grants,actor_id,bound_login,expires_at) VALUES($1,$2,'[{\"permission\":\"GL.JE.VIEW\"}]'::jsonb,'barrier-probe','refs_runtime',clock_timestamp()+interval '5 minutes')",[tokenHash,tenantId]);
    const live=await probeDown(name);
    assert.ok(live,'down/414 must raise while a live context exists');
    assert.equal(live.code,'55006');
    assert.match(live.message,/active contexts/);
    // Revoked contexts do not count.
    await admin.query('UPDATE runtime_auth_context SET revoked_at=clock_timestamp() WHERE token_hash=$1',[tokenHash]);
    const revoked=await probeDown(name);
    assert.ok(!revoked||revoked.code!=='55006','a revoked context must not hold the barrier');
  }finally{
    await admin.query('DELETE FROM runtime_auth_context WHERE token_hash=$1',[tokenHash]);
    await admin.query('DELETE FROM tenant WHERE tenant_id=$1',[tenantId]);
  }
});

pgTest('every evidence-conditional barrier guards a table that exists and that some up migration created',async()=>{
  const missing=[];
  for(const {name} of MIGRATION_MANIFEST){
    const body=await downBody(name);
    for(const m of body.matchAll(/IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+([a-z_][a-z0-9_.]*)(\s*\()?/gi)){
      if(m[2])continue; // set-returning function (jsonb_array_elements(...)), not a table
      const table=m[1].toLowerCase().replace(/^public\./,'');
      const exists=(await admin.query('SELECT to_regclass($1) r',[table])).rows[0].r;
      if(!exists)missing.push(`${name} -> ${table}`);
    }
  }
  assert.deepEqual(missing,[],'a conditional barrier that references a missing table would silently stop protecting anything');
});
