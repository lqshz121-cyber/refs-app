// S03 — independent AP bill void business closed loop (sprint pack codex007).
//
// The N15-FIX reachability test proves a natively created bill can be voided at
// all. This file is the independent business verification asked for by S03 and
// deliberately covers what that test does not: AP aging, the AP control total
// (aging <-> GL tie), the 291001 control account, the expense offset, period
// control, SoD on the void journal, command idempotency, attachment evidence
// carried onto the void journal, the audit trail, and the guard that a bill can
// only be voided once. Everything is read back from the live database; nothing
// is asserted from the command's own return value alone.
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
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-s03-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-s03-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-s03-issuer',max:2});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});

async function grant(ids,actorId,permission){
  const a=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL`,[ids.tenantId,actorId,ids.entityId,permission,a]);
}
const kernelFor=(ids,actorId)=>{
  const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});
  return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});
};

async function seed(tag){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),nextPeriodId=randomUUID(),attachmentId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),`s03-${tag}`]);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[nextPeriodId,tenantId,entityId]);
  await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'291001','Accounts Payable',true,'VENDOR'),($1,$2,'610000','Repairs',false,NULL)",[tenantId,entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'VENDOR-1','VENDOR','Vendor')",[tenantId,entityId]);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'bill.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[attachmentId,tenantId,entityId,hash(attachmentId),`object://attachments/${attachmentId}`]);
  const ids={tenantId,entityId,periodId,nextPeriodId,attachmentId};
  for(const [a,p] of [['maker','AP.BILL.CREATE'],['submitter','GL.JE.SUBMIT'],['reviewer','GL.JE.REVIEW'],['approver','GL.JE.APPROVE'],['poster','GL.JE.POST'],['voider','AP.BILL.VOID.CREATE'],['viewer','AP.VIEW']])await grant(ids,a,p);
  return ids;
}

async function createAndPostBill(ids,tag){
  const bill=await kernelFor(ids,'maker').createBusinessDocument({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,documentKind:'AP_BILL',documentNumber:`S03-BILL-${tag}`,counterpartyRef:'VENDOR-1',counterpartyName:'Vendor',currency:'USD',accountingDate:'2026-07-10',dueDate:'2026-08-09',amount:'100.0000',offsetAccountCode:'610000',description:'s03 native bill',attachmentIds:[ids.attachmentId],idempotencyKey:`s03-create-${tag}`});
  const jeId=bill.journal_entry_id||bill.draft_journal_entry_id;
  assert.ok(jeId,JSON.stringify(bill));
  await kernelFor(ids,'submitter').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:jeId,action:'SUBMIT',expectedRevision:0,idempotencyKey:`s03-sub-${tag}`});
  await kernelFor(ids,'reviewer').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:jeId,action:'REVIEW',expectedRevision:1,idempotencyKey:`s03-rev-${tag}`});
  await kernelFor(ids,'approver').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:jeId,action:'APPROVE',expectedRevision:2,idempotencyKey:`s03-app-${tag}`});
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:jeId,expectedRevision:3,idempotencyKey:`s03-post-${tag}`});
  const doc=(await admin.query('SELECT status,open_balance::text ob,gross_amount::text g,version::int v,posted_journal_entry_id FROM business_document WHERE business_document_id=$1',[bill.business_document_id])).rows[0];
  return {billId:bill.business_document_id,jeId,doc};
}
async function postVoidJournal(ids,vje,tag){
  await kernelFor(ids,'submitter').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:vje,action:'SUBMIT',expectedRevision:0,idempotencyKey:`s03-vsub-${tag}`});
  await kernelFor(ids,'reviewer').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:vje,action:'REVIEW',expectedRevision:1,idempotencyKey:`s03-vrev-${tag}`});
  await kernelFor(ids,'approver').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:vje,action:'APPROVE',expectedRevision:2,idempotencyKey:`s03-vapp-${tag}`});
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:vje,expectedRevision:3,idempotencyKey:`s03-vpost-${tag}`});
}
const adjOf=async(ids,billId)=>(await admin.query("SELECT business_adjustment_id,status,amount::text amount,draft_journal_entry_id FROM business_adjustment WHERE tenant_id=$1 AND adjustment_kind='AP_BILL_VOID' AND business_document_id=$2",[ids.tenantId,billId])).rows;
const netOn=async(ids,code)=>Number((await admin.query("SELECT COALESCE(sum(debit_amount-credit_amount),0)::text n FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2 AND account_code=$3",[ids.tenantId,ids.entityId,code])).rows[0].n);
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

