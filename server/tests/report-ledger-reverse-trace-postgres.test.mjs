// Report-figure-first reverse trace against the production SQL.
//
// Every live-PG lineage test in postgres-kernel.test.mjs is source-first: it knows
// the journal it created and looks for it in the report. Nothing started from a
// report row and walked back. This file does: take each Trial Balance row the
// kernel returns, re-sum the ledger_line ids it cites and require the sum to equal
// the displayed balance, then follow ledger_line -> journal_entry (POSTED) ->
// source_link -> evidence, and confirm the paged General Ledger read cites the
// same ledger_line. A report that could not be re-derived from the rows it names
// would fail here even if every source-first test still passed.
//
// Scope: TB/BS/IS/CF rows from refs_get_financial_statements (062). The last hop
// to WBS raw_event / wbs_inbound_receipt needs a WBS-admitted fixture and stays
// covered source-first by kernel test "provider-signed Payable admission ...".

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
before(async()=>{
  try{
    admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-reverse-trace-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
    runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-reverse-trace-runtime',max:4});await runtime.query('SELECT 1');
    issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-reverse-trace-issuer',max:2});await issuer.query('SELECT 1');
  }catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}
});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});

async function grant(ids,actorId,permission){
  const authority=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL`,[ids.tenantId,actorId,ids.entityId,permission,authority]);
}
const kernelFor=(ids,actorId)=>{const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});};

// Two posted MANUAL journals across three accounts so the TB has both a
// multi-line account (111000) and single-line accounts.
async function seedPosted(){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'trace tenant']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'111000','Cash',true,'BANK'),($1,$2,'291001','Accounts Payable',true,'VENDOR'),($1,$2,'610000','Repairs Expense',false,NULL)",[tenantId,entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-1','BANK','Operating Cash'),($1,$2,'VENDOR-1','VENDOR','Vendor')",[tenantId,entityId]);
  const journals=[];
  for(const [n,lines] of [[1,[['111000',100,0,'BANK-1'],['291001',0,100,'VENDOR-1']]],[2,[['610000',37.5,0,null],['111000',0,37.5,'BANK-1']]]]){
    const journalId=randomUUID(),attachmentId=randomUUID();
    await admin.query(`INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by,reviewed_by,approved_by) VALUES($1,$2,$3,$4,$5,'MANUAL','APPROVED','2026-07-1${n}','USD','maker','reviewer','approver')`,[journalId,tenantId,entityId,periodId,`JE-TRACE-${n}`]);
    let ln=0;for(const [a,d,c,m] of lines)await admin.query("INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,dimensions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb)",[tenantId,entityId,periodId,journalId,++ln,a,d,c,m]);
    await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'evidence.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[attachmentId,tenantId,entityId,hash(attachmentId),`object://attachments/${attachmentId}`]);
    await admin.query("INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by) VALUES($1,$2,'JE_ATTACHMENT',$3,$4,'maker')",[tenantId,entityId,journalId,attachmentId]);
    journals.push({journalId,attachmentId});
  }
  const ids={tenantId,entityId,periodId};
  await grant(ids,'trace-poster','GL.JE.POST');
  const poster=kernelFor(ids,'trace-poster');
  for(const {journalId} of journals)await poster.postJournal({...ids,journalEntryId:journalId,expectedRevision:0,idempotencyKey:`trace-post-${journalId}`});
  return {...ids,journals};
}
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

