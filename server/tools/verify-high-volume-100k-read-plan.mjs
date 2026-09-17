#!/usr/bin/env node
// S20 high-volume (100k) bounded-read gate.
//
// Loads a deterministic synthetic 100k-row population into an ephemeral gate
// database and EXPLAIN (ANALYZE)s the exact SQL body of the bounded list
// readers a 100k tenant hits: General Ledger page, Journal Entry period page,
// AP/AR business document period page, plus the authoritative General Ledger
// snapshot. Reader SQL is extracted from the migration files at run time and
// never re-typed here, so this gate cannot drift from the deployed function.
//
// Real accounting data is never written: the tool refuses to run unless the
// current database is the generated gate database, and it only ever writes its
// own synthetic tenant. Seeding is resumable so it can run under a short
// per-invocation wall-clock budget.
//
//   node tools/verify-high-volume-100k-read-plan.mjs seed [--budget-ms 120000]
//     exit 0 = population complete, exit 3 = budget spent, more rows to load
//   node tools/verify-high-volume-100k-read-plan.mjs measure
//     exit 0 = every bounded page met its budget, exit 1 = gate failure
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';

const GATE_DATABASE='refs_kernel_gate_test';
const TENANT_CODE='S20GATE';
const VOLUME=Number(process.env.S20_VOLUME||100001);
const BATCH=Number(process.env.S20_BATCH||5000);
const PAGE_BUDGET_MS=Number(process.env.S20_PAGE_BUDGET_MS||1000);
const migration=name=>readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8');
const emit=row=>console.log(JSON.stringify(row));
// Deterministic ids keep the population resumable and independently checkable.
const id=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const SCOPE={tenantId:id('1',1),entityId:id('1',2),periodId:id('1',3),batchId:id('1',4)};

function between(sql,start,end){
  const from=sql.indexOf(start);
  assert.ok(from>=0,`missing anchor ${start}`);
  const to=sql.indexOf(end,from);
  assert.ok(to>from,`missing anchor ${end}`);
  return sql.slice(from,to+end.length);
}

function substitute(sql,bindings){
  let out=sql;
  for(const [name,placeholder] of Object.entries(bindings))out=out.replaceAll(name,placeholder);
  const leftover=out.match(/\bp_[a-z_]+\b/g);
  assert.ok(!leftover,`unsubstituted plpgsql parameter remains: ${leftover}`);
  return out;
}

// Walks an EXPLAIN plan and reports, per relation, how many rows the executor
// actually visited. A bounded page must not have to visit the whole population.
function relationVisits(node,into={}){
  const name=node['Relation Name'];
  if(name){
    const visited=((node['Actual Rows']||0)+(node['Rows Removed by Filter']||0))*(node['Actual Loops']||0);
    into[name]=into[name]||{visited:0,nodes:[]};
    into[name].visited+=visited;
    into[name].nodes.push(node['Node Type']);
  }
  for(const child of node.Plans||[])relationVisits(child,into);
  return into;
}

async function openGatePool(){
  const config=runtimeConfig();
  const pool=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'s20-high-volume-gate',max:4});
  const database=(await pool.query('SELECT current_database() name')).rows[0].name;
  assert.equal(database,GATE_DATABASE,`S20 only runs against the generated gate database, not ${database}`);
  return pool;
}

async function ensureScope(pool){
  if((await pool.query('SELECT 1 FROM tenant WHERE tenant_id=$1',[SCOPE.tenantId])).rowCount)return;
  await pool.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[SCOPE.tenantId,TENANT_CODE,'S20 synthetic high-volume gate tenant']);
  await pool.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'S20GATE1','WBS','S20GATE1','S20 synthetic gate entity','USD')",[SCOPE.entityId,SCOPE.tenantId]);
  await pool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[SCOPE.periodId,SCOPE.tenantId,SCOPE.entityId]);
  await pool.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'111000','Cash',true,'BANK'),($1,$2,'291001','Accounts Payable',true,'VENDOR')",[SCOPE.tenantId,SCOPE.entityId]);
  await pool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-1','BANK','Operating Cash'),($1,$2,'VENDOR-1','VENDOR','Synthetic vendor')",[SCOPE.tenantId,SCOPE.entityId]);
  await pool.query(`INSERT INTO posting_batch(posting_batch_id,tenant_id,entity_id,period_id,idempotency_key,request_hash,posted_by)
    VALUES($1,$2,$3,$4,'s20-volume-batch','sha256:'||repeat('a',64),'fixture-poster')`,[SCOPE.batchId,SCOPE.tenantId,SCOPE.entityId,SCOPE.periodId]);
}