pgTest('S03: native AP bill void closes the loop across aging, AP control total, 291001 and the expense offset',async()=>{
  const ids=await seed('loop');
  const {billId,jeId,doc}=await createAndPostBill(ids,'loop');
  assert.deepEqual([doc.status,doc.ob,doc.g],['OPEN','100.0000','100.0000']);

  const viewer=kernelFor(ids,'viewer');
  const agingBefore=(await viewer.getApAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}))[0];
  assert.equal(String(agingBefore.total_open_balance),'100.0000','the open bill is aged');
  assert.equal(String(agingBefore.days_1_30),'100.0000','2026-08-09 due date is 22 days past a 2026-08-31 as-of');
  const controlBefore=(await viewer.getApControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}))[0];
  assert.deepEqual([String(controlBefore.open_balance),String(controlBefore.control_balance),controlBefore.in_balance],['100.0000','100.0000',true],'subledger ties to the 291001 control balance before the void');
  assert.equal(await netOn(ids,'291001'),-100,'AP control is credited by the original bill');
  assert.equal(await netOn(ids,'610000'),100);

  const created=await kernelFor(ids,'voider').createApBillVoid({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:billId,expectedVersion:doc.v,periodId:ids.periodId,journalNumber:'S03-BILL-loop-V',journalDate:'2026-07-12',reason:'Duplicate bill entered by mistake',idempotencyKey:'s03-void-loop'});
  assert.equal(created.status,'DRAFT');
  const [adj]=await adjOf(ids,billId);
  assert.equal(adj.amount,'100.0000');
  assert.equal((await admin.query('SELECT status FROM business_document WHERE business_document_id=$1',[billId])).rows[0].status,'OPEN','an unposted void draft must not change the bill status');
  assert.equal(await netOn(ids,'291001'),-100,'an unposted void draft must not move the ledger');

  await postVoidJournal(ids,adj.draft_journal_entry_id,'loop');

  const after=(await admin.query('SELECT status,open_balance::text ob FROM business_document WHERE business_document_id=$1',[billId])).rows[0];
  assert.deepEqual([after.status,after.ob],['VOID','0.0000'],'the void reducer closes the bill and its open balance');
  assert.equal((await adjOf(ids,billId))[0].status,'POSTED');
  assert.equal(await netOn(ids,'291001'),0,'291001 nets to zero after the void');
  assert.equal(await netOn(ids,'610000'),0,'the expense offset is reversed too');
  const agingAfter=await viewer.getApAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'});
  assert.equal(agingAfter.length===0?0:Number(agingAfter[0].total_open_balance),0,'a voided bill leaves AP aging');
  const controlAfter=(await viewer.getApControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}))[0];
  assert.deepEqual([Number(controlAfter.open_balance),Number(controlAfter.control_balance),controlAfter.in_balance],[0,0,true],'aging still ties to the control account after the void');

  const originalJe=(await admin.query('SELECT status,revision::int r FROM journal_entry WHERE journal_entry_id=$1',[jeId])).rows[0];
  assert.deepEqual([originalJe.status,originalJe.r],['POSTED',4]);
  const voidJe=(await admin.query('SELECT status,period_id FROM journal_entry WHERE journal_entry_id=$1',[adj.draft_journal_entry_id])).rows[0];
  assert.equal(voidJe.status,'POSTED');
  assert.equal(voidJe.period_id,ids.periodId,'the void posts into the period the command named');
});

pgTest('S03: the void journal carries the original attachment evidence and mirrors its journal type',async()=>{
  const ids=await seed('evidence');
  const {billId,jeId,doc}=await createAndPostBill(ids,'evidence');
  const created=await kernelFor(ids,'voider').createApBillVoid({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:billId,expectedVersion:doc.v,periodId:ids.periodId,journalNumber:'S03-BILL-evidence-V',journalDate:'2026-07-12',reason:'Duplicate bill entered by mistake',idempotencyKey:'s03-void-evidence'});
  assert.equal(created.status,'DRAFT');
  const [adj]=await adjOf(ids,billId);
  const types=(await admin.query('SELECT journal_entry_id,journal_type FROM journal_entry WHERE journal_entry_id=ANY($1::uuid[])',[[jeId,adj.draft_journal_entry_id]])).rows;
  const originalType=types.find(r=>r.journal_entry_id===jeId).journal_type;
  const voidType=types.find(r=>r.journal_entry_id===adj.draft_journal_entry_id).journal_type;
  assert.equal(voidType,originalType,'423 mirrors the original journal_type for source-document-less native bills');
  const links=(await admin.query("SELECT link_type,attachment_id FROM source_link WHERE tenant_id=$1 AND journal_entry_id=$2 AND link_type='JE_ATTACHMENT'",[ids.tenantId,adj.draft_journal_entry_id])).rows;
  assert.equal(links.length,1,'the void journal inherits exactly one attachment evidence link');
  assert.equal(links[0].attachment_id,ids.attachmentId,'and it is the attachment that evidenced the original bill');
  assert.equal((await admin.query('SELECT source_document_id FROM business_document WHERE business_document_id=$1',[billId])).rows[0].source_document_id,null,'this is the native no-source-document path 423 was written for');
});

