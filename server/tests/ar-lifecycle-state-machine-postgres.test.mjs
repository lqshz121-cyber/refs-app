// R04 — AR Invoice / Sales Receipt Void / Cancel / Refund objects and state
// machine gaps, verified end to end against a live database.
//
// R03 did this for AP. AR is not a mirror image of AP, and this file exists to
// show exactly where the two diverge:
//   1. the AR invoice status walk OPEN -> PARTIALLY_PAID -> PAID ->
//      (receipt reversal) -> PARTIALLY_PAID, with AR aging, both control
//      totals and the 120200 ledger read back at every hop;
//   2. the AR invoice has NO void and NO cancel object at all — no permission,
//      no adjustment kind, no routine — while AP ships a full bill void. An
//      AR_INVOICE can therefore never reach business_document.status='VOID',
//      which is why the entity-level reconciliation filters VOID out of the AP
//      leg and not out of the AR leg;
//   3. a posted native sales receipt has no void, cancel or refund object, and
//      its own two-state status does not survive a reversal of its journal:
//      the generic GL reversal path accepts the receipt's MANUAL journal, the
//      cash comes back out of the bank, and the sales receipt still reads
//      POSTED with no reversal signal anywhere in its read model;
//   4. an AR refund is terminal — there is no AR_REFUND_REVERSAL kind and no
//      routine that consumes a posted refund, although both AP payments and AR
//      receipts do have reversal objects;
//   5. the period-level control lineage has no available-AR-credit term, so an
//      unallocated posted credit memo makes GET /ar/control-totals?periodId=...
//      report a false break while the entity-level total ties (the AR half of
//      the R03 C23 finding, now measured rather than inferred).
//
// Everything is read back from the database. Nothing is asserted from a
// command's own return value alone. All fixtures are synthetic UUID tenants.
// No real ledger, period, bank or WBS data is touched.
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
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-r04-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-r04-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-r04-issuer',max:2});await issuer.query('SELECT 1');
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
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),nextPeriodId=randomUUID();
  const attachmentId=randomUUID(),memoAttachmentId=randomUUID(),saleAttachmentId=randomUUID(),reversalAttachmentId=randomUUID(),refundAttachmentId=randomUUID();
  // the allocation command records the actor as a uuid, so the applier actor id must be one
  const applierActor=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),`r04-${tag}`]);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[nextPeriodId,tenantId,entityId]);
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES
    ($1,$2,'120200','Accounts Receivable',true,'CUSTOMER'),($1,$2,'410000','Rental Revenue',false,NULL),($1,$2,'111000','Operating Cash',true,'BANK')`,[tenantId,entityId]);
  await admin.query(`INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES
    ($1,$2,'CUST-1','CUSTOMER','Customer'),($1,$2,'BANK-1','BANK','Operating bank')`,[tenantId,entityId]);
  for(const id of [attachmentId,memoAttachmentId,saleAttachmentId,reversalAttachmentId,refundAttachmentId])
    await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'doc.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[id,tenantId,entityId,hash(id),`object://attachments/${id}`]);
  const ids={tenantId,entityId,periodId,nextPeriodId,attachmentId,memoAttachmentId,saleAttachmentId,reversalAttachmentId,refundAttachmentId,applierActor};
  for(const [a,p] of [['maker','AR.INVOICE.CREATE'],['submitter','GL.JE.SUBMIT'],['reviewer','GL.JE.REVIEW'],['approver','GL.JE.APPROVE'],['poster','GL.JE.POST'],
    ['viewer','AR.VIEW'],['receiver','AR.RECEIPT.CREATE'],['reverser','AR.RECEIPT.REVERSE'],
    ['crediter','AR.CREDIT_MEMO.CREATE'],[applierActor,'AR.CREDIT_MEMO.APPLY'],['refunder','AR.REFUND.CREATE'],
    ['seller','AR.SALES_RECEIPT.CREATE'],['jereverser','GL.JE.REVERSE'],
    ['apmaker','AP.BILL.CREATE'],['apvoider','AP.BILL.VOID.CREATE'],['apviewer','AP.VIEW']])await grant(ids,a,p);
  return ids;
}

