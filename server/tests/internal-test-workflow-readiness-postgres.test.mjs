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
async function grant(ids,actorId,permission,bundle=[permission]){
  const serviceOnly=(await admin.query('SELECT 1 FROM runtime_service_only_permission WHERE permission_code=$1',[permission])).rowCount>0;
  let authority=serviceOnly?'SERVICE':((await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS');
  // As grant sync does for the real bundle: a permission that is additive to the bundle's workflow
  // class (ATTACHMENT.CREATE, the 412/441 VIEW permissions) is granted under that class.
  const additive=(await admin.query(`SELECT a.authority_class FROM runtime_human_additive_permission_authority a
    JOIN runtime_human_permission_authority native ON native.authority_class=a.authority_class AND native.permission_code=ANY($2::text[])
    WHERE a.permission_code=$1 LIMIT 1`,[permission,bundle])).rows[0]?.authority_class;
  if(additive)authority=additive;
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
  for(const role of ['reader','maker','submitter','reviewer','approver','poster','paymentMaker','reversalMaker','reconciliationStarter','clearer','reopener','receiptMaker'])for(const p of INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES[role])await grant(ids,actors[role],p,INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES[role]);
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

pgTest('every internal-test workflow bundle reconciles through the real grant sync, and the forecast and recurring actors can run their own commands',async()=>{
  // 441/412: a bundle that asserts its workflow VIEW next to the action only works if grant sync
  // accepts VIEW under the bundle's class. Exercise the production reconcile path, not a fixture.
  const {PostgresGrantSync}=await import('../runtime/grant-sync.mjs');
  const {reconcileInternalTestWorkflowActorGrants}=await import('../runtime/internal-test-workflow-grants.mjs');
  const grantPool=await createPool({databaseUrl:config.grantSyncDatabaseUrl,applicationName:'refs-internal-test-grant-sync',max:2});
  try{
    const tenantId=randomUUID(),entityId=randomUUID(),code=`O6${randomUUID().slice(0,4).toUpperCase()}`;
    await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'o06']);
    await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,'O06 grant entity','USD')",[entityId,tenantId,code]);
    const actors=Object.fromEntries(ROLES.map(r=>[r,`o06-${r.toLowerCase()}-${code}`]));
    const grantSync=new PostgresGrantSync(grantPool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
    await reconcileInternalTestWorkflowActorGrants({grantSync,scope:{tenantId,entityId,actors}});
    await reconcileInternalTestWorkflowActorGrants({grantSync,scope:{tenantId,entityId,actors}}); // restart replay
    for(const [role,permissions] of Object.entries(INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES)){
      const kernel=kernelFor({tenantId,entityId},actors[role]);
      const flags=await kernel.readEntityPermissionFlags({tenantId,entityId,permissions:[...permissions]});
      assert.deepEqual(Object.entries(flags).filter(([,allowed])=>!allowed).map(([p])=>p),[],`${role} must hold every permission of its bundle`);
    }
  }finally{await grantPool.end();}
});

pgTest('441: a workflow VIEW plus one action per class is accepted by the real grant sync, and a webhook subscription runs DRAFT to SUSPENDED end to end',async()=>{
  // Before 441 each of these workflows asserted <X>.VIEW next to the action, but grant sync grants
  // exactly one authority class per reconcile, so no real grant could hold both: create and every
  // transition failed closed for every user. Prove the fix on the production reconcile path.
  const {PostgresGrantSync}=await import('../runtime/grant-sync.mjs');
  const grantPool=await createPool({databaseUrl:config.grantSyncDatabaseUrl,applicationName:'refs-441-grant-sync',max:2});
  try{
    const tenantId=randomUUID(),entityId=randomUUID(),code=`W4${randomUUID().slice(0,4).toUpperCase()}`;
    await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'w441']);
    await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,'441 grant entity','USD')",[entityId,tenantId,code]);
    const grantSync=new PostgresGrantSync(grantPool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
    const validUntil=new Date(Date.now()+60*60*1000).toISOString();
    const reconcile=async(actorId,permissions,authorityClass)=>{const expectedVersion=await grantSync.currentVersion({tenantId,entityId,actorId});await grantSync.reconcile({tenantId,entityId,actorId,permissions,authorityClass,validUntil,expectedVersion,idempotencyKey:`w441-${actorId}-${expectedVersion}`});};
    const FAMILIES={
      'GROUP.CONSOLIDATION.CONFIG':{CREATE:'DRAFT',SUBMIT:'SUBMIT',APPROVE:'APPROVE'},
      'GROUP.INTERCOMPANY_ELIMINATION':{CREATE:'DRAFT',SUBMIT:'SUBMIT',REVIEW:'REVIEW',CANCEL:'REVIEW',APPROVE:'APPROVE',POST:'POST'},
      'INTEGRATION.WEBHOOK':{CREATE:'DRAFT',SUBMIT:'SUBMIT',APPROVE:'APPROVE',SUSPEND:'JE_REVIEW'},
      'REPORT.FORECAST':{CREATE:'DRAFT',SUBMIT:'SUBMIT',APPROVE:'APPROVE'},
    };
    for(const [family,actions] of Object.entries(FAMILIES))for(const [action,authorityClass] of Object.entries(actions)){
      const actorId=`w441-${family}-${action}-${code}`.toLowerCase();
      const permissions=[`${family}.${action}`,`${family}.VIEW`];
      await reconcile(actorId,permissions,authorityClass);
      const flags=await kernelFor({tenantId,entityId},actorId).readEntityPermissionFlags({tenantId,entityId,permissions});
      assert.deepEqual(flags,Object.fromEntries(permissions.map(p=>[p,true])),`${family}.${action} + VIEW under ${authorityClass}`);
    }
    // End to end: four distinct people, each holding only VIEW plus their own action.
    const who=a=>`w441-integration.webhook-${a}-${code}`.toLowerCase();
    const k=a=>kernelFor({tenantId,entityId},who(a));
    const created=await k('create').createWebhookSubscription({tenantId,entityId,subscriptionName:'441 ledger events',endpointHost:'hooks.example.com',endpointPath:'/refs/events',eventTypes:['JOURNAL_ENTRY_POSTED'],signingKeyReference:'vault://refs/webhook/441',signingKeyFingerprint:`sha256:${'a'.repeat(64)}`,reason:'441 end-to-end create',idempotencyKey:`w441-create-${code}`});
    assert.equal(created.status,'DRAFT');
    const id=created.subscription_id??created.webhook_subscription_id;
    let revision=Number(created.revision);
    for(const [action,status] of [['submit','PENDING_APPROVAL'],['approve','ACTIVE'],['suspend','SUSPENDED']]){
      const next=await k(action).transitionWebhookSubscription({tenantId,entityId,subscriptionId:id,action:action.toUpperCase(),expectedRevision:revision,reason:`441 end-to-end ${action}`,idempotencyKey:`w441-${action}-${code}`});
      assert.equal(next.status,status);revision=Number(next.revision);
    }
    // The additive VIEW does not widen: a VIEW-only reader still cannot create.
    await reconcile(`w441-reader-${code}`.toLowerCase(),['INTEGRATION.WEBHOOK.VIEW'],'READ');
    await assert.rejects(kernelFor({tenantId,entityId},`w441-reader-${code}`.toLowerCase()).createWebhookSubscription({tenantId,entityId,subscriptionName:'441 reader',endpointHost:'hooks.example.com',endpointPath:'/refs/r',eventTypes:['JOURNAL_ENTRY_POSTED'],signingKeyReference:'vault://refs/webhook/441r',signingKeyFingerprint:`sha256:${'b'.repeat(64)}`,reason:'441 reader must fail',idempotencyKey:`w441-reader-${code}`}));
  }finally{await grantPool.end();}
});