pgTest('S03: the void command is idempotent and a bill can only be voided once',async()=>{
  const ids=await seed('idem');
  const {billId,doc}=await createAndPostBill(ids,'idem');
  const voider=kernelFor(ids,'voider');
  const args={tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:billId,expectedVersion:doc.v,periodId:ids.periodId,journalNumber:'S03-BILL-idem-V',journalDate:'2026-07-12',reason:'Duplicate bill entered by mistake',idempotencyKey:'s03-void-idem'};
  await voider.createApBillVoid(args);
  await voider.createApBillVoid(args);
  const rows=await adjOf(ids,billId);
  assert.equal(rows.length,1,'replaying the same idempotency key must not create a second void adjustment');
  assert.equal((await admin.query("SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_number='S03-BILL-idem-V'",[ids.tenantId,ids.entityId])).rows[0].n,1,'and no second void journal is drafted');

  await postVoidJournal(ids,rows[0].draft_journal_entry_id,'idem');
  const v=(await admin.query('SELECT status,version::int v FROM business_document WHERE business_document_id=$1',[billId])).rows[0];
  assert.equal(v.status,'VOID');
  await assert.rejects(()=>voider.createApBillVoid({...args,journalNumber:'S03-BILL-idem-V2',idempotencyKey:'s03-void-idem-2',expectedVersion:v.v}),/./,'a VOID bill is no longer fully open and cannot be voided again');
  assert.equal((await adjOf(ids,billId)).length,1);
});

pgTest('S03: void posting honours SoD and period control',async()=>{
  const ids=await seed('control');
  const {billId,doc}=await createAndPostBill(ids,'control');

  await admin.query("UPDATE accounting_period SET status='CLOSED' WHERE period_id=$1",[ids.periodId]);
  await assert.rejects(()=>kernelFor(ids,'voider').createApBillVoid({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:billId,expectedVersion:doc.v,periodId:ids.periodId,journalNumber:'S03-BILL-control-VC',journalDate:'2026-07-12',reason:'Duplicate bill entered by mistake',idempotencyKey:'s03-void-closed'}),/./,'a closed period must reject the void draft');
  assert.equal((await adjOf(ids,billId)).length,0);
  await admin.query("UPDATE accounting_period SET status='OPEN' WHERE period_id=$1",[ids.periodId]);

  const created=await kernelFor(ids,'voider').createApBillVoid({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:billId,expectedVersion:doc.v,periodId:ids.periodId,journalNumber:'S03-BILL-control-V',journalDate:'2026-07-12',reason:'Duplicate bill entered by mistake',idempotencyKey:'s03-void-control'});
  assert.equal(created.status,'DRAFT');
  const vje=(await adjOf(ids,billId))[0].draft_journal_entry_id;
  await kernelFor(ids,'submitter').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:vje,action:'SUBMIT',expectedRevision:0,idempotencyKey:'s03-csub'});
  await kernelFor(ids,'reviewer').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:vje,action:'REVIEW',expectedRevision:1,idempotencyKey:'s03-crev'});
  await kernelFor(ids,'approver').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:vje,action:'APPROVE',expectedRevision:2,idempotencyKey:'s03-capp'});
  await grant(ids,'approver','GL.JE.POST');
  await assert.rejects(()=>kernelFor(ids,'approver').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:vje,expectedRevision:3,idempotencyKey:'s03-cpost-sod'}),/./,'the approver of the void journal must not be able to post it');
  assert.equal((await admin.query('SELECT status FROM business_document WHERE business_document_id=$1',[billId])).rows[0].status,'OPEN');

  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:vje,expectedRevision:3,idempotencyKey:'s03-cpost'});
  assert.equal((await admin.query('SELECT status FROM business_document WHERE business_document_id=$1',[billId])).rows[0].status,'VOID');

  const events=(await admin.query("SELECT event_type,actor_id FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type LIKE '%AP_BILL_VOID%' ORDER BY occurred_at",[ids.tenantId,ids.entityId])).rows;
  assert.ok(events.length>=1,`expected AP bill void audit events, got ${JSON.stringify(events)}`);
  assert.ok(events.some(e=>e.actor_id==='voider'),'the void draft is attributed to the voider');
});