// Minimal staging lineage for an AUTO journal (AR receipts and receipt
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
  await kernelFor(ids,'submitter').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'SUBMIT',expectedRevision:0,idempotencyKey:`r04-sub-${tag}`});
  await kernelFor(ids,'reviewer').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'REVIEW',expectedRevision:1,idempotencyKey:`r04-rev-${tag}`});
  await kernelFor(ids,'approver').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'APPROVE',expectedRevision:2,idempotencyKey:`r04-app-${tag}`});
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId,journalEntryId,expectedRevision:3,idempotencyKey:`r04-post-${tag}`});
}

async function createAndPostInvoice(ids,tag,amount='1000.0000'){
  const invoice=await kernelFor(ids,'maker').createBusinessDocument({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,documentKind:'AR_INVOICE',documentNumber:`R04-INV-${tag}`,counterpartyRef:'CUST-1',counterpartyName:'Customer',currency:'USD',accountingDate:'2026-07-10',dueDate:'2026-08-09',amount,offsetAccountCode:'410000',description:'r04 native invoice',attachmentIds:[ids.attachmentId],idempotencyKey:`r04-create-${tag}`});
  const jeId=invoice.journal_entry_id||invoice.draft_journal_entry_id;
  assert.ok(jeId,JSON.stringify(invoice));
  await postJournalFully(ids,jeId,`inv-${tag}`);
  return {invoiceId:invoice.business_document_id,jeId};
}

const doc=async(ids,id)=>(await admin.query('SELECT status,open_balance::text ob,gross_amount::text g,version::int v FROM business_document WHERE business_document_id=$1',[id])).rows[0];
// AR is a debit-balance control account: debits less credits on 120200.
const ledgerOn=async(ids,code)=>Number((await admin.query('SELECT COALESCE(sum(debit_amount-credit_amount),0)::text n FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2 AND account_code=$3',[ids.tenantId,ids.entityId,code])).rows[0].n);
const agingTotal=async(ids,asOfDate='2026-08-31')=>{
  const rows=await kernelFor(ids,'viewer').getArAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate});
  return rows.length===0?0:Number(rows[0].total_open_balance);
};
const entityControl=async ids=>{
  const rows=await kernelFor(ids,'viewer').getArControlTotal({tenantId:ids.tenantId,entityId:ids.entityId});
  return rows.length===0?{open:0,control:0,in_balance:true}:{open:Number(rows[0].open_balance),control:Number(rows[0].control_balance),in_balance:rows[0].in_balance};
};
const periodControl=async(ids,periodId=ids.periodId)=>{
  const rows=await kernelFor(ids,'viewer').getArControlTotal({tenantId:ids.tenantId,entityId:ids.entityId,periodId});
  return rows.length===0?{open:0,control:0,in_balance:true}:{open:Number(rows[0].open_balance),control:Number(rows[0].control_balance),in_balance:rows[0].in_balance};
};

function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

