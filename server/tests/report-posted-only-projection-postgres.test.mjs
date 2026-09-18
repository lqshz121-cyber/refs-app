// P09 — every financial statement projects POSTED ledger only, and the statements tie to each other.
// Drafts, approved-but-unposted journals, staging rows and raw events must never reach a report line.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

const config=runtimeConfig();
let admin=null,runtime=null,issuer=null,unavailable=null;
const hash=v=>`sha256:${createHash('sha256').update(String(v)).digest('hex')}`;

before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-p09-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-p09-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-p09-issuer',max:2});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});

async function grant(ids,actorId,permission){
  const a=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL,authority_class=EXCLUDED.authority_class,valid_until=EXCLUDED.valid_until`,[ids.tenantId,actorId,ids.entityId,permission,a]);
}
const kernelFor=(ids,actorId)=>{
  const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});
  return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});
};
const rejects=async(fn,code)=>{try{await fn();assert.fail('expected rejection '+code);}catch(e){assert.equal(e.code,code,e.message);}};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

async function seed(tag){
  const tenantId=randomUUID(),entityId=randomUUID(),julyId=randomUUID(),augustId=randomUUID(),attachmentId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),`p09-${tag}`]);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[julyId,tenantId,entityId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[augustId,tenantId,entityId]);
  // 1% asset, 2% liability, 3% equity, 4% revenue, 5-9% expense (062 classification)
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES
    ($1,$2,'111000','Operating cash',true,'BANK'),($1,$2,'150100','Construction in progress',false,NULL),
    ($1,$2,'291001','Accounts payable',true,'VENDOR'),($1,$2,'310000','Contributed capital',false,NULL),
    ($1,$2,'400100','Rental revenue',false,NULL),($1,$2,'610000','Repairs expense',false,NULL)`,[tenantId,entityId]);
  await admin.query(`INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-1','BANK','Operating bank'),($1,$2,'VENDOR-1','VENDOR','Builder')`,[tenantId,entityId]);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'doc.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[attachmentId,tenantId,entityId,hash(attachmentId),`object://attachments/${attachmentId}`]);
  const ids={tenantId,entityId,julyId,augustId,attachmentId};
  for(const [a,p] of [['jemaker','GL.JE.CREATE'],['submitter','GL.JE.SUBMIT'],['reviewer','GL.JE.REVIEW'],['approver','GL.JE.APPROVE'],['poster','GL.JE.POST'],['reporter','GL.REPORT.VIEW'],['reporter','GL.JE.VIEW']])await grant(ids,a,p);
  return ids;
}
const mem=a=>a==='111000'?'BANK-1':a==='291001'?'VENDOR-1':null;
async function makeJournal(ids,tag,rows,{periodId=ids.julyId,date='2026-07-10'}={}){
  const lines=rows.map(([account,debit,credit],i)=>({line_no:i+1,account_code:account,debit_amount:debit,credit_amount:credit,member_ref:mem(account),dimensions:{}}));
  return kernelFor(ids,'jemaker').createManualJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId,journalNumber:`P09-${tag}`,journalDate:date,currency:'USD',description:`p09 ${tag}`,attachmentIds:[ids.attachmentId],idempotencyKey:`p09-je-${tag}`,lines});
}
async function postFully(ids,journalEntryId,tag,periodId=ids.julyId){
  await kernelFor(ids,'submitter').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'SUBMIT',expectedRevision:0,idempotencyKey:`p09-sub-${tag}`});
  await kernelFor(ids,'reviewer').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'REVIEW',expectedRevision:1,idempotencyKey:`p09-rev-${tag}`});
  await kernelFor(ids,'approver').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'APPROVE',expectedRevision:2,idempotencyKey:`p09-app-${tag}`});
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId,journalEntryId,expectedRevision:3,idempotencyKey:`p09-post-${tag}`});
}
const statements=(ids,periodId=ids.julyId)=>kernelFor(ids,'reporter').getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId});
const pick=(rows,type)=>rows.filter(r=>r.statement_type===type);
const sumBy=(rows,f=r=>Number(r.display_balance))=>rows.reduce((a,r)=>a+f(r),0);
const round=n=>Math.round(n*10000)/10000;

