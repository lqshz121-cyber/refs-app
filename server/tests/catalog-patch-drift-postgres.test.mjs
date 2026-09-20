// Some migrations in this chain do not define a function -- they amend the one already installed:
//
//   SELECT pg_get_functiondef('refs_apply_ap_ar_posted_adjustment()'::regprocedure) INTO fn;
//   fn:=replace(fn,'<old text>','<new text>');
//   EXECUTE fn;
//
// The amendment lives only in the catalog. Nothing in db/migrations/ records that the function's
// definitive text has moved on, so a later migration that rebuilds the same function with
// CREATE OR REPLACE -- using the last whole definition in the tree as its base -- silently reverts
// every amendment made since, and the migration chain still applies cleanly.
//
// That is not hypothetical. 435 rebuilt refs_apply_ap_ar_posted_adjustment from 010 and dropped
// 028's kind scope guard and 423's void status widening with it. The cost was AP payment reversal,
// AR receipt reversal and AP bill void, all dead at the database level, and the chain reported
// success. 436 restored them.
//
// This file makes that class of regression fail loudly at head: it reads every amendment the
// migrations declare, and asserts each one is still present in the live catalog.
//
// Same environment contract as postgres-kernel.test.mjs (four role URLs, REFS_PG_REQUIRED).
// Read-only: it reads pg_proc and the migration files, and writes nothing.

import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';

const config=runtimeConfig();
const MIGRATIONS=new URL('../db/migrations/',import.meta.url);
let admin=null, unavailable=null, amendments=[], liveDefinition=new Map();

// replace(fn,'a','b') as written in these migrations: single-quoted SQL literals, '' for a quote,
// possibly spanning lines. Captures the replacement half, which is what must survive.
const REPLACE_CALL=/replace\(\s*fn\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)/gs;
const FUNCTION_TARGET=/pg_get_functiondef\(\s*'([a-z0-9_]+)\(\)'::regprocedure\s*\)\s*INTO\s+fn/gi;
const unquote=s=>s.replace(/''/g,"'");

before(async()=>{
  try{
    admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-catalog-patch-drift',max:2});
    await admin.query('SELECT 1');
    await migrateUp(admin,{});

    const files=(await readdir(MIGRATIONS,{withFileTypes:true}))
      .filter(e=>e.isFile()&&/^\d+_.+\.sql$/.test(e.name)).map(e=>e.name).sort();
    for(const name of files){
      const sql=(await readFile(new URL(name,MIGRATIONS),'utf8')).replace(/\r\n/g,'\n');
      if(!/pg_get_functiondef/.test(sql))continue;
      // Each DO block amends one function; pair the target named in the block with the replaces
      // that follow it inside the same block.
      for(const block of sql.split(/\bDO\s*\$\$/i).slice(1)){
        FUNCTION_TARGET.lastIndex=0;
        const target=FUNCTION_TARGET.exec(block);
        if(!target)continue;
        REPLACE_CALL.lastIndex=0;
        for(const m of block.matchAll(REPLACE_CALL)){
          amendments.push({migration:name,fn:target[1],from:unquote(m[1]),to:unquote(m[2])});
        }
      }
    }
    for(const fn of new Set(amendments.map(a=>a.fn))){
      const row=(await admin.query('SELECT pg_get_functiondef(oid) d FROM pg_proc WHERE proname=$1',[fn])).rows[0];
      liveDefinition.set(fn,row?row.d:null);
    }
  }catch(error){
    unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;
    if(config.requirePostgres)throw error;
    if(admin)await admin.end().catch(()=>{});admin=null;
  }
});
after(async()=>{if(admin)await admin.end();});

const pgTest=(name,fn)=>test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});

pgTest('CPD-1: the scan actually found the in-place amendments it is meant to police',()=>{
  assert.ok(amendments.length>=5,
    `expected the chain's pg_get_functiondef amendments to be discovered, found ${amendments.length}; `+
    'if the idiom changed, update the parser rather than letting this test pass vacuously');
  const targets=new Set(amendments.map(a=>a.fn));
  for(const fn of ['refs_apply_ap_ar_posted_adjustment','refs_apply_ap_payment_reversal_posted'])
    assert.ok(targets.has(fn),`${fn} is amended in place by the chain and must be in scope`);
});

pgTest('CPD-2: every function amended in place still exists at head',()=>{
  const missing=[...liveDefinition].filter(([,d])=>d===null).map(([fn])=>fn);
  assert.deepEqual(missing,[],`amended functions dropped from the catalog: ${missing.join(', ')}`);
});

pgTest('CPD-3: every in-place amendment survives to head',()=>{
  // The last amendment of a given text wins. An amendment is satisfied if its replacement text is
  // live, or if a later amendment in the chain took ownership of the same text -- either by
  // rewriting this amendment's output (b.from===a.to) or by re-deriving from the same input
  // (b.from===a.from), which is what a repair migration re-applying a lost patch looks like.
  const reverted=[];
  for(const [index,a] of amendments.entries()){
    const live=liveDefinition.get(a.fn);
    if(live===null)continue;
    if(live.includes(a.to))continue;
    const supersededLater=amendments.slice(index+1)
      .some(b=>b.fn===a.fn&&(b.from===a.to||b.from===a.from));
    if(supersededLater)continue;
    reverted.push(`${a.migration} -> ${a.fn}: replacement text is no longer in the live definition\n`+
                  `    expected to find: ${a.to.slice(0,120)}${a.to.length>120?' ...':''}`);
  }
  assert.deepEqual(reverted,[],
    'an in-place amendment has been lost, almost certainly by a later CREATE OR REPLACE rebuilt from\n'+
    'a stale base. Re-apply it in a new migration rather than editing the one that dropped it:\n'+
    reverted.join('\n'));
});

pgTest('CPD-4: the generic adjustment reducer only claims kinds it can actually handle',()=>{
  // The concrete invariant behind CPD-3's most expensive instance. The scope guard list and the
  // branch set must move together: a kind in the branches but not the list is never activated, and
  // a kind in neither is claimed away from the reducer that owns it.
  const live=liveDefinition.get('refs_apply_ap_ar_posted_adjustment');
  const scope=/adj\.adjustment_kind NOT IN \(([^)]*)\)/.exec(live);
  assert.ok(scope,'the 028 kind scope guard must be present');
  const listed=new Set([...scope[1].matchAll(/'([A-Z_]+)'/g)].map(m=>m[1]));
  const branched=new Set([...live.matchAll(/adj\.adjustment_kind\s*(?:=\s*'([A-Z_]+)'|IN \(([^)]*)\))/g)]
    .flatMap(m=>m[1]?[m[1]]:[...m[2].matchAll(/'([A-Z_]+)'/g)].map(x=>x[1])));
  for(const kind of ['AP_BILL_VOID','AP_VENDOR_CREDIT','AP_BILL_WRITE_OFF','AR_INVOICE_WRITE_OFF'])
    assert.ok(branched.has(kind)&&listed.has(kind),
      `${kind} must appear in both the scope guard and a branch (guard=${listed.has(kind)}, branch=${branched.has(kind)})`);
  const branchedButNotListed=[...branched].filter(k=>!listed.has(k));
  assert.deepEqual(branchedButNotListed,[],
    `these kinds have a branch but are filtered out before reaching it: ${branchedButNotListed.join(', ')}`);
});
