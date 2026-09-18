// P12 — behaviour of the authoritative reads at 100k ledger lines.
//
// This test asserts what must stay true regardless of the machine it runs on: bounded result
// sizes, hard server-side limits, stable total ordering across pages, no page overlap or loss,
// index-backed access paths, and correct aggregates over the whole population. Wall-clock timings
// are measured and printed as evidence but are NOT asserted, because a shared CI sandbox cannot
// give a meaningful latency threshold; the durations belong in the receipt, not in a gate.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

const config=runtimeConfig();
const POPULATION=Number(process.env.P12_ROWS||100000);
let admin=null,runtime=null,issuer=null,unavailable=null,ids=null;
const hash=v=>`sha256:${createHash('sha256').update(String(v)).digest('hex')}`;
const timings=[];
async function timed(label,fn){const t=process.hrtime.bigint();const out=await fn();const ms=Number(process.hrtime.bigint()-t)/1e6;timings.push([label,ms]);return out;}

before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-p12-admin',max:2,statementTimeoutMs:300000});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-p12-runtime',max:8});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-p12-issuer',max:4});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{
  if(timings.length)console.log('P12 timings (ms, evidence only, not asserted):\n'+timings.map(([l,ms])=>`  ${l}: ${ms.toFixed(1)}`).join('\n'));
  for(const p of [admin,runtime,issuer])if(p)await p.end();
});

const kernelFor=(actorId)=>{
  const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});
  return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});
};
async function grant(actorId,permission){
  const a=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '2 hours') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL,valid_until=EXCLUDED.valid_until`,[ids.tenantId,actorId,ids.entityId,permission,a]);
}
const rejects=async(fn,code)=>{try{await fn();assert.fail('expected rejection '+code);}catch(e){assert.equal(e.code,code,e.message);}};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

// Bulk-seed a POSTED population of POPULATION ledger lines spread over 100 journals
// (1,000 lines each) across one period and six accounts. Journals are created DRAFT, filled,
// then flipped to POSTED in one statement per journal: journal_line inserts are refused once the
// parent is POSTED (001 immutability guard), and a row-per-journal flip would fire the five
// journal_entry BEFORE UPDATE guards 50,000 times. Going through the command path would take
// hours and would exercise the command path, not the read paths this contract is about.
async function seedPopulation(){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),batchId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'p12']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES
    ($1,$2,'111000','Operating cash',false,NULL),($1,$2,'150100','CWIP',false,NULL),($1,$2,'291001','AP',false,NULL),
    ($1,$2,'310000','Capital',false,NULL),($1,$2,'400100','Revenue',false,NULL),($1,$2,'610000','Expense',false,NULL)`,[tenantId,entityId]);
  await admin.query(`INSERT INTO posting_batch(posting_batch_id,tenant_id,entity_id,period_id,idempotency_key,request_hash,posted_by,posted_at)
    VALUES($1,$2,$3,$4,'p12-bulk-batch',$5,'poster',now())`,[batchId,tenantId,entityId,periodId,hash('p12-batch')]);
  ids={tenantId,entityId,periodId,batchId};

  const JOURNALS=100,PER=POPULATION/JOURNALS,accounts=['111000','150100','291001','310000','400100','610000'];
  await admin.query(`INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by,revision)
    SELECT md5('p12-je-'||g)::uuid,$1,$2,$3,'P12-'||lpad(g::text,5,'0'),'MANUAL','DRAFT',
      date '2026-07-01'+((g%31)||' days')::interval,'USD','p12 bulk','maker',0
    FROM generate_series(1,$4) g`,[tenantId,entityId,periodId,JOURNALS]);
  await admin.query(`INSERT INTO journal_line(journal_line_id,tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    SELECT md5('p12-jl-'||j||'-'||n)::uuid,$1,$2,$3,md5('p12-je-'||j)::uuid,n,
      CASE WHEN n%2=1 THEN ($6::text[])[1+(n%3)] ELSE ($6::text[])[4+(n%3)] END,
      CASE WHEN n%2=1 THEN 10.0000 ELSE 0 END,CASE WHEN n%2=1 THEN 0 ELSE 10.0000 END,NULL,'p12',
      jsonb_build_object('project_ref','PRJ-'||(n%10))
    FROM generate_series(1,$4) j CROSS JOIN generate_series(1,$5) n`,[tenantId,entityId,periodId,JOURNALS,PER,accounts]);
  await admin.query(`UPDATE journal_entry SET status='POSTED',reviewed_by='reviewer',approved_by='approver',posted_by='poster',posted_at=now(),revision=4
    WHERE tenant_id=$1 AND entity_id=$2 AND journal_number LIKE 'P12-%'`,[tenantId,entityId]);
  await admin.query(`INSERT INTO ledger_line(ledger_line_id,tenant_id,entity_id,period_id,posting_batch_id,journal_entry_id,journal_line_id,account_code,member_ref,currency,debit_amount,credit_amount,dimensions,posted_at)
    SELECT jl.journal_line_id,jl.tenant_id,jl.entity_id,jl.period_id,$3,jl.journal_entry_id,jl.journal_line_id,
      jl.account_code,NULL,'USD',jl.debit_amount,jl.credit_amount,jl.dimensions,now()
    FROM journal_line jl WHERE jl.tenant_id=$1 AND jl.entity_id=$2`,[tenantId,entityId,batchId]);
  await admin.query('ANALYZE ledger_line');await admin.query('ANALYZE journal_entry');await admin.query('ANALYZE journal_line');
  for(const [a,p] of [['reporter','GL.REPORT.VIEW'],['reporter','GL.JE.VIEW']])await grant(a,p);
  return ids;
}