pgTest('R04-1: the AR invoice status walk OPEN -> PARTIALLY_PAID -> PAID -> PARTIALLY_PAID holds AR aging, both control totals and 120200 in lockstep',async()=>{
  const ids=await seed('walk');
  const {invoiceId}=await createAndPostInvoice(ids,'walk');

  // --- OPEN -------------------------------------------------------------
  const opened=await doc(ids,invoiceId);
  assert.deepEqual([opened.status,opened.ob],['OPEN','1000.0000']);
  assert.equal(await agingTotal(ids),1000);
  assert.equal(await ledgerOn(ids,'120200'),1000,'the posted invoice debits the AR control account');
  assert.deepEqual(await entityControl(ids),{open:1000,control:1000,in_balance:true});
  assert.deepEqual(await periodControl(ids),{open:1000,control:1000,in_balance:true});

  // --- PARTIALLY_PAID ---------------------------------------------------
  const partial=await kernelFor(ids,'receiver').createArReceipt({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:invoiceId,periodId:ids.periodId,receiptNumber:'R04-RCT-300',receiptDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:300,reason:'Partial cash receipt on account',idempotencyKey:'r04-rct-300'});
  assert.equal((await doc(ids,invoiceId)).status,'OPEN','an unposted receipt draft must not move the invoice');
  assert.equal(await ledgerOn(ids,'120200'),1000,'an unposted receipt draft must not move the ledger');
  await postJournalFully(ids,partial.journal_entry_id,'rct300');

  const afterPartial=await doc(ids,invoiceId);
  assert.deepEqual([afterPartial.status,afterPartial.ob],['PARTIALLY_PAID','700.0000']);
  assert.equal(await agingTotal(ids),700);
  assert.equal(await ledgerOn(ids,'120200'),700);
  assert.deepEqual(await entityControl(ids),{open:700,control:700,in_balance:true});
  assert.deepEqual(await periodControl(ids),{open:700,control:700,in_balance:true});

  // --- PAID -------------------------------------------------------------
  const rest=await kernelFor(ids,'receiver').createArReceipt({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:invoiceId,periodId:ids.periodId,receiptNumber:'R04-RCT-700',receiptDate:'2026-07-18',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:700,reason:'Settle the remaining balance',idempotencyKey:'r04-rct-700'});
  await postJournalFully(ids,rest.journal_entry_id,'rct700');

  const afterPaid=await doc(ids,invoiceId);
  assert.deepEqual([afterPaid.status,afterPaid.ob],['PAID','0.0000']);
  assert.equal(await agingTotal(ids),0);
  assert.equal(await ledgerOn(ids,'120200'),0);
  assert.deepEqual(await entityControl(ids),{open:0,control:0,in_balance:true});
  assert.deepEqual(await periodControl(ids),{open:0,control:0,in_balance:true});

  // A settled invoice must not absorb another receipt.
  await assert.rejects(
    kernelFor(ids,'receiver').createArReceipt({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:invoiceId,periodId:ids.periodId,receiptNumber:'R04-RCT-OVER',receiptDate:'2026-07-19',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:1,reason:'Over-collect a settled invoice',idempotencyKey:'r04-rct-over'}),
    error=>['23514','22023','P0002'].includes(error.code),'a settled invoice cannot absorb another receipt');

  // --- back to PARTIALLY_PAID via receipt reversal -----------------------
  const reversal=await kernelFor(ids,'reverser').createArReceiptReversal({tenantId:ids.tenantId,entityId:ids.entityId,sourceOccurrenceId:rest.payment_occurrence_id,periodId:ids.periodId,journalNumber:'R04-RCT-700-REV',journalDate:'2026-07-20',reason:'Customer cheque was returned unpaid',idempotencyKey:'r04-rct-rev-700'});
  await postJournalFully(ids,reversal.journal_entry_id,'rctrev700');

  const afterReversal=await doc(ids,invoiceId);
  assert.deepEqual([afterReversal.status,afterReversal.ob],['PARTIALLY_PAID','700.0000'],'reversing the final receipt reopens the invoice at the reversed amount');
  assert.equal(await agingTotal(ids),700);
  assert.equal(await ledgerOn(ids,'120200'),700);
  assert.deepEqual(await entityControl(ids),{open:700,control:700,in_balance:true});
  assert.deepEqual(await periodControl(ids),{open:700,control:700,in_balance:true});
});