pgTest('441: a consolidation configuration runs DRAFT to APPROVED with three people who each hold only VIEW plus their own action',async()=>{
  const {PostgresGrantSync}=await import('../runtime/grant-sync.mjs');
  const grantPool=await createPool({databaseUrl:config.grantSyncDatabaseUrl,applicationName:'refs-441-consolidation',max:2});
  try{
    const tenantId=randomUUID(),group=randomUUID(),member=randomUUID(),code=`C4${randomUUID().slice(0,4).toUpperCase()}`;
    const groupPeriod=randomUUID(),memberPeriod=randomUUID();
    await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'c441']);
    for(const [id,suffix] of [[group,'G'],[member,'M']]){
      await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,$4,'USD')",[id,tenantId,`${code}${suffix}`,`441 ${suffix} entity`]);
    }
    for(const [period,entity] of [[groupPeriod,group],[memberPeriod,member]])await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[period,tenantId,entity]);
    await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name) VALUES($1,$2,'1000','Cash')",[tenantId,member]);
    const grantSync=new PostgresGrantSync(grantPool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
    const validUntil=new Date(Date.now()+60*60*1000).toISOString();
    const reconcile=async(actorId,entityId,permissions,authorityClass)=>{const expectedVersion=await grantSync.currentVersion({tenantId,entityId,actorId});await grantSync.reconcile({tenantId,entityId,actorId,permissions,authorityClass,validUntil,expectedVersion,idempotencyKey:`c441-${actorId}-${entityId}-${expectedVersion}`});};
    const actor=a=>`c441-${a}-${code}`.toLowerCase();
    for(const [a,cls] of [['create','DRAFT'],['submit','SUBMIT'],['approve','APPROVE']]){
      await reconcile(actor(a),group,[`GROUP.CONSOLIDATION.CONFIG.${a.toUpperCase()}`,'GROUP.CONSOLIDATION.CONFIG.VIEW'],cls);
      await reconcile(actor(a),member,['GL.REPORT.VIEW'],'ANALYSIS'); // member report read, asserted by the validator
    }
    const k=a=>kernelFor({tenantId,entityId:group},actor(a));
    const hash=c=>`sha256:${c.repeat(64)}`;
    const created=await k('create').createConsolidationConfiguration({tenantId,entityId:group,periodId:groupPeriod,groupRef:'441-GROUP',currency:'USD',
      members:[{member_entity_id:member,member_period_id:memberPeriod,member_receipt_hash:hash('1'),member_ref:'M1',member_snapshot_hash:hash('2'),member_source_ref:'WBS',member_source_version:'1'}],
      accountMaps:[{mapping_hash:hash('3'),member_entity_id:member,presentation_account_code:'1000',presentation_side:'DEBIT',source_account_code:'1000'}],
      reason:'441 consolidation create',idempotencyKey:`c441-create-${code}`});
    assert.equal(created.status,'DRAFT');
    let revision=Number(created.revision);const workflowId=created.workflow_id??created.consolidation_configuration_workflow_id;
    for(const [a,status] of [['submit','PENDING_APPROVAL'],['approve','APPROVED']]){
      const next=await k(a).transitionConsolidationConfiguration({tenantId,entityId:group,workflowId,action:a.toUpperCase(),expectedRevision:revision,reason:`441 consolidation ${a}`,idempotencyKey:`c441-${a}-${code}`});
      assert.equal(next.status,status);revision=Number(next.revision);
    }
  }finally{await grantPool.end();}
});

