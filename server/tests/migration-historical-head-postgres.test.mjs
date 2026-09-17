// S18: historical down/up tests must not walk the live chain back through
// irreversible barriers (down/401 is unconditional; 43 others refuse when they
// hold evidence). Instead a test builds the historical head it needs on a fresh
// _test database with migrateUp({until}) and exercises that migration alone.
// This file proves the primitive; the twenty migrateDownThrough call sites in
// postgres-kernel.test.mjs are to be converted one by one (see
// server/MIGRATION-BARRIER-TEST-DESIGN.md).
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {migrateUp, migrateDown} from '../runtime/migrations.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const url=process.env.MIGRATION_DATABASE_URL||'';
const URL_KEYS=['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL'];
const saved=Object.fromEntries(URL_KEYS.map(k=>[k,process.env[k]]));
const retarget=name=>{for(const k of URL_KEYS){if(!saved[k])continue;const u=new URL(saved[k]);u.pathname='/'+name;process.env[k]=u.toString();}};
const HIST='317_native_sales_receipt.sql';
let admin, pool, unavailable=null, dbName;
before(async()=>{
  if(!url){unavailable='MIGRATION_DATABASE_URL not set';return;}
  const base=new URL(url);dbName=`refs_hist_${Date.now().toString(36)}_test`;
  admin=new pg.Client({connectionString:url});await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  base.pathname='/'+dbName;pool=new pg.Pool({connectionString:base.toString(),max:2});
  // runtimeConfig requires every role URL to target the same database; point all four at the fresh one for this file.
  retarget(dbName);
});
after(async()=>{if(pool)await pool.end();if(admin){await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);await admin.end();}for(const k of URL_KEYS){if(saved[k]!==undefined)process.env[k]=saved[k];}});
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}
const head=async()=>(await pool.query('SELECT migration_name FROM refs_schema_migration ORDER BY migration_name DESC LIMIT 1')).rows[0]?.migration_name??null;
const count=async()=>(await pool.query('SELECT count(*)::int n FROM refs_schema_migration')).rows[0].n;

pgTest('until builds exactly the historical head and nothing after it',async()=>{
  await migrateUp(pool,{until:HIST});
  assert.equal(await head(),HIST);
  assert.equal(await count(),MIGRATION_MANIFEST.findIndex(m=>m.name===HIST)+1);
});
pgTest('the historical migration itself rounds down and up without touching any barrier',async()=>{
  await migrateDown(pool);assert.notEqual(await head(),HIST);
  await migrateUp(pool,{until:HIST});assert.equal(await head(),HIST);
});
pgTest('a full migrateUp afterwards reaches the release head, so the fixture is not a fork',async()=>{
  await migrateUp(pool);assert.equal(await count(),MIGRATION_MANIFEST.length);
});
pgTest('until refuses an unknown target and never applies anything for it',async()=>{
  await assert.rejects(migrateUp(pool,{until:'999_nope.sql'}),e=>e.code==='MIGRATION_UNTIL_UNKNOWN');
});
pgTest('until refuses a database whose name does not end in _test',async()=>{
  // Only the identity check is exercised here: the connected _test database is what we have, so simulate
  // the refusal through a pool whose current_database() answer is rewritten.
  const client=await pool.connect();
  const fake={connect:async()=>({query:async(text,params)=>{const sql=String(text);if(sql.startsWith('SELECT current_database()')){const r=await client.query(text,params);r.rows[0].database_name='refs_production';return r;}return client.query(text,params);},release(){}})};
  try{await assert.rejects(migrateUp(fake,{until:HIST}),e=>e.code==='MIGRATION_DATABASE_REJECTED'||e.code==='MIGRATION_UNTIL_FORBIDDEN');}finally{client.release();}
});
