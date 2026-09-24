// R03 — AP Bill / Vendor Credit / Payment / (Write-off) complete state machine
// and the aging <-> GL tie-out, verified end to end against a live database.
//
// S03 already closed the AP bill *void* loop. This file is the rest of R03 and
// deliberately covers what S03 does not:
//   1. the full status walk of one bill: OPEN -> PARTIALLY_PAID -> PAID ->
//      (payment reversal) -> PARTIALLY_PAID, every hop read back from the row;
//   2. the AP aging and BOTH AP control totals (entity-level and period-level
//      lineage) at every hop, tied to the live 291001 ledger balance;
//   3. the state-machine reachability census: which of the eight statuses in
//      business_document_status_check any shipped routine can actually write;
//   4. the guards: a partially paid bill cannot be voided, an over-application
//      is refused, and an exhausted vendor credit cannot be applied again;
//   5. the AP write-off gap: the kernel ships no write-off command at all, so
//      this file pins that fact rather than letting it be assumed implemented.
//
// Everything is read back from the database. Nothing is asserted from a
// command's own return value alone. All fixtures are synthetic UUID tenants.
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
const STATUS_DOMAIN=['DRAFT','PENDING_POST','APPROVED','OPEN','PARTIALLY_PAID','PAID','VOID','REVERSED'];

before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-r03-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-r03-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-r03-issuer',max:2});await issuer.query('SELECT 1');
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
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),nextPeriodId=randomUUID(),attachmentId=randomUUID(),creditAttachmentId=randomUUID();
  // the allocation command records the actor as a uuid, so the applier actor id must be one
  const applierActor=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),`r03-${tag}`]);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[nextPeriodId,tenantId,entityId]);
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES
    ($1,$2,'291001','Accounts Payable',true,'VENDOR'),($1,$2,'610000','Repairs',false,NULL),($1,$2,'111000','Operating Cash',true,'BANK')`,[tenantId,entityId]);
  await admin.query(`INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES
    ($1,$2,'VENDOR-1','VENDOR','Vendor'),($1,$2,'BANK-1','BANK','Operating bank')`,[tenantId,entityId]);
  for(const id of [attachmentId,creditAttachmentId])
    await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'doc.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[id,tenantId,entityId,hash(id),`object://attachments/${id}`]);
  const ids={tenantId,entityId,periodId,nextPeriodId,attachmentId,creditAttachmentId,applierActor};
  for(const [a,p] of [['maker','AP.BILL.CREATE'],['submitter','GL.JE.SUBMIT'],['reviewer','GL.JE.REVIEW'],['approver','GL.JE.APPROVE'],['poster','GL.JE.POST'],
    ['voider','AP.BILL.VOID.CREATE'],['viewer','AP.VIEW'],['payer','AP.PAYMENT.CREATE'],['reverser','AP.PAYMENT.REVERSE'],
    ['crediter','AP.VENDOR_CREDIT.CREATE'],[applierActor,'AP.VENDOR_CREDIT.APPLY']])await grant(ids,a,p);
  return ids;
}