pgTest('every Trial Balance row re-derives exactly from the ledger_line ids it cites, and each cited line belongs to a POSTED journal in the period',async()=>{
  const ids=await seedPosted();
  await grant(ids,'trace-reader','GL.REPORT.VIEW');
  const rows=await kernelFor(ids,'trace-reader').getFinancialStatements(ids);
  const tb=rows.filter(r=>r.statement_type==='TRIAL_BALANCE');
  assert.ok(tb.length>=3,`expected 3 accounts in the trial balance, got ${tb.length}`);
  for(const row of tb){
    assert.ok(Array.isArray(row.ledger_line_ids)&&row.ledger_line_ids.length>0,`${row.account_code} cites no ledger lines`);
    const sum=(await admin.query('SELECT coalesce(sum(debit_amount),0)::text d,coalesce(sum(credit_amount),0)::text c,count(*)::int n FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2 AND ledger_line_id=ANY($3::uuid[])',[ids.tenantId,ids.entityId,row.ledger_line_ids])).rows[0];
    assert.equal(sum.n,row.ledger_line_ids.length,`${row.account_code}: some cited ledger_line ids do not exist`);
    assert.equal(Number(sum.d)-Number(sum.c),Number(row.display_balance),`${row.account_code}: display_balance ${row.display_balance} != re-summed ${Number(sum.d)-Number(sum.c)}`);
    assert.equal(Number(row.ending_debit),Number(sum.d));assert.equal(Number(row.ending_credit),Number(sum.c));
    const journals=(await admin.query("SELECT DISTINCT j.journal_entry_id,j.status,j.period_id FROM ledger_line l JOIN journal_entry j ON j.journal_entry_id=l.journal_entry_id WHERE l.ledger_line_id=ANY($1::uuid[])",[row.ledger_line_ids])).rows;
    assert.ok(journals.every(j=>j.status==='POSTED'&&j.period_id===ids.periodId),`${row.account_code}: a cited line belongs to a non-POSTED or out-of-period journal`);
    assert.deepEqual(journals.map(j=>j.journal_entry_id).sort(),[...row.journal_entry_ids].sort(),`${row.account_code}: journal_entry_ids disagree with the journals behind the cited lines`);
  }
  // Sum of display balances across the trial balance is zero.
  assert.equal(tb.reduce((s,r)=>s+Number(r.display_balance),0),0);
});

pgTest('Balance Sheet and Income Statement rows are the same ledger lines re-sectioned; nothing appears that the trial balance does not cite',async()=>{
  const ids=await seedPosted();
  await grant(ids,'trace-reader','GL.REPORT.VIEW');
  const rows=await kernelFor(ids,'trace-reader').getFinancialStatements(ids);
  const tbLines=new Set(rows.filter(r=>r.statement_type==='TRIAL_BALANCE').flatMap(r=>r.ledger_line_ids));
  for(const type of ['BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW']){
    const section=rows.filter(r=>r.statement_type===type);
    assert.ok(section.length>0,`${type} returned no rows`);
    for(const row of section)for(const id of row.ledger_line_ids)assert.ok(tbLines.has(id),`${type} ${row.account_code} cites ledger_line ${id} the trial balance does not`);
  }
  const is=rows.filter(r=>r.statement_type==='INCOME_STATEMENT');
  assert.equal(is.reduce((s,r)=>s+Number(r.display_balance),0),37.5,'income statement must show the 610000 expense only');
});

pgTest('from a report row back to evidence: ledger_line -> journal_entry -> source_link -> verified attachment, and the paged General Ledger cites the same line',async()=>{
  const ids=await seedPosted();
  await grant(ids,'trace-reader','GL.REPORT.VIEW');await grant(ids,'trace-reader','GL.JE.VIEW');
  const reader=kernelFor(ids,'trace-reader');
  const row=(await reader.getFinancialStatements(ids)).find(r=>r.statement_type==='TRIAL_BALANCE'&&r.account_code==='610000');
  assert.ok(row);
  const [lineId]=row.ledger_line_ids;
  const evidence=(await admin.query(`SELECT j.journal_entry_id,j.status,a.attachment_id,a.finalization_status,a.scan_status
    FROM ledger_line l JOIN journal_entry j ON j.journal_entry_id=l.journal_entry_id
    JOIN source_link s ON s.journal_entry_id=j.journal_entry_id AND s.link_type='JE_ATTACHMENT'
    JOIN attachment a ON a.attachment_id=s.attachment_id WHERE l.ledger_line_id=$1`,[lineId])).rows;
  assert.equal(evidence.length,1);
  assert.equal(evidence[0].status,'POSTED');assert.equal(evidence[0].finalization_status,'VERIFIED_CLEAN');assert.equal(evidence[0].scan_status,'CLEAN');
  assert.ok(ids.journals.some(j=>j.journalId===evidence[0].journal_entry_id&&j.attachmentId===evidence[0].attachment_id),'the evidence reached is the exact attachment the fixture attached');
  const gl=await reader.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,limit:50});
  const glRows=Array.isArray(gl)?gl:(gl.rows||gl.entries||[]);
  assert.ok(glRows.some(r=>r.ledger_line_id===lineId),'the paged General Ledger must cite the same ledger_line the statement cites');
});
