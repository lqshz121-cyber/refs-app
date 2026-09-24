// 437 / D-R03-1: the AP/AR control reconciliation compares POSTED subledger with POSTED ledger.
//
// R03-F1: before 437 the view summed open_balance for every non-VOID AP bill and every AR invoice,
// while the ledger side only ever contains posted journals. A single DRAFT bill therefore read as
// "AP out of balance by its full amount" -- noise that buries the real exceptions the view exists
// to surface. These tests pin the corrected semantics from both directions: drafts are invisible
// to the view, and a genuine break (a manual journal on 291001 with no document) is still reported.
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
    admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-437-admin',max:4,statementTimeoutMs:300000});
    await admin.query('SELECT 1');await migrateUp(admin,{});
    runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-437-runtime',max:8});await runtime.query('SELECT 1');
    issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-437-issuer',max:4});await issuer.query('SELECT 1');
  }catch(error){
    unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;
    if(config.requirePostgres)throw error;
    for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=null;runtime=null;issuer=null;
  }
});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
const pgTest=(name,fn)=>test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});

async function grant(ids,actorId,permission){
  const a=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until)
    VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour')
    ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL,valid_until=EXCLUDED.valid_until`,
    [ids.tenantId,actorId,ids.entityId,permission,a]);
}
const kernelFor=(ids,actorId)=>{
  const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});
  return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});
};

async function seed(tag){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),attachmentId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),`m437-${tag}`]);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES
    ($1,$2,'291001','Accounts Payable',true,'VENDOR'),
    ($1,$2,'120200','Accounts Receivable',true,'CUSTOMER_OR_AFFILIATE'),
    ($1,$2,'610000','Repairs',false,NULL),
    ($1,$2,'400000','Revenue',false,NULL),
    ($1,$2,'111000','Operating Cash',true,'BANK')`,[tenantId,entityId]);
  await admin.query(`INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES
    ($1,$2,'VENDOR-1','VENDOR','Vendor'),($1,$2,'CUST-1','CUSTOMER','Customer'),($1,$2,'BANK-1','BANK','Bank')`,[tenantId,entityId]);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,finalized_at,scan_status,finalization_status)
    VALUES($1,$2,$3,'doc.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),now(),'CLEAN','VERIFIED_CLEAN')`,[attachmentId,tenantId,entityId,hash(attachmentId),`object://m437/${attachmentId}`]);
  const ids={tenantId,entityId,periodId,attachmentId};
  for(const [a,p] of [['maker','AP.BILL.CREATE'],['maker','AR.INVOICE.CREATE'],
    ['submitter','GL.JE.SUBMIT'],['reviewer','GL.JE.REVIEW'],['approver','GL.JE.APPROVE'],['poster','GL.JE.POST']]) await grant(ids,a,p);
  return ids;
}

async function postFully(ids,journalEntryId,tag){
  await kernelFor(ids,'submitter').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'SUBMIT',expectedRevision:0,idempotencyKey:`m437-sub-${tag}`});
  await kernelFor(ids,'reviewer').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'REVIEW',expectedRevision:1,idempotencyKey:`m437-rev-${tag}`});
  await kernelFor(ids,'approver').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'APPROVE',expectedRevision:2,idempotencyKey:`m437-app-${tag}`});
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId,expectedRevision:3,idempotencyKey:`m437-post-${tag}`});
}

const createDocument=(ids,kind,tag,amount)=>kernelFor(ids,'maker').createBusinessDocument({
  tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,documentKind:kind,
  documentNumber:`M437-${kind}-${tag}`,
  counterpartyRef:kind==='AP_BILL'?'VENDOR-1':'CUST-1',counterpartyName:'Counterparty',
  currency:'USD',accountingDate:'2026-07-10',dueDate:'2026-08-09',amount,
  offsetAccountCode:kind==='AP_BILL'?'610000':'400000',description:'437 document',
  attachmentIds:[ids.attachmentId],idempotencyKey:`m437-create-${kind}-${tag}`});

const reconciliation=async ids=>(await admin.query(
  'SELECT ap_open_balance::text,ap_control_balance::text,ap_in_balance,ar_open_balance::text,ar_control_balance::text,ar_in_balance FROM refs_ap_ar_control_reconciliation WHERE tenant_id=$1 AND entity_id=$2',
  [ids.tenantId,ids.entityId])).rows[0]??null;

pgTest('M437-1: a DRAFT AP bill and a DRAFT AR invoice do not appear in the control reconciliation at all',async()=>{
  const ids=await seed('draft');
  const bill=await createDocument(ids,'AP_BILL','d1',100);
  const invoice=await createDocument(ids,'AR_INVOICE','d2',250);
  const docs=(await admin.query('SELECT status,open_balance::text,posted_journal_entry_id FROM business_document WHERE tenant_id=$1 ORDER BY document_kind',[ids.tenantId])).rows;
  assert.deepEqual(docs.map(d=>[d.status,d.open_balance,d.posted_journal_entry_id]),[['DRAFT','100.0000',null],['DRAFT','250.0000',null]],
    'precondition: both documents are drafts with an open_balance and no posted journal -- exactly the shape that produced the false break');
  assert.ok(bill.business_document_id&&invoice.business_document_id);
  const r=await reconciliation(ids);
  // No posted document, no ledger line: the entity has no row, or a row that is in balance at zero.
  if(r!==null){
    assert.equal(r.ap_open_balance,'0.0000');assert.equal(r.ar_open_balance,'0.0000');
    assert.equal(r.ap_in_balance,true);assert.equal(r.ar_in_balance,true);
  }
});

