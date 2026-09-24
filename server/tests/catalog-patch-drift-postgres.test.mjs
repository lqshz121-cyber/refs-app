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
// R07 widened this file from the two zero-argument reducers to the whole chain:
//   - the parser (helpers/catalog-amendments.mjs) understands every amendment idiom in use --
//     argument signatures, `public.` prefixes, multi-line targets, `definition:=` assignment,
//     conditional re-application -- and reports what it could not resolve instead of ignoring it;
//   - db/FUNCTION-CATALOG.json pins the sha256 of every live function definition at head, so a
//     whole-function rebuild that reverts a catalog patch changes a recorded hash and fails here,
//     even for a patch whose replacement text this parser never saw.
//
// Same environment contract as postgres-kernel.test.mjs (four role URLs, REFS_PG_REQUIRED).
// Read-only: it reads pg_proc and the migration files, and writes nothing.

import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
import {parseAmendments} from './helpers/catalog-amendments.mjs';
import {readLiveFunctionCatalog, readPostgresMajor, FUNCTION_CATALOG_PATH, FUNCTION_CATALOG_SCHEMA} from '../runtime/export-function-catalog.mjs';

const config=runtimeConfig();
const MIGRATIONS=new URL('../db/migrations/',import.meta.url);
let admin=null, unavailable=null, amendments=[], unresolved=[], liveDefinition=new Map(), liveCatalog=null, liveMajor=null, livePronames=new Set();

// Blocks the parser is known not to resolve statically, with the reason. Anything else that fails
// to resolve is a new idiom and must be added to the parser, not to this list.
// Literal amendments whose text was later removed on purpose by a whole redefinition or retirement,
// not by a stale rebuild. Each names the migration that took ownership and a fragment that must be
// live instead -- so the entry keeps guarding the function rather than just silencing it.
const SUPERSEDED_BY_REDEFINITION=[
  {migration:'140_ai_analysis_explain_scope.sql',fn:'refs_complete_ai_accounting_analysis_explanation(uuid,uuid,text,text,jsonb)',
   from:"(action-'category'-'action')",by:'140 (later CREATE OR REPLACE in the same file) narrows the key check to an ARRAY difference',
   mustContain:"action.value-ARRAY['category','action','finding_ids']::text[]"},
  {migration:'179_wbs_test_bank_range_batch.sql',fn:'refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text)',
   from:null,by:'181 raised the controlled-test Bank row limit from 500 to 10,000',
   mustContain:'Controlled test Bank observation must contain one to ten thousand rows'},
  {migration:'250_wbs_test_bank_checkpoint_integrity.sql',fn:'refs_finalize_wbs_test_bank_staged_import(uuid,uuid,uuid)',
   from:null,by:'276 retired the legacy staged-import boundary (SoD); the function now refuses',
   mustContain:"disabled after migration 276"},
  {migration:'270_wbs_h1_payable_reclass_vendor_identity.sql',fn:'refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text)',
   from:"AND journal_entry_id=trace.journal_entry_id AND account_code='610000' AND debit_amount=source_row.amount AND credit_amount=0 FOR SHARE;",
   by:'438: 270 anchored on trace.journal_entry_id, which 269 never had, so this guard never applied; 438 applies it on the live anchor',
   mustContain:"AND account_code='610000' AND debit_amount=source_row.amount AND credit_amount=0 AND member_ref IS NULL AND dimensions='{}'::jsonb FOR SHARE;"},
];
const supersededEntry=a=>SUPERSEDED_BY_REDEFINITION.find(e=>e.migration===a.migration&&e.fn===a.fn&&(e.from===null||e.from===a.from));
const compact=s=>s.replace(/\s+/g,'');
// 372 idiom: replace(def,'public.f(','public.f_pre_372(') + EXECUTE creates a retained copy under a
// new name; the target itself is not amended. Satisfied when the copy exists.
const renameCopy=a=>{
  const from=/^public\.([a-z0-9_]+)\($/.exec(a.from||''),to=/^public\.([a-z0-9_]+)\($/.exec(a.to||'');
  return from&&to&&from[1]!==to[1]?to[1]:null;
};

const KNOWN_DYNAMIC=new Map([
  ['140_ai_analysis_explain_scope.sql','loops over a VALUES list of signatures (target.signature::regprocedure)'],
  ['313_credit_allocation_capacity.sql','loops over a VALUES list of signatures (item.signature::regprocedure)'],
]);

before(async()=>{
  try{
    admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-catalog-patch-drift',max:2});
    await admin.query('SELECT 1');
    await migrateUp(admin,{});

    const files=(await readdir(MIGRATIONS,{withFileTypes:true}))
      .filter(e=>e.isFile()&&/^\d+_.+\.sql$/.test(e.name)).map(e=>e.name).sort();
    for(const name of files){
      const parsed=parseAmendments(await readFile(new URL(name,MIGRATIONS),'utf8'),name);
      amendments.push(...parsed.amendments);
      unresolved.push(...parsed.unresolved);
    }
    for(const fn of new Set(amendments.map(a=>a.fn))){
      // Resolve by full signature, not proname: overloads (refs_ap_control_total 2-arg vs 3-arg)
      // are distinct functions and must be checked separately.
      const row=await admin.query('SELECT pg_get_functiondef($1::regprocedure) d',[fn]).catch(()=>null);
      liveDefinition.set(fn,row?.rows?.[0]?.d??null);
    }
    liveCatalog=await readLiveFunctionCatalog(admin);
    livePronames=new Set((await admin.query("SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace")).rows.map(r=>r.proname));
    liveMajor=await readPostgresMajor(admin);
  }catch(error){
    unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;
    if(config.requirePostgres)throw error;
    if(admin)await admin.end().catch(()=>{});admin=null;
  }
});
after(async()=>{if(admin)await admin.end();});

const pgTest=(name,fn)=>test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});
const require_json=url=>readFileSync(url,'utf8');

