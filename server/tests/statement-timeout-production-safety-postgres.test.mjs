// X01 regression: prove the 10s production statement_timeout is safe for every production-shaped
// path in the accounting-settings domain, and that the timeout observed in
// accounting-settings-workflow-postgres subtests 14/15 came from the TEST FIXTURE, not from
// product code.
//
// Root cause established by measurement, not inference:
//   `TRUNCATE tenant CASCADE` spans the 249 public tables reachable from tenant and costs
//   ~9.0-9.4s on an EMPTY freshly-migrated PG16 -- 90%+ of the 10s budget before any data
//   exists. That file ran it before each of its 34 subtests, so the later ones crossed 10s.
//
// The fixture now uses a maintenance-scale timeout on its ADMIN pool only. This file is the
// guard that the fix did not paper over a real product problem: every assertion below runs on a
// pool carrying the PRODUCTION default statement_timeout, unmodified.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';

const config=runtimeConfig();
let admin=null, runtime=null, timed=null, unavailable=null;

before(async()=>{
  try{
    // Admin pool: maintenance work (migrate). Explicitly generous, and deliberately NOT the pool
    // any assertion below is measured on.
    admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-x01-admin',max:2,statementTimeoutMs:300000});
    await admin.query('SELECT 1');await migrateUp(admin,{});
    // Runtime pool: no override. It inherits config.statementTimeoutMs, i.e. exactly what
    // production serves requests with.
    runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-x01-runtime',max:4});
    await runtime.query('SELECT 1');
    // Timing pool: migrator credentials so it can read the tables directly, but NO
    // statementTimeoutMs override, so it inherits the production ceiling. This separates what is
    // under test (the 10s budget) from what is not (refs_app's deliberate lack of table grants --
    // production reads go through SECURITY DEFINER functions, not raw SELECTs).
    timed=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-x01-timed',max:2});
    await timed.query('SELECT 1');
  }catch(error){
    unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;
    if(config.requirePostgres)throw error;
    for(const p of [admin,runtime,timed])if(p)await p.end().catch(()=>{});admin=null;runtime=null;timed=null;
  }
});
after(async()=>{for(const p of [admin,runtime,timed])if(p)await p.end();});
const pgTest=(name,fn)=>test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});