pgTest('M437-2: once posted, the same documents appear on both sides and the entity is in balance',async()=>{
  const ids=await seed('posted');
  const bill=await createDocument(ids,'AP_BILL','p1',100);
  const invoice=await createDocument(ids,'AR_INVOICE','p2',250);
  await postFully(ids,bill.journal_entry_id,'bill');
  const mid=await reconciliation(ids);
  assert.deepEqual([mid.ap_open_balance,mid.ap_control_balance,mid.ap_in_balance],['100.0000','100.0000',true],'posted bill: subledger and ledger agree');
  assert.deepEqual([mid.ar_open_balance,mid.ar_control_balance,mid.ar_in_balance],['0.0000','0.0000',true],'the still-draft invoice is not counted');
  await postFully(ids,invoice.journal_entry_id,'invoice');
  const r=await reconciliation(ids);
  assert.deepEqual([r.ap_in_balance,r.ar_open_balance,r.ar_control_balance,r.ar_in_balance],[true,'250.0000','250.0000',true]);
});

pgTest('M437-3: a manual journal on the AP control account with no document is still reported as a break',async()=>{
  // The view must not become blind in the other direction. A posted journal crediting 291001 with
  // no business document is the textbook exception (428:6) and has to stay visible.
  const ids=await seed('break');
  // A posted bill first, so the test also proves R06's central claim: a manual journal on the
  // control account leaves business_document.open_balance untouched (only reducers move it).
  const bill=await createDocument(ids,'AP_BILL','b1',400);
  await postFully(ids,bill.journal_entry_id,'bill');
  assert.deepEqual(await reconciliation(ids).then(r=>[r.ap_open_balance,r.ap_control_balance,r.ap_in_balance]),['400.0000','400.0000',true]);
  const journalId=randomUUID();
  await admin.query(`INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by,reviewed_by,approved_by)
    VALUES($1,$2,$3,$4,$5,'MANUAL','APPROVED','2026-07-15','USD','maker','reviewer','approver')`,[journalId,ids.tenantId,ids.entityId,ids.periodId,`M437-${journalId.slice(0,8)}`]);
  for(const [n,acct,d,c,m] of [[1,'610000',100,0,null],[2,'291001',0,100,'VENDOR-1']])
    await admin.query("INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,dimensions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb)",[ids.tenantId,ids.entityId,ids.periodId,journalId,n,acct,d,c,m]);
  await admin.query("INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by) VALUES($1,$2,'JE_ATTACHMENT',$3,$4,'maker')",[ids.tenantId,ids.entityId,journalId,ids.attachmentId]);
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:journalId,expectedRevision:0,idempotencyKey:'m437-manual-post'});
  const r=await reconciliation(ids);
  assert.deepEqual([r.ap_open_balance,r.ap_control_balance,r.ap_in_balance],['400.0000','500.0000',false],'ledger moved without a document: this is the exception the view exists for');
  const doc=(await admin.query('SELECT open_balance::text,status FROM business_document WHERE business_document_id=$1',[bill.business_document_id])).rows[0];
  assert.deepEqual(doc,{open_balance:'400.0000',status:'OPEN'},'a plain manual journal never changes a document\'s open_balance');
});

pgTest('M437-5: refs_app cannot read the view directly (042 boundary restored); the AP.VIEW reader still works',async()=>{
  const ids=await seed('grant');
  await grant(ids,'viewer','AP.VIEW');
  // refs_runtime is a NOINHERIT member of refs_app, so the privilege has to be tested AS refs_app.
  const client=await runtime.connect();
  try{
    await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');
    await assert.rejects(client.query('SELECT 1 FROM refs_ap_ar_control_reconciliation LIMIT 1'),e=>e.code==='42501',
      'R06-F2: 044 had re-granted SELECT to refs_app; 437 revokes it again so the only path is the scope-asserting reader');
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
  const rows=await kernelFor(ids,'viewer').getApControlTotal({tenantId:ids.tenantId,entityId:ids.entityId});
  assert.ok(Array.isArray(rows),'the SECURITY DEFINER reader is unaffected');
});

pgTest('M437-4: the live view definition filters on a posted journal and excludes pre-posting statuses',async()=>{
  const def=(await admin.query("SELECT pg_get_viewdef('refs_ap_ar_control_reconciliation'::regclass,true) AS d")).rows[0].d;
  assert.match(def,/posted_journal_entry_id IS NOT NULL/);
  for(const s of ['DRAFT','PENDING_POST','VOID','REVERSED'])assert.ok(def.includes(`'${s}'`),`${s} must be excluded from the subledger side`);
  assert.doesNotMatch(def,/status <> 'VOID'/,'the 044 AP-only filter must be gone');
});
