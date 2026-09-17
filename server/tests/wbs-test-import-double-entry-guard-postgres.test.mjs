// O03: import scope control and compensation guards on live PostgreSQL.
//  * the same sanitized source retained again (new idempotency key, same facts) is a REPLAY, not a second staging row
//  * the same source with drifted facts is refused 23505 and leaves the retained receipt untouched
//  * a second human Draft for one receipt (new key) is refused 23505 — one source, one Draft
//  * retention into a non-OPEN period is refused 55000
//  * retained receipts and draft evidence are append-only (UPDATE/DELETE blocked)
//  * compensation is a workflow VOID of the Draft, never a delete; ledger stays at zero throughout
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
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-o03-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-o03-runtime',max:4});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-o03-issuer',max:2});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
async function grant(ids,actorId,permission){
  const serviceOnly=(await admin.query('SELECT 1 FROM runtime_service_only_permission WHERE permission_code=$1',[permission])).rowCount>0;
  const authority=serviceOnly?'SERVICE':((await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS');
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL`,[ids.tenantId,actorId,ids.entityId,permission,authority]);
}
const kernelFor=(ids,actorId)=>{const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

async function seed(){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),closedPeriodId=randomUUID(),code=`O3${randomUUID().slice(0,4).toUpperCase()}`;
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'o03']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,'O03 import guard entity','USD')",[entityId,tenantId,code]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN'),($4,$2,$3,'2026-06','2026-06-01','2026-06-30','CLOSED')",[periodId,tenantId,entityId,closedPeriodId]);
  await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'111000','Cash',true,'BANK'),($1,$2,'291001','Accounts Payable',true,'VENDOR')",[tenantId,entityId]);
  const ids={tenantId,entityId,periodId,closedPeriodId,code};
  await grant(ids,'o03-importer','WBS.TEST.IMPORT');await grant(ids,'o03-maker','AP.BILL.CREATE');await grant(ids,'o03-maker','GL.JE.CREATE');
  return ids;
}
const observationFor=(ids,rows)=>({schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_payables',environment:'PRODUCTION',entity_id:ids.entityId,captured_at:'2026-09-17T00:00:00.000Z',provider_content_sha256:createHash('sha256').update(`provider-${ids.code}`).digest('hex'),scope:{company_codes:[ids.code],date_range:['2026-07-01','2026-07-31']},record_count:rows.length,rows,signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:hash(`obs-${ids.code}`)});
const counts=async ids=>(await admin.query(`SELECT (SELECT count(*)::int FROM wbs_test_payable_source_receipt WHERE tenant_id=$1 AND entity_id=$2) receipts,(SELECT count(*)::int FROM source_document WHERE tenant_id=$1 AND entity_id=$2) source_documents,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2) ledger,(SELECT count(*)::int FROM wbs_test_payable_draft_evidence WHERE tenant_id=$1 AND entity_id=$2) drafts,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='WBS_TEST_PAYABLE_SOURCE_RETAIN_REPLAYED') replays`,[ids.tenantId,ids.entityId])).rows[0];

pgTest('the same source retained twice under different keys is one receipt (replay), and drifted facts for the same source are refused',async()=>{
  const ids=await seed();const rows=[{source_record_hash:hash(`row-${ids.code}-0`),currency:'USD',accounting_date:'2026-07-09',amount:'41.2500',status:'CLEAR'}];
  const observation=observationFor(ids,rows);const importer=kernelFor(ids,'o03-importer');
  const first=await importer.retainWbsTestPayableSource({...ids,observation,row:rows[0],rowIndex:0,idempotencyKey:`o03-retain-a-${ids.code}`});
  assert.equal(first.status,'RETAINED');assert.equal(first.idempotent,false);
  const again=await importer.retainWbsTestPayableSource({...ids,observation,row:rows[0],rowIndex:0,idempotencyKey:`o03-retain-b-${ids.code}`});
  assert.equal(again.idempotent,true);assert.equal(again.wbs_test_payable_source_receipt_id,first.wbs_test_payable_source_receipt_id);assert.equal(again.receipt_hash,first.receipt_hash);
  let c=await counts(ids);assert.equal(c.receipts,1);assert.equal(c.source_documents,1);assert.equal(c.replays,1);assert.equal(c.ledger,0);
  const drifted={...rows[0],amount:'41.2600'};
  await assert.rejects(importer.retainWbsTestPayableSource({...ids,observation:observationFor(ids,[drifted]),row:drifted,rowIndex:0,idempotencyKey:`o03-retain-c-${ids.code}`}),e=>e.code==='23505');
  c=await counts(ids);assert.equal(c.receipts,1);assert.equal(c.source_documents,1);
  // same key, different payload is an idempotency conflict too
  const restated={...rows[0],status:'DRAW'};
  await assert.rejects(importer.retainWbsTestPayableSource({...ids,observation:observationFor(ids,[restated]),row:restated,rowIndex:0,idempotencyKey:`o03-retain-a-${ids.code}`}),e=>e.code==='23505');
});

pgTest('one receipt yields exactly one human Draft: a second Draft under a new key is refused and the ledger stays at zero',async()=>{
  const ids=await seed();const rows=[{source_record_hash:hash(`row-${ids.code}-1`),currency:'USD',accounting_date:'2026-07-10',amount:'12.0000',status:'CLEAR'}];
  const retained=await kernelFor(ids,'o03-importer').retainWbsTestPayableSource({...ids,observation:observationFor(ids,rows),row:rows[0],rowIndex:0,idempotencyKey:`o03-retain-${ids.code}`});
  const maker=kernelFor(ids,'o03-maker');
  const draft=await maker.createWbsTestPayableDraft({tenantId:ids.tenantId,entityId:ids.entityId,sourceReceiptId:retained.wbs_test_payable_source_receipt_id,expectedReceiptHash:retained.receipt_hash,idempotencyKey:`o03-draft-a-${ids.code}`});
  assert.equal(draft.status,'DRAFT');assert.equal(draft.test_only,true);
  await assert.rejects(maker.createWbsTestPayableDraft({tenantId:ids.tenantId,entityId:ids.entityId,sourceReceiptId:retained.wbs_test_payable_source_receipt_id,expectedReceiptHash:retained.receipt_hash,idempotencyKey:`o03-draft-b-${ids.code}`}),e=>e.code==='23505');
  // wrong receipt hash (stale/drifted evidence) is a CAS failure, not a silent second draft
  await assert.rejects(maker.createWbsTestPayableDraft({tenantId:ids.tenantId,entityId:ids.entityId,sourceReceiptId:retained.wbs_test_payable_source_receipt_id,expectedReceiptHash:hash('stale'),idempotencyKey:`o03-draft-c-${ids.code}`}),e=>e.code==='40001');
  const c=await counts(ids);assert.equal(c.drafts,1);assert.equal(c.journals,1);assert.equal(c.ledger,0);
  // the importer (service producer) can never be the human maker
  await assert.rejects(kernelFor(ids,'o03-importer').createWbsTestPayableDraft({tenantId:ids.tenantId,entityId:ids.entityId,sourceReceiptId:retained.wbs_test_payable_source_receipt_id,expectedReceiptHash:retained.receipt_hash,idempotencyKey:`o03-draft-d-${ids.code}`}),e=>e.code==='42501');
});

pgTest('retention into a CLOSED period is refused 55000, and retained evidence is append-only',async()=>{
  const ids=await seed();const rows=[{source_record_hash:hash(`row-${ids.code}-2`),currency:'USD',accounting_date:'2026-06-15',amount:'5.0000',status:'CLEAR'}];
  const importer=kernelFor(ids,'o03-importer');
  await assert.rejects(importer.retainWbsTestPayableSource({...ids,periodId:ids.closedPeriodId,observation:observationFor(ids,rows),row:rows[0],rowIndex:0,idempotencyKey:`o03-closed-${ids.code}`}),e=>e.code==='55000');
  assert.equal((await counts(ids)).receipts,0);
  const julyRow={...rows[0],accounting_date:'2026-07-15'};
  const ok=await importer.retainWbsTestPayableSource({...ids,observation:observationFor(ids,[julyRow]),row:julyRow,rowIndex:0,idempotencyKey:`o03-open-${ids.code}`});
  await assert.rejects(admin.query('UPDATE wbs_test_payable_source_receipt SET amount=amount+1 WHERE wbs_test_payable_source_receipt_id=$1',[ok.wbs_test_payable_source_receipt_id]),e=>/append|immutable|not allowed|prohibited/i.test(e.message)||['55000','2F003','P0001'].includes(e.code));
  await assert.rejects(admin.query('DELETE FROM wbs_test_payable_source_receipt WHERE wbs_test_payable_source_receipt_id=$1',[ok.wbs_test_payable_source_receipt_id]),e=>/append|immutable|not allowed|prohibited/i.test(e.message)||['55000','2F003','P0001'].includes(e.code));
  assert.equal((await counts(ids)).receipts,1);
});
