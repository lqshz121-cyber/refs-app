// R07: the amendment parser, against the exact idioms the migration chain uses. No database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {parseAmendments} from './helpers/catalog-amendments.mjs';

const MIGRATIONS=new URL('../db/migrations/',import.meta.url);

test('CAP-1: zero-argument target, replace(fn,...) -- the 436 idiom',()=>{
  const sql=`BEGIN;
DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_apply_ap_ar_posted_adjustment()'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn,
    'IF NOT FOUND THEN RETURN NEW; END IF;',
    'IF NOT FOUND OR adj.adjustment_kind NOT IN (''AP_BILL_VOID'') THEN RETURN NEW; END IF;');
  IF fn=old THEN RAISE EXCEPTION 'x' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;
COMMIT;`;
  const {amendments,unresolved}=parseAmendments(sql,'436_x.sql');
  assert.deepEqual(unresolved,[]);
  assert.deepEqual(amendments,[{migration:'436_x.sql',fn:'refs_apply_ap_ar_posted_adjustment()',variable:'fn',
    from:'IF NOT FOUND THEN RETURN NEW; END IF;',to:"IF NOT FOUND OR adj.adjustment_kind NOT IN ('AP_BILL_VOID') THEN RETURN NEW; END IF;",literal:true}]);
});

test('CAP-2: argument signature with public. prefix across lines, definition:= assignment, conditional re-application -- the 163 idiom',()=>{
  const sql=`DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.refs_retain_wbs_final1_source_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text)'::regprocedure
  ) INTO definition;
  IF position('gross numeric(20,4)' IN definition)>0 THEN
    definition:=replace(definition,'gross numeric(20,4)','gross numeric(22,4)');
  ELSIF position('gross numeric(22,4)' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected' USING ERRCODE='22023';
  END IF;
  IF position('a' IN definition)>0 THEN
    definition:=replace(
      definition,
      '''signed_project_code'',normalized->>''projectCode''',
      '''signed_business_id'',normalized->>''businessId'',''signed_project_code'',normalized->>''projectCode''');
  END IF;
  EXECUTE definition;
END $$;`;
  const {amendments,unresolved}=parseAmendments(sql,'163_x.sql');
  assert.deepEqual(unresolved,[]);
  assert.equal(amendments.length,2);
  assert.equal(amendments[0].fn,'refs_retain_wbs_final1_source_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text)');
  assert.deepEqual([amendments[0].from,amendments[0].to],['gross numeric(20,4)','gross numeric(22,4)']);
  assert.equal(amendments[1].from,"'signed_project_code',normalized->>'projectCode'");
  assert.ok(amendments[1].to.startsWith("'signed_business_id'"));
});

test('CAP-3: var:=pg_get_functiondef(...) assignment form -- the 161 idiom',()=>{
  const sql=`DO $$
DECLARE function_definition text;
BEGIN
  function_definition:=pg_get_functiondef('refs_read_insurance_prepaid_amortization(uuid,uuid,uuid,integer)'::regprocedure);
  function_definition:=replace(function_definition,'LIMIT 200','LIMIT 500');
  EXECUTE function_definition;
END $$;`;
  const {amendments,unresolved}=parseAmendments(sql,'161_x.sql');
  assert.deepEqual(unresolved,[]);
  assert.deepEqual(amendments.map(a=>[a.fn,a.variable,a.from,a.to,a.literal]),
    [['refs_read_insurance_prepaid_amortization(uuid,uuid,uuid,integer)','function_definition','LIMIT 200','LIMIT 500',true]]);
});

test('CAP-4: two targets in one block are paired by variable and position -- the 030 idiom',()=>{
  const sql=`DO $$
DECLARE fn text;
BEGIN
  SELECT pg_get_functiondef('refs_create_ap_payment(uuid,text)'::regprocedure) INTO fn;
  fn:=replace(fn,'A','B');
  EXECUTE fn;
  SELECT pg_get_functiondef('refs_create_ar_receipt(uuid,text)'::regprocedure) INTO fn;
  fn:=replace(fn,'C','D');
  EXECUTE fn;
END $$;`;
  const {amendments}=parseAmendments(sql,'030_x.sql');
  assert.deepEqual(amendments.map(a=>[a.fn,a.from,a.to]),
    [['refs_create_ap_payment(uuid,text)','A','B'],['refs_create_ar_receipt(uuid,text)','C','D']]);
});

test('CAP-5: the 215 idiom -- a replacement DECLAREd as a text constant -- resolves to its value; a computed one is reported non-literal, not dropped',()=>{
  // 215 passes `categories`, a DECLAREd text constant, as the replacement. That is as literal as a
  // quoted string (the 178 idiom), so it must resolve and be policed textually by CPD-3.
  const declared=`DO $$
DECLARE definition text; categories text:='''A'', ''B''';
BEGIN
  SELECT pg_get_functiondef('refs_assert_ai_accounting_analysis_evidence(jsonb)'::regprocedure) INTO definition;definition:=replace(definition,'''BANK_DUPLICATE_PAYMENT''',categories);IF position('M' IN definition)=0 THEN RAISE EXCEPTION 'f';END IF;EXECUTE definition;
END $$;`;
  const r1=parseAmendments(declared,'215_x.sql');
  assert.deepEqual(r1.unresolved,[]);
  assert.equal(r1.amendments.length,1);
  assert.equal(r1.amendments[0].literal,true);
  assert.equal(r1.amendments[0].to,"'A', 'B'");
  // 439: fragments DECLAREd with dollar quoting resolve the same way.
  const dollar=`DO $m$
DECLARE definition text; a constant text:=$q$it's 'quoted'$q$; b constant text:=$q$new$q$;
BEGIN
  SELECT pg_get_functiondef('refs_x(jsonb)'::regprocedure) INTO definition;EXECUTE replace(definition,a,b);
END $m$;`;
  const r3=parseAmendments(dollar,'439_x.sql');
  assert.deepEqual(r3.amendments.map(x=>[x.literal,x.from,x.to]),[[true,"it's 'quoted'",'new']]);
  // A replacement built at run time (141: gate||needle) cannot be checked textually.
  const computed=`DO $$
DECLARE definition text; needle text; gate text;
BEGIN
  SELECT pg_get_functiondef('refs_x(jsonb)'::regprocedure) INTO definition;needle:='N';gate:=format('G%s',1);definition:=replace(definition,needle,gate||needle);EXECUTE definition;
END $$;`;
  const r2=parseAmendments(computed,'141_x.sql');
  assert.deepEqual(r2.unresolved,[]);
  assert.equal(r2.amendments.length,1);
  assert.equal(r2.amendments[0].literal,false);
  assert.equal(r2.amendments[0].toRaw,'gate||needle');
});