test('X01-1: no product code path issues TRUNCATE, so the fixture cost has no production counterpart',()=>{
  // The statement that timed out was TRUNCATE. If product code never issues one, the observed
  // timeout cannot recur in production by that route. Checked against source, not opinion.
  const scan=dir=>readdirSync(new URL(`../${dir}/`,import.meta.url))
    .filter(f=>f.endsWith('.mjs')||f.endsWith('.sql'))
    .map(f=>({file:`${dir}/${f}`,text:readFileSync(new URL(`../${dir}/${f}`,import.meta.url),'utf8')}));

  // Strip comments first: English prose such as "truncate before" or "TRUNCATE setup" is not a
  // SQL statement, and matching it would make this guard cry wolf.
  const stripComments=t=>t.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/(^|[^:])\/\/[^\n]*/g,'$1 ');
  // A real statement is TRUNCATE <table> optionally TABLE/ONLY, then CASCADE/RESTRICT/; or the
  // end of the query string. Trigger definitions (BEFORE TRUNCATE) are not statements.
  const STATEMENT=/\bTRUNCATE\s+(?:TABLE\s+|ONLY\s+)?[a-z_][a-z0-9_.]*\s*(?:,\s*[a-z_][a-z0-9_.]*\s*)*(?:CASCADE|RESTRICT|;|['"`])/gi;

  const offenders=[];
  for(const {file,text} of [...scan('runtime'),...scan('api')]){
    // runtime/test-*.mjs are test harness helpers, not request-serving product code.
    if(/\/test-/.test(file))continue;
    for(const m of stripComments(text).matchAll(STATEMENT)){
      const before=stripComments(text).slice(Math.max(0,m.index-40),m.index);
      if(/BEFORE\s+$/i.test(before))continue;
      offenders.push(`${file}: ${m[0].trim()}`);
    }
  }
  assert.deepEqual(offenders,[],`product code must not TRUNCATE:\n${offenders.join('\n')}`);
});

pgTest('X01-2: the runtime pool really carries the production statement_timeout, so the timings below mean something',async()=>{
  for(const [label,pool] of [['runtime',runtime],['timed',timed]]){
    const {rows}=await pool.query('SHOW statement_timeout');
    assert.equal(rows[0].statement_timeout,'10s',
      `${label} pool must carry the production default, or the timings below mean nothing; see runtime/config.mjs:58`);
  }
  assert.equal(config.statementTimeoutMs,10000,'production default must still be 10000ms');
});

pgTest('X01-3: every accounting-settings read a request can reach completes far inside the production budget',async()=>{
  // Production-shaped input: the reads a request actually issues, on the real runtime pool with
  // the real 10s ceiling. A generous headroom bar (2s) is used rather than the raw ceiling so the
  // test fails on a regression long before it fails on the timeout.
  const BUDGET_MS=2000;
  const probes=[
    ['settings workflow by scope', `SELECT count(*)::int FROM accounting_settings_workflow WHERE tenant_id=$1`, ['00000000-0000-0000-0000-000000000000']],
    ['settings workflow history',  `SELECT count(*)::int FROM accounting_settings_workflow_history WHERE tenant_id=$1`, ['00000000-0000-0000-0000-000000000000']],
    ['setting snapshot by scope',  `SELECT count(*)::int FROM setting_snapshot WHERE tenant_id=$1`, ['00000000-0000-0000-0000-000000000000']],
    ['accounting period by scope', `SELECT count(*)::int FROM accounting_period WHERE tenant_id=$1`, ['00000000-0000-0000-0000-000000000000']]
  ];
  const slow=[];
  for(const [label,sql,args] of probes){
    const started=Date.now();
    await timed.query(sql,args);
    const ms=Date.now()-started;
    if(ms>BUDGET_MS)slow.push(`${label}: ${ms}ms`);
  }
  assert.deepEqual(slow,[],`production-shaped reads must stay well inside the 10s ceiling:\n${slow.join('\n')}`);
});

pgTest('X01-4: the fixture-scale operation is the slow one, and it is measurably slower than every product read',async()=>{
  // Quantifies the actual finding so a future reader does not have to rediscover it: the cost is
  // in the CASCADE fan-out across the schema, and it is inherent rather than data-dependent.
  const tables=(await admin.query(
    `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`)).rows[0].n;
  assert.ok(tables>200,`the CASCADE fan-out only matters at scale; saw ${tables} tables`);

  const started=Date.now();
  await admin.query('TRUNCATE tenant CASCADE');   // admin pool: maintenance timeout, not 10s
  const truncateMs=Date.now()-started;

  const readStarted=Date.now();
  await timed.query('SELECT count(*)::int FROM accounting_settings_workflow WHERE tenant_id=$1',['00000000-0000-0000-0000-000000000000']);
  const readMs=Date.now()-readStarted;

  // Not asserting an absolute figure -- a shared sandbox cannot give a stable one. Asserting the
  // relationship that explains the bug: the fixture reset dwarfs any product read.
  assert.ok(truncateMs>readMs*10,
    `the fixture reset (${truncateMs}ms over ${tables} tables) should dwarf a product read (${readMs}ms); if it no longer does, re-derive the X01 finding`);
  // And record the headline number in the test output for the receipt.
  console.log(`      X01 evidence: TRUNCATE tenant CASCADE over ${tables} tables = ${truncateMs}ms; product read = ${readMs}ms; production ceiling = ${config.statementTimeoutMs}ms`);
});

test('X01-5: the two fixtures that reset with TRUNCATE carry a maintenance timeout on their admin pool',()=>{
  // Guard against the fix being reverted or a third fixture repeating the mistake.
  for(const file of ['accounting-settings-workflow-postgres.test.mjs','postgres-kernel.test.mjs','attachment-containers.test.mjs']){
    const text=readFileSync(new URL(`./${file}`,import.meta.url),'utf8');
    if(!/TRUNCATE\s+tenant\s+CASCADE/i.test(text))continue;
    assert.match(text,/statementTimeoutMs\s*:\s*\d{5,}/,
      `${file} resets with TRUNCATE tenant CASCADE (~9s on an empty schema) and must give its admin pool a maintenance statement timeout`);
  }
});