// Synthetic read-volume only: every journal is balanced, carries a distinct
// number and a distinct immutable ledger trace. No kernel command is faked as
// having run, and nothing outside this synthetic tenant is touched.
async function seedBatch(pool,first,last){
  const client=await pool.connect();
  const args=[SCOPE.tenantId,SCOPE.entityId,SCOPE.periodId,first,last];
  try{
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='600000'");
    await client.query('ALTER TABLE journal_line DISABLE TRIGGER journal_line_posted_immutable');
    await client.query(`INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by,reviewed_by,approved_by,posted_by,posted_at,revision)
      SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,$2,$3,'S20-VOL-'||n,'MANUAL','POSTED','2026-07-16','USD','fixture-maker','fixture-reviewer','fixture-approver','fixture-poster',now(),4
      FROM generate_series($4::int,$5::int) n`,args);
    await client.query(`INSERT INTO journal_line(journal_line_id,tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref)
      SELECT ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1::uuid,$2::uuid,$3::uuid,('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1,'291001',40,0,'VENDOR-1' FROM generate_series($4::int,$5::int) n
      UNION ALL
      SELECT ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1::uuid,$2::uuid,$3::uuid,('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,2,'111000',0,40,'BANK-1' FROM generate_series($4::int,$5::int) n`,args);
    await client.query(`INSERT INTO ledger_line(tenant_id,entity_id,period_id,posting_batch_id,journal_entry_id,journal_line_id,account_code,member_ref,currency,debit_amount,credit_amount,posted_at)
      SELECT $1::uuid,$2::uuid,$3::uuid,$6::uuid,('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'291001','VENDOR-1','USD',40,0,now() FROM generate_series($4::int,$5::int) n
      UNION ALL
      SELECT $1::uuid,$2::uuid,$3::uuid,$6::uuid,('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'111000','BANK-1','USD',0,40,now() FROM generate_series($4::int,$5::int) n`,[...args,SCOPE.batchId]);
    await client.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,posted_journal_entry_id,created_by)
      SELECT ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1::uuid,$2::uuid,'AP_BILL','S20-BILL-'||n,'VENDOR-1','Synthetic volume vendor','USD','2026-07-16','2026-08-16',40,0,'PAID',('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fixture'
      FROM generate_series($3::int,$4::int) n`,[SCOPE.tenantId,SCOPE.entityId,first,last]);
    await client.query('ALTER TABLE journal_line ENABLE TRIGGER journal_line_posted_immutable');
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

async function loaded(pool){
  return (await pool.query('SELECT count(*)::int n FROM journal_entry WHERE entity_id=$1',[SCOPE.entityId])).rows[0].n;
}

async function seed(budgetMs){
  const pool=await openGatePool();
  await ensureScope(pool);
  const started=Date.now();
  let done=await loaded(pool);
  while(done<VOLUME){
    if(Date.now()-started>budgetMs){
      emit({gate:'seed_progress',loaded:done,target:VOLUME,elapsed_ms:Date.now()-started,complete:false});
      await pool.end();process.exitCode=3;return;
    }
    const first=done+1,last=Math.min(done+BATCH,VOLUME);
    await seedBatch(pool,first,last);
    done=last;
    emit({gate:'seed_progress',loaded:done,target:VOLUME,elapsed_ms:Date.now()-started,complete:done>=VOLUME});
  }
  await pool.end();
}

async function measure(pool,{gate,sql,params,expectRows}){
  const started=Date.now();
  const rows=(await pool.query(sql,params)).rows;
  const wallMs=Date.now()-started;
  if(expectRows!==undefined)assert.equal(rows.length,expectRows,`${gate}: bounded page must return ${expectRows} rows, got ${rows.length}`);
  const plan=(await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,params)).rows[0]['QUERY PLAN'][0];
  const visits=relationVisits(plan.Plan);
  const relation_visits=Object.fromEntries(Object.entries(visits).map(([k,v])=>[k,v.visited]));
  const seq_scans=Object.entries(visits).filter(([,v])=>v.nodes.includes('Seq Scan')).map(([k])=>k);
  const result={gate,rows:rows.length,wall_ms:wallMs,execution_ms:plan['Execution Time'],planning_ms:plan['Planning Time'],
    relation_visits,seq_scans,within_page_budget:plan['Execution Time']<PAGE_BUDGET_MS};
  emit(result);
  return result;
}

async function runMeasure(){
  const pool=await openGatePool();
  const counts=(await pool.query(`SELECT
    (SELECT count(*)::int FROM journal_entry WHERE entity_id=$1) journals,
    (SELECT count(*)::int FROM journal_line WHERE entity_id=$1) journal_lines,
    (SELECT count(*)::int FROM ledger_line WHERE entity_id=$1) ledger_lines,
    (SELECT count(*)::int FROM business_document WHERE entity_id=$1) documents`,[SCOPE.entityId])).rows[0];
  emit({gate:'population',...counts});
  assert.equal(counts.journals,VOLUME,'measurement requires the complete synthetic population');
  assert.equal(counts.ledger_lines,VOLUME*2);
  assert.equal(counts.documents,VOLUME);
  for(const table of ['journal_entry','journal_line','ledger_line','business_document'])await pool.query(`ANALYZE ${table}`);

  const bind={'p_tenant':'$1::uuid','p_entity':'$2::uuid','p_period':'$3::uuid','p_limit':'$4::integer','p_offset':'$5::integer'};
  const scope=[SCOPE.tenantId,SCOPE.entityId,SCOPE.periodId];
  const period={'selected_period.starts_on':"'2026-07-01'::date",'selected_period.ends_on':"'2026-07-31'::date",
    'selected_period.period_id':'$3::uuid','selected_period.period_code':"'2026-07'::text",
    'scoped_period.starts_on':"'2026-07-01'::date",'scoped_period.ends_on':"'2026-07-31'::date"};
  const scopeSql=await migration('252_authoritative_document_journal_period_scope.sql');
  const glSql=substitute(between(await migration('189_general_ledger_page_before_lineage.sql'),
    'WITH scoped AS (','FROM paged p ORDER BY p.journal_date,p.posted_at,p.ledger_line_id;'),
    {...bind,...period,'p_account_code':'NULL::text','p_query':'NULL::text'});
  const jeSql=substitute(between(scopeSql,'    SELECT j.journal_entry_id,j.journal_number,j.journal_type::text','LIMIT p_limit OFFSET p_offset;'),{...bind,...period});
  const bdSql=substitute(between(scopeSql,'    SELECT d.business_document_id,d.document_number','LIMIT p_limit OFFSET p_offset;'),{...bind,...period,'p_kind':"'AP_BILL'::text"});

  const results=[];
  for(const gate of [
    {gate:'gl_page_first',sql:glSql,params:[...scope,100,0],expectRows:100},
    {gate:'gl_page_deep',sql:glSql,params:[...scope,100,VOLUME],expectRows:100},
    {gate:'je_period_page_first',sql:jeSql,params:[...scope,100,0],expectRows:100},
    {gate:'je_period_page_deep',sql:jeSql,params:[...scope,100,VOLUME-100],expectRows:100},
    {gate:'ap_document_page_first',sql:bdSql,params:[...scope,100,0],expectRows:100},
    {gate:'ap_document_page_deep',sql:bdSql,params:[...scope,100,VOLUME-100],expectRows:100}
  ])results.push(await measure(pool,gate));

  // The authoritative GL snapshot (300) hashes its whole population, so it is
  // specified to fail closed above 100000 rows rather than serve an unbounded
  // page. Calling it needs a real session context; without one the call stops
  // at refs_assert_scope, which says nothing about the population bound. Report
  // that outcome as NOT_MEASURED rather than dressing a scope denial up as a
  // passing bound.
  const snapshotStarted=Date.now();
  try{
    const page=(await pool.query('SELECT refs_read_general_ledger_snapshot($1,$2,$3,NULL,NULL,$4,$5) AS page',[...scope,100,0])).rows[0].page;
    emit({gate:'gl_snapshot_population_bound',outcome:'SERVED',wall_ms:Date.now()-snapshotStarted,total_count:page.total_count,read_count:page.read_count});
  }catch(error){
    const scopeDenied=error.code==='42501';
    emit({gate:'gl_snapshot_population_bound',outcome:scopeDenied?'NOT_MEASURED':'REFUSED',wall_ms:Date.now()-snapshotStarted,
      sqlstate:error.code,message:error.message,
      note:scopeDenied?'stopped at refs_assert_scope before the population bound; needs a session-context run to measure':undefined});
  }

  const failures=[];
  for(const result of results){
    for(const [relation,visited] of Object.entries(result.relation_visits)){
      if(['journal_entry','ledger_line','journal_line','business_document'].includes(relation)&&visited>VOLUME/2)
        failures.push(`${result.gate}: one bounded page visited ${visited} rows of ${relation}`);
    }
    if(result.execution_ms>=PAGE_BUDGET_MS)failures.push(`${result.gate}: ${result.execution_ms.toFixed(1)}ms exceeds the ${PAGE_BUDGET_MS}ms bounded-page budget`);
  }
  emit({gate:'summary',population:VOLUME,page_budget_ms:PAGE_BUDGET_MS,failure_count:failures.length,failures});
  await pool.end();
  if(failures.length){console.error(`S20 HIGH-VOLUME READ GATE FAILED (${failures.length})`);for(const failure of failures)console.error('- '+failure);process.exitCode=1;}
  else console.log('S20 HIGH-VOLUME READ GATE PASSED');
}

const command=process.argv[2]||'measure';
const budgetArg=process.argv.indexOf('--budget-ms');
const budgetMs=budgetArg>0?Number(process.argv[budgetArg+1]):120000;
assert.ok(['seed','measure'].includes(command),`unknown command ${command}`);
(command==='seed'?seed(budgetMs):runMeasure()).catch(error=>{console.error('S20 GATE ERROR',error);process.exitCode=2;});
