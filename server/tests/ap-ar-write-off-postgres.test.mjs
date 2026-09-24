// X02: AP/AR write-off must move the subledger and the ledger together.
//
// The defect this closes: before migration 434/435 the only way to clear an uncollectible balance
// was a generic manual journal, which moves 291001/120200 but never touches
// business_document.open_balance. The document then ages forever and
// refs_ap_ar_control_reconciliation reports a break -- exactly the condition migration 428:6
// describes as "an exception the Controller must explain".
//
// So the load-bearing assertion in this file is not "the command returns 201". It is that after a
// write-off posts, BOTH sides of refs_ap_ar_control_reconciliation have moved by the same amount
// and the view still reports in_balance. Everything else here is a guard around that.
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
    admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-x02-admin',max:4,statementTimeoutMs:300000});
    await admin.query('SELECT 1');await migrateUp(admin,{});
    runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-x02-runtime',max:8});await runtime.query('SELECT 1');
    issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-x02-issuer',max:4});await issuer.query('SELECT 1');
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
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),closedPeriodId=randomUUID(),attachmentId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),`x02-${tag}`]);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status,closed_by,closed_at) VALUES($1,$2,$3,'2026-06','2026-06-01','2026-06-30','CLOSED','closer',now())",[closedPeriodId,tenantId,entityId]);
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES
    ($1,$2,'291001','Accounts Payable',true,'VENDOR'),
    ($1,$2,'120200','Accounts Receivable',true,'CUSTOMER_OR_AFFILIATE'),
    ($1,$2,'610000','Repairs',false,NULL),
    ($1,$2,'400000','Revenue',false,NULL),
    ($1,$2,'706000','Bad debt expense',false,NULL),
    ($1,$2,'482400','Bad debt recovery',false,NULL),
    ($1,$2,'111000','Operating Cash',true,'BANK')`,[tenantId,entityId]);
  await admin.query(`INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES
    ($1,$2,'VENDOR-1','VENDOR','Vendor'),($1,$2,'CUST-1','CUSTOMER','Customer'),($1,$2,'BANK-1','BANK','Bank')`,[tenantId,entityId]);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,finalized_at,scan_status,finalization_status)
    VALUES($1,$2,$3,'doc.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),now(),'CLEAN','VERIFIED_CLEAN')`,[attachmentId,tenantId,entityId,hash(attachmentId),`object://x02/${attachmentId}`]);
  const ids={tenantId,entityId,periodId,closedPeriodId,attachmentId};
  for(const [a,p] of [['maker','AP.BILL.CREATE'],['maker','AR.INVOICE.CREATE'],
    ['submitter','GL.JE.SUBMIT'],['reviewer','GL.JE.REVIEW'],['approver','GL.JE.APPROVE'],['poster','GL.JE.POST'],
    ['apwriter','AP.BILL.WRITE_OFF.CREATE'],['arwriter','AR.INVOICE.WRITE_OFF.CREATE'],
    ['viewer','AP.VIEW'],['viewer','AR.VIEW']]) await grant(ids,a,p);
  return ids;
}

async function postFully(ids,journalEntryId,tag,periodId=ids.periodId){
  await kernelFor(ids,'submitter').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'SUBMIT',expectedRevision:0,idempotencyKey:`x02-sub-${tag}`});
  await kernelFor(ids,'reviewer').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'REVIEW',expectedRevision:1,idempotencyKey:`x02-rev-${tag}`});
  await kernelFor(ids,'approver').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'APPROVE',expectedRevision:2,idempotencyKey:`x02-app-${tag}`});
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId,journalEntryId,expectedRevision:3,idempotencyKey:`x02-post-${tag}`});
}

async function openDocument(ids,kind,tag,amount){
  const doc=await kernelFor(ids,'maker').createBusinessDocument({
    tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,documentKind:kind,
    documentNumber:`X02-${kind}-${tag}`,
    counterpartyRef:kind==='AP_BILL'?'VENDOR-1':'CUST-1',counterpartyName:'Counterparty',
    currency:'USD',accountingDate:'2026-07-10',dueDate:'2026-08-09',amount,
    offsetAccountCode:kind==='AP_BILL'?'610000':'400000',description:'x02 document',
    attachmentIds:[ids.attachmentId],idempotencyKey:`x02-create-${kind}-${tag}`});
  await postFully(ids,doc.journal_entry_id,`doc-${kind}-${tag}`);
  return doc.business_document_id;
}