pgTest('P09-1: TB/BS/IS/CF and the GL all project POSTED ledger only, and tie to each other',async()=>{
  const ids=await seed('projection');
  // POSTED: capital 100,000 cash; CWIP 30,000 on credit; revenue 12,000 cash; expense 2,500 cash
  const a=await makeJournal(ids,'capital',[['111000',100000,0],['310000',0,100000]]);await postFully(ids,a.journal_entry_id,'capital');
  const b=await makeJournal(ids,'cwip',[['150100',30000,0],['291001',0,30000]]);await postFully(ids,b.journal_entry_id,'cwip');
  const c=await makeJournal(ids,'revenue',[['111000',12000,0],['400100',0,12000]]);await postFully(ids,c.journal_entry_id,'revenue');
  const d=await makeJournal(ids,'expense',[['610000',2500,0],['111000',0,2500]]);await postFully(ids,d.journal_entry_id,'expense');
  // NOT posted, and each at a different lifecycle stage, all with large amounts that would be obvious
  const draft=await makeJournal(ids,'draft',[['610000',777000,0],['111000',0,777000]]);
  const approved=await makeJournal(ids,'approved',[['610000',888000,0],['111000',0,888000]]);
  await kernelFor(ids,'submitter').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:approved.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'p09-sub-approved'});
  await kernelFor(ids,'reviewer').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:approved.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'p09-rev-approved'});
  await kernelFor(ids,'approver').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:approved.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'p09-app-approved'});
  const statuses=(await admin.query('SELECT status,count(*)::int n FROM journal_entry WHERE tenant_id=$1 GROUP BY status ORDER BY status',[ids.tenantId])).rows;
  assert.deepEqual(statuses,[{status:'DRAFT',n:1},{status:'APPROVED',n:1},{status:'POSTED',n:4}],'the fixture really does hold unposted work');

  const rows=await statements(ids);
  const everyAmount=rows.flatMap(r=>[r.opening_debit,r.opening_credit,r.period_debit,r.period_credit,r.ending_debit,r.ending_credit].map(Number));
  assert.ok(!everyAmount.some(v=>Math.abs(v)>=777000),'no unposted amount reached any statement line');

  const tb=pick(rows,'TRIAL_BALANCE');
  assert.equal(round(sumBy(tb,r=>Number(r.ending_debit))),144500);
  assert.equal(round(sumBy(tb,r=>Number(r.ending_credit))),144500,'trial balance is in balance');
  assert.equal(round(sumBy(tb)),0,'signed trial balance nets to zero');
  // ledger tie-out: the trial balance equals a direct ledger_line aggregate
  const direct=(await admin.query("SELECT account_code,sum(debit_amount)::text d,sum(credit_amount)::text c FROM ledger_line WHERE tenant_id=$1 GROUP BY account_code ORDER BY account_code",[ids.tenantId])).rows;
  const tbByAccount=Object.fromEntries(tb.map(r=>[r.account_code,[Number(r.ending_debit),Number(r.ending_credit)]]));
  for(const row of direct)assert.deepEqual(tbByAccount[row.account_code],[Number(row.d),Number(row.c)],row.account_code);

  const is=pick(rows,'INCOME_STATEMENT');
  const revenue=sumBy(is.filter(r=>r.statement_section==='REVENUE')),expenses=sumBy(is.filter(r=>r.statement_section==='EXPENSES'));
  assert.equal(round(revenue),12000);assert.equal(round(expenses),2500);
  const netIncome=round(revenue-expenses);assert.equal(netIncome,9500);

  const bs=pick(rows,'BALANCE_SHEET');
  const assets=sumBy(bs.filter(r=>r.statement_section==='ASSETS'));
  const liabilities=sumBy(bs.filter(r=>r.statement_section==='LIABILITIES'));
  const equity=sumBy(bs.filter(r=>r.statement_section==='EQUITY'));
  const earnings=sumBy(bs.filter(r=>r.statement_section==='CURRENT_EARNINGS'));
  assert.equal(round(assets),139500,'cash 109,500 + CWIP 30,000');
  assert.equal(round(liabilities),30000);assert.equal(round(equity),100000);
  assert.equal(round(earnings),netIncome,'current earnings on the balance sheet equal income statement net income');
  assert.equal(round(assets),round(liabilities+equity+earnings),'assets = liabilities + equity + earnings');

  const cf=pick(rows,'CASH_FLOW');
  assert.deepEqual(cf.map(r=>r.statement_section),['DIRECT_CASH_MOVEMENT'],'only bank-member accounts appear');
  assert.equal(round(sumBy(cf)),109500,'direct cash movement equals the cash account balance');
  assert.equal(round(sumBy(cf)),round(sumBy(bs.filter(r=>r.account_code==='111000'))));

  // general ledger drilldown ties to the trial balance for one account and paginates stably
  const gl=await kernelFor(ids,'reporter').listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.julyId,accountCode:'111000',limit:50,offset:0});
  const glRows=Array.isArray(gl)?gl:gl.rows;
  assert.equal(glRows.length,3,'three posted cash movements, no Draft or approved line');
  assert.equal(round(glRows.reduce((a,r)=>a+Number(r.debit_amount)-Number(r.credit_amount),0)),109500);
  const page1=await kernelFor(ids,'reporter').listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.julyId,accountCode:'111000',limit:2,offset:0});
  const page2=await kernelFor(ids,'reporter').listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.julyId,accountCode:'111000',limit:2,offset:2});
  const ids1=(Array.isArray(page1)?page1:page1.rows).map(r=>r.ledger_line_id),ids2=(Array.isArray(page2)?page2:page2.rows).map(r=>r.ledger_line_id);
  assert.equal(ids1.length,2);assert.equal(ids2.length,1);
  assert.equal(new Set([...ids1,...ids2]).size,3,'pagination is stable and does not repeat or drop a line');

  // every statement line carries its own evidence back to the ledger
  for(const row of tb)assert.ok(Array.isArray(row.ledger_line_ids)&&row.ledger_line_ids.length>0,`${row.account_code} carries ledger evidence`);
  await rejects(()=>kernelFor(ids,'jemaker').getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.julyId}),'42501');
});

