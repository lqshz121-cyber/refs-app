// O06: 426 internal-test CUSTOMER master — maker-scope gated, idempotent under one receipt, conflict-safe, audited,
// requires an existing member-bearing 120200 control account, and its down file refuses while journal evidence references the member.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
const config=runtimeConfig();
let admin=null,runtime=null,issuer=null,unavailable=null;
before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-o06-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-o06-runtime',max:4});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-o06-issuer',max:2});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
async function grant(ids,actorId,permission){
  const authority=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL`,[ids.tenantId,actorId,ids.entityId,permission,authority]);
}
const kernelFor=(ids,actorId)=>{const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}
async function seed({withReceivable=true}={}){
  const tenantId=randomUUID(),entityId=randomUUID(),code=`O6${randomUUID().slice(0,4).toUpperCase()}`;
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'o06']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'REFS_STAGE1',$3,'O06 internal test entity','USD')",[entityId,tenantId,code]);
  if(withReceivable)await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'120200','Accounts Receivable',true,'CUSTOMER_OR_AFFILIATE')",[tenantId,entityId]);
  const ids={tenantId,entityId};await grant(ids,'o06-maker','CASH.TRANSFER.CONFIGURE');await grant(ids,'o06-maker','GL.JE.VIEW');return ids;
}
pgTest('creates one INTERNAL TEST ONLY customer idempotently, audits it, and refuses callers without the maker scope',async()=>{
  const ids=await seed();const maker=kernelFor(ids,'o06-maker');
  const first=await maker.ensureInternalTestCustomerMaster({...ids,idempotencyKey:'o06-customer-0001'});
  assert.deepEqual(first,{customer_member_ref:'INTERNAL_TEST_CUSTOMER',receivable_account_code:'120200',currency:'USD',classification:'INTERNAL_TEST_ONLY',idempotent:false});
  const again=await maker.ensureInternalTestCustomerMaster({...ids,idempotencyKey:'o06-customer-0001'});assert.equal(again.idempotent,true);
  const members=(await admin.query("SELECT member_ref,display_name,active FROM member_master WHERE tenant_id=$1 AND entity_id=$2 AND member_type='CUSTOMER'",[ids.tenantId,ids.entityId])).rows;
  assert.deepEqual(members,[{member_ref:'INTERNAL_TEST_CUSTOMER',display_name:'INTERNAL TEST ONLY Customer',active:true}]);
  assert.equal((await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type='INTERNAL_TEST_CUSTOMER_MASTER_READY'",[ids.tenantId])).rows[0].n,1);
  assert.equal((await admin.query("SELECT count(*)::int n FROM outbox_event WHERE tenant_id=$1 AND event_type='INTERNAL_TEST_CUSTOMER_MASTER_READY'",[ids.tenantId])).rows[0].n,1);
  await assert.rejects(kernelFor(ids,'o06-stranger').ensureInternalTestCustomerMaster({...ids,idempotencyKey:'o06-customer-0002'}),e=>e.code==='42501');
  await assert.rejects(maker.ensureInternalTestCustomerMaster({...ids,idempotencyKey:'bad key!'}),e=>e.code==='22023');
  // a pre-existing real customer under the same ref with a different name is a conflict, never overwritten
  const other=await seed();await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name,active) VALUES($1,$2,'INTERNAL_TEST_CUSTOMER','CUSTOMER','A real customer',true)",[other.tenantId,other.entityId]);
  await assert.rejects(kernelFor(other,'o06-maker').ensureInternalTestCustomerMaster({...other,idempotencyKey:'o06-customer-0003'}),e=>e.code==='23514');
  assert.equal((await admin.query("SELECT display_name FROM member_master WHERE tenant_id=$1 AND member_ref='INTERNAL_TEST_CUSTOMER'",[other.tenantId])).rows[0].display_name,'A real customer');
});
pgTest('requires an existing member-bearing 120200 control account and never creates one',async()=>{
  const ids=await seed({withReceivable:false});
  await assert.rejects(kernelFor(ids,'o06-maker').ensureInternalTestCustomerMaster({...ids,idempotencyKey:'o06-customer-0004'}),e=>e.code==='23514');
  assert.equal((await admin.query("SELECT count(*)::int n FROM account_master WHERE tenant_id=$1 AND account_code='120200'",[ids.tenantId])).rows[0].n,0);
  assert.equal((await admin.query("SELECT count(*)::int n FROM member_master WHERE tenant_id=$1 AND member_ref='INTERNAL_TEST_CUSTOMER'",[ids.tenantId])).rows[0].n,0,'the transaction rolled the member back');
});
pgTest('446 / D-O06-2: an UNPOSTED plain 120200 is made member-bearing by the bootstrap; a posted one still fails closed',async()=>{
  // the staging shape observed 2026-09-28: account exists, requires_member=false, no lines
  const ids=await seed({withReceivable:false});
  await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'120200','Accounts Receivable',false,NULL)",[ids.tenantId,ids.entityId]);
  const result=await kernelFor(ids,'o06-maker').ensureInternalTestCustomerMaster({...ids,idempotencyKey:'o06-customer-0006'});
  assert.equal(result.idempotent,false);
  const shape=(await admin.query("SELECT requires_member,required_member_type,active FROM account_master WHERE tenant_id=$1 AND account_code='120200'",[ids.tenantId])).rows[0];
  assert.deepEqual(shape,{requires_member:true,required_member_type:'CUSTOMER_OR_AFFILIATE',active:true});
  assert.equal((await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type='INTERNAL_TEST_RECEIVABLE_CONTROL_RESHAPED'",[ids.tenantId])).rows[0].n,1);
  // a second call is idempotent and does not audit a second reshape
  await kernelFor(ids,'o06-maker').ensureInternalTestCustomerMaster({...ids,idempotencyKey:'o06-customer-0006'});
  assert.equal((await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type='INTERNAL_TEST_RECEIVABLE_CONTROL_RESHAPED'",[ids.tenantId])).rows[0].n,1);
  // same plain shape but with a posted line: evidence, never reshaped
  const posted=await seed({withReceivable:false});
  await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'120200','Accounts Receivable',false,NULL),($1,$2,'400000','Revenue',false,NULL)",[posted.tenantId,posted.entityId]);
  const periodId=randomUUID(),journalId=randomUUID();
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,posted.tenantId,posted.entityId]);
  await admin.query("INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by) VALUES($1,$2,$3,$4,'JE-O06B','MANUAL','DRAFT','2026-07-10','USD','o06-maker')",[journalId,posted.tenantId,posted.entityId,periodId]);
  await admin.query("INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions) VALUES($1,$2,$3,$4,1,'120200',10,0,NULL,'x','{}'),($1,$2,$3,$4,2,'400000',0,10,NULL,'x','{}')",[posted.tenantId,posted.entityId,periodId,journalId]);
  await assert.rejects(kernelFor(posted,'o06-maker').ensureInternalTestCustomerMaster({...posted,idempotencyKey:'o06-customer-0007'}),e=>e.code==='23514');
  assert.equal((await admin.query("SELECT requires_member FROM account_master WHERE tenant_id=$1 AND account_code='120200'",[posted.tenantId])).rows[0].requires_member,false);
});
pgTest('down/426 refuses while journal evidence references the test customer',async()=>{
  const ids=await seed();await kernelFor(ids,'o06-maker').ensureInternalTestCustomerMaster({...ids,idempotencyKey:'o06-customer-0005'});
  const periodId=randomUUID(),journalId=randomUUID();
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,ids.tenantId,ids.entityId]);
  await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'400000','Revenue',false,NULL)",[ids.tenantId,ids.entityId]);
  await admin.query("INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by) VALUES($1,$2,$3,$4,'JE-O06','MANUAL','DRAFT','2026-07-10','USD','o06-maker')",[journalId,ids.tenantId,ids.entityId,periodId]);
  await admin.query("INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,dimensions) VALUES($1,$2,$3,$4,1,'120200',10,0,'INTERNAL_TEST_CUSTOMER','{}'::jsonb),($1,$2,$3,$4,2,'400000',0,10,NULL,'{}'::jsonb)",[ids.tenantId,ids.entityId,periodId,journalId]);
  const down=await readFile(new URL('../db/migrations/down/426_internal_test_customer_master.sql',import.meta.url),'utf8');
  await assert.rejects(admin.query(down),e=>e.code==='55000');
  assert.equal((await admin.query("SELECT count(*)::int n FROM pg_proc WHERE proname='refs_ensure_internal_test_customer_master'")).rows[0].n,1);
});
