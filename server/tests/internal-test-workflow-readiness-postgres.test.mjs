// O05: the two kernel reads behind internal-test workflow readiness against live PostgreSQL.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
import {createInternalTestWorkflowReadinessService} from '../runtime/internal-test-workflow-readiness.mjs';
import {INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES} from '../runtime/internal-test-workflow-grants.mjs';
const config=runtimeConfig();
let admin=null,runtime=null,issuer=null,unavailable=null;
before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-o05-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-o05-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-o05-issuer',max:4});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
async function grant(ids,actorId,permission){
  const serviceOnly=(await admin.query('SELECT 1 FROM runtime_service_only_permission WHERE permission_code=$1',[permission])).rowCount>0;
  const authority=serviceOnly?'SERVICE':((await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS');
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL`,[ids.tenantId,actorId,ids.entityId,permission,authority]);
}
const kernelFor=(ids,actorId)=>{const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}
const ROLES=Object.keys(INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES);

pgTest('permission flags answer per session actor; master-data readiness reflects OPEN period and BANK/VENDOR/CUSTOMER members; the service composes them without widening any grant',async()=>{
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),code=`O5${randomUUID().slice(0,4).toUpperCase()}`;const ids={tenantId,entityId};
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'o05']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,'O05 readiness entity','USD')",[entityId,tenantId,code]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'INTERNAL_TEST_BANK','BANK','Test bank'),($1,$2,'WBS_TEST_VENDOR','VENDOR','Test vendor')",[tenantId,entityId]);
  const actors=Object.fromEntries(ROLES.map(r=>[r,r==='voidMaker'?null:`o05-${r.toLowerCase()}-${code}`]));
  // grant the reader + the JE chain only; leave reversalMaker without AP.BILL.VOID.CREATE and everything else ungranted
  for(const role of ['reader','maker','submitter','reviewer','approver','poster','paymentMaker','reversalMaker','reconciliationStarter','clearer','reopener','receiptMaker'])for(const p of INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES[role])await grant(ids,actors[role],p);
  const maker=kernelFor(ids,actors.maker);
  const flags=await maker.readEntityPermissionFlags({tenantId,entityId,permissions:['GL.JE.CREATE','GL.JE.POST','AP.BILL.CREATE']});
  assert.deepEqual(flags,{'GL.JE.CREATE':true,'GL.JE.POST':false,'AP.BILL.CREATE':true});
  await assert.rejects(maker.readEntityPermissionFlags({tenantId,entityId,permissions:['drop table']}),e=>e.code==='PERMISSION_FLAGS_INVALID');
  const master=await kernelFor(ids,actors.reader).readInternalTestMasterDataReadiness({tenantId,entityId});
  assert.deepEqual(master,{OPEN_PERIOD:true,BANK:true,VENDOR:true,CUSTOMER:false});
  await assert.rejects(kernelFor(ids,'o05-stranger').readInternalTestMasterDataReadiness({tenantId,entityId}),e=>e.code==='42501');
  const service=createInternalTestWorkflowReadinessService({tenantId,actors,kernelForActor:actorId=>kernelFor(ids,actorId)});
  const before=(await admin.query('SELECT count(*)::int n FROM runtime_actor_grant WHERE tenant_id=$1',[tenantId])).rows[0].n;
  const r=await service.read({entityId});
  assert.equal(r.workflows.JOURNAL_ENTRY.ready,true);assert.equal(r.workflows.AP_BILL.ready,true);assert.equal(r.workflows.AP_PAYMENT.ready,true);assert.equal(r.workflows.BANK_RECONCILE.ready,true);
  assert.equal(r.workflows.AP_BILL_VOID.ready,false);assert.deepEqual(r.workflows.AP_BILL_VOID.blocking,[{kind:'GRANT',role:'voidMaker',permission:'AP.BILL.VOID.CREATE'}]);
  assert.deepEqual(r.workflows.AR_INVOICE.blocking,[{kind:'MASTER_DATA',key:'CUSTOMER'}]);assert.deepEqual(r.workflows.AR_RECEIPT.blocking,[{kind:'MASTER_DATA',key:'CUSTOMER'}]);
  assert.equal((await admin.query('SELECT count(*)::int n FROM runtime_actor_grant WHERE tenant_id=$1',[tenantId])).rows[0].n,before,'a readiness read never writes grants');
  assert.equal((await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type LIKE '%GRANT%'",[tenantId])).rows[0].n,0);
});