pgTest('P09-2: period comparison, opening/period/ending split and honest empty states',async()=>{
  const ids=await seed('periods');
  const a=await makeJournal(ids,'july-rev',[['111000',5000,0],['400100',0,5000]]);await postFully(ids,a.journal_entry_id,'july-rev');
  const b=await makeJournal(ids,'aug-rev',[['111000',8000,0],['400100',0,8000]],{periodId:ids.augustId,date:'2026-08-10'});
  await postFully(ids,b.journal_entry_id,'aug-rev',ids.augustId);

  const july=await statements(ids,ids.julyId),august=await statements(ids,ids.augustId);
  const cashJuly=pick(july,'TRIAL_BALANCE').find(r=>r.account_code==='111000');
  const cashAug=pick(august,'TRIAL_BALANCE').find(r=>r.account_code==='111000');
  assert.deepEqual([Number(cashJuly.opening_debit),Number(cashJuly.period_debit),Number(cashJuly.ending_debit)],[0,5000,5000]);
  assert.deepEqual([Number(cashAug.opening_debit),Number(cashAug.period_debit),Number(cashAug.ending_debit)],[5000,8000,13000],
    'August opens with July closing and ends cumulative');
  const isJuly=round(sumBy(pick(july,'INCOME_STATEMENT').filter(r=>r.statement_section==='REVENUE')));
  const isAug=round(sumBy(pick(august,'INCOME_STATEMENT').filter(r=>r.statement_section==='REVENUE')));
  assert.equal(isJuly,5000);assert.equal(isAug,8000,'the income statement is a period movement, not cumulative');

  const comparison=await kernelFor(ids,'reporter').getFinancialStatementPeriodComparison({tenantId:ids.tenantId,entityId:ids.entityId,currentPeriodId:ids.augustId,priorPeriodId:ids.julyId});
  const compRows=Array.isArray(comparison)?comparison:comparison.rows;
  assert.ok(compRows.length>0,'the comparison read returns rows');
  const compCash=compRows.find(r=>r.account_code==='111000'&&r.statement_type==='TRIAL_BALANCE');
  assert.ok(compCash,'cash appears in the comparison');

  // an entity with no postings at all reports empty, not an error, and still refuses without scope
  const empty=await seed('empty');
  const none=await statements(empty);
  assert.deepEqual(none,[],'no postings yields an empty projection, not a fabricated zero row');
  const emptyGl=await kernelFor(empty,'reporter').listGeneralLedger({tenantId:empty.tenantId,entityId:empty.entityId,periodId:empty.julyId,limit:50,offset:0});
  assert.equal((Array.isArray(emptyGl)?emptyGl:emptyGl.rows).length,0);
  await rejects(()=>kernelFor(empty,'jemaker').listGeneralLedger({tenantId:empty.tenantId,entityId:empty.entityId,periodId:empty.julyId,limit:50,offset:0}),'42501');
  // a period that belongs to another company is rejected, not silently empty
  await rejects(()=>kernelFor(empty,'reporter').getFinancialStatements({tenantId:empty.tenantId,entityId:empty.entityId,periodId:ids.julyId}),'22023');
});