pgTest('R04-2: an AR invoice has no void and no cancel object anywhere, so AR_INVOICE can never reach status VOID while an AP bill can',async()=>{
  const ids=await seed('void');

  // (a) permission catalog: AP ships a maker and an approver for the bill
  //     void, AR ships nothing at all.
  const apVoidPerms=(await admin.query("SELECT permission_code FROM permission_catalog WHERE permission_code LIKE 'AP.%' AND permission_code ~* '(VOID|CANCEL)' ORDER BY 1")).rows.map(r=>r.permission_code);
  assert.deepEqual(apVoidPerms,['AP.BILL.VOID.APPROVE','AP.BILL.VOID.CREATE'],'AP ships a two-eyes bill void permission pair');
  const arVoidPerms=(await admin.query("SELECT permission_code FROM permission_catalog WHERE permission_code LIKE 'AR.%' AND permission_code ~* '(VOID|CANCEL)' ORDER BY 1")).rows.map(r=>r.permission_code);
  assert.deepEqual(arVoidPerms,[],'R04 GAP: AR has no void or cancel permission at all');

  // (b) adjustment kinds: AP_BILL_VOID exists, no AR counterpart does.
  const kinds=(await admin.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='business_adjustment'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%adjustment_kind%'`)).rows.map(r=>r.d).join(' ');
  assert.match(kinds,/AP_BILL_VOID/,'the AP bill void is a declared adjustment kind');
  assert.ok(!/AR_INVOICE_VOID|AR_INVOICE_CANCEL/i.test(kinds),'R04 GAP: there is no AR invoice void or cancel adjustment kind');

  // (c) routines: no AR void/cancel routine ships, while the AP pair does.
  const arVoidFns=(await admin.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname ~* 'ar.*(void|cancel)' ORDER BY 1`)).rows.map(r=>r.proname);
  assert.deepEqual(arVoidFns,[],'R04 GAP: no AR invoice void or cancel routine exists');
  const apVoidFns=(await admin.query(`SELECT DISTINCT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname ~* 'ap_bill_void' ORDER BY 1`)).rows.map(r=>r.proname);
  assert.deepEqual(apVoidFns,['refs_ap_bill_void_hash','refs_create_ap_bill_void'],'the AP bill void routines are the asymmetry being measured');

  // (d) exactly one routine can write status='VOID', and it gates that on the
  //     AP bill void kind, so an AR_INVOICE is unreachable from it.
  const writers=(await admin.query(`SELECT p.proname,pg_get_functiondef(p.oid) src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND pg_get_functiondef(p.oid) ~ 'UPDATE business_document' AND pg_get_functiondef(p.oid) ~ '''VOID'''`)).rows;
  assert.deepEqual(writers.map(w=>w.proname),['refs_apply_ap_ar_posted_adjustment'],'exactly one routine can set business_document.status=VOID');
  assert.match(writers[0].src,/AP_BILL_VOID/,'and it only does so for an AP_BILL_VOID adjustment');

  // (e) read out of the shipped reconciliation view: since 437 (D-R03-1) the subledger side counts
  //     only posted documents and excludes VOID/REVERSED for both kinds in one WHERE, so the R04 gap
  //     (an AR void would have double-counted) is closed at the view as well.
  const viewdef=(await admin.query("SELECT pg_get_viewdef('refs_ap_ar_control_reconciliation'::regclass,true) d")).rows[0].d;
  assert.match(viewdef,/business_document\.posted_journal_entry_id IS NOT NULL AND \(business_document\.status <> ALL \(ARRAY\['DRAFT'::text, 'PENDING_POST'::text, 'VOID'::text, 'REVERSED'::text\]\)\)/,
    'both open-document legs count posted, non-void, non-reversed documents only');
  assert.match(viewdef,/FILTER \(WHERE business_document\.document_kind = 'AR_INVOICE'::text\)/,'the AR leg is split from the AP leg by kind');

  // (f) behaviourally, in this same database: an AP bill created and posted the
  //     same way CAN be voided, so the AR gap is a real asymmetry rather than a
  //     database-wide absence of the concept.
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES
    ($1,$2,'291001','Accounts Payable',true,'VENDOR'),($1,$2,'610000','Repairs',false,NULL)`,[ids.tenantId,ids.entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'VENDOR-1','VENDOR','Vendor')",[ids.tenantId,ids.entityId]);
  const bill=await kernelFor(ids,'apmaker').createBusinessDocument({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,documentKind:'AP_BILL',documentNumber:'R04-BILL-VOIDABLE',counterpartyRef:'VENDOR-1',counterpartyName:'Vendor',currency:'USD',accountingDate:'2026-07-10',dueDate:'2026-08-09',amount:'250.0000',offsetAccountCode:'610000',description:'r04 comparison bill',attachmentIds:[ids.attachmentId],idempotencyKey:'r04-bill-voidable'});
  await postJournalFully(ids,bill.journal_entry_id||bill.draft_journal_entry_id,'bill-voidable');
  const billRow=await doc(ids,bill.business_document_id);
  assert.equal(billRow.status,'OPEN');
  const voidDraft=await kernelFor(ids,'apvoider').createApBillVoid({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:bill.business_document_id,expectedVersion:billRow.v,periodId:ids.periodId,journalNumber:'R04-BILL-VOIDABLE-V',journalDate:'2026-07-11',reason:'The bill was never owed',idempotencyKey:'r04-bill-void'});
  assert.equal(voidDraft.status,'DRAFT','an open AP bill accepts a void draft');

  // (g) an equally-open AR invoice has nothing to call: the kernel exposes no
  //     AR void or cancel method at all.
  const {invoiceId}=await createAndPostInvoice(ids,'void','250.0000');
  assert.equal((await doc(ids,invoiceId)).status,'OPEN');
  const kernel=kernelFor(ids,'maker');
  for(const name of ['createArInvoiceVoid','createArInvoiceCancel','cancelArInvoice','voidArInvoice','createArInvoiceWriteOff'])
    assert.equal(typeof kernel[name],'undefined',`R04 GAP: the kernel exposes no ${name}`);
});

pgTest('R04-3: a posted sales receipt has no void/cancel/refund object and its status does not survive a reversal of its own journal',async()=>{
  const ids=await seed('sale');

  const sale=await kernelFor(ids,'seller').createNativeSalesReceipt({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,number:'R04-SR-500',customerRef:'CUST-1',bankMemberRef:'BANK-1',cashAccountCode:'111000',categoryAccountCode:'410000',date:'2026-07-12',currency:'USD',amount:500,reason:'Cash sale of surplus materials',attachmentIds:[ids.saleAttachmentId],idempotencyKey:'r04-sale-500'});
  await postJournalFully(ids,sale.journal_entry_id,'sale500');

  const posted=(await admin.query('SELECT status,version::int v FROM sales_receipt WHERE sales_receipt_id=$1',[sale.sales_receipt_id])).rows[0];
  assert.equal(posted.status,'POSTED');
  assert.equal(await ledgerOn(ids,'111000'),500,'the posted sale brings 500 into the bank account');

  // (a) there is no void, cancel or refund object for a sales receipt.
  const srFns=(await admin.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname ~* 'sales_receipt' AND p.proname ~* '(void|cancel|refund|revers)' ORDER BY 1`)).rows.map(r=>r.proname);
  assert.deepEqual(srFns,[],'R04 GAP: no sales receipt void, cancel, refund or reversal routine exists');
  const srStatus=(await admin.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='sales_receipt'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ 'status = ANY'`)).rows[0].d;
  assert.match(srStatus,/ARRAY\['DRAFT'::text, 'POSTED'::text\]/,'R04 GAP: sales_receipt.status is a two-state DRAFT/POSTED column with no terminal reversed state');
  const kernel=kernelFor(ids,'seller');
  for(const name of ['createSalesReceiptVoid','cancelSalesReceipt','refundSalesReceipt','reverseSalesReceipt'])
    assert.equal(typeof kernel[name],'undefined',`R04 GAP: the kernel exposes no ${name}`);
  // the refund object that does exist is bound to a credit memo, never to a sale
  const refundSrc=(await admin.query(`SELECT pg_get_functiondef(p.oid) src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.proname='refs_create_native_refund'`)).rows[0].src;
  assert.match(refundSrc,/AR_CREDIT_MEMO/,'the native refund consumes a posted credit memo');
  assert.ok(!/sales_receipt/.test(refundSrc),'R04 GAP: the refund object cannot be pointed at a sales receipt');

  // (b) the sale's journal is MANUAL and carries no business source link, so
  //     the generic GL reversal path accepts it.
  const jt=(await admin.query('SELECT journal_type FROM journal_entry WHERE journal_entry_id=$1',[sale.journal_entry_id])).rows[0].journal_type;
  assert.equal(jt,'MANUAL','the sales receipt posts a MANUAL journal, which the generic reversal path accepts');
  const rev=await kernelFor(ids,'jereverser').createJournalAdjustment({action:'REVERSAL',tenantId:ids.tenantId,entityId:ids.entityId,originalJournalEntryId:sale.journal_entry_id,periodId:ids.periodId,journalNumber:'R04-SR-500-REV',journalDate:'2026-07-13',description:'Reverse the mistaken cash sale',reason:'The cash sale was recorded against the wrong company',attachmentIds:[ids.reversalAttachmentId],idempotencyKey:'r04-sale-rev'});
  await postJournalFully(ids,rev.journal_entry_id,'salerev');

  // (c) the ledger says the sale is undone; the sales receipt does not.
  assert.equal(await ledgerOn(ids,'111000'),0,'the reversal takes the cash back out: economically the sale is undone');
  assert.equal(await ledgerOn(ids,'410000'),0,'and the revenue is reversed too');
  const afterReversal=(await admin.query('SELECT status,version::int v FROM sales_receipt WHERE sales_receipt_id=$1',[sale.sales_receipt_id])).rows[0];
  assert.deepEqual([afterReversal.status,afterReversal.v],[posted.status,posted.v],
    'R04 FINDING: reversing the journal leaves sales_receipt.status=POSTED and its revision untouched');

  const envelope=await kernelFor(ids,'viewer').readSalesReceipt({tenantId:ids.tenantId,entityId:ids.entityId,receiptId:sale.sales_receipt_id});
  assert.equal(envelope.schema_version,'SALES_RECEIPT_DETAIL_V1');
  const read=envelope.record;
  assert.equal(read.status,'POSTED','the receipt read model still reports a live posted sale');
  assert.equal(read.journal_status,'POSTED','and the original journal is still POSTED — the reversal is a separate journal the read model never joins');
  assert.equal(read.amount,'500.0000','at the full original amount');
  assert.ok(!Object.keys(read).some(k=>/revers/i.test(k)),
    'R04 FINDING: sales_receipt_detail_read exposes no reversal column, so no caller can tell a live sale from a reversed one');

  const page=await kernelFor(ids,'viewer').listSalesReceipts({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  assert.match(JSON.stringify(page),/"status":\s*"POSTED"/,'the sales receipt register lists the reversed sale as POSTED');
});

pgTest('R04-4: an AR refund is terminal — no reversal or void object consumes a posted refund, although AP payments and AR receipts have one',async()=>{
  const ids=await seed('refund');

  const memo=await kernelFor(ids,'crediter').createArCreditMemo({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,memoNumber:'R04-CM-400',memoDate:'2026-07-14',customerRef:'CUST-1',customerName:'Customer',amount:400,lines:[{line_no:1,account_code:'410000',amount:400,description:'Rent concession'}],reason:'Customer credit for an agreed rent concession',attachmentIds:[ids.memoAttachmentId],idempotencyKey:'r04-cm-400'});
  await postJournalFully(ids,memo.journal_entry_id,'cm400');
  assert.equal((await admin.query('SELECT status FROM business_adjustment WHERE business_adjustment_id=$1',[memo.business_adjustment_id])).rows[0].status,'POSTED');
  assert.equal(await ledgerOn(ids,'120200'),-400,'the posted credit memo leaves a customer credit standing on 120200');

  // The shipped route is the evidence-bound native refund; the legacy
  // /ar/refunds route is retired at the HTTP layer (see (d) below).
  const refund=await kernelFor(ids,'refunder').createNativeRefund({tenantId:ids.tenantId,entityId:ids.entityId,sourceAdjustmentId:memo.business_adjustment_id,periodId:ids.periodId,number:'R04-RF-400',date:'2026-07-15',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:400,reason:'Refund the unused customer credit',attachmentIds:[ids.refundAttachmentId],idempotencyKey:'r04-rf-400'});
  await postJournalFully(ids,refund.journal_entry_id,'rf400');
  const refundRow=(await admin.query('SELECT status,adjustment_kind FROM business_adjustment WHERE business_adjustment_id=$1',[refund.business_adjustment_id])).rows[0];
  assert.deepEqual([refundRow.status,refundRow.adjustment_kind],['POSTED','AR_REFUND']);
  assert.equal(await ledgerOn(ids,'120200'),0,'the posted refund clears the customer credit off the control account');
  assert.equal(await ledgerOn(ids,'111000'),-400,'and pays it out of the bank');
  assert.deepEqual(await entityControl(ids),{open:0,control:0,in_balance:true},'the books tie after the refund');

  // (a) a second refund against the exhausted credit is refused — the forward
  //     guard works, which is exactly why the missing backward path matters.
  await assert.rejects(
    kernelFor(ids,'refunder').createNativeRefund({tenantId:ids.tenantId,entityId:ids.entityId,sourceAdjustmentId:memo.business_adjustment_id,periodId:ids.periodId,number:'R04-RF-OVER',date:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:1,reason:'Refund more than the available credit',attachmentIds:[ids.refundAttachmentId],idempotencyKey:'r04-rf-over'}),
    error=>error.code==='23514','a refund cannot exceed the posted credit');

  // (b) the gap: there is no AR_REFUND_REVERSAL kind, while both the AP payment
  //     and the AR receipt do have a reversal kind.
  const kinds=(await admin.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='business_adjustment'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%adjustment_kind%'`)).rows.map(r=>r.d).join(' ');
  assert.match(kinds,/AP_PAYMENT_REVERSAL/,'the AP payment has a reversal kind');
  assert.match(kinds,/AR_RECEIPT_REVERSAL/,'the AR receipt has a reversal kind');
  assert.ok(!/AR_REFUND_REVERSAL|AR_REFUND_VOID/i.test(kinds),'R04 GAP: the AR refund has no reversal or void kind');

  // (c) and no routine consumes a posted AR_REFUND as its source, so nothing
  //     can put the credit back. Only the refund producers mention the kind.
  const consumers=(await admin.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND pg_get_functiondef(p.oid) ~ '''AR_REFUND''' ORDER BY 1`)).rows.map(r=>r.proname);
  assert.ok(consumers.length>0,'the census must find the routines that know the AR_REFUND kind');
  for(const name of consumers)
    assert.ok(!/revers|void|cancel/i.test(name),`R04 GAP: ${name} is not an undo path; no AR refund reversal routine exists`);
  const kernel=kernelFor(ids,'refunder');
  for(const name of ['createArRefundReversal','reverseArRefund','cancelArRefund','voidArRefund'])
    assert.equal(typeof kernel[name],'undefined',`R04 GAP: the kernel exposes no ${name}`);

  // (d) a second finding from this walk: the legacy refs_create_ar_refund is
  //     retired at the HTTP layer (410 ROUTE_RETIRED on /ar/refunds) but still
  //     exists in the database and is still EXECUTE-granted to refs_app — and
  //     it writes a NULL member on the cash line, so on any entity whose bank
  //     account is BANK-member-controlled (which the native refund, sales
  //     receipt and expense commands all REQUIRE) it can only ever fail 23514.
  //     It is unreachable dead code holding a live grant.
  const legacy=(await admin.query(`SELECT p.oid::regprocedure::text sig,pg_get_functiondef(p.oid) src,
      has_function_privilege('refs_app',p.oid,'EXECUTE') granted
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND p.proname='refs_create_ar_refund'`)).rows;
  assert.equal(legacy.length,1,'the legacy AR refund routine is still installed');
  assert.equal(legacy[0].granted,true,'R04 FINDING: the retired legacy AR refund routine still holds EXECUTE for refs_app');
  assert.ok(!/p_bank_member/.test(legacy[0].src),'R04 FINDING: the legacy routine takes no bank member at all, so its cash line can only carry a NULL member');
  await assert.rejects(
    kernelFor(ids,'refunder').createArRefund({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,sourceAdjustmentId:memo.business_adjustment_id,refundNumber:'R04-RF-LEGACY',refundDate:'2026-07-17',cashAccountCode:'111000',amount:1,reason:'Legacy refund path against a BANK-controlled account',idempotencyKey:'r04-rf-legacy'}),
    error=>error.code==='23514','R04 FINDING: the legacy AR refund routine cannot post against a BANK-controlled cash account');
});

pgTest('R04-5: an unallocated posted AR credit memo is netted by AR aging and the entity control total but NOT by the period control lineage',async()=>{
  const ids=await seed('credit');
  const {invoiceId}=await createAndPostInvoice(ids,'credit','1000.0000');

  const memo=await kernelFor(ids,'crediter').createArCreditMemo({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,memoNumber:'R04-CM-200',memoDate:'2026-07-16',customerRef:'CUST-1',customerName:'Customer',amount:200,lines:[{line_no:1,account_code:'410000',amount:200,description:'Agreed rent concession'}],reason:'Customer credit for an agreed rent concession',attachmentIds:[ids.memoAttachmentId],idempotencyKey:'r04-cm-200'});
  assert.equal((await admin.query('SELECT status FROM business_adjustment WHERE business_adjustment_id=$1',[memo.business_adjustment_id])).rows[0].status,'DRAFT');
  assert.equal(await ledgerOn(ids,'120200'),1000,'an unposted credit memo draft must not move the ledger');
  await postJournalFully(ids,memo.journal_entry_id,'cm200');

  assert.equal((await admin.query('SELECT status FROM business_adjustment WHERE business_adjustment_id=$1',[memo.business_adjustment_id])).rows[0].status,'POSTED');
  assert.equal(await ledgerOn(ids,'120200'),800,'the posted credit memo credits 120200 immediately');
  assert.equal((await doc(ids,invoiceId)).ob,'1000.0000','an unallocated credit memo does not touch the invoice');
  assert.equal(await agingTotal(ids),800,'AR aging nets the available customer credit');
  assert.deepEqual(await entityControl(ids),{open:800,control:800,in_balance:true});

  // The period-level lineage has no available-credit term at all: its document
  // side is gross - allocations - AP voids + receipt reversals, so an
  // unallocated credit shows up on the ledger side only and the period control
  // reports out of balance while the books are in fact correct.
  const period=await periodControl(ids);
  assert.deepEqual([period.open,period.control,period.in_balance],[1000,800,false],
    'R04 FINDING (AR half of the R03 C23 defect): refs_ap_ar_period_control_lineage has no available-credit term, so GET /ar/control-totals?periodId=... reports a false break the entity-level total does not');

  // Allocating the credit removes the divergence: both totals agree again.
  await kernelFor(ids,ids.applierActor).applyArCreditMemo({tenantId:ids.tenantId,entityId:ids.entityId,businessAdjustmentId:memo.business_adjustment_id,businessDocumentId:invoiceId,amount:200,reason:'Apply the customer credit to the open invoice',idempotencyKey:'r04-cm-apply-200'});
  const applied=await doc(ids,invoiceId);
  assert.deepEqual([applied.status,applied.ob],['PARTIALLY_PAID','800.0000'],'an applied credit settles part of the invoice');
  assert.equal(await agingTotal(ids),800);
  assert.deepEqual(await entityControl(ids),{open:800,control:800,in_balance:true});
  assert.deepEqual(await periodControl(ids),{open:800,control:800,in_balance:true},'once allocated, the period lineage ties again');

  // Over-application beyond the remaining credit must be refused.
  await assert.rejects(
    kernelFor(ids,ids.applierActor).applyArCreditMemo({tenantId:ids.tenantId,entityId:ids.entityId,businessAdjustmentId:memo.business_adjustment_id,businessDocumentId:invoiceId,amount:1,reason:'Over-apply an exhausted customer credit',idempotencyKey:'r04-cm-apply-over'}),
    error=>error.code==='23514','an exhausted credit memo cannot be applied again');
  assert.equal((await doc(ids,invoiceId)).ob,'800.0000','the refused application leaves the invoice untouched');
});