// The control reconciliation view is the whole point: read both sides together.
const reconciliation=async ids=>(await admin.query(
  'SELECT * FROM refs_ap_ar_control_reconciliation WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0];
const document=async(ids,id)=>(await admin.query(
  'SELECT open_balance::text,status,posted_credit_adjustments::text FROM business_document WHERE business_document_id=$1',[id])).rows[0];

const writeOff=(ids,actor,documentId,amount,account,tag,periodId=ids.periodId)=>
  kernelFor(ids,actor).createApArWriteOff({
    tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:documentId,periodId,
    journalNumber:`X02-WO-${tag}`,journalDate:'2026-07-20',amount,writeOffAccountCode:account,
    attachmentIds:[ids.attachmentId],
    reason:'Uncollectible balance written off under X02 controlled command.',
    idempotencyKey:`x02-wo-${tag}`});

pgTest('X02-1: a partial AP write-off moves the subledger and the ledger by the same amount, and the control reconciliation stays in balance',async()=>{
  const ids=await seed('ap-partial');
  const billId=await openDocument(ids,'AP_BILL','p1',1000);

  const before=await reconciliation(ids);
  assert.equal(before.ap_open_balance,'1000.0000');
  assert.equal(before.ap_control_balance,'1000.0000');
  assert.equal(before.ap_in_balance,true,'precondition: the entity must start in balance');

  const draft=await writeOff(ids,'apwriter',billId,'300.0000','482400','p1');
  assert.equal(draft.status,'DRAFT','the command must never post by itself');
  assert.equal(draft.document_kind,'AP_BILL');

  // Still untouched before the journal posts: a Draft changes no balance.
  assert.equal((await document(ids,billId)).open_balance,'1000.0000');
  assert.equal((await reconciliation(ids)).ap_open_balance,'1000.0000');

  await postFully(ids,draft.journal_entry_id,'wo-p1');

  const doc=await document(ids,billId);
  assert.equal(doc.open_balance,'700.0000','subledger must drop by exactly the written-off amount');
  assert.equal(doc.status,'PARTIALLY_PAID');
  assert.equal(doc.posted_credit_adjustments,'300.0000');

  const after=await reconciliation(ids);
  assert.equal(after.ap_open_balance,'700.0000','documents side moved');
  assert.equal(after.ap_control_balance,'700.0000','ledger side moved by the same amount');
  assert.equal(after.ap_in_balance,true,'THE POINT: a write-off must not break the control reconciliation');

  // R06: the period-scoped read (166, refs_ap_ar_period_control_lineage) is what the UI shows when a
  // period is selected. It recomputes each document from gross minus posted allocations rather than
  // reading open_balance, so it must independently agree -- the write-off's allocation is what it
  // subtracts, and the lineage must name the write-off journal on the ledger side.
  const period=await kernelFor(ids,'viewer').getApControlTotal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  assert.equal(period.length,1,'one currency');
  assert.equal(String(period[0].open_balance),'700.0000','period lineage: document side net of the write-off allocation');
  assert.equal(String(period[0].control_balance),'700.0000','period lineage: ledger side');
  assert.equal(period[0].in_balance,true);
  assert.deepEqual(period[0].business_document_ids,[billId]);
  assert.ok(period[0].journal_entry_ids.includes(draft.journal_entry_id),'the write-off journal is part of the control-account lineage');
});

pgTest('X02-2: writing off the remainder closes the document and leaves both sides at zero',async()=>{
  const ids=await seed('ap-full');
  const billId=await openDocument(ids,'AP_BILL','f1',500);
  const draft=await writeOff(ids,'apwriter',billId,'500.0000','482400','f1');
  await postFully(ids,draft.journal_entry_id,'wo-f1');

  const doc=await document(ids,billId);
  assert.equal(doc.open_balance,'0.0000');
  assert.equal(doc.status,'PAID','a fully written-off document is closed, not left open');
  const after=await reconciliation(ids);
  assert.equal(after.ap_open_balance,'0.0000');
  assert.equal(after.ap_control_balance,'0.0000');
  assert.equal(after.ap_in_balance,true);
});

pgTest('X02-3: an AR write-off hits bad debt expense and keeps the AR control reconciliation in balance',async()=>{
  const ids=await seed('ar');
  const invoiceId=await openDocument(ids,'AR_INVOICE','r1',800);
  const before=await reconciliation(ids);
  assert.equal(before.ar_open_balance,'800.0000');
  assert.equal(before.ar_in_balance,true);

  const draft=await writeOff(ids,'arwriter',invoiceId,'800.0000','706000','r1');
  assert.equal(draft.document_kind,'AR_INVOICE');
  await postFully(ids,draft.journal_entry_id,'wo-r1');

  const after=await reconciliation(ids);
  assert.equal(after.ar_open_balance,'0.0000');
  assert.equal(after.ar_control_balance,'0.0000');
  assert.equal(after.ar_in_balance,true);
  assert.equal((await document(ids,invoiceId)).status,'PAID');

  // The expense really landed on the bad-debt account, not somewhere convenient.
  const expense=(await admin.query(
    `SELECT COALESCE(sum(debit_amount-credit_amount),0)::text AS net FROM ledger_line
      WHERE tenant_id=$1 AND entity_id=$2 AND account_code='706000'`,[ids.tenantId,ids.entityId])).rows[0].net;
  assert.equal(expense,'800.0000','the write-off must be recognised as bad debt expense');
});

pgTest('X02-4: the command refuses over-writing off, a closed period, a missing permission, and a duplicate open write-off',async()=>{
  const ids=await seed('guards');
  const billId=await openDocument(ids,'AP_BILL','g1',400);

  await assert.rejects(writeOff(ids,'apwriter',billId,'400.0001','482400','g-over'),
    e=>e.code==='23514',' over the open balance must be refused');
  await assert.rejects(writeOff(ids,'apwriter',billId,'100.0000','482400','g-closed',ids.closedPeriodId),
    e=>e.code==='55000','a closed period must be refused');
  await assert.rejects(writeOff(ids,'viewer',billId,'100.0000','482400','g-perm'),
    e=>e.code==='42501','an actor without the write-off permission must be refused');
  await assert.rejects(writeOff(ids,'apwriter',billId,'100.0000','291001','g-control'),
    e=>e.code==='23514','the control account must not absorb its own write-off');
  await assert.rejects(writeOff(ids,'apwriter',billId,'100.0000','111000','g-member'),
    e=>e.code==='23514','a member-bearing account must not be used as the write-off account');

  // Nothing above may have left a trace.
  assert.equal((await document(ids,billId)).open_balance,'400.0000');
  assert.equal((await reconciliation(ids)).ap_in_balance,true);

  // One open write-off at a time, so two Drafts cannot together exceed the balance.
  await writeOff(ids,'apwriter',billId,'300.0000','482400','g-first');
  await assert.rejects(writeOff(ids,'apwriter',billId,'100.0000','482400','g-second'),
    e=>e.code==='23514','a second open write-off on the same document must be refused');
});

pgTest('X02-5: the same idempotency key replays the same Draft instead of creating a second one',async()=>{
  const ids=await seed('idem');
  const billId=await openDocument(ids,'AP_BILL','i1',250);
  const first=await writeOff(ids,'apwriter',billId,'100.0000','482400','i1');
  const replay=await writeOff(ids,'apwriter',billId,'100.0000','482400','i1');
  assert.equal(replay.idempotent,true);
  assert.equal(replay.business_adjustment_id,first.business_adjustment_id);
  const n=(await admin.query(
    `SELECT count(*)::int n FROM business_adjustment WHERE tenant_id=$1 AND adjustment_kind='AP_BILL_WRITE_OFF'`,[ids.tenantId])).rows[0].n;
  assert.equal(n,1,'a replay must not mint a second adjustment');
});

pgTest('X02-6: retained evidence records the accounts and the balance the decision was made against',async()=>{
  const ids=await seed('evidence');
  const billId=await openDocument(ids,'AP_BILL','e1',600);
  const draft=await writeOff(ids,'apwriter',billId,'250.0000','482400','e1');
  const binding=(await admin.query(
    'SELECT * FROM ap_ar_write_off_binding WHERE business_adjustment_id=$1',[draft.business_adjustment_id])).rows[0];
  assert.ok(binding,'a binding row must be retained');
  assert.equal(binding.write_off_account_code,'482400');
  assert.equal(binding.control_account_code,'291001');
  assert.equal(binding.amount,'250.0000');
  assert.equal(binding.open_balance_before,'600.0000','the balance at decision time must be retained');
  assert.match(binding.evidence_hash,/^sha256:[0-9a-f]{64}$/);

  // Append-only: the decision basis cannot be rewritten afterwards.
  await assert.rejects(admin.query('UPDATE ap_ar_write_off_binding SET amount=1 WHERE business_adjustment_id=$1',[draft.business_adjustment_id]),
    e=>typeof e.code==='string','the binding must be append-only');
});