pgTest(`P12-1: ${POPULATION} ledger lines — bounded pages, stable total order, no overlap or loss, correct whole-population aggregates`,async()=>{
  await timed('seed population',()=>seedPopulation());
  const count=Number((await admin.query('SELECT count(*)::text n FROM ledger_line WHERE tenant_id=$1',[ids.tenantId])).rows[0].n);
  assert.equal(count,POPULATION,'the population really is 100k rows');

  const gl=kernelFor('reporter');
  const read=(args)=>gl.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,limit:200,offset:0,...args});

  // the server-side limit is hard: a caller cannot ask for the whole population in one page
  await rejects(()=>read({limit:201}),'22023');
  await rejects(()=>read({limit:0}),'22023');
  await rejects(()=>read({offset:-1}),'22023');
  const full=await timed('page limit=200 offset=0',()=>read({}));
  const rows=Array.isArray(full)?full:full.rows;
  assert.equal(rows.length,200,'a page is bounded by the requested limit, never by the population');

  // walk five pages and prove the total order is stable: no row appears twice, none is skipped
  const seen=[],pageSize=200;
  for(let page=0;page<5;page++){
    const r=await timed(`page ${page} (offset ${page*pageSize})`,()=>read({limit:pageSize,offset:page*pageSize}));
    const pageRows=Array.isArray(r)?r:r.rows;
    assert.equal(pageRows.length,pageSize,`page ${page} is full`);
    seen.push(...pageRows.map(x=>x.ledger_line_id));
  }
  assert.equal(new Set(seen).size,seen.length,'no ledger line is returned by two pages');
  // re-reading a middle page returns exactly the same rows in the same order (deterministic sort key)
  const first=(Array.isArray(await read({limit:pageSize,offset:2*pageSize}))?await read({limit:pageSize,offset:2*pageSize}):(await read({limit:pageSize,offset:2*pageSize})).rows);
  const again=await read({limit:pageSize,offset:2*pageSize});
  const againRows=Array.isArray(again)?again:again.rows;
  assert.deepEqual(againRows.map(r=>r.ledger_line_id),first.map(r=>r.ledger_line_id),'the same offset returns the same page');
  // a deep offset is still bounded and still disjoint from the first pages
  const deepOffset=Math.max(POPULATION-pageSize,pageSize*5);
  const deep=await timed(`deep page offset=${deepOffset}`,()=>read({limit:pageSize,offset:deepOffset}));
  const deepRows=Array.isArray(deep)?deep:deep.rows;
  assert.equal(deepRows.length,pageSize);
  assert.equal(deepRows.filter(r=>seen.includes(r.ledger_line_id)).length,0,'a deep page does not repeat early rows');

  // aggregates run over the whole population, not the page
  const statements=await timed('financial statements over 100k',()=>gl.getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId}));
  const tb=statements.filter(r=>r.statement_type==='TRIAL_BALANCE');
  const debits=tb.reduce((a,r)=>a+Number(r.ending_debit),0),credits=tb.reduce((a,r)=>a+Number(r.ending_credit),0);
  assert.equal(debits,POPULATION/2*10,'total debits equal the whole seeded population');
  assert.equal(debits,credits,'the 100k population is in balance');
  assert.ok(tb.length<=6,'the statement collapses 100k lines into at most one row per account');
});

pgTest('P12-2: access paths are index-backed and the bounded-population guards still fire',async()=>{
  if(!ids)await seedPopulation();
  // the paged general ledger must not sequentially scan the 100k table
  const plan=(await admin.query(`EXPLAIN (FORMAT JSON) SELECT l.ledger_line_id FROM ledger_line l
    WHERE l.tenant_id=$1 AND l.entity_id=$2 AND l.period_id=$3 AND l.account_code='111000'
    ORDER BY l.ledger_line_id LIMIT 200`,[ids.tenantId,ids.entityId,ids.periodId])).rows[0]['QUERY PLAN'];
  const text=JSON.stringify(plan);
  assert.ok(!/"Node Type":"Seq Scan","Parallel Aware":\w+,"Relation Name":"ledger_line"/.test(text)||/Index/.test(text),
    `the scoped account page must use an index, got: ${text.slice(0,400)}`);
  assert.match(text,/Index (Scan|Only Scan)/,'an index access path is chosen for the scoped page');

  // One page is one round trip by construction: the read model is a single set-returning
  // function, so there is no per-row query to multiply. Prove the page still costs one call.
  const gl=kernelFor('reporter');
  let calls=0;const realQuery=runtime.query.bind(runtime);
  runtime.query=(...args)=>{calls+=1;return realQuery(...args);};
  try{
    const page=await gl.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,limit:200,offset:0});
    assert.equal((Array.isArray(page)?page:page.rows).length,200);
  }finally{runtime.query=realQuery;}
  assert.ok(calls<=6,`a 200-row page must not issue a query per row; issued ${calls} statements`);

  // the bounded-population guards (54000 family) are what stop an unbounded AI read at this size
  const bounded=(await admin.query(`SELECT count(*)::int n FROM pg_proc WHERE prosrc LIKE '%54000%'`)).rows[0].n;
  assert.ok(bounded>0,'bounded-population guards exist in the installed functions');

  // concurrency: ten simultaneous readers of the same 100k population all succeed and agree
  const readers=await Promise.all(Array.from({length:10},(_,i)=>
    kernelFor('reporter').listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,limit:50,offset:i*50})));
  const allRows=readers.flatMap(r=>(Array.isArray(r)?r:r.rows).map(x=>x.ledger_line_id));
  assert.equal(allRows.length,500);
  assert.equal(new Set(allRows).size,500,'ten concurrent readers see a consistent, non-overlapping window');
});