pgTest('CPD-1: the scan found the in-place amendments it is meant to police, across the whole chain',()=>{
  const targets=new Set(amendments.map(a=>a.fn));
  assert.ok(amendments.length>=40,
    `expected the chain's pg_get_functiondef amendments to be discovered, found ${amendments.length}; `+
    'if the idiom changed, update the parser rather than letting this test pass vacuously');
  assert.ok(targets.size>=20,`expected amendments against at least 20 distinct functions, saw ${targets.size}`);
  for(const fn of ['refs_apply_ap_ar_posted_adjustment()','refs_apply_ap_payment_reversal_posted()',
    'refs_post_journal(uuid,uuid,uuid,uuid,bigint,text,text,text)','refs_transition_journal(uuid,uuid,uuid,text,bigint,text,text,text)',
    'refs_retain_wbs_final1_source_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text)'])
    assert.ok(targets.has(fn),`${fn} is amended in place by the chain and must be in scope`);
});

pgTest('CPD-1b: every block the parser could not resolve is a known, named dynamic idiom',()=>{
  const unknown=unresolved.filter(u=>!KNOWN_DYNAMIC.has(u.migration));
  assert.deepEqual(unknown.map(u=>`${u.migration}: ${u.reason}\n    ${u.excerpt.split('\n')[0]}`),[],
    'a migration amends a function in a way this test cannot police; extend helpers/catalog-amendments.mjs');
  for(const [migration] of KNOWN_DYNAMIC)
    assert.ok(unresolved.some(u=>u.migration===migration),`${migration} is listed as dynamic but the parser resolved it; remove it from KNOWN_DYNAMIC`);
});

pgTest('CPD-2: every function amended in place still exists at head',()=>{
  const missing=[...liveDefinition].filter(([,d])=>d===null).map(([fn])=>fn);
  assert.deepEqual(missing,[],`amended functions dropped from the catalog: ${missing.join(', ')}`);
});

pgTest('CPD-3: every literal in-place amendment survives to head',()=>{
  // The last amendment of a given text wins. An amendment is satisfied if its replacement text is
  // live, or if a later amendment in the chain took ownership of the same text -- either by
  // rewriting this amendment's output (b.from===a.to) or by re-deriving from the same input
  // (b.from===a.from), which is what a repair migration re-applying a lost patch looks like.
  // Conditional amendments (163 style: `IF position(old)>0 THEN replace`) are satisfied the same
  // way: if `to` is live the patch holds, whichever branch ran.
  const reverted=[];
  const literal=amendments.filter(a=>a.literal);
  for(const [index,a] of literal.entries()){
    const live=liveDefinition.get(a.fn);
    if(live===null)continue;
    if(live.includes(a.to)||compact(live).includes(compact(a.to)))continue; // 027/270: whitespace-only reflow
    const copy=renameCopy(a);
    if(copy){if(!livePronames.has(copy))reverted.push(`${a.migration} -> retained copy ${copy} is missing`);continue;}
    const entry=supersededEntry(a);
    if(entry){if(!compact(live).includes(compact(entry.mustContain)))reverted.push(`${a.migration} -> ${a.fn}: superseded by ${entry.by}, but the replacement is not live either\n    expected to find: ${entry.mustContain}`);continue;}
    const supersededLater=literal.slice(index+1)
      // b rewrote (part of) a's output: b.from is inside a.to or wraps it (213 -> 215, 027 -> 051).
      .some(b=>b.fn===a.fn&&(b.from===a.to||b.from===a.from||b.from.includes(a.to)||a.to.includes(b.from)));
    if(supersededLater)continue;
    reverted.push(`${a.migration} -> ${a.fn}: replacement text is no longer in the live definition\n`+
                  `    expected to find: ${a.to.slice(0,120)}${a.to.length>120?' ...':''}`);
  }
  assert.deepEqual(reverted,[],
    'an in-place amendment has been lost, almost certainly by a later CREATE OR REPLACE rebuilt from\n'+
    'a stale base. Re-apply it in a new migration rather than editing the one that dropped it:\n'+
    reverted.join('\n'));
});