// Minimal staging lineage for an AUTO journal (AP payments and payment
// reversals post as AUTO and the poster requires the source->JE linkage).
// Ported down from the postgres-kernel fixture; approved snapshots are reused
// per entity so repeated calls in one scenario stay consistent.
async function attachAutoSource(ids,journalId){
  const batchId=randomUUID(),rawId=randomUUID(),documentId=randomUUID(),ruleId=randomUUID(),stagingId=randomUUID(),recordId=`AUTO-${journalId}`;
  let settingId=randomUUID(),mappingId=randomUUID();
  const inputKeyHash=hash('mapping-key');
  const configHashes=(await admin.query("SELECT refs_jsonb_hash('{}'::jsonb) AS setting_hash,refs_jsonb_hash(jsonb_build_object('input_keys','{}'::jsonb,'output_rules','{}'::jsonb)) AS mapping_hash")).rows[0];
  await admin.query("INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash) VALUES($1,$2,$3,'WBS_API','bankFeed','E1',$4,$5)",[batchId,ids.tenantId,ids.entityId,'auto-import-'+journalId,hash('auto-import')]);
  await admin.query(`INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    VALUES($1,$2,$3,$4,'WBS','bankFeed','E1',$5,'1','UPSERT',now(),$6,$7,$5)`,[rawId,ids.tenantId,ids.entityId,batchId,recordId,hash('auto-raw'),`object://raw/${rawId}`]);
  await admin.query(`INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,business_date,accounting_date,currency,gross_amount,source_ref,payload_hash)
    VALUES($1,$2,$3,$4,'WBS','bankFeed','E1',$5,'1','BANK_TRANSACTION','2026-07-15','2026-07-15','USD',100,$6,$7)`,[documentId,ids.tenantId,ids.entityId,rawId,recordId,`WBS:${recordId}`,hash('auto-doc')]);
  const existingSetting=(await admin.query(`SELECT setting_snapshot_id FROM setting_snapshot WHERE tenant_id=$1 AND entity_id=$2 AND family='BANK' AND scope_type='ENTITY' AND scope_key=$2::text AND status IN ('APPROVED','RETIRED') ORDER BY version DESC LIMIT 1`,[ids.tenantId,ids.entityId])).rows[0];
  const existingMapping=(await admin.query(`SELECT mapping_snapshot_id FROM mapping_snapshot WHERE tenant_id=$1 AND entity_id=$2 AND family='BANK' AND scope_type='ENTITY' AND scope_key=$2::text AND status IN ('APPROVED','RETIRED') ORDER BY version DESC LIMIT 1`,[ids.tenantId,ids.entityId])).rows[0];
  if(existingSetting)settingId=existingSetting.setting_snapshot_id;else
    await admin.query(`INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,effective_to,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
      VALUES($1,$2,$3::uuid,'BANK','ENTITY',$3::text,1,'2026-01-01T00:00:00Z',NULL,'APPROVED','{}',$4,'setting-maker','setting-approver',now())`,[settingId,ids.tenantId,ids.entityId,configHashes.setting_hash]);
  if(existingMapping)mappingId=existingMapping.mapping_snapshot_id;else
    await admin.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,effective_to,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
      VALUES($1,$2,$3::uuid,'BANK','ENTITY',$3::text,$4,1,0,'2026-01-01T00:00:00Z',NULL,'APPROVED','{}','{}',$5,'mapping-maker','mapping-approver',now())`,[mappingId,ids.tenantId,ids.entityId,inputKeyHash,configHashes.mapping_hash]);
  const inputDigest=hash('rule');
  const evaluationDigest=(await admin.query("SELECT refs_rule_evaluation_hash($1,$2,$3,'R-BANK-01',1,'{}'::jsonb,'{}'::jsonb,$4) AS digest",[documentId,settingId,mappingId,inputDigest])).rows[0].digest;
  await admin.query(`INSERT INTO rule_evaluation(rule_evaluation_id,tenant_id,source_document_id,setting_snapshot_id,mapping_snapshot_id,rule_code,rule_version,matched_facts,result,reason,input_digest,evaluation_digest,evaluated_at)
    VALUES($1,$2,$3,$4,$5,'R-BANK-01',1,'{}','{}','fixture',$6,$7,now())`,[ruleId,ids.tenantId,documentId,settingId,mappingId,inputDigest,evaluationDigest]);
  await admin.query(`INSERT INTO staging_item(staging_item_id,tenant_id,entity_id,source_document_id,setting_snapshot_id,mapping_snapshot_id,rule_evaluation_id,status,reviewed_by,reviewed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,'APPROVED','reviewer',now())`,[stagingId,ids.tenantId,ids.entityId,documentId,settingId,mappingId,ruleId]);
  await admin.query("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,staging_item_id,journal_entry_id,created_by) VALUES($1,$2,'SOURCE_TO_JE',$3,$4,$5,'engine')",[ids.tenantId,ids.entityId,documentId,stagingId,journalId]);
  return {documentId,stagingId};
}

// Drive one draft journal through the full four-eyes workflow into POSTED.
async function postJournalFully(ids,journalEntryId,tag,periodId=ids.periodId){
  const jt=(await admin.query('SELECT journal_type FROM journal_entry WHERE journal_entry_id=$1',[journalEntryId])).rows[0]?.journal_type;
  const linked=(await admin.query("SELECT count(*)::int n FROM source_link WHERE journal_entry_id=$1 AND link_type='SOURCE_TO_JE'",[journalEntryId])).rows[0].n;
  if(jt==='AUTO'&&linked===0)await attachAutoSource(ids,journalEntryId);
  await kernelFor(ids,'submitter').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'SUBMIT',expectedRevision:0,idempotencyKey:`r03-sub-${tag}`});
  await kernelFor(ids,'reviewer').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'REVIEW',expectedRevision:1,idempotencyKey:`r03-rev-${tag}`});
  await kernelFor(ids,'approver').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'APPROVE',expectedRevision:2,idempotencyKey:`r03-app-${tag}`});
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId,journalEntryId,expectedRevision:3,idempotencyKey:`r03-post-${tag}`});
}

async function createAndPostBill(ids,tag,amount='1000.0000'){
  const bill=await kernelFor(ids,'maker').createBusinessDocument({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,documentKind:'AP_BILL',documentNumber:`R03-BILL-${tag}`,counterpartyRef:'VENDOR-1',counterpartyName:'Vendor',currency:'USD',accountingDate:'2026-07-10',dueDate:'2026-08-09',amount,offsetAccountCode:'610000',description:'r03 native bill',attachmentIds:[ids.attachmentId],idempotencyKey:`r03-create-${tag}`});
  const jeId=bill.journal_entry_id||bill.draft_journal_entry_id;
  assert.ok(jeId,JSON.stringify(bill));
  await postJournalFully(ids,jeId,`bill-${tag}`);
  return {billId:bill.business_document_id,jeId};
}

const doc=async(ids,billId)=>(await admin.query('SELECT status,open_balance::text ob,gross_amount::text g,version::int v FROM business_document WHERE business_document_id=$1',[billId])).rows[0];
const netOn=async(ids,code)=>Number((await admin.query('SELECT COALESCE(sum(credit_amount-debit_amount),0)::text n FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2 AND account_code=$3',[ids.tenantId,ids.entityId,code])).rows[0].n);
const agingTotal=async(ids,asOfDate='2026-08-31')=>{
  const rows=await kernelFor(ids,'viewer').getApAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate});
  return rows.length===0?0:Number(rows[0].total_open_balance);
};
const entityControl=async ids=>{
  const rows=await kernelFor(ids,'viewer').getApControlTotal({tenantId:ids.tenantId,entityId:ids.entityId});
  return rows.length===0?{open:0,control:0,in_balance:true}:{open:Number(rows[0].open_balance),control:Number(rows[0].control_balance),in_balance:rows[0].in_balance};
};
const periodControl=async(ids,periodId=ids.periodId)=>{
  const rows=await kernelFor(ids,'viewer').getApControlTotal({tenantId:ids.tenantId,entityId:ids.entityId,periodId});
  return rows.length===0?{open:0,control:0,in_balance:true}:{open:Number(rows[0].open_balance),control:Number(rows[0].control_balance),in_balance:rows[0].in_balance};
};

function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

pgTest('R03-1: the AP bill status walk OPEN -> PARTIALLY_PAID -> PAID -> PARTIALLY_PAID holds aging, both control totals and 291001 in lockstep',async()=>{
  const ids=await seed('walk');
  const {billId}=await createAndPostBill(ids,'walk');

  // --- OPEN -------------------------------------------------------------
  const opened=await doc(ids,billId);
  assert.deepEqual([opened.status,opened.ob],['OPEN','1000.0000']);
  assert.equal(await agingTotal(ids),1000);
  assert.equal(await netOn(ids,'291001'),1000,'the posted bill credits the AP control account');
  assert.deepEqual(await entityControl(ids),{open:1000,control:1000,in_balance:true});
  assert.deepEqual(await periodControl(ids),{open:1000,control:1000,in_balance:true});

  // --- PARTIALLY_PAID ---------------------------------------------------
  const partial=await kernelFor(ids,'payer').createApPayment({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:billId,periodId:ids.periodId,paymentNumber:'R03-PAY-300',paymentDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:300,reason:'Partial payment on account',idempotencyKey:'r03-pay-300'});
  assert.equal((await doc(ids,billId)).status,'OPEN','an unposted payment draft must not move the bill');
  assert.equal(await netOn(ids,'291001'),1000,'an unposted payment draft must not move the ledger');
  await postJournalFully(ids,partial.journal_entry_id,'pay300');

  const afterPartial=await doc(ids,billId);
  assert.deepEqual([afterPartial.status,afterPartial.ob],['PARTIALLY_PAID','700.0000']);
  assert.equal(await agingTotal(ids),700);
  assert.equal(await netOn(ids,'291001'),700);
  assert.deepEqual(await entityControl(ids),{open:700,control:700,in_balance:true});
  assert.deepEqual(await periodControl(ids),{open:700,control:700,in_balance:true});

  // A partially paid bill is not "fully open" and must not be voidable.
  await assert.rejects(
    kernelFor(ids,'voider').createApBillVoid({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:billId,expectedVersion:afterPartial.v,periodId:ids.periodId,journalNumber:'R03-BILL-walk-V',journalDate:'2026-07-17',reason:'Void attempt on a partially paid bill',idempotencyKey:'r03-void-partial'}),
    error=>error.code==='23514','only a fully open bill may be voided');
  assert.equal((await doc(ids,billId)).status,'PARTIALLY_PAID','the refused void leaves the bill untouched');

  // --- PAID -------------------------------------------------------------
  const rest=await kernelFor(ids,'payer').createApPayment({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:billId,periodId:ids.periodId,paymentNumber:'R03-PAY-700',paymentDate:'2026-07-18',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:700,reason:'Settle the remaining balance',idempotencyKey:'r03-pay-700'});
  await postJournalFully(ids,rest.journal_entry_id,'pay700');

  const afterPaid=await doc(ids,billId);
  assert.deepEqual([afterPaid.status,afterPaid.ob],['PAID','0.0000']);
  assert.equal(await agingTotal(ids),0);
  assert.equal(await netOn(ids,'291001'),0);
  assert.deepEqual(await entityControl(ids),{open:0,control:0,in_balance:true});
  assert.deepEqual(await periodControl(ids),{open:0,control:0,in_balance:true});

  // Over-payment of a settled bill must be refused.
  await assert.rejects(
    kernelFor(ids,'payer').createApPayment({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:billId,periodId:ids.periodId,paymentNumber:'R03-PAY-OVER',paymentDate:'2026-07-19',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:1,reason:'Overpay a settled bill',idempotencyKey:'r03-pay-over'}),
    error=>['23514','22023','P0002'].includes(error.code),'a settled bill cannot absorb another payment');

  // --- back to PARTIALLY_PAID via payment reversal -----------------------
  const reversal=await kernelFor(ids,'reverser').createApPaymentReversal({tenantId:ids.tenantId,entityId:ids.entityId,sourceOccurrenceId:rest.payment_occurrence_id,periodId:ids.periodId,journalNumber:'R03-PAY-700-REV',journalDate:'2026-07-20',reason:'Bank returned the payment',idempotencyKey:'r03-rev-700'});
  await postJournalFully(ids,reversal.journal_entry_id,'rev700');

  const afterReversal=await doc(ids,billId);
  assert.deepEqual([afterReversal.status,afterReversal.ob],['PARTIALLY_PAID','700.0000'],'reversing the final payment reopens the bill at the reversed amount');
  assert.equal(await agingTotal(ids),700);
  assert.equal(await netOn(ids,'291001'),700);
  assert.deepEqual(await entityControl(ids),{open:700,control:700,in_balance:true});
  assert.deepEqual(await periodControl(ids),{open:700,control:700,in_balance:true});
});

pgTest('R03-2: a full reversal of the only payment reopens the bill to OPEN, not APPROVED',async()=>{
  const ids=await seed('reopen');
  const {billId}=await createAndPostBill(ids,'reopen','500.0000');
  const payment=await kernelFor(ids,'payer').createApPayment({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:billId,periodId:ids.periodId,paymentNumber:'R03-REOPEN-500',paymentDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:500,reason:'Pay the bill in full',idempotencyKey:'r03-reopen-pay'});
  await postJournalFully(ids,payment.journal_entry_id,'reopen-pay');
  assert.equal((await doc(ids,billId)).status,'PAID');

  const reversal=await kernelFor(ids,'reverser').createApPaymentReversal({tenantId:ids.tenantId,entityId:ids.entityId,sourceOccurrenceId:payment.payment_occurrence_id,periodId:ids.periodId,journalNumber:'R03-REOPEN-500-REV',journalDate:'2026-07-20',reason:'Bank returned the payment',idempotencyKey:'r03-reopen-rev'});
  await postJournalFully(ids,reversal.journal_entry_id,'reopen-rev');

  const after=await doc(ids,billId);
  assert.deepEqual([after.status,after.ob],['OPEN','500.0000'],'423 unified the fully-open status on OPEN for AP as it already was for AR');
  assert.equal(await agingTotal(ids),500);
  assert.deepEqual(await entityControl(ids),{open:500,control:500,in_balance:true});
  assert.deepEqual(await periodControl(ids),{open:500,control:500,in_balance:true});

  // And a bill reopened to OPEN is voidable again — the reopen path must not
  // strand the document outside the void command's accepted status set.
  const created=await kernelFor(ids,'voider').createApBillVoid({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:billId,expectedVersion:after.v,periodId:ids.periodId,journalNumber:'R03-REOPEN-VOID',journalDate:'2026-07-21',reason:'Bill was never owed after the return',idempotencyKey:'r03-reopen-void'});
  assert.equal(created.status,'DRAFT');
});

pgTest('R03-3: a posted but unallocated AP vendor credit is netted by aging and the entity control total, but NOT by the period control lineage',async()=>{
  const ids=await seed('credit');
  const {billId}=await createAndPostBill(ids,'credit','1000.0000');

  const credit=await kernelFor(ids,'crediter').createApVendorCredit({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,creditNumber:'R03-VC-200',creditDate:'2026-07-16',vendorRef:'VENDOR-1',vendorName:'Vendor',amount:200,lines:[{line_no:1,account_code:'610000',amount:200,description:'Returned materials'}],reason:'Vendor credit for returned materials',attachmentIds:[ids.creditAttachmentId],idempotencyKey:'r03-vc-200'});
  assert.equal((await admin.query('SELECT status FROM business_adjustment WHERE business_adjustment_id=$1',[credit.business_adjustment_id])).rows[0].status,'DRAFT');
  assert.equal(await netOn(ids,'291001'),1000,'an unposted vendor credit draft must not move the ledger');
  await postJournalFully(ids,credit.journal_entry_id,'vc200');

  assert.equal((await admin.query('SELECT status FROM business_adjustment WHERE business_adjustment_id=$1',[credit.business_adjustment_id])).rows[0].status,'POSTED');
  assert.equal(await netOn(ids,'291001'),800,'the posted vendor credit debits 291001 immediately');
  assert.equal((await doc(ids,billId)).ob,'1000.0000','an unallocated credit does not touch the bill');

  // Aging nets the unallocated credit as a negative movement.
  assert.equal(await agingTotal(ids),800,'AP aging nets the available vendor credit');
  // The entity-level reconciliation subtracts available credit too.
  assert.deepEqual(await entityControl(ids),{open:800,control:800,in_balance:true});

  // The period-level lineage has no vendor-credit term at all: its document
  // side is gross - allocations - voids + payment reversals, so an unallocated
  // credit shows up on the ledger side only and the period control reports out
  // of balance while the books are in fact correct.
  const period=await periodControl(ids);
  assert.deepEqual([period.open,period.control,period.in_balance],[1000,800,false],
    'R03 FINDING: refs_ap_ar_period_control_lineage has no available-vendor-credit term, so GET /ap/control-totals?periodId=... reports a false break that the entity-level total does not');

  // Applying the credit removes the divergence: both totals agree again.
  await kernelFor(ids,ids.applierActor).applyApVendorCredit({tenantId:ids.tenantId,entityId:ids.entityId,businessAdjustmentId:credit.business_adjustment_id,businessDocumentId:billId,amount:200,reason:'Apply the vendor credit to the open bill',idempotencyKey:'r03-vc-apply-200'});
  const applied=await doc(ids,billId);
  assert.deepEqual([applied.status,applied.ob],['PARTIALLY_PAID','800.0000'],'an applied credit settles part of the bill');
  assert.equal(await agingTotal(ids),800);
  assert.deepEqual(await entityControl(ids),{open:800,control:800,in_balance:true});
  assert.deepEqual(await periodControl(ids),{open:800,control:800,in_balance:true},'once allocated, the period lineage ties again');

  // Over-application beyond the remaining credit must be refused.
  await assert.rejects(
    kernelFor(ids,ids.applierActor).applyApVendorCredit({tenantId:ids.tenantId,entityId:ids.entityId,businessAdjustmentId:credit.business_adjustment_id,businessDocumentId:billId,amount:1,reason:'Over-apply an exhausted credit',idempotencyKey:'r03-vc-apply-over'}),
    error=>error.code==='23514','an exhausted vendor credit cannot be applied again');
  assert.equal((await doc(ids,billId)).ob,'800.0000','the refused application leaves the bill untouched');
});

pgTest('R03-4: business_document status reachability census — PENDING_POST has no writer and exactly three readers exclude it',async()=>{
  const declared=(await admin.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='business_document'::regclass AND conname='business_document_status_check'`)).rows[0].d;
  for(const status of STATUS_DOMAIN)
    assert.match(declared,new RegExp(`'${status}'`),`${status} must stay in the declared status domain`);

  const {rows}=await admin.query(`SELECT p.oid::regprocedure::text sig, pg_get_functiondef(p.oid) src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`);
  const writers=rows.filter(r=>/UPDATE\s+business_document\b/i.test(r.src)||/INSERT\s+INTO\s+business_document\b/i.test(r.src));
  assert.ok(writers.length>0,'the census must find the business_document writers');

  const producible=new Set();
  for(const w of writers)for(const status of STATUS_DOMAIN)if(new RegExp(`'${status}'`).test(w.src))producible.add(status);
  for(const status of ['DRAFT','OPEN','PARTIALLY_PAID','PAID','VOID'])
    assert.ok(producible.has(status),`${status} must be producible by a shipped routine`);

  // PENDING_POST is referenced only by the aging/risk readers as an exclusion,
  // never by a writer. Pin that so a future migration that starts producing it
  // has to come past this test and update the aging contract deliberately.
  assert.deepEqual(writers.filter(w=>/'PENDING_POST'/.test(w.src)).map(w=>w.sig),[],
    'no shipped routine writes business_document.status=PENDING_POST; it exists only as an aging exclusion');

  const excluders=rows.filter(r=>/'DRAFT','PENDING_POST','VOID','REVERSED'/.test(r.src)).map(r=>r.sig).sort();
  assert.deepEqual(excluders,['refs_ap_aging(uuid,uuid,date)','refs_ar_aging(uuid,uuid,date)','refs_read_ai_ap_aging_risk_source(uuid,uuid,date)'],
    'exactly these readers exclude the non-aged statuses; a new aged reader must be added here on purpose');
});

pgTest('R03-5: the AP write-off gap is closed by 434/435 -- one creator, one hash helper, a dedicated kind',async()=>{
  // R03 pinned the absence of an AP write-off. 434 (routine + kind) and 435 (reducer) closed it; the
  // behaviour is covered by ap-ar-write-off-postgres.test.mjs. Pin the shape here so a second
  // write-off path cannot appear unnoticed.
  const fns=(await admin.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname ~* 'write.?off' ORDER BY 1`)).rows.map(r=>r.proname);
  assert.deepEqual(fns,['refs_ap_ar_write_off_hash','refs_create_ap_ar_write_off'],'exactly the 434 write-off routines exist');
  const kinds=(await admin.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='business_adjustment'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%adjustment_kind%'`)).rows.map(r=>r.d).join(' ');
  assert.match(kinds,/AP_BILL_WRITE_OFF/,'business_adjustment carries the AP write-off kind');
  assert.match(kinds,/AP_BILL_VOID/,'the full bill void remains a separate non-cash clearing path');
  assert.match(kinds,/AP_VENDOR_CREDIT/,'the vendor credit remains the partial non-cash relief path');
});
