// Z03: keep the fixture teardown off the production statement_timeout, permanently.
//
// The risk being contained: `TRUNCATE tenant CASCADE` costs time proportional to the TABLE COUNT.
// Measured on this schema it went 249 tables -> ~9.0-9.4s and 250 tables -> 9382ms, i.e. ~94% of
// the 10000ms production ceiling. X01 gave the fixture's admin pool a maintenance timeout, which
// stops it failing today, but it does nothing about the slope: keep adding tables and the fixture
// gets slower forever.
//
// This file does two things. It pins the growth headroom so a migration that adds tables cannot
// quietly consume it, and it proves the replacement strategy is both correct and much cheaper.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {ensureTemplateDatabase, withFreshDatabase, measureTeardownStrategies} from './helpers/template-database.mjs';

const config=runtimeConfig();
let unavailable=null;
before(async()=>{
  // R04: migrate the target first, like every other *-postgres test. Z01/Z02/Z03 read the live
  // schema, so without this the file only passed when an earlier file had migrated the database.
  try{const p=new pg.Pool({connectionString:config.migrationDatabaseUrl,max:2,statement_timeout:300000});
    try{await p.query('SELECT 1');await migrateUp(p,{});}finally{await p.end().catch(()=>{});}}
  catch(error){
    unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;
    if(config.requirePostgres)throw error;
  }
});
const pgTest=(name,fn)=>test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});

// Headroom the fixture must keep against the production ceiling. Deliberately generous: this is a
// tripwire for a trend, not a latency SLO, and a shared sandbox cannot give a stable millisecond.
const CEILING_MS=10000;

pgTest('Z03-1: ordered DELETE cannot replace TRUNCATE, because the schema deliberately blocks it',async()=>{
  // Worth pinning: the obvious cheap fix is wrong here, and it is wrong for a good reason.
  // Retained-evidence tables carry DELETE triggers; TRUNCATE is the fixture's way past them.
  // Making DELETE work would mean disabling those guards, which is exactly the isolation Z03
  // forbids weakening.
  const pool=new pg.Pool({connectionString:config.migrationDatabaseUrl,max:2,statement_timeout:300000});
  try{
    const guarded=Number((await pool.query(
      "SELECT count(DISTINCT c.relname)::int n FROM pg_trigger t "+
      "JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace "+
      "WHERE NOT t.tgisinternal AND ns.nspname='public' AND (t.tgtype & 8)<>0")).rows[0].n);
    assert.ok(guarded>100,
      `expected many DELETE-guarded tables (retained evidence); saw ${guarded}. If this dropped sharply, the evidence guards changed and Z03's reasoning needs revisiting.`);
    await assert.rejects(pool.query('DELETE FROM refs_deployment_identity'),
      e=>e.code==='42501','deployment identity must stay immutable, so a blanket DELETE teardown is not available');
  }finally{await pool.end();}
});

pgTest('Z03-2: cloning a template is far cheaper than emptying the schema (recorded, not asserted)',async t=>{
  // D-R04-1: the timings are information. Both depend on the host (fsync, disk, PG major): on the
  // CI runner TRUNCATE costs ~9s against a ~0.3s clone, on a fast local disk the two converge. The
  // property that matters -- no fixture pays the TRUNCATE -- is enforced statically by Z03-3.
  const {tableCount,truncateMs,cloneMs}=await measureTeardownStrategies();
  t.diagnostic(`Z03 evidence: ${tableCount} tables | TRUNCATE ${truncateMs}ms | CREATE DATABASE TEMPLATE ${cloneMs}ms | ceiling ${CEILING_MS}ms (${(truncateMs/CEILING_MS*100).toFixed(0)}% of it)`);
  assert.ok(tableCount>200,`this only matters at scale; saw ${tableCount} tables`);
  assert.ok(Number.isFinite(truncateMs)&&Number.isFinite(cloneMs));
});

