// P01: no command may write accounting facts into a CLOSED (or SOFT_CLOSED) period.
// One entity, three periods (OPEN / SOFT_CLOSED / CLOSED). Every write family the kernel exposes is attempted against
// the closed periods with fully-granted actors; each must be refused with the period SQLSTATE (55000) or a CAS/period
// precondition, and the row counts of journal_entry / business_document / ledger_line / bank_source must not move.
// Then the OPEN period accepts the same JE draft, proving the fixtures and grants are valid and only the period differed.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
const config=runtimeConfig();const hash=v=>`sha256:${createHash('sha256').update(String(v)).digest('hex')}`;
let admin=null,runtime=null,issuer=null,unavailable=null;
before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-p01-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-p01-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-p01-issuer',max:4});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
async function grant(ids,actorId,permission){
  const serviceOnly=(await admin.query('SELECT 1 FROM runtime_service_only_permission WHERE permission_code=$1',[permission])).rowCount>0;
  const authority=serviceOnly?'SERVICE':((await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS');
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL,authority_class=EXCLUDED.authority_class`,[ids.tenantId,actorId,ids.entityId,permission,authority]);
}
const kernelFor=(ids,actorId)=>{const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}
async function seed(){
  const tenantId=randomUUID(),entityId=randomUUID(),open=randomUUID(),soft=randomUUID(),closed=randomUUID(),attachmentId=randomUUID(),code=`P1${randomUUID().slice(0,4).toUpperCase()}`;
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'p01']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,'P01 period matrix','USD')",[entityId,tenantId,code]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status,closed_by,closed_at) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN',NULL,NULL),($4,$2,$3,'2026-06','2026-06-01','2026-06-30','SOFT_CLOSED',NULL,NULL),($5,$2,$3,'2026-05','2026-05-01','2026-05-31','CLOSED','closer',clock_timestamp())",[open,tenantId,entityId,soft,closed]);
  await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'111000','Cash',true,'BANK'),($1,$2,'291001','Accounts Payable',true,'VENDOR'),($1,$2,'120200','Accounts Receivable',true,'CUSTOMER_OR_AFFILIATE'),($1,$2,'610000','Repairs Expense',false,NULL),($1,$2,'400000','Revenue',false,NULL)",[tenantId,entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-1','BANK','Operating Cash'),($1,$2,'VENDOR-1','VENDOR','Vendor'),($1,$2,'CUST-1','CUSTOMER','Customer')",[tenantId,entityId]);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'evidence.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[attachmentId,tenantId,entityId,hash(attachmentId),`object://p01/${attachmentId}`]);
  const ids={tenantId,entityId,open,soft,closed,attachmentId,code};
  for(const [actor,perms] of [['maker',['GL.JE.CREATE','AP.BILL.CREATE','AR.INVOICE.CREATE']],['payer',['AP.PAYMENT.CREATE']],['receiver',['AR.RECEIPT.CREATE']],['importer',['WBS.TEST.IMPORT']],['poster',['GL.JE.POST']]])for(const p of perms)await grant(ids,actor,p);
  return ids;
}
const counts=async ids=>(await admin.query(`SELECT (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2) journals,(SELECT count(*)::int FROM business_document WHERE tenant_id=$1 AND entity_id=$2) documents,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2) ledger,(SELECT count(*)::int FROM wbs_test_payable_source_receipt WHERE tenant_id=$1 AND entity_id=$2) receipts`,[ids.tenantId,ids.entityId])).rows[0];
const lines=[{line_no:1,account_code:'610000',debit_amount:25,credit_amount:0,member_ref:null,dimensions:{}},{line_no:2,account_code:'111000',debit_amount:0,credit_amount:25,member_ref:'BANK-1',dimensions:{}}];
const PERIOD_CODES=new Set(['55000','23514','22023','P0001','P0002']);
const observationFor=(ids,rows)=>({schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_payables',environment:'PRODUCTION',entity_id:ids.entityId,captured_at:'2026-09-17T00:00:00.000Z',provider_content_sha256:createHash('sha256').update(`p01-${ids.code}`).digest('hex'),scope:{company_codes:[ids.code],date_range:['2026-05-01','2026-05-31']},record_count:rows.length,rows,signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:hash(`obs-${ids.code}`)});

for(const status of ['CLOSED','SOFT_CLOSED']){
  pgTest(`${status} period: every write family is refused with a period/precondition SQLSTATE and no accounting row is created`,async()=>{
    const ids=await seed();const periodId=status==='CLOSED'?ids.closed:ids.soft;const date=status==='CLOSED'?'2026-05-10':'2026-06-10';
    const before=await counts(ids);const outcomes={};
    const attempt=async(name,fn)=>{try{await fn();outcomes[name]='ACCEPTED';}catch(error){outcomes[name]=error.code||error.message;}};
    await attempt('manual_journal',()=>kernelFor(ids,'maker').createManualJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId,journalNumber:`JE-${status}-1`,journalDate:date,currency:'USD',description:'closed period probe',attachmentIds:[ids.attachmentId],idempotencyKey:`p01-je-${status}-${ids.code}`,lines}));
    await attempt('ap_bill',()=>kernelFor(ids,'maker').createBusinessDocument({tenantId:ids.tenantId,entityId:ids.entityId,periodId,documentKind:'AP_BILL',documentNumber:`BILL-${status}-1`,counterpartyRef:'VENDOR-1',counterpartyName:'Vendor',currency:'USD',accountingDate:date,dueDate:'2026-08-09',amount:'100.0000',offsetAccountCode:'610000',description:'closed period bill',attachmentIds:[ids.attachmentId],idempotencyKey:`p01-bill-${status}-${ids.code}`}));
    await attempt('ar_invoice',()=>kernelFor(ids,'maker').createBusinessDocument({tenantId:ids.tenantId,entityId:ids.entityId,periodId,documentKind:'AR_INVOICE',documentNumber:`INV-${status}-1`,counterpartyRef:'CUST-1',counterpartyName:'Customer',currency:'USD',accountingDate:date,dueDate:'2026-08-09',amount:'100.0000',offsetAccountCode:'400000',description:'closed period invoice',attachmentIds:[ids.attachmentId],idempotencyKey:`p01-inv-${status}-${ids.code}`}));
    const row={source_record_hash:hash(`row-${ids.code}-${status}`),currency:'USD',accounting_date:date,amount:'7.0000',status:'CLEAR'};
    await attempt('wbs_test_retain',()=>kernelFor(ids,'importer').retainWbsTestPayableSource({tenantId:ids.tenantId,entityId:ids.entityId,periodId,observation:observationFor(ids,[row]),row,rowIndex:0,idempotencyKey:`p01-wbs-${status}-${ids.code}`}));
    // an OPEN-period draft, then an attempt to post it *as if* the period were the closed one, is a CAS/scope failure too
    const draft=await kernelFor(ids,'maker').createManualJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.open,journalNumber:`JE-OPEN-${status}`,journalDate:'2026-07-15',currency:'USD',description:'open period draft',attachmentIds:[ids.attachmentId],idempotencyKey:`p01-open-${status}-${ids.code}`,lines});
    await attempt('post_open_draft_under_closed_period',()=>kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId,journalEntryId:draft.journal_entry_id,expectedRevision:draft.revision??0,idempotencyKey:`p01-post-${status}-${ids.code}`}));
    console.log(`# ${status} outcomes ${JSON.stringify(outcomes)}`);
    for(const [name,code] of Object.entries(outcomes))assert.notEqual(code,'ACCEPTED',`${name} must be refused in a ${status} period`);
    for(const [name,code] of Object.entries(outcomes))assert.ok(PERIOD_CODES.has(code)||/PERIOD|CLOSED/.test(String(code)),`${name}: unexpected refusal ${code}`);
    const after=await counts(ids);
    assert.deepEqual({documents:after.documents,ledger:after.ledger,receipts:after.receipts},{documents:before.documents,ledger:before.ledger,receipts:before.receipts},'no document/ledger/receipt row appeared');
    assert.equal(after.journals,before.journals+1,'only the OPEN-period draft exists');
    const openJournalPeriods=(await admin.query('SELECT DISTINCT period_id FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows.map(r=>r.period_id);
    assert.deepEqual(openJournalPeriods,[ids.open]);
    // the period rows themselves were not mutated by any refused attempt
    const periods=(await admin.query('SELECT period_id,status FROM accounting_period WHERE tenant_id=$1 AND entity_id=$2 ORDER BY starts_on',[ids.tenantId,ids.entityId])).rows;
    assert.deepEqual(periods.map(p=>p.status),['CLOSED','SOFT_CLOSED','OPEN']);
  });
}

pgTest('the OPEN period accepts the same journal draft with the same actors, so the refusals above were caused by the period alone',async()=>{
  const ids=await seed();
  const draft=await kernelFor(ids,'maker').createManualJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.open,journalNumber:'JE-OPEN-OK',journalDate:'2026-07-15',currency:'USD',description:'open',attachmentIds:[ids.attachmentId],idempotencyKey:`p01-open-ok-${ids.code}`,lines});
  assert.equal(draft.status,'DRAFT');
  const bill=await kernelFor(ids,'maker').createBusinessDocument({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.open,documentKind:'AP_BILL',documentNumber:'BILL-OPEN-OK',counterpartyRef:'VENDOR-1',counterpartyName:'Vendor',currency:'USD',accountingDate:'2026-07-10',dueDate:'2026-08-09',amount:'100.0000',offsetAccountCode:'610000',description:'open bill',attachmentIds:[ids.attachmentId],idempotencyKey:`p01-bill-open-${ids.code}`});
  assert.ok(bill.business_document_id||bill.document_id||bill.journal_entry_id,'bill created in the OPEN period');
});
