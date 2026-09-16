// N15 / T11-G1 closed by migration 423 (Owner decision 2026-09-16).
//
// Before 423, refs_create_ap_bill_void (006) and its posting reducer (010)
// accepted only status APPROVED while the native document path posts a bill
// straight into OPEN (048), so no natively created bill could be voided. This
// test drives the real path end to end: create -> four-role post -> void
// draft -> four-role post of the void -> bill VOID, and then pins that the AP
// payment reversal reducer (023 as replaced by 423) reopens to OPEN like AR.
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
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-void-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-void-runtime',max:4});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-void-issuer',max:2});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
async function grant(ids,actorId,permission){const a=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL`,[ids.tenantId,actorId,ids.entityId,permission,a]);}
const kernelFor=(ids,actorId)=>{const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});};
async function seed(){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),attachmentId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'void']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'291001','Accounts Payable',true,'VENDOR'),($1,$2,'610000','Repairs',false,NULL)",[tenantId,entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'VENDOR-1','VENDOR','Vendor')",[tenantId,entityId]);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'bill.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[attachmentId,tenantId,entityId,hash(attachmentId),`object://attachments/${attachmentId}`]);
  const ids={tenantId,entityId,periodId,attachmentId};
  for(const [a,p] of [['maker','AP.BILL.CREATE'],['submitter','GL.JE.SUBMIT'],['reviewer','GL.JE.REVIEW'],['approver','GL.JE.APPROVE'],['poster','GL.JE.POST'],['voider','AP.BILL.VOID.CREATE']])await grant(ids,a,p);
  return ids;
}
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

pgTest('a natively created AP bill posts into OPEN and can be voided end to end (T11-G1 closed by 423)',async()=>{
  const ids=await seed();
  const bill=await kernelFor(ids,'maker').createBusinessDocument({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,documentKind:'AP_BILL',documentNumber:'BILL-VOID-1',counterpartyRef:'VENDOR-1',counterpartyName:'Vendor',currency:'USD',accountingDate:'2026-07-10',dueDate:'2026-08-09',amount:'100.0000',offsetAccountCode:'610000',description:'native bill',attachmentIds:[ids.attachmentId],idempotencyKey:'void-bill-create-0001'});
  const jeId=bill.journal_entry_id||bill.draft_journal_entry_id;
  assert.ok(jeId,JSON.stringify(bill));
  const move=(actor,action,rev,key)=>kernelFor(ids,actor).transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:jeId,action,expectedRevision:rev,idempotencyKey:key});
  await move('submitter','SUBMIT',0,'void-bill-submit-0001');await move('reviewer','REVIEW',1,'void-bill-review-0001');await move('approver','APPROVE',2,'void-bill-approve-0001');
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:jeId,expectedRevision:3,idempotencyKey:'void-bill-post-0001'});
  const doc=(await admin.query('SELECT status,open_balance::text ob,gross_amount::text g,version::int v,posted_journal_entry_id IS NOT NULL AS posted FROM business_document WHERE business_document_id=$1',[bill.business_document_id])).rows[0];
  assert.deepEqual([doc.status,doc.ob,doc.g,doc.posted],['OPEN','100.0000','100.0000',true],'native posting lands the bill in OPEN with full open balance');
  const voided=await kernelFor(ids,'voider').createApBillVoid({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:bill.business_document_id,expectedVersion:doc.v,periodId:ids.periodId,journalNumber:'BILL-VOID-1-V',journalDate:'2026-07-12',reason:'Duplicate bill entered by mistake',idempotencyKey:'void-bill-void-0001'});
  assert.equal(voided.status,'DRAFT');
  const adj=(await admin.query("SELECT status,amount::text amount,draft_journal_entry_id FROM business_adjustment WHERE tenant_id=$1 AND adjustment_kind='AP_BILL_VOID'",[ids.tenantId])).rows;
  assert.equal(adj.length,1);assert.equal(adj[0].amount,'100.0000');
  const vje=adj[0].draft_journal_entry_id;
  const moveV=(actor,action,rev,key)=>kernelFor(ids,actor).transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:vje,action,expectedRevision:rev,idempotencyKey:key});
  await moveV('submitter','SUBMIT',0,'void-je-submit-0001');await moveV('reviewer','REVIEW',1,'void-je-review-0001');await moveV('approver','APPROVE',2,'void-je-approve-0001');
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:vje,expectedRevision:3,idempotencyKey:'void-je-post-0001'});
  const after=(await admin.query('SELECT status,open_balance::text ob FROM business_document WHERE business_document_id=$1',[bill.business_document_id])).rows[0];
  assert.equal(after.status,'VOID','reducer 010 (as replaced by 423) accepts an OPEN fully-open bill');
  assert.equal((await admin.query("SELECT status FROM business_adjustment WHERE tenant_id=$1 AND adjustment_kind='AP_BILL_VOID'",[ids.tenantId])).rows[0].status,'POSTED');
  // Ledger: original + void JE net to zero on the AP control account.
  const net=(await admin.query("SELECT COALESCE(sum(debit_amount-credit_amount),0)::text n FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2 AND account_code='291001'",[ids.tenantId,ids.entityId])).rows[0].n;
  assert.equal(Number(net),0);
});

pgTest('after 423 both AP (payment reversal) and AR (receipt reversal) reducers reopen a fully reversed document to OPEN',async()=>{
  const ap=(await admin.query("SELECT pg_get_functiondef('refs_apply_ap_payment_reversal_posted'::regproc) d")).rows[0].d;
  const ar=(await admin.query("SELECT pg_get_functiondef('refs_apply_ar_receipt_reversal_posted'::regproc) d")).rows[0].d;
  assert.match(ap,/THEN 'OPEN' ELSE 'PARTIALLY_PAID'/);assert.doesNotMatch(ap,/'APPROVED'/);
  assert.match(ar,/'OPEN'/);
  const voidFn=(await admin.query("SELECT pg_get_functiondef('refs_create_ap_bill_void(uuid,uuid,uuid,uuid,bigint,text,date,text,text,text)'::regprocedure) d")).rows[0].d;
  assert.match(voidFn,/status NOT IN \('APPROVED','OPEN'\)/);
});