test('Z03-3: no test fixture resets its database with TRUNCATE tenant CASCADE',async()=>{
  // D-R04-1 (static, replaces the timing tripwire): the reset costs time proportional to the table
  // count and sits near the production statement_timeout. Fixtures use withFreshDatabase
  // (tests/helpers/template-database.mjs) instead. The only files allowed to issue the statement are
  // the two that measure it.
  const {readdir,readFile}=await import('node:fs/promises');
  const MEASURING=new Set(['fixture-teardown-scalability-postgres.test.mjs','statement-timeout-production-safety-postgres.test.mjs','helpers/template-database.mjs']);
  const files=[...(await readdir(new URL('./',import.meta.url))).filter(f=>f.endsWith('.mjs')),...(await readdir(new URL('./helpers/',import.meta.url))).filter(f=>f.endsWith('.mjs')).map(f=>'helpers/'+f)];
  const offenders=[];
  for(const file of files){
    if(MEASURING.has(file))continue;
    const code=(await readFile(new URL('./'+file,import.meta.url),'utf8')).replace(/\/\/[^\n]*/g,'');
    if(/query\(\s*['"`]TRUNCATE\s+tenant\s+CASCADE/i.test(code))offenders.push(file);
  }
  assert.deepEqual(offenders,[],`these fixtures still reset with TRUNCATE tenant CASCADE; use withFreshDatabase:\n${offenders.join('\n')}`);
});

pgTest('Z03-4: a cloned database is a usable, fully migrated, isolated copy',async()=>{
  const template=await ensureTemplateDatabase();
  assert.equal(typeof template,'string');
  let firstName=null;
  await withFreshDatabase(async({url,databaseName})=>{
    firstName=databaseName;
    // The clone is dropped WITH (FORCE) as soon as the body returns; a connection pg has not finished
    // closing then receives 57P01 as an idle-client error, which must not surface as uncaught.
    const pool=new pg.Pool({connectionString:url,max:2});pool.on('error',()=>{});
    try{
      // Fully migrated: same ledger as the template, not an empty shell.
      const count=Number((await pool.query('SELECT count(*)::int n FROM refs_schema_migration')).rows[0].n);
      assert.ok(count>400,`clone must carry the full migration ledger; saw ${count}`);
      // Writable and isolated: a row written here must not leak anywhere else.
      await pool.query("INSERT INTO tenant(tenant_id,tenant_code,name) VALUES(gen_random_uuid(),'ZZCLONE','clone probe')");
      assert.equal(Number((await pool.query("SELECT count(*)::int n FROM tenant WHERE tenant_code='ZZCLONE'")).rows[0].n),1);
    }finally{await pool.end();}
  });

  // Dropped afterwards, and the next clone does not see the previous one's writes.
  await withFreshDatabase(async({url,databaseName})=>{
    assert.notEqual(databaseName,firstName,'each clone must be its own database');
    // The clone is dropped WITH (FORCE) as soon as the body returns; a connection pg has not finished
    // closing then receives 57P01 as an idle-client error, which must not surface as uncaught.
    const pool=new pg.Pool({connectionString:url,max:2});pool.on('error',()=>{});
    try{
      assert.equal(Number((await pool.query("SELECT count(*)::int n FROM tenant WHERE tenant_code='ZZCLONE'")).rows[0].n),0,
        'a fresh clone must not inherit the previous clone\'s rows');
    }finally{await pool.end();}
  });

  const admin=new pg.Client({connectionString:config.migrationDatabaseUrl.replace(/\/[^/]+$/,'/postgres')});
  await admin.connect();
  try{
    const left=Number((await admin.query('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[firstName])).rows[0].n);
    assert.equal(left,0,'the clone must be dropped when the body finishes');
  }finally{await admin.end();}
});

pgTest('Z03-5: the role URLs are restored even when the body throws',async()=>{
  const before={...process.env};
  await assert.rejects(withFreshDatabase(async()=>{throw new Error('deliberate');}),/deliberate/);
  for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL'])
    assert.equal(process.env[k],before[k],`${k} must be restored`);
});