pgTest('CPD-3b: non-literal amendments are few, named, and their targets are hash-pinned',()=>{
  // replace(definition,'x',<variable>) cannot be checked textually; the hash manifest (CPD-5) is
  // what protects these. Keep the list explicit so a new one is a conscious decision.
  const dynamic=amendments.filter(a=>!a.literal);
  const byMigration=[...new Set(dynamic.map(a=>a.migration))];
  // 215 is not here: its replacement is a DECLAREd text constant, which the parser resolves.
  assert.deepEqual(byMigration,['051_post_journal_response_integrity.sql','141_ai_amortization_proposal_coverage_gate.sql','182_wbs_test_payable_signed_amount.sql'],
    `non-literal replace() calls found in: ${byMigration.join(', ')}`);
  if(existsSync(FUNCTION_CATALOG_PATH)){
    const pinned=new Set(JSON.parse(require_json(FUNCTION_CATALOG_PATH)).functions.map(f=>f.signature));
    for(const a of dynamic)assert.ok(pinned.has(a.fn),`${a.fn} (amended dynamically by ${a.migration}) must be in FUNCTION-CATALOG.json`);
  }
});

pgTest('CPD-4: the generic adjustment reducer only claims kinds it can actually handle',()=>{
  // The concrete invariant behind CPD-3's most expensive instance. The scope guard list and the
  // branch set must move together: a kind in the branches but not the list is never activated, and
  // a kind in neither is claimed away from the reducer that owns it.
  const live=liveDefinition.get('refs_apply_ap_ar_posted_adjustment()');
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

pgTest('CPD-5: the live function catalog matches db/FUNCTION-CATALOG.json hash for hash',()=>{
  // This is the check that catches what no text parser can: any function whose definition at head
  // differs from the reviewed snapshot -- including a whole-function CREATE OR REPLACE that quietly
  // rebuilt from a stale base. It never skips: a missing file is a failure with the fix spelled out.
  assert.ok(existsSync(FUNCTION_CATALOG_PATH),
    `db/FUNCTION-CATALOG.json is missing. Generate it on a fresh, fully migrated database with\n`+
    `    npm run db:function-catalog\n`+
    `and commit it. (${fileURLToPath(FUNCTION_CATALOG_PATH)})`);
  const doc=JSON.parse(require_json(FUNCTION_CATALOG_PATH));
  assert.equal(doc.schema_version,FUNCTION_CATALOG_SCHEMA);
  const manifestHead=MIGRATION_MANIFEST[MIGRATION_MANIFEST.length-1].name;
  assert.equal(doc.migration_head,manifestHead,
    `FUNCTION-CATALOG.json was generated at ${doc.migration_head}; the manifest head is ${manifestHead}. Regenerate it (npm run db:function-catalog) after every migration that touches a function.`);
  assert.equal(doc.postgres_major,liveMajor,
    `FUNCTION-CATALOG.json was generated on PostgreSQL ${doc.postgres_major}; this database is ${liveMajor}. pg_get_functiondef formatting is only guaranteed stable within a major -- run this gate on PostgreSQL ${doc.postgres_major} (core-gates does) or regenerate deliberately.`);
  const pinned=new Map(doc.functions.map(f=>[f.signature,f.sha256]));
  const live=new Map(liveCatalog.map(f=>[f.signature,f.sha256]));
  const changed=[...live].filter(([sig,h])=>pinned.has(sig)&&pinned.get(sig)!==h).map(([sig])=>sig);
  const added=[...live.keys()].filter(sig=>!pinned.has(sig));
  const removed=[...pinned.keys()].filter(sig=>!live.has(sig));
  assert.deepEqual({changed,added,removed},{changed:[],added:[],removed:[]},
    'the live function catalog drifted from the reviewed snapshot.\n'+
    '  changed: a function\'s definition at head is not what was reviewed -- if a migration meant to change it, regenerate the snapshot in the same commit; if not, a CREATE OR REPLACE reverted a catalog patch.\n'+
    '  added/removed: functions exist at head that the snapshot does not know, or vice versa.\n'+
    `  changed=${changed.length} added=${added.length} removed=${removed.length}`);
  assert.equal(doc.function_count,live.size);
});
