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
  // 182 and 439 are not here either: their fragments are dollar-quoted DECLAREd constants.
  assert.deepEqual(byMigration,['051_post_journal_response_integrity.sql','141_ai_amortization_proposal_coverage_gate.sql'],
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

pgTest('CPD-6: no installed function makes a call PostgreSQL will refuse at run time (more than 100 arguments)',async()=>{
  // 440: 373 shipped two jsonb_build_object calls of 132 and 156 arguments. plpgsql does not check
  // FUNC_MAX_ARGS until the statement runs, so the migration applied cleanly and every intercompany
  // elimination read failed later. Count top-level arguments of every call in every public function.
  const rows=(await admin.query("SELECT p.oid::regprocedure::text sig,p.prosrc src FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prolang IN (SELECT oid FROM pg_language WHERE lanname IN ('plpgsql','sql'))")).rows;
  // Only ordinary function calls are capped; SQL syntax and the special forms are not.
  const NOT_A_CALL=new Set(['from','in','values','as','on','exists','using','over','filter','within','select','where','and','or','not','when','then','else','case','returns','table','into','any','all','some','row','array','coalesce','greatest','least','join','by','set','if','elsif','return','perform','execute','loop','for','foreach','raise','update','insert','delete','with','union','except','intersect','lateral','distinct','nullif','cast','extract','overlay','position','substring','trim','is','like','ilike','between']);
  // A retained pre-fix copy no function and no kernel query reaches: 410 replaced refs_read_unit_transfer_pair
  // with a split build, and the _370 body is kept only as rollback evidence.
  const RETAINED_UNREACHABLE=new Set(['refs_read_unit_transfer_pair_370(uuid,uuid,uuid)']);
  for(const sig of RETAINED_UNREACHABLE){
    const name=sig.slice(0,sig.indexOf('('));
    assert.equal((await admin.query('SELECT count(*)::int n FROM pg_proc WHERE pronamespace=$1::regnamespace AND prosrc LIKE $2',['public',`%${name}%`])).rows[0].n,0,`${sig} must stay unreferenced`);
    const runtimeSource=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
    assert.ok(!runtimeSource.includes(name),`${sig} must stay unused by the kernel`);
  }
  const offenders=[];
  for(const {sig,src} of rows){
    if(RETAINED_UNREACHABLE.has(sig))continue;
    const re=/([a-z_][a-z0-9_]*)\s*\(/gi;let m;
    while((m=re.exec(src))){
      if(NOT_A_CALL.has(m[1].toLowerCase()))continue;
      let depth=1,quote=false,args=1,empty=true,i=m.index+m[0].length;
      for(;i<src.length&&depth>0;i++){
        const c=src[i];
        if(quote){if(c==="'"){if(src[i+1]==="'"){i++;continue;}quote=false;}continue;}
        if(c==="'"){quote=true;empty=false;continue;}
        if(c==='(')depth++;else if(c===')')depth--;else if(c===','&&depth===1)args++;
        if(depth>0&&!/\s/.test(c))empty=false;
      }
      if(!empty&&args>100)offenders.push(`${sig}: ${m[1]}() with ${args} arguments`);
    }
  }
  assert.deepEqual(offenders,[],offenders.join('\n'));
});

pgTest('CPD-7: no command asserts a READ-class permission next to another class unless that READ permission is additive to it',async()=>{
  // 441: a human grant carries exactly one authority class. A command that asserts, say,
  // X.CREATE (DRAFT) and X.VIEW (READ) is unreachable for every real grant unless X.VIEW is listed in
  // runtime_human_additive_permission_authority for DRAFT (the 412 pattern).
  const rows=(await admin.query(`WITH f AS (SELECT p.oid::regprocedure::text sig,p.prosrc FROM pg_proc p WHERE p.pronamespace='public'::regnamespace),
    uses AS (SELECT f.sig,a.permission_code,a.authority_class FROM f JOIN runtime_human_permission_authority a ON f.prosrc LIKE '%refs_assert_scope(%'''||a.permission_code||'''%'),
    -- 445: the action permission may be chosen at run time (saved views pick CREATE or SHARE by
    -- visibility into a variable), so the other side is any quoted permission literal in the body.
    named AS (SELECT f.sig,a.permission_code,a.authority_class FROM f JOIN runtime_human_permission_authority a ON f.prosrc LIKE '%'''||a.permission_code||'''%')
    SELECT r.sig,r.permission_code read_permission,o.permission_code other_permission,o.authority_class other_class
    FROM uses r JOIN named o ON o.sig=r.sig AND o.authority_class<>'READ'
    WHERE r.authority_class='READ' AND NOT EXISTS(SELECT 1 FROM runtime_human_additive_permission_authority x WHERE x.permission_code=r.permission_code AND x.authority_class=o.authority_class)
    ORDER BY 1,2,3`)).rows;
  assert.deepEqual(rows,[],rows.map(r=>`${r.sig}: ${r.read_permission} (READ) with ${r.other_permission} (${r.other_class})`).join('\n'));
});

pgTest('CPD-8: plpgsql_check finds no statement that fails every time it runs, outside named retained copies and table-branching triggers',async t=>{
  // 442-444: a PL/pgSQL statement is only planned when it first runs, so an ambiguous column, a
  // missing column or function, a bad regex or a type mismatch passes every migration and fails
  // every call. plpgsql_check plans each statement statically. The extension is installed and used
  // inside a transaction that is rolled back, so the schema and function catalog are untouched.
  const available=(await admin.query("SELECT 1 FROM pg_available_extensions WHERE name='plpgsql_check'")).rowCount>0;
  if(!available){t.skip('plpgsql_check is not installed on this server (apt: postgresql-<major>-plpgsql-check)');return;}
  // Retained pre-fix copies that no live function or kernel query reaches (kept as rollback evidence).
  const RETAINED_UNREACHABLE=['refs_set_reconciliation_clearance_385','refs_create_native_expense_395','refs_create_native_expense_403','refs_read_native_expense_create_options_395','refs_read_native_expense_create_options_403','refs_read_unit_transfer_pair_370','refs_read_ai_construction_loan_lender_balances'];
  // Trigger functions shared by several tables that branch on TG_TABLE_NAME: plpgsql_check plans every
  // branch against each table, so the other table's branch reports that table's missing fields.
  const TABLE_BRANCHING_TRIGGERS=new Map([['refs_protect_approved_config',['setting_snapshot','mapping_snapshot']],['refs_guard_reconciliation_adjustment_lifecycle',['reconciliation','journal_entry']]]);
  // Statements over temporary tables the same function creates (ON COMMIT DROP) cannot be planned statically.
  const TEMP_TABLE_PREFIX='_wbs273_';
  const runtimeSource=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
  const client=await admin.connect();
  try{
    await client.query('BEGIN');
    await client.query('CREATE EXTENSION IF NOT EXISTS plpgsql_check');
    const rows=(await client.query(`SELECT p.proname,p.oid::regprocedure::text sig,COALESCE(t.tgrelid::regclass::text,'') rel,c.sqlstate,c.message,c.lineno
      FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      LEFT JOIN LATERAL (SELECT tgrelid FROM pg_trigger t WHERE t.tgfoid=p.oid AND NOT t.tgisinternal) t ON true
      CROSS JOIN LATERAL plpgsql_check_function_tb(p.oid,COALESCE(t.tgrelid,0),fatal_errors:=false,other_warnings:=false,performance_warnings:=false,extra_warnings:=false) c
      WHERE p.pronamespace='public'::regnamespace AND p.prorettype<>'event_trigger'::regtype
        AND (p.prorettype<>'trigger'::regtype OR t.tgrelid IS NOT NULL) AND c.level='error'`)).rows;
    for(const name of RETAINED_UNREACHABLE){
      assert.equal((await client.query("SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname<>$1 AND prosrc ~ ('\\m'||$1||'\\M')",[name])).rows[0].n,0,`${name} must stay unreferenced`);
      assert.ok(!new RegExp(`\\b${name}\\b`).test(runtimeSource),`${name} must stay unused by the kernel`);
    }
    const offenders=rows.filter(r=>!RETAINED_UNREACHABLE.includes(r.proname)&&!(TABLE_BRANCHING_TRIGGERS.get(r.proname)||[]).includes(r.rel)&&!String(r.message).includes(`"${TEMP_TABLE_PREFIX}`))
      .map(r=>`${r.sig}${r.rel?` on ${r.rel}`:''} line ${r.lineno}: ${r.sqlstate} ${r.message}`);
    assert.deepEqual(offenders,[],offenders.join('\n'));
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
});

pgTest('CPD-7b: no command unconditionally asserts two non-READ authority classes (445)',async()=>{
  // 445: Unit Transfer reversal steps asserted REVERSAL next to DRAFT/JE_REVERSAL/SUBMIT/REVIEW/APPROVE/POST/JE_REVIEW,
  // so no real grant (one class per entity) could run any of them. A literal pair of classes in one body is
  // flagged unless the function picks one of them per action/kind (a CASE), listed here by name.
  const PER_ACTION=new Set(['refs_read_settlement_bank_account_pairs','refs_read_settlement_bank_members','refs_read_settlement_context','refs_transition_reconciliation','refs_transition_reconciliation_adjustment_aware_385','refs_transition_reconciliation_adjustment_aware_legacy_092']);
  const rows=(await admin.query(`WITH f AS (SELECT p.proname,p.oid::regprocedure::text sig,p.prosrc FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosrc LIKE '%refs_assert_scope(%'),
    u AS (SELECT f.proname,f.sig,a.permission_code,a.authority_class FROM f JOIN runtime_human_permission_authority a ON strpos(f.prosrc,''''||a.permission_code||'''')>0
      AND f.prosrc ~ ('refs_assert_scope\\([^;]*'''||replace(a.permission_code,'.','\\.')||''''))
    SELECT a.proname,a.sig,a.permission_code p1,a.authority_class c1,b.permission_code p2,b.authority_class c2 FROM u a JOIN u b ON a.sig=b.sig AND a.permission_code<b.permission_code AND a.authority_class<>b.authority_class
    WHERE 'READ' NOT IN(a.authority_class,b.authority_class) AND NOT EXISTS(SELECT 1 FROM runtime_human_additive_permission_authority x WHERE (x.permission_code,x.authority_class) IN((a.permission_code,b.authority_class),(b.permission_code,a.authority_class)))
    ORDER BY 2,3,5`)).rows.filter(r=>!PER_ACTION.has(r.proname));
  assert.deepEqual(rows,[],rows.map(r=>`${r.sig}: ${r.p1} (${r.c1}) with ${r.p2} (${r.c2})`).join('\n'));
  for(const name of PER_ACTION)assert.match((await admin.query('SELECT string_agg(prosrc,chr(10)) s FROM pg_proc WHERE proname=$1',[name])).rows[0].s??'',/\bCASE\b|\bELSIF\b/i,`${name} must choose its permission per action`);
});