test('CAP-5b: texts declared as constants and passed by name resolve to literals -- the 178 idiom',()=>{
  const sql=`DO $$
DECLARE
  definition text;
  old_source_guard constant text:='bank_delta<>bank.amount';
  new_source_guard constant text:='bank_delta<>bank.amount OR item.kind=''ADJ''';
  occurrences integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.refs_create_reconciliation_adjustment_draft_105(uuid,uuid,character,text)'::regprocedure
  ) INTO definition;
  occurrences:=(length(definition)-length(replace(definition,old_source_guard,'')))/length(old_source_guard);
  definition:=replace(definition,old_source_guard,new_source_guard);
  EXECUTE definition;
END $$;`;
  const {amendments,unresolved}=parseAmendments(sql,'178_x.sql');
  assert.deepEqual(unresolved,[]);
  const real=amendments.filter(a=>a.to!=='');
  assert.deepEqual(real.map(a=>[a.fn,a.from,a.to,a.literal]),
    [['refs_create_reconciliation_adjustment_draft_105(uuid,uuid,character,text)','bank_delta<>bank.amount',"bank_delta<>bank.amount OR item.kind='ADJ'",true]]);
});

test('CAP-6: a dynamic signature is reported as unresolved -- the 140 idiom',()=>{
  const sql=`DO $$
DECLARE target record; definition text;
BEGIN
  FOR target IN SELECT * FROM (VALUES ('refs_a(uuid)')) AS t(signature) LOOP
    SELECT pg_get_functiondef(target.signature::regprocedure) INTO definition;
    definition:=replace(definition,'x','y');
    EXECUTE definition;
  END LOOP;
END $$;`;
  const {amendments,unresolved}=parseAmendments(sql,'140_x.sql');
  assert.equal(amendments.length,0,'nothing can be paired with a static target');
  assert.equal(unresolved.length,1);
  assert.match(unresolved[0].reason,/non-literal signature/);
});

test('CAP-7: files without pg_get_functiondef produce nothing; CRLF is tolerated',()=>{
  assert.deepEqual(parseAmendments('CREATE TABLE t(a int);','001.sql'),{amendments:[],unresolved:[],snapshots:[]});
  // 276/286/288: a definition copied into a backup table outside any DO block is a snapshot, not an
  // unresolved amendment -- plain SQL cannot EXECUTE it.
  const backup="-- uses pg_get_functiondef + EXECUTE in prose only\nINSERT INTO b VALUES('f',pg_get_functiondef('f()'::regprocedure));";
  const r=parseAmendments(backup,'286_x.sql');
  assert.deepEqual([r.amendments.length,r.unresolved.length,r.snapshots.length],[0,0,1]);
  const crlf="DO $$\r\nBEGIN\r\n  SELECT pg_get_functiondef('f()'::regprocedure) INTO fn;\r\n  fn:=replace(fn,'a','b');\r\n  EXECUTE fn;\r\nEND $$;";
  assert.equal(parseAmendments(crlf,'x.sql').amendments.length,1);
});

test('CAP-8: against the real chain, the parser resolves every amending migration except the known dynamic one',()=>{
  const files=readdirSync(MIGRATIONS).filter(f=>/^\d+_.+\.sql$/.test(f)).sort();
  let total=0;const unresolvedBy=new Map();const fns=new Set();
  for(const f of files){
    const {amendments,unresolved}=parseAmendments(readFileSync(new URL(f,MIGRATIONS),'utf8'),f);
    total+=amendments.length;
    for(const a of amendments)fns.add(a.fn);
    for(const u of unresolved)unresolvedBy.set(u.migration,u.reason);
  }
  assert.ok(total>=40,`found ${total} amendments; the chain carries several dozen`);
  assert.ok(fns.size>=20,`found ${fns.size} distinct amended functions`);
  // 140 and 313 both loop over a VALUES list of signatures (x.signature::regprocedure); the drift
  // test lists them in KNOWN_DYNAMIC and relies on the FUNCTION-CATALOG hashes for their targets.
  assert.deepEqual([...unresolvedBy.keys()],['140_ai_analysis_explain_scope.sql','313_credit_allocation_capacity.sql'],
    `unresolved: ${JSON.stringify([...unresolvedBy])}`);
  for(const fn of ['refs_post_journal(uuid,uuid,uuid,uuid,bigint,text,text,text)','refs_transition_journal(uuid,uuid,uuid,text,bigint,text,text,text)','refs_apply_ap_ar_posted_adjustment()'])
    assert.ok(fns.has(fn),`${fn} must be discovered`);
});
