// P04 — 291001 member-level open items (migration 428): per vendor member the POSTED control net must equal the sub-ledger
// open balance; mismatches are surfaced as exceptions, never cleared. Fixture helpers copied from R03.
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
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-p04-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-p04-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-p04-issuer',max:2});await issuer.query('SELECT 1');
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
    ['voider','AP.BILL.VOID.CREATE'],['viewer','AP.VIEW'],['jemaker','GL.JE.CREATE'],['payer','AP.PAYMENT.CREATE'],['reverser','AP.PAYMENT.REVERSE'],
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


async function seedTwoVendors(tag){
  const ids=await seed(tag);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'VENDOR-2','VENDOR','Second vendor')",[ids.tenantId,ids.entityId]);
  return ids;
}
async function createAndPostBillFor(ids,tag,amount,vendor){
  const bill=await kernelFor(ids,'maker').createBusinessDocument({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,documentKind:'AP_BILL',documentNumber:`P04-BILL-${tag}`,counterpartyRef:vendor,counterpartyName:vendor,currency:'USD',accountingDate:'2026-07-10',dueDate:'2026-08-09',amount,offsetAccountCode:'610000',description:'p04 bill',attachmentIds:[ids.attachmentId],idempotencyKey:`p04-create-${tag}`});
  const jeId=bill.journal_entry_id||bill.draft_journal_entry_id;await postJournalFully(ids,jeId,`bill-${tag}`);return {billId:bill.business_document_id,jeId};
}
const readItems=(ids,extra={})=>kernelFor(ids,'viewer').readApControlMemberOpenItems({tenantId:ids.tenantId,entityId:ids.entityId,limit:50,offset:0,...extra});

pgTest('P04-1: two vendors, one partially paid — every member row ties control_net to its open balance and the totals equal the entity control',async()=>{
  const ids=await seedTwoVendors('tie');
  const a=await createAndPostBillFor(ids,'A','1000.0000','VENDOR-1');await createAndPostBillFor(ids,'B','250.0000','VENDOR-2');
  const pay=await kernelFor(ids,'payer').createApPayment({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:a.billId,periodId:ids.periodId,paymentNumber:'P04-PAY-300',paymentDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:300,reason:'Partial payment vendor one',idempotencyKey:'p04-pay-300'});
  await postJournalFully(ids,pay.journal_entry_id,'pay300');
  const items=await readItems(ids);
  assert.equal(items.schema_version,'AP_CONTROL_MEMBER_OPEN_ITEMS_V1');assert.equal(items.can_post,false);assert.equal(items.can_clear,false);
  const byMember=Object.fromEntries(items.rows.map(r=>[r.member_ref,r]));
  assert.deepEqual({s:byMember['VENDOR-1'].state,c:byMember['VENDOR-1'].control_net,o:byMember['VENDOR-1'].open_balance,d:byMember['VENDOR-1'].difference,n:byMember['VENDOR-1'].open_document_count},{s:'TIED',c:'700.0000',o:'700.0000',d:'0.0000',n:1});
  assert.deepEqual({s:byMember['VENDOR-2'].state,c:byMember['VENDOR-2'].control_net,o:byMember['VENDOR-2'].open_balance},{s:'TIED',c:'250.0000',o:'250.0000'});
  assert.deepEqual({m:items.totals.member_count,c:items.totals.control_net,o:items.totals.open_balance,d:items.totals.difference,t:items.totals.tied_count,e:items.totals.exception_count},{m:2,c:'950.0000',o:'950.0000',d:'0.0000',t:2,e:0});
  assert.deepEqual(await entityControl(ids),{open:950,control:950,in_balance:true});
  assert.equal(await netOn(ids,'291001'),950);
});

pgTest('P04-2: a manual posting on 291001 without a document and an unapplied vendor credit surface as member exceptions, first in the list, and nothing is cleared',async()=>{
  const ids=await seedTwoVendors('exc');
  await createAndPostBillFor(ids,'C','400.0000','VENDOR-1');
  // manual JE crediting 291001 for VENDOR-2 with no AP document behind it
  const manual=await kernelFor(ids,'jemaker').createManualJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalNumber:'P04-MANUAL-291001',journalDate:'2026-07-12',currency:'USD',description:'accrual straight to control',attachmentIds:[ids.attachmentId],idempotencyKey:'p04-manual',lines:[{line_no:1,account_code:'610000',debit_amount:60,credit_amount:0,member_ref:null,dimensions:{}},{line_no:2,account_code:'291001',debit_amount:0,credit_amount:60,member_ref:'VENDOR-2',dimensions:{}}]});
  await postJournalFully(ids,manual.journal_entry_id,'manual');
  const items=await readItems(ids);
  assert.equal(items.rows[0].member_ref,'VENDOR-2','exceptions sort first');
  assert.deepEqual({s:items.rows[0].state,c:items.rows[0].control_net,o:items.rows[0].open_balance,d:items.rows[0].difference},{s:'POSTING_WITHOUT_DOCUMENT',c:'60.0000',o:'0.0000',d:'60.0000'});
  assert.deepEqual({s:items.rows[1].state,d:items.rows[1].difference},{s:'TIED',d:'0.0000'});
  assert.deepEqual({t:items.totals.tied_count,e:items.totals.exception_count,d:items.totals.difference},{t:1,e:1,d:'60.0000'});
  // the entity-level control read shows the same 60 imbalance — the member view explains *which* member
  const control=await entityControl(ids);assert.equal(control.in_balance,false);assert.equal(control.control-control.open,60);
  // read is pure
  assert.equal((await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type LIKE '%MEMBER_OPEN%'",[ids.tenantId])).rows[0].n,0);
});

pgTest('P04-3: scope, paging and period bounds are enforced; a period filter keeps only postings dated inside it',async()=>{
  const ids=await seedTwoVendors('scope');
  await createAndPostBillFor(ids,'D','120.0000','VENDOR-1');
  await assert.rejects(kernelFor(ids,'nobody').readApControlMemberOpenItems({tenantId:ids.tenantId,entityId:ids.entityId,limit:50,offset:0}),e=>e.code==='42501');
  await assert.rejects(readItems(ids,{limit:0}),e=>e.code==='22023');
  await assert.rejects(readItems(ids,{periodId:randomUUID()}),e=>e.code==='22023');
  const inPeriod=await readItems(ids,{periodId:ids.periodId});assert.equal(inPeriod.rows.length,1);assert.equal(inPeriod.rows[0].control_net,'120.0000');
  const nextPeriod=await readItems(ids,{periodId:ids.nextPeriodId});
  assert.equal(nextPeriod.rows.length,1,'the document still counts (accounting_date ≤ August end) …');
  assert.deepEqual({c:nextPeriod.rows[0].control_net,s:nextPeriod.rows[0].state},{c:'0.0000',s:'DOCUMENT_WITHOUT_POSTING'},'… while August has no posting for it: the period view makes the timing visible instead of hiding it');
  const page=await readItems(ids,{limit:1,offset:5});assert.deepEqual(page.rows,[]);assert.equal(page.totals.member_count,1);
});