pgTest('every authoritative workflow role bundle reconciles through the real grant sync (CASH_TRANSFER_RECONCILER was labelled RECONCILE, frozen JE_REVIEW)',async()=>{
  const {PostgresGrantSync}=await import('../runtime/grant-sync.mjs');
  const {AUTHORITATIVE_WORKFLOW_ROLES}=await import('../runtime/workflow-role-grant.mjs');
  const grantPool=await createPool({databaseUrl:config.grantSyncDatabaseUrl,applicationName:'refs-role-bundle-sync',max:2});
  try{
    const tenantId=randomUUID(),entityId=randomUUID(),code=`RB${randomUUID().slice(0,4).toUpperCase()}`;
    await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'role-bundles']);
    await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,'role bundle entity','USD')",[entityId,tenantId,code]);
    const sync=new PostgresGrantSync(grantPool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
    const refused=[];
    for(const [name,definition] of Object.entries(AUTHORITATIVE_WORKFLOW_ROLES)){
      try{await sync.reconcile({tenantId,entityId,actorId:`rb-${name.toLowerCase()}-${code}`,permissions:definition.permissions,authorityClass:definition.authorityClass,validUntil:definition.authorityClass==='SERVICE'?null:new Date(Date.now()+60*60*1000).toISOString(),expectedVersion:0,idempotencyKey:`rb-${name.toLowerCase()}-${code}`});}
      catch(error){refused.push(`${name} (${definition.authorityClass}): ${error.code} ${error.message}`);}
    }
    assert.deepEqual(refused,[]);
  }finally{await grantPool.end();}
});
