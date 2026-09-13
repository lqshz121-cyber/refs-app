import assert from 'node:assert/strict';
import test,{after,before} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runtimeConfig} from '../runtime/config.mjs';
import {createPool} from '../runtime/db.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
import {PostgresGrantSync} from '../runtime/grant-sync.mjs';
import {AUTHORITATIVE_WORKFLOW_ROLES} from '../runtime/workflow-role-grant.mjs';
import {installApprovedAiSettingsFixture} from './helpers/approved-ai-settings-fixture.mjs';

const config=runtimeConfig();
let adminPool=null;
let runtimePool=null;
let issuerPool=null;
let grantSyncPool=null;
let unavailable=null;

before(async()=>{
  try{
    adminPool=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-accounting-settings-pg-admin',max:8});
    await adminPool.query('SELECT 1');
    await migrateUp(adminPool,{onEvent:event=>{if(event.event==='migration_failed')console.error(JSON.stringify(event));}});
    runtimePool=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-accounting-settings-pg-runtime',max:8});
    issuerPool=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-accounting-settings-pg-issuer',max:4});
    grantSyncPool=await createPool({databaseUrl:config.grantSyncDatabaseUrl,applicationName:'refs-accounting-settings-pg-grant-sync',max:4});
    await Promise.all([runtimePool.query('SELECT 1'),issuerPool.query('SELECT 1'),grantSyncPool.query('SELECT 1')]);
  }catch(error){
    unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;
    if(config.requirePostgres)throw error;
    await Promise.allSettled([adminPool?.end(),runtimePool?.end(),issuerPool?.end(),grantSyncPool?.end()]);
    adminPool=null;runtimePool=null;issuerPool=null;grantSyncPool=null;
  }
});

after(async()=>{
  if(adminPool)await adminPool.query('TRUNCATE tenant CASCADE').catch(()=>{});
  await Promise.allSettled([runtimePool?.end(),issuerPool?.end(),grantSyncPool?.end(),adminPool?.end()]);
});

function pgTest(name,fn){
  test(name,async t=>{
    if(unavailable){t.skip(unavailable);return;}
    await adminPool.query('TRUNCATE tenant CASCADE');
    await fn(t);
  });
}

const period=(code,start,end)=>({periodId:randomUUID(),code,start,end});
const reason=action=>`${action} the exact retained accounting settings evidence.`;
const childIds=fixture=>Object.fromEntries(Object.entries(fixture.childRefs).map(([key,value])=>[key,value.setting_snapshot_id]));
const rollbackSql=()=>readFile(new URL('../db/migrations/down/374_accounting_settings_authoritative.sql',import.meta.url),'utf8');
const stripTransaction=sql=>sql.replace(/^\s*BEGIN;\s*/i,'').replace(/\s*COMMIT;\s*$/i,'');
const outcome=promise=>promise.then(value=>({value}),error=>({error}));

async function waitBlocked(holderPid,waiterPid,message){
  for(let attempt=0;attempt<160;attempt++){
    if((await adminPool.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) waiting',[holderPid,waiterPid])).rows[0].waiting)return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.fail(message);
}

async function seedScope({tenantId=randomUUID(),entityId=randomUUID(),entityCode=`E${randomUUID().replaceAll('-','').slice(0,8)}`.toUpperCase(),periods=[]}={}){
  const tenantCode=`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase();
  await adminPool.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3) ON CONFLICT(tenant_id) DO NOTHING',[tenantId,tenantCode,'Accounting settings test tenant']);
  await adminPool.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,$3,'USD')",[entityId,tenantId,entityCode]);
  for(const item of periods)await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status,ledger_code) VALUES($1,$2,$3,$4,$5,$6,'OPEN',$7)",[item.periodId,tenantId,entityId,item.code,item.start,item.end,item.ledgerCode||'PRIMARY']);
  return {tenantId,entityId,sourceEntityId:entityCode,periods};
}

async function issueKernel(scope,actorId,pool=runtimePool){
  const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,actorId})});
  return new PostgresAccountingKernel(pool,{sessionProvider:()=>issuer.issue({tenantId:scope.tenantId})});
}

async function syncPermissions(scope,actorId,permissions,authorityClass,{expectedVersion=0,key=`settings-grant-${actorId}-${expectedVersion}`}={}){
  const sync=new PostgresGrantSync(grantSyncPool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
  await sync.reconcile({tenantId:scope.tenantId,entityId:scope.entityId,actorId,permissions,authorityClass,validUntil:new Date(Date.now()+60*60*1000).toISOString(),expectedVersion,idempotencyKey:key});
  return issueKernel(scope,actorId);
}

async function roleKernel(scope,actorId,roleName,options={}){
  const role=AUTHORITATIVE_WORKFLOW_ROLES[roleName];
  assert.ok(role,`Missing workflow role ${roleName}`);
  assert.equal(role.permissions.includes('ACCOUNTING.SETTINGS.WORKFLOW.VIEW'),true);
  assert.equal(role.permissions.filter(value=>value.startsWith('ACCOUNTING.SETTINGS.WORKFLOW.')&&value!=='ACCOUNTING.SETTINGS.WORKFLOW.VIEW').length,roleName.endsWith('_VIEWER')?0:1);
  return syncPermissions(scope,actorId,role.permissions,role.authorityClass,options);
}

async function lifecycleActors(scope,prefix){
  const specs=[
    ['maker','ACCOUNTING_SETTINGS_WORKFLOW_MAKER'],
    ['submitter','ACCOUNTING_SETTINGS_WORKFLOW_SUBMITTER'],
    ['reviewer','ACCOUNTING_SETTINGS_WORKFLOW_REVIEWER'],
    ['approver','ACCOUNTING_SETTINGS_WORKFLOW_APPROVER'],
    ['activator','ACCOUNTING_SETTINGS_WORKFLOW_ACTIVATOR']
  ];
  const result={};
  for(const [name,role] of specs)result[name]=await roleKernel(scope,`${prefix}-${name}`,role);
  return result;
}

async function createDraft(scope,target,fixture,actors,prefix){
  return actors.maker.createAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,childSettingSnapshotIds:childIds(fixture),reason:reason('Create'),idempotencyKey:`${prefix}-create`});
}

async function transition(scope,actors,workflow,action,prefix,{actor=null,expectedRevision=Number(workflow.revision)}={}){
  const kernel=actor||actors[{SUBMIT:'submitter',REVIEW:'reviewer',APPROVE:'approver',ACTIVATE:'activator'}[action]];
  return kernel.transitionAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:workflow.accounting_settings_workflow_id,action,expectedRevision,reason:reason(action),idempotencyKey:`${prefix}-${action.toLowerCase()}`});
}

async function advance(scope,actors,workflow,prefix,through='APPROVE'){
  const actions=['SUBMIT','REVIEW','APPROVE','ACTIVATE'];
  for(const action of actions){
    workflow=await transition(scope,actors,workflow,action,prefix);
    if(action===through)return workflow;
  }
  return workflow;
}

async function forwardFixture({withSeptember=false}={}){
  const july=period('2026-07','2026-07-01','2026-07-31');
  const august=period('2026-08','2026-08-01','2026-08-31');
  const periods=withSeptember?[july,august,period('2026-09','2026-09-01','2026-09-30')]:[july,august];
  const scope=await seedScope({periods});
  const legacy=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:july.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:true,openEndedParent:true});
  const augustChildren=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:august.periodId},companyCode:scope.sourceEntityId,settingsVersion:2,includeParent:false});
  return {scope,july,august,september:periods[2],legacy,augustChildren};
}

async function retireApprovedParent(settingSnapshotId,retiredBy){
  const client=await adminPool.connect();
  try{
    await client.query('BEGIN');
    await client.query("SELECT set_config('refs.config_retire','authorized',true)");
    await client.query("UPDATE setting_snapshot SET status='RETIRED',lifecycle_revision=lifecycle_revision+1,retired_by=$2,retired_at=clock_timestamp(),retire_reason='Retained historical parent fixture' WHERE setting_snapshot_id=$1",[settingSnapshotId,retiredBy]);
    await client.query('COMMIT');
  }catch(error){
    try{await client.query('ROLLBACK');}catch{}
    throw error;
  }finally{client.release();}
}

async function insertParentSnapshot(scope,target,fixture,{scopeType='ENTITY',scopeKey=scope.entityId,status='APPROVED',version=1,queryable=adminPool}={}){
  const snapshot={schema_version:'AI_ACCOUNTING_ENTITY_PERIOD_SETTINGS_SNAPSHOT_V1',company_code:scope.sourceEntityId,period_id:target.periodId,period_code:target.code,period_start:target.start,period_end:target.end,currency:'USD',...fixture.childRefs};
  const snapshotHash=(await queryable.query('SELECT refs_jsonb_hash($1::jsonb) hash',[snapshot])).rows[0].hash,settingSnapshotId=randomUUID();
  await queryable.query("INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,effective_to,status,snapshot,snapshot_hash,created_by,approved_by,approved_at,retired_by,retired_at,retire_reason,lifecycle_revision) VALUES($1,$2,$3,'AI_ACCOUNTING_ENTITY_PERIOD_SETTINGS_V1',$4,$5,$6,$7::date,($8::date+1),$9,$10::jsonb,$11,'legacy-maker','legacy-approver',now(),CASE WHEN $9='RETIRED' THEN 'legacy-retirer' END,CASE WHEN $9='RETIRED' THEN now() END,CASE WHEN $9='RETIRED' THEN 'Retained historical parent' END,CASE WHEN $9='RETIRED' THEN 1 ELSE 0 END)",[settingSnapshotId,scope.tenantId,scope.entityId,scopeType,scopeKey,version,target.start,target.end,status,snapshot,snapshotHash]);
  return {settingSnapshotId,snapshot,snapshotHash};
}

async function cloneApprovedChild(scope,sourceId,mutate,version){
  const source=(await adminPool.query('SELECT * FROM setting_snapshot WHERE setting_snapshot_id=$1',[sourceId])).rows[0];
  const snapshot=structuredClone(source.snapshot);mutate(snapshot);
  const settingSnapshotId=randomUUID(),snapshotHash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) hash',[snapshot])).rows[0].hash;
  await adminPool.query("INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,effective_to,status,snapshot,snapshot_hash,created_by,approved_by,approved_at) VALUES($1,$2,$3,$4,'ENTITY',$3::text,$5,$6,$7,'APPROVED',$8::jsonb,$9,'parity-maker','parity-approver',now())",
    [settingSnapshotId,scope.tenantId,scope.entityId,source.family,version,source.effective_from,source.effective_to,snapshot,snapshotHash]);
  return settingSnapshotId;
}

async function cloneApprovedChildWithJsonbPatch(scope,sourceId,path,jsonLiteral,version){
  const settingSnapshotId=randomUUID();
  await adminPool.query(`WITH patched AS (
    SELECT family,effective_from,effective_to,jsonb_set(snapshot,$6::text[],$7::jsonb,false) snapshot
      FROM setting_snapshot WHERE tenant_id=$2 AND entity_id=$3 AND setting_snapshot_id=$1
  ) INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,effective_to,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
    SELECT $4,$2,$3,family,'ENTITY',$3::text,$5,effective_from,effective_to,'APPROVED',snapshot,refs_jsonb_hash(snapshot),'parity-maker','parity-approver',now() FROM patched`,
    [sourceId,scope.tenantId,scope.entityId,settingSnapshotId,version,path,jsonLiteral]);
  return settingSnapshotId;
}

async function readWorkflowEvidence(kernel,scope,workflowId){
  return kernel.inSession(async client=>(await client.query('SELECT refs_read_accounting_settings_workflow_evidence($1,$2,$3) result',[scope.tenantId,scope.entityId,workflowId])).rows[0]?.result);
}

pgTest('accounting settings uses five legal VIEW plus single-authority actors and replays one exact private-readback lifecycle',async()=>{
  const {scope,august,legacy,augustChildren}=await forwardFixture();
  const actors=await lifecycleActors(scope,'settings-happy');
  const grants=(await adminPool.query("SELECT actor_id,authority_class,array_agg(permission ORDER BY permission) permissions FROM runtime_actor_grant WHERE tenant_id=$1 AND entity_id=$2 AND actor_id LIKE 'settings-happy-%' AND revoked_at IS NULL GROUP BY actor_id,authority_class ORDER BY actor_id",[scope.tenantId,scope.entityId])).rows;
  assert.equal(grants.length,5);
  for(const grant of grants){assert.equal(grant.permissions.includes('ACCOUNTING.SETTINGS.WORKFLOW.VIEW'),true);assert.equal(grant.permissions.filter(value=>value.startsWith('ACCOUNTING.SETTINGS.WORKFLOW.')&&value!=='ACCOUNTING.SETTINGS.WORKFLOW.VIEW').length,1);}
  assert.deepEqual(grants.flatMap(grant=>grant.permissions.filter(value=>value.startsWith('ACCOUNTING.SETTINGS.WORKFLOW.')&&value!=='ACCOUNTING.SETTINGS.WORKFLOW.VIEW')).sort(),['ACCOUNTING.SETTINGS.WORKFLOW.ACTIVATE','ACCOUNTING.SETTINGS.WORKFLOW.APPROVE','ACCOUNTING.SETTINGS.WORKFLOW.CREATE','ACCOUNTING.SETTINGS.WORKFLOW.REVIEW','ACCOUNTING.SETTINGS.WORKFLOW.SUBMIT']);
  const options=await actors.maker.readAccountingSettingsWorkflowOptions({tenantId:scope.tenantId,entityId:scope.entityId,periodId:august.periodId});
  assert.equal(options.prerequisites.length,10);assert.deepEqual(options.blockers.missing_approved_families,[]);assert.equal(options.action_flags.can_create_draft,true);assert.equal(options.blockers.forward_legacy_parent_setting_snapshot_id,legacy.settingsSnapshotId);
  let workflow=await createDraft(scope,august,augustChildren,actors,'settings-happy');
  const createReplay=await createDraft(scope,august,augustChildren,actors,'settings-happy');assert.equal(createReplay.idempotent,true);assert.equal(createReplay.accounting_settings_workflow_id,workflow.accounting_settings_workflow_id);
  for(const action of ['SUBMIT','REVIEW','APPROVE','ACTIVATE']){
    workflow=await transition(scope,actors,workflow,action,'settings-happy');
    const replay=await transition(scope,actors,{...workflow,revision:String(Number(workflow.revision)-1)},action,'settings-happy',{expectedRevision:Number(workflow.revision)-1});
    assert.equal(replay.idempotent,true);assert.equal(replay.revision,workflow.revision);
  }
  assert.equal(workflow.status,'ACTIVE');assert.equal(workflow.revision,'4');assert.equal(workflow.history.length,5);
  const stored=(await adminPool.query('SELECT status,effective_from::date::text effective_from,effective_to::date::text effective_to,retired_by FROM setting_snapshot WHERE setting_snapshot_id=$1',[legacy.settingsSnapshotId])).rows[0];
  assert.deepEqual(stored,{status:'RETIRED',effective_from:'2026-07-01',effective_to:'2026-08-01',retired_by:'settings-happy-activator'});
  await assert.rejects(actors.activator.inSession(client=>client.query('SELECT refs_validate_accounting_settings_activation_snapshot($1,$2,$3)',[scope.tenantId,scope.entityId,august.periodId])),error=>error.code==='42501');
  await assert.rejects(actors.activator.inSession(client=>client.query('SELECT refs_validate_accounting_settings_selected_bundle($1,$2,$3,$4::jsonb,$5::jsonb,false)',[scope.tenantId,scope.entityId,august.periodId,workflow.canonical_parent_snapshot,workflow.child_setting_snapshot_ids])),error=>error.code==='42501');
  const helperPrivileges=(await adminPool.query("SELECT has_function_privilege('PUBLIC','refs_validate_accounting_settings_selected_bundle(uuid,uuid,uuid,jsonb,jsonb,boolean)','EXECUTE') public_execute,has_function_privilege('refs_app','refs_validate_accounting_settings_selected_bundle(uuid,uuid,uuid,jsonb,jsonb,boolean)','EXECUTE') app_execute")).rows[0];
  assert.deepEqual(helperPrivileges,{public_execute:false,app_execute:false});
  const aiReader=await syncPermissions(scope,'settings-ai-reader',['AI.ACCOUNTING.SETTINGS.VIEW'],'READ');
  const readback=await aiReader.readApprovedWbsAiEntityPeriodSettings({tenantId:scope.tenantId,entityId:scope.entityId,periodId:august.periodId,readOnly:true});
  assert.equal(readback.settings_snapshot_id,workflow.legacy_parent_setting_snapshot_id);assert.equal(readback.settings_hash,workflow.canonical_parent_hash);assert.equal(readback.period_id,august.periodId);
  const counts=(await adminPool.query("SELECT (SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE object_id=$1 AND event_type LIKE 'ACCOUNTING_SETTINGS_%') audit,(SELECT count(*)::int FROM outbox_event WHERE aggregate_id=$1 AND event_type LIKE 'ACCOUNTING_SETTINGS_%') outbox",[workflow.accounting_settings_workflow_id])).rows[0];
  assert.deepEqual(counts,{history:5,audit:5,outbox:5});
  const storedWorkflow=(await adminPool.query('SELECT created_at FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$1',[workflow.accounting_settings_workflow_id])).rows[0];
  assert.equal(Date.parse(workflow.created_at),new Date(storedWorkflow.created_at).valueOf());
  const history=(await adminPool.query("SELECT tenant_id,revision::int revision,from_status,to_status,actor_id,reason,previous_event_hash,event_hash,created_at,refs_accounting_settings_history_hash(tenant_id,accounting_settings_workflow_id,from_status,to_status,revision,actor_id,reason,previous_event_hash,created_at)=event_hash hash_valid FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1 ORDER BY revision",[workflow.accounting_settings_workflow_id])).rows;
  assert.deepEqual(history.map(row=>row.revision),[0,1,2,3,4]);
  assert.deepEqual(history.map(row=>row.to_status),['DRAFT','SUBMITTED','REVIEWED','APPROVED','ACTIVE']);
  for(const [index,event] of history.entries()){
    assert.equal(event.hash_valid,true,`revision ${index} must retain its canonical event hash`);
    assert.equal(event.previous_event_hash,index===0?null:history[index-1].event_hash,`revision ${index} must link to its predecessor`);
    assert.equal(Date.parse(workflow.history[index].created_at),new Date(event.created_at).valueOf());
    assert.equal(workflow.history[index].previous_event_hash,event.previous_event_hash);
    assert.equal(workflow.history[index].event_hash,event.event_hash);
  }
  const auditEvents=(await adminPool.query("SELECT event_type,after_hash,metadata FROM audit_event WHERE object_id=$1 AND event_type LIKE 'ACCOUNTING_SETTINGS_%' ORDER BY (metadata->>'revision')::int",[workflow.accounting_settings_workflow_id])).rows;
  const outboxEvents=(await adminPool.query("SELECT event_type,payload_hash,payload FROM outbox_event WHERE aggregate_id=$1 AND event_type LIKE 'ACCOUNTING_SETTINGS_%' ORDER BY (payload->>'revision')::int",[workflow.accounting_settings_workflow_id])).rows;
  assert.deepEqual(auditEvents.map(row=>row.event_type),['ACCOUNTING_SETTINGS_DRAFT_CREATED','ACCOUNTING_SETTINGS_SUBMIT','ACCOUNTING_SETTINGS_REVIEW','ACCOUNTING_SETTINGS_APPROVE','ACCOUNTING_SETTINGS_ACTIVATE']);
  assert.deepEqual(outboxEvents.map(row=>row.event_type),auditEvents.map(row=>row.event_type));
  const createdAt=new Date(storedWorkflow.created_at).valueOf();
  assert.equal(new Date(history[0].created_at).valueOf(),createdAt);
  assert.equal(Date.parse(auditEvents[0].metadata.created_at),createdAt);
  assert.equal(Date.parse(outboxEvents[0].payload.created_at),createdAt);
  for(const [index,event] of history.entries()){
    assert.equal(auditEvents[index].metadata.previous_event_hash,event.previous_event_hash);
    assert.equal(auditEvents[index].metadata.history_event_hash,event.event_hash);
    assert.equal(Date.parse(auditEvents[index].metadata.created_at),new Date(event.created_at).valueOf());
    assert.deepEqual(outboxEvents[index].payload,auditEvents[index].metadata);
    const payloadEventHash=(await adminPool.query("SELECT refs_accounting_settings_history_hash($1::uuid,$2::uuid,$3::text,$4::text,$5::bigint,$6::text,$7::text,$8::text,$9::timestamptz) event_hash",[event.tenant_id,workflow.accounting_settings_workflow_id,auditEvents[index].metadata.from_status??null,auditEvents[index].metadata.status,auditEvents[index].metadata.revision,auditEvents[index].metadata.actor_id,auditEvents[index].metadata.reason,auditEvents[index].metadata.previous_event_hash,auditEvents[index].metadata.created_at])).rows[0].event_hash;
    assert.equal(payloadEventHash,event.event_hash,`revision ${index} payload timestamp must reproduce its stored history hash`);
    const hashes=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) audit_hash,refs_jsonb_hash($2::jsonb) outbox_hash',[auditEvents[index].metadata,outboxEvents[index].payload])).rows[0];
    assert.equal(auditEvents[index].after_hash,hashes.audit_hash);
    assert.equal(outboxEvents[index].payload_hash,hashes.outbox_hash);
  }
});

pgTest('workflow-only readers cannot call public 251 and blind writers or cross-company children leave zero command evidence',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31');
  const scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const viewer=await roleKernel(scope,'settings-workflow-viewer','ACCOUNTING_SETTINGS_WORKFLOW_VIEWER');
  await assert.rejects(viewer.readApprovedWbsAiEntityPeriodSettings({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,readOnly:true}),error=>error.code==='42501');
  const blind=await syncPermissions(scope,'settings-blind-maker',['ACCOUNTING.SETTINGS.WORKFLOW.CREATE'],'DRAFT');
  await assert.rejects(blind.createAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,childSettingSnapshotIds:childIds(fixture),reason:reason('Create'),idempotencyKey:'settings-blind-create'}),error=>error.code==='42501');
  const blindCounts=(await adminPool.query("SELECT (SELECT count(*)::int FROM accounting_settings_workflow) workflow,(SELECT count(*)::int FROM accounting_settings_workflow_history) history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key='settings-blind-create') audit,(SELECT count(*)::int FROM outbox_event WHERE event_type='ACCOUNTING_SETTINGS_DRAFT_CREATED') outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key='settings-blind-create') idempotency")).rows[0];
  assert.deepEqual(blindCounts,{workflow:0,history:0,audit:0,outbox:0,idempotency:0});
  const validMaker=await roleKernel(scope,'settings-visible-maker','ACCOUNTING_SETTINGS_WORKFLOW_MAKER');
  const draft=await validMaker.createAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,childSettingSnapshotIds:childIds(fixture),reason:reason('Create'),idempotencyKey:'settings-visible-create'});
  const blindSubmitter=await syncPermissions(scope,'settings-blind-submitter',['ACCOUNTING.SETTINGS.WORKFLOW.SUBMIT'],'SUBMIT');
  await assert.rejects(blindSubmitter.transitionAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:draft.accounting_settings_workflow_id,action:'SUBMIT',expectedRevision:0,reason:reason('SUBMIT'),idempotencyKey:'settings-blind-submit'}),error=>error.code==='42501');
  const blindTransition=(await adminPool.query("SELECT status,revision::int revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key='settings-blind-submit') audit,(SELECT count(*)::int FROM outbox_event WHERE aggregate_id=$1) outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key='settings-blind-submit') idempotency FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$1",[draft.accounting_settings_workflow_id])).rows[0];
  assert.deepEqual(blindTransition,{status:'DRAFT',revision:0,history:1,audit:0,outbox:1,idempotency:0});

  const other=await seedScope({tenantId:scope.tenantId,periods:[period('2026-08','2026-08-01','2026-08-31')]});
  const otherFixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...other,periodId:other.periods[0].periodId},companyCode:other.sourceEntityId,settingsVersion:1,includeParent:false});
  const forged=childIds(fixture);forged.tax=childIds(otherFixture).tax;
  const maker=await roleKernel(scope,'settings-cross-company-maker','ACCOUNTING_SETTINGS_WORKFLOW_MAKER');
  await assert.rejects(maker.createAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,childSettingSnapshotIds:forged,reason:reason('Create'),idempotencyKey:'settings-cross-company-create'}),error=>error.code==='23514');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM accounting_settings_workflow')).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM idempotency_receipt WHERE idempotency_key='settings-cross-company-create'")).rows[0].n,0);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE idempotency_key='settings-cross-company-create'")).rows[0].n,0);
});

pgTest('stale revisions and a re-granted same actor fail SoD without history, audit, outbox, or receipt drift',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31');
  const scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const actors=await lifecycleActors(scope,'settings-conflict');
  let workflow=await createDraft(scope,target,fixture,actors,'settings-conflict');
  const makerSubmitter=await roleKernel(scope,'settings-conflict-maker','ACCOUNTING_SETTINGS_WORKFLOW_SUBMITTER',{expectedVersion:1,key:'settings-maker-regrant-submit'});
  await assert.rejects(transition(scope,actors,workflow,'SUBMIT','settings-sod',{actor:makerSubmitter}),error=>error.code==='42501');
  let state=(await adminPool.query("SELECT status,revision::int revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key='settings-sod-submit') audit,(SELECT count(*)::int FROM outbox_event WHERE aggregate_id=$1) outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key='settings-sod-submit') idempotency FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$1",[workflow.accounting_settings_workflow_id])).rows[0];
  assert.deepEqual(state,{status:'DRAFT',revision:0,history:1,audit:0,outbox:1,idempotency:0});
  workflow=await transition(scope,actors,workflow,'SUBMIT','settings-conflict');
  await assert.rejects(transition(scope,actors,workflow,'REVIEW','settings-stale',{expectedRevision:0}),error=>error.code==='40001');
  state=(await adminPool.query("SELECT status,revision::int revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key='settings-stale-review') audit,(SELECT count(*)::int FROM outbox_event WHERE aggregate_id=$1) outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key='settings-stale-review') idempotency FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$1",[workflow.accounting_settings_workflow_id])).rows[0];
  assert.deepEqual(state,{status:'SUBMITTED',revision:1,history:2,audit:0,outbox:2,idempotency:0});
});

pgTest('closing the target period after Draft preparation rolls every lifecycle action back without command residue',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31');
  const scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const actors=await lifecycleActors(scope,'settings-closed');
  const prepared=[];
  for(const action of ['SUBMIT','REVIEW','APPROVE','ACTIVATE']){
    const prefix=`settings-closed-${action.toLowerCase()}`;
    let workflow=await createDraft(scope,target,fixture,actors,prefix);
    const prerequisite={SUBMIT:null,REVIEW:'SUBMIT',APPROVE:'REVIEW',ACTIVATE:'APPROVE'}[action];
    if(prerequisite)workflow=await advance(scope,actors,workflow,prefix,prerequisite);
    prepared.push({action,prefix,workflow});
  }
  await adminPool.query("UPDATE accounting_period SET status='CLOSED',closed_at=clock_timestamp(),closed_by='period-controller' WHERE period_id=$1",[target.periodId]);
  for(const {action,prefix,workflow} of prepared){
    const key=`${prefix}-closed-attempt`;
    await assert.rejects(actors[{SUBMIT:'submitter',REVIEW:'reviewer',APPROVE:'approver',ACTIVATE:'activator'}[action]].transitionAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:workflow.accounting_settings_workflow_id,action,expectedRevision:Number(workflow.revision),reason:reason(action),idempotencyKey:key}),error=>error.code==='55000');
    const unchanged=(await adminPool.query("SELECT status,revision::int revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key=$2) audit,(SELECT count(*)::int FROM outbox_event WHERE aggregate_id=$1) outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key=$2) idempotency FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$1",[workflow.accounting_settings_workflow_id,key])).rows[0];
    assert.deepEqual(unchanged,{status:workflow.status,revision:Number(workflow.revision),history:Number(workflow.revision)+1,audit:0,outbox:Number(workflow.revision)+1,idempotency:0},action);
  }
  const closedCreateKey='settings-closed-new-create';
  await assert.rejects(actors.maker.createAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,childSettingSnapshotIds:childIds(fixture),reason:reason('Create'),idempotencyKey:closedCreateKey}),error=>error.code==='55000');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM idempotency_receipt WHERE idempotency_key=$1',[closedCreateKey])).rows[0].n,0);
});

pgTest('same-period replacement is rejected at create and activation while the approved loser remains clean',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31');
  const scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const firstActors=await lifecycleActors(scope,'settings-same-a'),secondActors=await lifecycleActors(scope,'settings-same-b');
  let first=await createDraft(scope,target,fixture,firstActors,'settings-same-a');
  let second=await createDraft(scope,target,fixture,secondActors,'settings-same-b');
  first=await advance(scope,firstActors,first,'settings-same-a','APPROVE');
  second=await advance(scope,secondActors,second,'settings-same-b','APPROVE');
  first=await transition(scope,firstActors,first,'ACTIVATE','settings-same-a');
  assert.equal(first.status,'ACTIVE');
  await assert.rejects(createDraft(scope,target,fixture,firstActors,'settings-same-after-active'),error=>error.code==='55000');
  await assert.rejects(transition(scope,secondActors,second,'ACTIVATE','settings-same-b'),error=>error.code==='55000');
  const rows=(await adminPool.query("SELECT accounting_settings_workflow_id,status,revision::int revision FROM accounting_settings_workflow ORDER BY version")).rows;
  assert.deepEqual(rows,[
    {accounting_settings_workflow_id:first.accounting_settings_workflow_id,status:'ACTIVE',revision:4},
    {accounting_settings_workflow_id:second.accounting_settings_workflow_id,status:'APPROVED',revision:3}
  ]);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM idempotency_receipt WHERE idempotency_key IN('settings-same-after-active-create','settings-same-b-activate')")).rows[0].n,0);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE idempotency_key IN('settings-same-after-active-create','settings-same-b-activate')")).rows[0].n,0);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1',[second.accounting_settings_workflow_id])).rows[0].n,4);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM outbox_event WHERE aggregate_id=$1',[second.accounting_settings_workflow_id])).rows[0].n,4);
});

pgTest('legacy-parent creator and approver cannot self-retire during a forward activation',async()=>{
  for(const forbiddenActor of ['settings-maker','settings-approver']){
    const {scope,august,legacy,augustChildren}=await forwardFixture();
    const prefix=`settings-self-retire-${forbiddenActor}`;
    const actors=await lifecycleActors(scope,prefix);
    let workflow=await createDraft(scope,august,augustChildren,actors,prefix);
    workflow=await advance(scope,actors,workflow,prefix,'APPROVE');
    const selfActivator=await roleKernel(scope,forbiddenActor,'ACCOUNTING_SETTINGS_WORKFLOW_ACTIVATOR');
    const key=`${prefix}-activate-denied`;
    await assert.rejects(selfActivator.transitionAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:workflow.accounting_settings_workflow_id,action:'ACTIVATE',expectedRevision:3,reason:reason('ACTIVATE'),idempotencyKey:key}),error=>error.code==='42501');
    const state=(await adminPool.query("SELECT w.status,w.revision::int revision,s.status parent_status,s.effective_to::text effective_to,(SELECT count(*)::int FROM audit_event WHERE idempotency_key=$3) audit,(SELECT count(*)::int FROM outbox_event WHERE aggregate_id=$1) outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key=$3) idempotency FROM accounting_settings_workflow w JOIN setting_snapshot s ON s.setting_snapshot_id=$2 WHERE w.accounting_settings_workflow_id=$1",[workflow.accounting_settings_workflow_id,legacy.settingsSnapshotId,key])).rows[0];
    assert.deepEqual(state,{status:'APPROVED',revision:3,parent_status:'APPROVED',effective_to:null,audit:0,outbox:4,idempotency:0},forbiddenActor);
  }
});

pgTest('a later active workflow supersedes the old workflow and retires its parent exactly at the next period start',async()=>{
  const {scope,august,september,augustChildren}=await forwardFixture({withSeptember:true});
  const firstActors=await lifecycleActors(scope,'settings-forward-a');
  let first=await createDraft(scope,august,augustChildren,firstActors,'settings-forward-a');
  first=await advance(scope,firstActors,first,'settings-forward-a','ACTIVATE');
  const septemberChildren=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:september.periodId},companyCode:scope.sourceEntityId,settingsVersion:3,includeParent:false});
  const secondActors=await lifecycleActors(scope,'settings-forward-b');
  let second=await createDraft(scope,september,septemberChildren,secondActors,'settings-forward-b');
  second=await advance(scope,secondActors,second,'settings-forward-b','ACTIVATE');
  const old=await secondActors.activator.readAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:first.accounting_settings_workflow_id});
  assert.equal(old.status,'SUPERSEDED');assert.equal(old.revision,'5');assert.equal(old.history.length,6);assert.equal(old.superseded_by_workflow_id,second.accounting_settings_workflow_id);
  const state=(await adminPool.query("SELECT (SELECT count(*)::int FROM accounting_settings_workflow WHERE tenant_id=$1 AND entity_id=$2 AND status='ACTIVE') active_count,(SELECT status FROM setting_snapshot WHERE setting_snapshot_id=$3) old_parent_status,(SELECT effective_to::date::text FROM setting_snapshot WHERE setting_snapshot_id=$3) old_parent_effective_to",[scope.tenantId,scope.entityId,first.legacy_parent_setting_snapshot_id])).rows[0];
  assert.deepEqual(state,{active_count:1,old_parent_status:'RETIRED',old_parent_effective_to:'2026-09-01'});
  const supersedeEvidence=(await adminPool.query("SELECT (SELECT count(*)::int FROM audit_event WHERE object_id=$1 AND event_type='ACCOUNTING_SETTINGS_SUPERSEDED') audit,(SELECT count(*)::int FROM outbox_event WHERE aggregate_id=$1 AND event_type='ACCOUNTING_SETTINGS_SUPERSEDED') outbox",[first.accounting_settings_workflow_id])).rows[0];
  assert.deepEqual(supersedeEvidence,{audit:1,outbox:1});
  assert.equal(second.status,'ACTIVE');assert.equal(second.canonical_parent_snapshot.period_id,september.periodId);
});

pgTest('an active parent maker or approver cannot activate either prepared successor workflow',async()=>{
  const {scope,august,september,augustChildren}=await forwardFixture({withSeptember:true});
  const firstActors=await lifecycleActors(scope,'settings-successor-source');
  let active=await createDraft(scope,august,augustChildren,firstActors,'settings-successor-source');
  active=await advance(scope,firstActors,active,'settings-successor-source','ACTIVATE');
  const successorChildren=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:september.periodId},companyCode:scope.sourceEntityId,settingsVersion:3,includeParent:false});
  const prepared=[];
  for(const label of ['maker','approver']){
    const actors=await lifecycleActors(scope,`settings-successor-${label}`);
    let workflow=await createDraft(scope,september,successorChildren,actors,`settings-successor-${label}`);
    workflow=await advance(scope,actors,workflow,`settings-successor-${label}`,'APPROVE');
    prepared.push({label,workflow});
  }
  const forbidden=[
    {label:'maker',actorId:'settings-successor-source-maker',expectedVersion:1},
    {label:'approver',actorId:'settings-successor-source-approver',expectedVersion:1}
  ];
  for(const item of forbidden){
    const activator=await roleKernel(scope,item.actorId,'ACCOUNTING_SETTINGS_WORKFLOW_ACTIVATOR',{expectedVersion:item.expectedVersion,key:`settings-successor-${item.label}-regrant`});
    const workflow=prepared.find(value=>value.label===item.label).workflow,key=`settings-successor-${item.label}-self-retire`;
    await assert.rejects(activator.transitionAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:workflow.accounting_settings_workflow_id,action:'ACTIVATE',expectedRevision:3,reason:reason('ACTIVATE'),idempotencyKey:key}),error=>error.code==='42501');
    const unchanged=(await adminPool.query("SELECT status,revision::int revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key=$2) audit,(SELECT count(*)::int FROM outbox_event WHERE aggregate_id=$1) outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key=$2) idempotency FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$1",[workflow.accounting_settings_workflow_id,key])).rows[0];
    assert.deepEqual(unchanged,{status:'APPROVED',revision:3,history:4,audit:0,outbox:4,idempotency:0},item.label);
  }
  const parent=(await adminPool.query('SELECT status,effective_to::text effective_to FROM setting_snapshot WHERE setting_snapshot_id=$1',[active.legacy_parent_setting_snapshot_id])).rows[0];
  assert.deepEqual(parent,{status:'APPROVED',effective_to:null});
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM accounting_settings_workflow WHERE tenant_id=$1 AND entity_id=$2 AND status='ACTIVE'",[scope.tenantId,scope.entityId])).rows[0].n,1);
});

pgTest('RETIRED-only parent history rejects an earlier target and a target inside a retained historical gap',async()=>{
  const june=period('2026-06','2026-06-01','2026-06-30'),july=period('2026-07','2026-07-01','2026-07-31'),august=period('2026-08','2026-08-01','2026-08-31'),september=period('2026-09','2026-09-01','2026-09-30');
  const scope=await seedScope({periods:[june,july,august,september]});
  const julyHistory=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:july.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:true});
  await retireApprovedParent(julyHistory.settingsSnapshotId,'history-retirer-july');
  const septemberHistory=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:september.periodId},companyCode:scope.sourceEntityId,settingsVersion:2,includeParent:true});
  await retireApprovedParent(septemberHistory.settingsSnapshotId,'history-retirer-september');
  const targets=[
    {label:'earlier',period:june,fixture:await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:june.periodId},companyCode:scope.sourceEntityId,settingsVersion:3,includeParent:false})},
    {label:'gap',period:august,fixture:await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:august.periodId},companyCode:scope.sourceEntityId,settingsVersion:4,includeParent:false})}
  ];
  const actors=await lifecycleActors(scope,'settings-retired-history');
  for(const target of targets){
    const prefix=`settings-retired-${target.label}`;
    let workflow=await createDraft(scope,target.period,target.fixture,actors,prefix);
    workflow=await advance(scope,actors,workflow,prefix,'APPROVE');
    await assert.rejects(transition(scope,actors,workflow,'ACTIVATE',prefix),error=>error.code==='55000'&&/strictly later than all retained parent history/i.test(error.message));
    const unchanged=(await adminPool.query("SELECT status,revision::int revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key=$2) audit,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key=$2) idempotency FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$1",[workflow.accounting_settings_workflow_id,`${prefix}-activate`])).rows[0];
    assert.deepEqual(unchanged,{status:'APPROVED',revision:3,history:4,audit:0,idempotency:0},target.label);
  }
  const history=(await adminPool.query("SELECT status,effective_from::date::text effective_from,effective_to::date::text effective_to FROM setting_snapshot WHERE setting_snapshot_id=ANY($1::uuid[]) ORDER BY effective_from",[[julyHistory.settingsSnapshotId,septemberHistory.settingsSnapshotId]])).rows;
  assert.deepEqual(history.map(({status,effective_from,effective_to})=>({status,effective_from,effective_to})),[
    {status:'RETIRED',effective_from:'2026-07-01',effective_to:'2026-08-01'},
    {status:'RETIRED',effective_from:'2026-09-01',effective_to:'2026-10-01'}
  ]);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM setting_snapshot WHERE tenant_id=$1 AND entity_id=$2 AND family='AI_ACCOUNTING_ENTITY_PERIOD_SETTINGS_V1'",[scope.tenantId,scope.entityId])).rows[0].n,2);
});

pgTest('new parent emits one independent CONFIG_SNAPSHOT_APPROVED audit and outbox across replay while failed activation emits none',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31');
  const scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const winnerActors=await lifecycleActors(scope,'settings-parent-event-winner'),loserActors=await lifecycleActors(scope,'settings-parent-event-loser');
  let winner=await createDraft(scope,target,fixture,winnerActors,'settings-parent-event-winner');
  let loser=await createDraft(scope,target,fixture,loserActors,'settings-parent-event-loser');
  winner=await advance(scope,winnerActors,winner,'settings-parent-event-winner','APPROVE');
  loser=await advance(scope,loserActors,loser,'settings-parent-event-loser','APPROVE');
  winner=await transition(scope,winnerActors,winner,'ACTIVATE','settings-parent-event-winner');
  const replay=await transition(scope,winnerActors,{...winner,revision:'3'},'ACTIVATE','settings-parent-event-winner',{expectedRevision:3});
  assert.equal(replay.idempotent,true);assert.equal(replay.legacy_parent_setting_snapshot_id,winner.legacy_parent_setting_snapshot_id);
  const approved=(await adminPool.query("SELECT (SELECT count(*)::int FROM audit_event WHERE object_type='SETTING_SNAPSHOT' AND object_id=$1 AND event_type='CONFIG_SNAPSHOT_APPROVED') audit,(SELECT count(*)::int FROM outbox_event WHERE aggregate_type='SETTING_SNAPSHOT' AND aggregate_id=$1 AND event_type='CONFIG_SNAPSHOT_APPROVED') outbox,(SELECT count(*)::int FROM audit_event WHERE object_id=$1 AND idempotency_key='settings-parent-event-winner-activate') keyed_audit",[winner.legacy_parent_setting_snapshot_id])).rows[0];
  assert.deepEqual(approved,{audit:1,outbox:1,keyed_audit:1});
  await assert.rejects(transition(scope,loserActors,loser,'ACTIVATE','settings-parent-event-loser'),error=>error.code==='55000');
  const afterFailure=(await adminPool.query("SELECT (SELECT count(*)::int FROM setting_snapshot WHERE tenant_id=$1 AND entity_id=$2 AND family='AI_ACCOUNTING_ENTITY_PERIOD_SETTINGS_V1') parents,(SELECT count(*)::int FROM audit_event WHERE event_type='CONFIG_SNAPSHOT_APPROVED') approved_audit,(SELECT count(*)::int FROM outbox_event WHERE event_type='CONFIG_SNAPSHOT_APPROVED') approved_outbox,(SELECT count(*)::int FROM audit_event WHERE idempotency_key='settings-parent-event-loser-activate') failed_audit,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key='settings-parent-event-loser-activate') failed_idempotency",[scope.tenantId,scope.entityId])).rows[0];
  assert.deepEqual(afterFailure,{parents:1,approved_audit:1,approved_outbox:1,failed_audit:0,failed_idempotency:0});
});

pgTest('all five VIEW actors read the ten immutable selected child bodies while only the stage authority can execute',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31'),scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const actors=await lifecycleActors(scope,'settings-evidence-authority');
  let workflow=await createDraft(scope,target,fixture,actors,'settings-evidence-authority');
  const selectedIds=Object.values(fixture.childRefs).map(row=>row.setting_snapshot_id);
  const stored=(await adminPool.query('SELECT setting_snapshot_id,family,version::text version,snapshot_hash,status,approved_by,approved_at,effective_from,effective_to,snapshot FROM setting_snapshot WHERE setting_snapshot_id=ANY($1::uuid[])',[selectedIds])).rows;
  const storedById=new Map(stored.map(row=>[row.setting_snapshot_id,row]));
  for(const [actorName,kernel] of Object.entries(actors)){
    const evidence=await readWorkflowEvidence(kernel,scope,workflow.accounting_settings_workflow_id);
    assert.equal(evidence.schema_version,'ACCOUNTING_SETTINGS_WORKFLOW_EVIDENCE_V1',actorName);
    assert.equal(evidence.tenant_id,scope.tenantId);assert.equal(evidence.entity_id,scope.entityId);assert.equal(evidence.workflow_id,workflow.accounting_settings_workflow_id);assert.equal(evidence.period_id,target.periodId);
    assert.equal(evidence.canonical_parent_hash,workflow.canonical_parent_hash);assert.deepEqual(evidence.canonical_parent_snapshot,workflow.canonical_parent_snapshot);
    assert.equal(evidence.selected_child_snapshots.length,10);
    assert.deepEqual(evidence.selected_child_snapshots.map(row=>row.key),Object.keys(fixture.childRefs));
    for(const row of evidence.selected_child_snapshots){
      const expected=storedById.get(row.setting_snapshot_id),selected=fixture.childRefs[row.key];
      assert.ok(expected,`${actorName} received an unselected child`);assert.equal(row.setting_snapshot_id,selected.setting_snapshot_id);assert.equal(row.family,expected.family);
      assert.equal(row.version,expected.version);assert.equal(row.snapshot_hash,expected.snapshot_hash);assert.equal(row.status,expected.status);assert.equal(row.approved_by,expected.approved_by);
      assert.equal(Date.parse(row.approved_at),new Date(expected.approved_at).valueOf());assert.equal(Date.parse(row.effective_from),new Date(expected.effective_from).valueOf());assert.equal(Date.parse(row.effective_to),new Date(expected.effective_to).valueOf());assert.deepEqual(row.snapshot,expected.snapshot);
    }
  }
  const failedKeys=[];
  for(const [name,kernel] of Object.entries(actors))if(name!=='maker'){
    const key=`settings-evidence-create-denied-${name}`;failedKeys.push(key);
    await assert.rejects(kernel.createAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,childSettingSnapshotIds:childIds(fixture),reason:reason('Create'),idempotencyKey:key}),error=>error.code==='42501');
  }
  for(const [action,owner] of [['SUBMIT','submitter'],['REVIEW','reviewer'],['APPROVE','approver'],['ACTIVATE','activator']]){
    for(const [name,kernel] of Object.entries(actors))if(name!==owner){
      const key=`settings-evidence-${action.toLowerCase()}-denied-${name}`;failedKeys.push(key);
      await assert.rejects(kernel.transitionAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:workflow.accounting_settings_workflow_id,action,expectedRevision:Number(workflow.revision),reason:reason(action),idempotencyKey:key}),error=>error.code==='42501');
    }
    workflow=await transition(scope,actors,workflow,action,'settings-evidence-authority');
  }
  assert.equal(workflow.status,'ACTIVE');assert.equal((await adminPool.query('SELECT count(*)::int n FROM accounting_settings_workflow WHERE tenant_id=$1',[scope.tenantId])).rows[0].n,1);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM idempotency_receipt WHERE tenant_id=$1 AND idempotency_key=ANY($2::text[])',[scope.tenantId,failedKeys])).rows[0].n,0);
});

pgTest('workflow evidence detail rejects cross-tenant, cross-entity, and missing VIEW scopes',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31'),scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const maker=await roleKernel(scope,'settings-evidence-scope-maker','ACCOUNTING_SETTINGS_WORKFLOW_MAKER');
  const workflow=await maker.createAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,childSettingSnapshotIds:childIds(fixture),reason:reason('Create'),idempotencyKey:'settings-evidence-scope-create'});
  const noView=await syncPermissions(scope,'settings-evidence-no-view',['AI.ACCOUNTING.SETTINGS.VIEW'],'READ');
  await assert.rejects(readWorkflowEvidence(noView,scope,workflow.accounting_settings_workflow_id),error=>error.code==='42501');
  const otherEntity=await seedScope({tenantId:scope.tenantId,periods:[period('2026-08','2026-08-01','2026-08-31')]});
  const otherEntityViewer=await roleKernel(otherEntity,'settings-evidence-other-entity','ACCOUNTING_SETTINGS_WORKFLOW_VIEWER');
  await assert.rejects(readWorkflowEvidence(otherEntityViewer,otherEntity,workflow.accounting_settings_workflow_id),error=>error.code==='P0002');
  const otherTenant=await seedScope({periods:[period('2026-08','2026-08-01','2026-08-31')]});
  const otherTenantViewer=await roleKernel(otherTenant,'settings-evidence-other-tenant','ACCOUNTING_SETTINGS_WORKFLOW_VIEWER');
  await assert.rejects(readWorkflowEvidence(otherTenantViewer,otherTenant,workflow.accounting_settings_workflow_id),error=>error.code==='P0002');
});

pgTest('workflow evidence detail returns SQL 23514 for isolated selected-body or canonical-reference corruption',async()=>{
  const create=async prefix=>{
    const target=period('2026-08','2026-08-01','2026-08-31'),scope=await seedScope({periods:[target]});
    const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
    const maker=await roleKernel(scope,`${prefix}-maker`,'ACCOUNTING_SETTINGS_WORKFLOW_MAKER');
    const workflow=await maker.createAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,childSettingSnapshotIds:childIds(fixture),reason:reason('Create'),idempotencyKey:`${prefix}-create`});
    return {scope,fixture,maker,workflow};
  };
  const bodyDrift=await create('settings-evidence-body-drift');
  await adminPool.query('ALTER TABLE setting_snapshot DISABLE TRIGGER USER');
  try{await adminPool.query("UPDATE setting_snapshot SET snapshot=snapshot||'{\"tampered\":true}'::jsonb WHERE setting_snapshot_id=$1",[bodyDrift.fixture.childRefs.tax.setting_snapshot_id]);}
  finally{await adminPool.query('ALTER TABLE setting_snapshot ENABLE TRIGGER USER');}
  await assert.rejects(readWorkflowEvidence(bodyDrift.maker,bodyDrift.scope,bodyDrift.workflow.accounting_settings_workflow_id),error=>error.code==='23514');

  const refDrift=await create('settings-evidence-ref-drift');
  await adminPool.query('ALTER TABLE accounting_settings_workflow DISABLE TRIGGER USER');
  try{await adminPool.query("UPDATE accounting_settings_workflow SET child_setting_snapshot_ids=jsonb_set(child_setting_snapshot_ids,'{tax}',to_jsonb($2::text)) WHERE accounting_settings_workflow_id=$1",[refDrift.workflow.accounting_settings_workflow_id,randomUUID()]);}
  finally{await adminPool.query('ALTER TABLE accounting_settings_workflow ENABLE TRIGGER USER');}
  await assert.rejects(readWorkflowEvidence(refDrift.maker,refDrift.scope,refDrift.workflow.accounting_settings_workflow_id),error=>error.code==='23514');
});

pgTest('workflow table rejects every incoherent state, actor, timestamp, parent, and supersession shape',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31'),scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const actors=await lifecycleActors(scope,'settings-table-constraints');
  const template=await createDraft(scope,target,fixture,actors,'settings-table-constraints');
  const at='2026-08-02T00:00:00.000Z',legacyParentId=fixture.childRefs.tax.setting_snapshot_id;
  let version=100;
  const insert=overrides=>{
    const row={id:randomUUID(),status:'DRAFT',revision:0,legacyParentId:null,createdBy:'constraint-maker',createdAt:at,submittedBy:null,submittedAt:null,reviewedBy:null,reviewedAt:null,approvedBy:null,approvedAt:null,activatedBy:null,activatedAt:null,supersededBy:null,supersededAt:null,...overrides};
    return adminPool.query("INSERT INTO accounting_settings_workflow(accounting_settings_workflow_id,tenant_id,entity_id,period_id,version,status,revision,child_setting_snapshot_ids,canonical_parent_snapshot,canonical_parent_hash,legacy_parent_setting_snapshot_id,created_by,created_at,submitted_by,submitted_at,reviewed_by,reviewed_at,approved_by,approved_at,activated_by,activated_at,superseded_by_workflow_id,superseded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)",[row.id,scope.tenantId,scope.entityId,target.periodId,version++,row.status,row.revision,template.child_setting_snapshot_ids,template.canonical_parent_snapshot,template.canonical_parent_hash,row.legacyParentId,row.createdBy,row.createdAt,row.submittedBy,row.submittedAt,row.reviewedBy,row.reviewedAt,row.approvedBy,row.approvedAt,row.activatedBy,row.activatedAt,row.supersededBy,row.supersededAt]);
  };
  const submitted={status:'SUBMITTED',revision:1,submittedBy:'constraint-submitter',submittedAt:at};
  const reviewed={...submitted,status:'REVIEWED',revision:2,reviewedBy:'constraint-reviewer',reviewedAt:at};
  const approved={...reviewed,status:'APPROVED',revision:3,approvedBy:'constraint-approver',approvedAt:at};
  const active={...approved,status:'ACTIVE',revision:4,activatedBy:'constraint-activator',activatedAt:at,legacyParentId};
  const otherTarget=period('2026-08','2026-08-01','2026-08-31');
  const otherScope=await seedScope({tenantId:scope.tenantId,periods:[otherTarget]});
  const otherEntitySuccessorId=randomUUID();
  await adminPool.query("INSERT INTO accounting_settings_workflow(accounting_settings_workflow_id,tenant_id,entity_id,period_id,version,status,revision,child_setting_snapshot_ids,canonical_parent_snapshot,canonical_parent_hash,created_by) VALUES($1,$2,$3,$4,1,'DRAFT',0,$5::jsonb,$6::jsonb,$7,'other-entity-successor')",[otherEntitySuccessorId,scope.tenantId,otherScope.entityId,otherTarget.periodId,template.child_setting_snapshot_ids,template.canonical_parent_snapshot,template.canonical_parent_hash]);
  const failures=[
    {label:'invalid-status',row:{status:'RETIRED'},code:'23514'},
    {label:'negative-revision',row:{revision:-1},code:'23514'},
    {label:'draft-wrong-revision',row:{revision:1},code:'23514'},
    {label:'status-revision',row:{...submitted,revision:0},code:'23514'},
    {label:'reviewed-wrong-revision',row:{...reviewed,revision:1},code:'23514'},
    {label:'approved-wrong-revision',row:{...approved,revision:2},code:'23514'},
    {label:'active-wrong-revision',row:{...active,revision:3},code:'23514'},
    {label:'missing-stage-actor',row:{status:'SUBMITTED',revision:1},code:'23514'},
    {label:'actor-without-timestamp',row:{status:'SUBMITTED',revision:1,submittedBy:'constraint-submitter'},code:'23514'},
    {label:'timestamp-without-actor',row:{status:'SUBMITTED',revision:1,submittedAt:at},code:'23514'},
    {label:'later-actor-without-timestamp',row:{...reviewed,reviewedAt:null},code:'23514'},
    {label:'later-timestamp-without-actor',row:{...reviewed,reviewedBy:null},code:'23514'},
    {label:'future-stage-on-draft',row:{submittedBy:'constraint-submitter',submittedAt:at},code:'23514'},
    {label:'submitter-equals-maker',row:{...submitted,submittedBy:'constraint-maker'},code:'23514'},
    {label:'reviewer-reused',row:{...reviewed,reviewedBy:'constraint-submitter'},code:'23514'},
    {label:'approver-reused',row:{...approved,approvedBy:'constraint-reviewer'},code:'23514'},
    {label:'activator-reused',row:{...active,activatedBy:'constraint-approver'},code:'23514'},
    {label:'draft-with-parent',row:{legacyParentId},code:'23514'},
    {label:'active-without-parent',row:{...active,legacyParentId:null},code:'23514'},
    {label:'active-missing-parent-fk',row:{...active,legacyParentId:randomUUID()},code:'23503'},
    {label:'active-with-supersession',row:{...active,id:randomUUID(),supersededBy:null,supersededAt:at},code:'23514'},
    {label:'superseded-without-timestamp',row:{...active,status:'SUPERSEDED',revision:5,supersededBy:template.accounting_settings_workflow_id},code:'23514'},
    {label:'superseded-self-reference',row:{...active,status:'SUPERSEDED',revision:5,id:null,supersededAt:at},self:true,code:'23514'},
    {label:'superseded-cross-entity-fk',row:{...active,status:'SUPERSEDED',revision:5,supersededBy:otherEntitySuccessorId,supersededAt:at},code:'23503'},
    {label:'superseded-missing-fk',row:{...active,status:'SUPERSEDED',revision:5,supersededBy:randomUUID(),supersededAt:at},code:'23503'}
  ];
  for(const failure of failures){
    const row={...failure.row};
    if(failure.self){row.id=randomUUID();row.supersededBy=row.id;}
    if(failure.label==='active-with-supersession')row.supersededBy=row.id;
    await assert.rejects(insert(row),error=>error.code===failure.code,failure.label);
  }
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM accounting_settings_workflow WHERE tenant_id=$1 AND entity_id=$2',[scope.tenantId,scope.entityId])).rows[0].n,1);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM accounting_settings_workflow WHERE tenant_id=$1 AND entity_id=$2 AND accounting_settings_workflow_id=$3',[scope.tenantId,otherScope.entityId,otherEntitySuccessorId])).rows[0].n,1);
});

pgTest('history table rejects noncanonical transitions, revisions, predecessor presence, actors, and reasons',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31'),scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const actors=await lifecycleActors(scope,'settings-history-constraints');
  const template=await createDraft(scope,target,fixture,actors,'settings-history-constraints');
  const workflowId=randomUUID();
  await adminPool.query("INSERT INTO accounting_settings_workflow(accounting_settings_workflow_id,tenant_id,entity_id,period_id,version,status,revision,child_setting_snapshot_ids,canonical_parent_snapshot,canonical_parent_hash,created_by) VALUES($1,$2,$3,$4,99,'DRAFT',0,$5::jsonb,$6::jsonb,$7,'history-constraint-maker')",[workflowId,scope.tenantId,scope.entityId,target.periodId,template.child_setting_snapshot_ids,template.canonical_parent_snapshot,template.canonical_parent_hash]);
  const hash=`sha256:${'a'.repeat(64)}`,validReason='Retain exact workflow transition evidence.';
  const insert=({revision=1,fromStatus='DRAFT',toStatus='SUBMITTED',actorId='history-constraint-actor',reasonText=validReason,previousHash=hash}={})=>adminPool.query('INSERT INTO accounting_settings_workflow_history(accounting_settings_workflow_id,tenant_id,from_status,to_status,revision,actor_id,reason,previous_event_hash,event_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[workflowId,scope.tenantId,fromStatus,toStatus,revision,actorId,reasonText,previousHash,hash]);
  const failures=[
    {label:'negative-revision',row:{revision:-1,fromStatus:null,toStatus:'DRAFT',previousHash:null}},
    {label:'revision-zero-transition',row:{revision:0,fromStatus:'DRAFT',toStatus:'SUBMITTED',previousHash:null}},
    {label:'revision-one-transition',row:{revision:1,fromStatus:'DRAFT',toStatus:'REVIEWED'}},
    {label:'revision-two-transition',row:{revision:2,fromStatus:'DRAFT',toStatus:'REVIEWED'}},
    {label:'revision-three-transition',row:{revision:3,fromStatus:'REVIEWED',toStatus:'ACTIVE'}},
    {label:'revision-four-transition',row:{revision:4,fromStatus:'APPROVED',toStatus:'SUPERSEDED'}},
    {label:'revision-five-transition',row:{revision:5,fromStatus:'ACTIVE',toStatus:'ACTIVE'}},
    {label:'unsupported-revision',row:{revision:6,fromStatus:'SUPERSEDED',toStatus:'ACTIVE'}},
    {label:'initial-with-predecessor',row:{revision:0,fromStatus:null,toStatus:'DRAFT',previousHash:hash}},
    {label:'later-without-predecessor',row:{revision:1,previousHash:null}},
    {label:'empty-actor',row:{actorId:''}},
    {label:'padded-actor',row:{actorId:' padded-actor '}},
    {label:'control-actor',row:{actorId:'control\nactor'}},
    {label:'long-actor',row:{actorId:'a'.repeat(301)}},
    {label:'short-reason',row:{reasonText:'short'}},
    {label:'padded-reason',row:{reasonText:' padded retained reason '}},
    {label:'control-reason',row:{reasonText:'Retained\nreason evidence.'}},
    {label:'long-reason',row:{reasonText:'r'.repeat(2001)}}
  ];
  for(const failure of failures)await assert.rejects(insert(failure.row),error=>error.code==='23514',failure.label);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1',[workflowId])).rows[0].n,0);
});

pgTest('an inactive entity makes the workflow payload non-actionable and rejects create or transition without residue',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31'),scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const actors=await lifecycleActors(scope,'settings-inactive-entity');
  const draft=await createDraft(scope,target,fixture,actors,'settings-inactive-entity');
  await adminPool.query('UPDATE entity SET active=false WHERE tenant_id=$1 AND entity_id=$2',[scope.tenantId,scope.entityId]);
  const payload=await actors.submitter.readAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:draft.accounting_settings_workflow_id});
  assert.equal(payload.source_current,false);assert.deepEqual(payload.action_flags,{can_submit:false,can_review:false,can_approve:false,can_activate:false});
  const options=await actors.maker.readAccountingSettingsWorkflowOptions({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId});assert.equal(options.action_flags.can_create_draft,false);
  await assert.rejects(createDraft(scope,target,fixture,actors,'settings-inactive-new'),error=>error.code==='P0002');
  await assert.rejects(transition(scope,actors,draft,'SUBMIT','settings-inactive-transition'),error=>error.code==='P0002');
  const unchanged=(await adminPool.query("SELECT status,revision::int revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key IN('settings-inactive-new-create','settings-inactive-transition-submit')) failed_audit,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key IN('settings-inactive-new-create','settings-inactive-transition-submit')) failed_receipts FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$1",[draft.accounting_settings_workflow_id])).rows[0];
  assert.deepEqual(unchanged,{status:'DRAFT',revision:0,history:1,failed_audit:0,failed_receipts:0});
});

pgTest('OPEN child evidence remains historically readable after SOFT_CLOSED or CLOSED while all effective actions stay false',async()=>{
  for(const periodStatus of ['SOFT_CLOSED','CLOSED']){
    const target=period('2026-08','2026-08-01','2026-08-31');
    const scope=await seedScope({periods:[target]});
    const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
    const actors=await lifecycleActors(scope,`settings-history-${periodStatus.toLowerCase()}`);
    let workflow=await createDraft(scope,target,fixture,actors,`settings-history-${periodStatus.toLowerCase()}`);
    workflow=await advance(scope,actors,workflow,`settings-history-${periodStatus.toLowerCase()}`,'ACTIVATE');
    await adminPool.query("UPDATE accounting_period SET status=$2::period_status,closed_by='period-controller',closed_at=clock_timestamp(),version=version+1 WHERE period_id=$1",[target.periodId,periodStatus]);
    const aiReader=await syncPermissions(scope,`settings-history-reader-${periodStatus.toLowerCase()}`,['AI.ACCOUNTING.SETTINGS.VIEW'],'READ');
    const settings=await aiReader.readApprovedWbsAiEntityPeriodSettings({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,readOnly:true});
    assert.equal(settings.period_status,periodStatus);
    assert.equal(settings.period_close_policy.settings.period_status,'OPEN');
    assert.equal(settings.period_close_policy.settings.allow_post,true);
    assert.deepEqual({can_create_draft:settings.can_create_draft,can_review:settings.can_review,can_approve:settings.can_approve,can_post:settings.can_post},{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
    const closedWorkflow=await actors.submitter.readAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:workflow.accounting_settings_workflow_id});
    assert.equal(closedWorkflow.target_period_status,periodStatus);
    assert.deepEqual(closedWorkflow.action_flags,{can_submit:false,can_review:false,can_approve:false,can_activate:false});
    const options=await actors.maker.readAccountingSettingsWorkflowOptions({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId});
    assert.equal(options.action_flags.can_create_draft,false);
  }
});

pgTest('workflow boundaries require a PRIMARY ledger and reject an overlapping PRIMARY period without residue',async()=>{
  const secondary={...period('2097-01','2097-01-01','2097-01-31'),ledgerCode:'SECONDARY'};
  const secondaryScope=await seedScope({periods:[secondary]});
  const secondaryFixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...secondaryScope,periodId:secondary.periodId},companyCode:secondaryScope.sourceEntityId,settingsVersion:1,includeParent:false});
  const secondaryActors=await lifecycleActors(secondaryScope,'settings-secondary-ledger');
  await assert.rejects(secondaryActors.maker.readAccountingSettingsWorkflowOptions({tenantId:secondaryScope.tenantId,entityId:secondaryScope.entityId,periodId:secondary.periodId}),error=>error.code==='23514'&&/PRIMARY ledger period/i.test(error.message));
  await assert.rejects(createDraft(secondaryScope,secondary,secondaryFixture,secondaryActors,'settings-secondary-ledger'),error=>error.code==='23514');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM accounting_settings_workflow WHERE tenant_id=$1',[secondaryScope.tenantId])).rows[0].n,0);

  const target=period('2097-02','2097-02-01','2097-02-28');
  const overlap=period('2097-03','2097-02-15','2097-03-14');
  const scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const actors=await lifecycleActors(scope,'settings-overlap-ledger');
  const draft=await createDraft(scope,target,fixture,actors,'settings-overlap-ledger');
  await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status,ledger_code) VALUES($1,$2,$3,$4,$5,$6,'OPEN','PRIMARY')",[overlap.periodId,scope.tenantId,scope.entityId,overlap.code,overlap.start,overlap.end]);
  await assert.rejects(actors.maker.readAccountingSettingsWorkflowOptions({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId}),error=>error.code==='23514'&&/overlaps another period/i.test(error.message));
  await assert.rejects(createDraft(scope,target,fixture,actors,'settings-overlap-create'),error=>error.code==='23514');
  await assert.rejects(transition(scope,actors,draft,'SUBMIT','settings-overlap-transition'),error=>error.code==='23514');
  const unchanged=(await adminPool.query("SELECT status,revision::int revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key IN('settings-overlap-create-create','settings-overlap-transition-submit')) failed_audit,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key IN('settings-overlap-create-create','settings-overlap-transition-submit')) failed_receipts FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$1",[draft.accounting_settings_workflow_id])).rows[0];
  assert.deepEqual(unchanged,{status:'DRAFT',revision:0,history:1,failed_audit:0,failed_receipts:0});
});

pgTest('public history rejects legacy parents outside exact ENTITY scope',async()=>{
  const variants=[
    {label:'tenant-scope',scopeType:'TENANT',scopeKey:null},
    {label:'wrong-entity-key',scopeType:'ENTITY',scopeKey:randomUUID()}
  ];
  for(const variant of variants){
    const target=period('2026-08','2026-08-01','2026-08-31'),scope=await seedScope({periods:[target]});
    const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
    await insertParentSnapshot(scope,target,fixture,{scopeType:variant.scopeType,scopeKey:variant.scopeKey||scope.tenantId});
    const reader=await syncPermissions(scope,`settings-malformed-parent-reader-${variant.label}`,['AI.ACCOUNTING.SETTINGS.VIEW'],'READ');
    await assert.rejects(reader.readApprovedWbsAiEntityPeriodSettings({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,readOnly:true}),error=>error.code==='23514'&&/Exactly one approved AI entity-period settings snapshot/i.test(error.message));
    const maker=await roleKernel(scope,`settings-malformed-parent-maker-${variant.label}`,'ACCOUNTING_SETTINGS_WORKFLOW_MAKER');
    const options=await maker.readAccountingSettingsWorkflowOptions({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId});
    assert.equal(options.blockers.forward_legacy_parent_setting_snapshot_id,null);
  }
});

pgTest('generic retirement protects an ACTIVE workflow parent and bound child but permits the child after coverage',async()=>{
  const target=period('2099-01','2099-01-01','2099-01-31'),following=period('2099-02','2099-02-01','2099-02-28');
  const scope=await seedScope({periods:[target,following]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const actors=await lifecycleActors(scope,'settings-generic-retire');
  let active=await createDraft(scope,target,fixture,actors,'settings-generic-retire');
  active=await advance(scope,actors,active,'settings-generic-retire','ACTIVATE');
  const retirer=await syncPermissions(scope,'settings-generic-retirer',['CONFIG.SNAPSHOT.RETIRE'],'CONFIG_RETIRE');
  const base={kind:'SETTING',tenantId:scope.tenantId,entityId:scope.entityId,expectedRevision:0,reason:'Retire only after the authoritative workflow coverage boundary.'};
  await assert.rejects(retirer.retireConfigSnapshot({...base,snapshotId:active.legacy_parent_setting_snapshot_id,cutoff:'2099-02-01T00:00:00.000Z',idempotencyKey:'settings-retire-active-parent'}),error=>error.code==='42501'&&/forward workflow activation/i.test(error.message));
  const childId=fixture.childRefs.tax.setting_snapshot_id;
  await assert.rejects(retirer.retireConfigSnapshot({...base,snapshotId:childId,cutoff:'2099-01-15T00:00:00.000Z',idempotencyKey:'settings-retire-bound-child'}),error=>error.code==='42501'&&/must cover its bound period/i.test(error.message));
  const retired=await retirer.retireConfigSnapshot({...base,snapshotId:childId,cutoff:'2099-02-01T00:00:00.000Z',idempotencyKey:'settings-retire-safe-child'});
  assert.equal(retired.status,'RETIRED');assert.equal(retired.idempotent,false);
  const state=(await adminPool.query("SELECT (SELECT status FROM setting_snapshot WHERE setting_snapshot_id=$1) parent_status,(SELECT status FROM setting_snapshot WHERE setting_snapshot_id=$2) child_status,(SELECT effective_to::date::text FROM setting_snapshot WHERE setting_snapshot_id=$2) child_effective_to,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key IN('settings-retire-active-parent','settings-retire-bound-child')) failed_receipts",[active.legacy_parent_setting_snapshot_id,childId])).rows[0];
  assert.deepEqual(state,{parent_status:'APPROVED',child_status:'RETIRED',child_effective_to:'2099-02-01',failed_receipts:0});
  const reader=await syncPermissions(scope,'settings-retired-child-history-reader',['AI.ACCOUNTING.SETTINGS.VIEW'],'READ');
  const history=await reader.readApprovedWbsAiEntityPeriodSettings({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,readOnly:true});
  assert.equal(history.tax.setting_snapshot_id,childId);assert.equal(history.tax.approval_status,'APPROVED');assert.equal(history.can_post,false);
});

pgTest('generic retirement also protects a SUPERSEDED workflow child through its bound period and permits the next boundary',async()=>{
  const january=period('2099-01','2099-01-01','2099-01-31'),february=period('2099-02','2099-02-01','2099-02-28');
  const scope=await seedScope({periods:[january,february]});
  const januaryFixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:january.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const januaryActors=await lifecycleActors(scope,'settings-superseded-child-old');
  let old=await createDraft(scope,january,januaryFixture,januaryActors,'settings-superseded-child-old');
  old=await advance(scope,januaryActors,old,'settings-superseded-child-old','ACTIVATE');
  const februaryFixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:february.periodId},companyCode:scope.sourceEntityId,settingsVersion:2,includeParent:false});
  const februaryActors=await lifecycleActors(scope,'settings-superseded-child-new');
  let current=await createDraft(scope,february,februaryFixture,februaryActors,'settings-superseded-child-new');
  current=await advance(scope,februaryActors,current,'settings-superseded-child-new','ACTIVATE');
  const superseded=await januaryActors.maker.readAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:old.accounting_settings_workflow_id});
  assert.equal(superseded.status,'SUPERSEDED');assert.equal(current.status,'ACTIVE');
  const childId=januaryFixture.childRefs.tax.setting_snapshot_id;
  const retirer=await syncPermissions(scope,'settings-superseded-child-retirer',['CONFIG.SNAPSHOT.RETIRE'],'CONFIG_RETIRE');
  const base={kind:'SETTING',tenantId:scope.tenantId,entityId:scope.entityId,snapshotId:childId,expectedRevision:0,reason:'Retire the superseded child only after its bound period.'};
  await assert.rejects(retirer.retireConfigSnapshot({...base,cutoff:'2099-01-15T00:00:00.000Z',idempotencyKey:'settings-retire-superseded-child-early'}),error=>error.code==='42501'&&/must cover its bound period/i.test(error.message));
  const retired=await retirer.retireConfigSnapshot({...base,cutoff:'2099-02-01T00:00:00.000Z',idempotencyKey:'settings-retire-superseded-child-safe'});
  assert.equal(retired.status,'RETIRED');
  const state=(await adminPool.query("SELECT status,effective_to::date::text effective_to,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key='settings-retire-superseded-child-early') failed_receipts FROM setting_snapshot WHERE setting_snapshot_id=$1",[childId])).rows[0];
  assert.deepEqual(state,{status:'RETIRED',effective_to:'2099-02-01',failed_receipts:0});
  const retained=await readWorkflowEvidence(januaryActors.maker,scope,old.accounting_settings_workflow_id);
  assert.equal(retained.selected_child_snapshots.find(row=>row.key==='tax').setting_snapshot_id,childId);
  assert.equal(retained.selected_child_snapshots.find(row=>row.key==='tax').status,'RETIRED');
});

pgTest('create waits for an uncommitted retained parent and observes commit or rollback without TOCTOU residue',async()=>{
  for(const disposition of ['commit','rollback']){
    const target=period('2098-08','2098-08-01','2098-08-31'),future=period('2098-09','2098-09-01','2098-09-30');
    const scope=await seedScope({periods:[target,future]});
    const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
    const actorId=`settings-create-toctou-${disposition}`;
    await roleKernel(scope,actorId,'ACCOUNTING_SETTINGS_WORKFLOW_MAKER');
    let waiterPid=null,connectedResolve;const connected=new Promise(resolve=>{connectedResolve=resolve;});
    const observedPool={connect:async()=>{const client=await runtimePool.connect();waiterPid=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;connectedResolve();return client;}};
    const maker=await issueKernel(scope,actorId,observedPool),parentClient=await adminPool.connect();let parentOpen=false,createPromise=null;
    try{
      await parentClient.query('BEGIN');parentOpen=true;
      const holderPid=(await parentClient.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await insertParentSnapshot(scope,disposition==='commit'?target:future,fixture,{version:2,queryable:parentClient});
      const key=`settings-create-toctou-${disposition}`;
      createPromise=outcome(maker.createAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,childSettingSnapshotIds:childIds(fixture),reason:reason('Create'),idempotencyKey:key}));
      await connected;
      await waitBlocked(holderPid,waiterPid,`Create must wait for the ${disposition} parent transaction`);
      await parentClient.query(disposition==='commit'?'COMMIT':'ROLLBACK');parentOpen=false;
      const result=await createPromise;createPromise=null;
      if(disposition==='commit'){
        assert.equal(result.error?.code,'55000');assert.match(result.error?.message||'',/Same-period accounting settings replacement|strictly later than retained parent history/i);
        const empty=(await adminPool.query("SELECT (SELECT count(*)::int FROM accounting_settings_workflow WHERE tenant_id=$1) workflow,(SELECT count(*)::int FROM accounting_settings_workflow_history h JOIN accounting_settings_workflow w ON w.accounting_settings_workflow_id=h.accounting_settings_workflow_id WHERE w.tenant_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND idempotency_key=$2) audit,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND aggregate_type='ACCOUNTING_SETTINGS_WORKFLOW') outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE tenant_id=$1 AND idempotency_key=$2) receipt",[scope.tenantId,key])).rows[0];
        assert.deepEqual(empty,{workflow:0,history:0,audit:0,outbox:0,receipt:0});
      }else{
        assert.equal(result.error,undefined);assert.equal(result.value.status,'DRAFT');assert.equal(result.value.idempotent,false);
        const created=(await adminPool.query("SELECT (SELECT count(*)::int FROM accounting_settings_workflow WHERE tenant_id=$1) workflow,(SELECT count(*)::int FROM accounting_settings_workflow_history h JOIN accounting_settings_workflow w ON w.accounting_settings_workflow_id=h.accounting_settings_workflow_id WHERE w.tenant_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND idempotency_key=$2) audit,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND aggregate_id=$3) outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE tenant_id=$1 AND idempotency_key=$2 AND status='SUCCEEDED') receipt",[scope.tenantId,key,result.value.accounting_settings_workflow_id])).rows[0];
        assert.deepEqual(created,{workflow:1,history:1,audit:1,outbox:1,receipt:1});
      }
    }finally{
      if(parentOpen)await parentClient.query('ROLLBACK').catch(()=>{});
      parentClient.release();
      if(createPromise)await createPromise;
    }
  }
});

pgTest('migration down smoke drops guarded workflow objects in dependency order and rollback restores them',async()=>{
  const sql=stripTransaction(await rollbackSql()),client=await adminPool.connect();let open=false;
  try{
    await client.query('BEGIN');open=true;
    await client.query(sql);
    const dropped=(await client.query("SELECT to_regclass('accounting_settings_workflow') workflow_table,to_regclass('accounting_settings_workflow_history') history_table,to_regprocedure('refs_read_accounting_settings_workflow(uuid,uuid,uuid)') workflow_reader,to_regprocedure('refs_read_accounting_settings_workflow_evidence(uuid,uuid,uuid)') evidence_reader,to_regprocedure('refs_protect_workflow_owned_accounting_settings_parent()') parent_guard,(SELECT count(*)::int FROM permission_catalog WHERE permission_code LIKE 'ACCOUNTING.SETTINGS.WORKFLOW.%' AND active) active_permissions")).rows[0];
    assert.deepEqual(dropped,{workflow_table:null,history_table:null,workflow_reader:null,evidence_reader:null,parent_guard:null,active_permissions:0});
    await client.query('ROLLBACK');open=false;
    const restored=(await adminPool.query("SELECT to_regclass('accounting_settings_workflow')::text workflow_table,to_regclass('accounting_settings_workflow_history')::text history_table,to_regprocedure('refs_read_accounting_settings_workflow(uuid,uuid,uuid)')::text workflow_reader,to_regprocedure('refs_read_accounting_settings_workflow_evidence(uuid,uuid,uuid)')::text evidence_reader,to_regprocedure('refs_protect_workflow_owned_accounting_settings_parent()')::text parent_guard,(SELECT count(*)::int FROM permission_catalog WHERE permission_code LIKE 'ACCOUNTING.SETTINGS.WORKFLOW.%' AND active) active_permissions")).rows[0];
    assert.deepEqual(restored,{workflow_table:'accounting_settings_workflow',history_table:'accounting_settings_workflow_history',workflow_reader:'refs_read_accounting_settings_workflow(uuid,uuid,uuid)',evidence_reader:'refs_read_accounting_settings_workflow_evidence(uuid,uuid,uuid)',parent_guard:'refs_protect_workflow_owned_accounting_settings_parent()',active_permissions:6});
  }finally{if(open)await client.query('ROLLBACK').catch(()=>{});client.release();}
});

pgTest('forward_only_conflict aligns options, create, workflow flags, and activation rejection',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31'),future=period('2026-09','2026-09-01','2026-09-30');
  const scope=await seedScope({periods:[target,future]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const actors=await lifecycleActors(scope,'settings-forward-conflict');
  let workflow=await createDraft(scope,target,fixture,actors,'settings-forward-conflict');
  workflow=await advance(scope,actors,workflow,'settings-forward-conflict','APPROVE');
  await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:future.periodId},companyCode:scope.sourceEntityId,settingsVersion:2,includeParent:true});
  const options=await actors.maker.readAccountingSettingsWorkflowOptions({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId});
  assert.equal(options.blockers.same_period_activation_exists,false);assert.equal(options.blockers.forward_only_conflict,true);assert.equal(options.action_flags.can_create_draft,false);
  await assert.rejects(createDraft(scope,target,fixture,actors,'settings-forward-conflict-new'),error=>error.code==='55000'&&/strictly later than retained parent history/i.test(error.message));
  const visible=await actors.activator.readAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:workflow.accounting_settings_workflow_id});
  assert.deepEqual(visible.action_flags,{can_submit:false,can_review:false,can_approve:false,can_activate:false});
  await assert.rejects(transition(scope,actors,workflow,'ACTIVATE','settings-forward-conflict'),error=>error.code==='55000'&&/strictly later than all retained parent history/i.test(error.message));
  const unchanged=(await adminPool.query("SELECT status,revision::int revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key IN('settings-forward-conflict-new-create','settings-forward-conflict-activate')) failed_audit,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key IN('settings-forward-conflict-new-create','settings-forward-conflict-activate')) failed_receipts FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$1",[workflow.accounting_settings_workflow_id])).rows[0];
  assert.deepEqual(unchanged,{status:'APPROVED',revision:3,history:4,failed_audit:0,failed_receipts:0});
});

pgTest('a later ACTIVE workflow blocks stale Draft Submitted and Reviewed transitions without residue',async()=>{
  const august=period('2026-08','2026-08-01','2026-08-31'),september=period('2026-09','2026-09-01','2026-09-30');
  const scope=await seedScope({periods:[august,september]});
  const augustFixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:august.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const prepared=[];
  for(const item of [
    {label:'draft',through:null,action:'SUBMIT',actor:'submitter'},
    {label:'submitted',through:'SUBMIT',action:'REVIEW',actor:'reviewer'},
    {label:'reviewed',through:'REVIEW',action:'APPROVE',actor:'approver'}
  ]){
    const prefix=`settings-later-active-old-${item.label}`,actors=await lifecycleActors(scope,prefix);
    let workflow=await createDraft(scope,august,augustFixture,actors,prefix);
    if(item.through)workflow=await advance(scope,actors,workflow,prefix,item.through);
    prepared.push({...item,prefix,actors,workflow});
  }

  const septemberFixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:september.periodId},companyCode:scope.sourceEntityId,settingsVersion:2,includeParent:false});
  const laterActors=await lifecycleActors(scope,'settings-later-active-new');
  let later=await createDraft(scope,september,septemberFixture,laterActors,'settings-later-active-new');
  later=await advance(scope,laterActors,later,'settings-later-active-new','ACTIVATE');
  assert.equal(later.status,'ACTIVE');

  for(const item of prepared){
    const before=(await adminPool.query("SELECT status,revision::int revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM outbox_event WHERE aggregate_id=$1) outbox",[item.workflow.accounting_settings_workflow_id])).rows[0];
    const visible=await item.actors[item.actor].readAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:item.workflow.accounting_settings_workflow_id});
    assert.deepEqual(visible.action_flags,{can_submit:false,can_review:false,can_approve:false,can_activate:false},item.label);
    const key=`${item.prefix}-${item.action.toLowerCase()}-after-later-active`;
    await assert.rejects(item.actors[item.actor].transitionAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:item.workflow.accounting_settings_workflow_id,action:item.action,expectedRevision:Number(item.workflow.revision),reason:reason(item.action),idempotencyKey:key}),error=>error.code==='55000'&&/strictly later than all retained (?:parent|workflow) history/i.test(error.message),item.label);
    const after=(await adminPool.query("SELECT status,revision::int revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key=$2) failed_audit,(SELECT count(*)::int FROM outbox_event WHERE aggregate_id=$1) outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key=$2) failed_receipt",[item.workflow.accounting_settings_workflow_id,key])).rows[0];
    assert.deepEqual(after,{...before,failed_audit:0,failed_receipt:0},item.label);
  }
});

pgTest('concurrent same-period activation leaves exactly one ACTIVE winner and no loser command residue',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31');
  const scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const actorSets=[];
  for(const label of ['a','b']){
    const actors=await lifecycleActors(scope,`settings-race-${label}`);
    let workflow=await createDraft(scope,target,fixture,actors,`settings-race-${label}`);
    workflow=await advance(scope,actors,workflow,`settings-race-${label}`,'APPROVE');
    actorSets.push({label,actors,workflow});
  }
  const outcomes=await Promise.allSettled(actorSets.map(({label,actors,workflow})=>transition(scope,actors,workflow,'ACTIVATE',`settings-race-${label}`)));
  assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(value=>value.status==='rejected'&&value.reason?.code==='55000').length,1);
  const winner=outcomes.find(value=>value.status==='fulfilled').value;
  const loserIndex=outcomes.findIndex(value=>value.status==='rejected'),loser=actorSets[loserIndex];
  const state=(await adminPool.query("SELECT (SELECT count(*)::int FROM accounting_settings_workflow WHERE tenant_id=$1 AND entity_id=$2 AND status='ACTIVE') active_count,(SELECT status FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$3) loser_status,(SELECT revision::int FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$3) loser_revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$3) loser_history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key=$4) loser_audit,(SELECT count(*)::int FROM outbox_event WHERE aggregate_id=$3) loser_outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key=$4) loser_idempotency",[scope.tenantId,scope.entityId,loser.workflow.accounting_settings_workflow_id,`settings-race-${loser.label}-activate`])).rows[0];
  assert.deepEqual(state,{active_count:1,loser_status:'APPROVED',loser_revision:3,loser_history:4,loser_audit:0,loser_outbox:4,loser_idempotency:0});
  assert.equal(winner.status,'ACTIVE');
});

pgTest('migration 374 refuses rollback after retained workflow evidence',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31');
  const scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const actors=await lifecycleActors(scope,'settings-rollback');
  await createDraft(scope,target,fixture,actors,'settings-rollback');
  const sql=(await rollbackSql()).replace(/^\s*BEGIN;\s*/i,'').replace(/\s*COMMIT;\s*$/i,'');
  const client=await adminPool.connect();
  try{
    await client.query('BEGIN');
    await assert.rejects(client.query(sql),error=>error.code==='55000'&&/retained accounting settings workflow evidence/i.test(error.message));
  }finally{
    try{await client.query('ROLLBACK');}finally{client.release();}
  }
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM accounting_settings_workflow WHERE tenant_id=$1',[scope.tenantId])).rows[0].n,1);
});

pgTest('down-first migration barrier blocks grant sync until rollback restores the permission and workflow schema',async()=>{
  const scope=await seedScope({periods:[period('2026-08','2026-08-01','2026-08-31')]});
  const sql=stripTransaction(await rollbackSql()),downClient=await adminPool.connect();
  let downOpen=false,grantPromise=null;
  try{
    await downClient.query('BEGIN');downOpen=true;
    const downPid=(await downClient.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    await downClient.query(sql);
    let grantPid=null,connectedResolve;const connected=new Promise(resolve=>{connectedResolve=resolve;});
    const observedPool={connect:async()=>{const client=await grantSyncPool.connect();grantPid=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;connectedResolve();return client;}};
    const sync=new PostgresGrantSync(observedPool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
    grantPromise=outcome(sync.reconcile({tenantId:scope.tenantId,entityId:scope.entityId,actorId:'settings-down-first-grantee',permissions:['ACCOUNTING.SETTINGS.WORKFLOW.VIEW'],authorityClass:'READ',validUntil:new Date(Date.now()+60*60*1000).toISOString(),expectedVersion:0,idempotencyKey:'settings-down-first-grant'}));
    await connected;
    await waitBlocked(downPid,grantPid,'Grant sync must wait behind the down migration permission_catalog barrier');
    await downClient.query('ROLLBACK');downOpen=false;
    const granted=await grantPromise;grantPromise=null;
    assert.equal(granted.error,undefined);assert.deepEqual(granted.value.permissions,['ACCOUNTING.SETTINGS.WORKFLOW.VIEW']);
    const restored=(await adminPool.query("SELECT to_regclass('accounting_settings_workflow') workflow_table,(SELECT active FROM permission_catalog WHERE permission_code='ACCOUNTING.SETTINGS.WORKFLOW.VIEW') permission_active")).rows[0];
    assert.deepEqual(restored,{workflow_table:'accounting_settings_workflow',permission_active:true});
  }finally{
    if(downOpen)await downClient.query('ROLLBACK').catch(()=>{});
    downClient.release();
    if(grantPromise)await grantPromise;
  }
});

pgTest('grant-first transaction blocks down until commit and then makes retained grant evidence reject rollback',async()=>{
  const scope=await seedScope({periods:[period('2026-08','2026-08-01','2026-08-31')]});
  const sql=stripTransaction(await rollbackSql());
  let releaseCommit=()=>{},heldResolve,grantPid=null;
  const held=new Promise(resolve=>{heldResolve=resolve;}),barrier=new Promise(resolve=>{releaseCommit=resolve;});
  const heldPool={connect:async()=>{
    const client=await grantSyncPool.connect();grantPid=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    return {query:async(...args)=>{if(args[0]==='COMMIT'){heldResolve();await barrier;}return client.query(...args);},release:()=>client.release()};
  }};
  const sync=new PostgresGrantSync(heldPool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
  const grantPromise=outcome(sync.reconcile({tenantId:scope.tenantId,entityId:scope.entityId,actorId:'settings-grant-first-grantee',permissions:['ACCOUNTING.SETTINGS.WORKFLOW.VIEW'],authorityClass:'READ',validUntil:new Date(Date.now()+60*60*1000).toISOString(),expectedVersion:0,idempotencyKey:'settings-grant-first-grant'}));
  const downClient=await adminPool.connect();let downOpen=false,downPromise=null;
  try{
    await held;
    await downClient.query('BEGIN');downOpen=true;
    const downPid=(await downClient.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    downPromise=outcome(downClient.query(sql));
    await waitBlocked(grantPid,downPid,'Down migration must wait behind the in-flight grant permission_catalog read');
    releaseCommit();
    const granted=await grantPromise;assert.equal(granted.error,undefined);
    const rejected=await downPromise;downPromise=null;
    assert.equal(rejected.error?.code,'55000');assert.match(rejected.error?.message||'',/retained accounting settings workflow evidence/i);
    await downClient.query('ROLLBACK');downOpen=false;
    const retained=(await adminPool.query("SELECT (SELECT count(*)::int FROM runtime_actor_grant WHERE tenant_id=$1 AND actor_id='settings-grant-first-grantee' AND permission='ACCOUNTING.SETTINGS.WORKFLOW.VIEW' AND revoked_at IS NULL) grants,to_regclass('accounting_settings_workflow') workflow_table",[scope.tenantId])).rows[0];
    assert.deepEqual(retained,{grants:1,workflow_table:'accounting_settings_workflow'});
  }finally{
    releaseCommit();
    if(downOpen)await downClient.query('ROLLBACK').catch(()=>{});
    downClient.release();
    await grantPromise;
    if(downPromise)await downPromise;
  }
});

pgTest('all ten selected child families are deeply validated before Draft evidence is retained',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31');
  const scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const maker=await roleKernel(scope,'settings-deep-maker','ACCOUNTING_SETTINGS_WORKFLOW_MAKER');
  const validIds=childIds(fixture);
  const mutations={
    coa:s=>{s.settings.accounts=[];},
    vendor_treatment:s=>{s.settings.default_treatment='EXPENSE';},
    project_property_cost_code:s=>{s.settings.default_capitalization_treatment='EXPENSE';},
    period_close_policy:s=>{s.settings.period_id=randomUUID();},
    tax:s=>{s.settings.jurisdiction='';},
    intercompany:s=>{s.settings.clearing_account_role='INVALID';},
    materiality:s=>{s.settings.currency='EUR';},
    approval_thresholds:s=>{s.settings.approval_levels=[];},
    report_mapping:s=>{s.settings.account_mappings=[];},
    loan_capitalization_policy:s=>{s.settings.qualifying_combinations=[];}
  };
  let ordinal=100;
  for(const [key,mutate] of Object.entries(mutations)){
    const source=(await adminPool.query('SELECT * FROM setting_snapshot WHERE setting_snapshot_id=$1',[validIds[key]])).rows[0];
    const snapshot=structuredClone(source.snapshot);mutate(snapshot);
    const badId=randomUUID(),hash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) hash',[snapshot])).rows[0].hash;
    await adminPool.query("INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,effective_to,status,snapshot,snapshot_hash,created_by,approved_by,approved_at) VALUES($1,$2,$3,$4,'ENTITY',$3::text,$5,$6,$7,'APPROVED',$8::jsonb,$9,'deep-maker','deep-approver',now())",
      [badId,scope.tenantId,scope.entityId,source.family,ordinal++,source.effective_from,source.effective_to,snapshot,hash]);
    const keyId='settings-deep-'+key.replaceAll('_','-');
    await assert.rejects(maker.createAccountingSettingsWorkflow({
      tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,
      childSettingSnapshotIds:{...validIds,[key]:badId},reason:reason('Create'),idempotencyKey:keyId
    }),error=>error.code==='23514',key);
  }
  const empty=(await adminPool.query("SELECT (SELECT count(*)::int FROM accounting_settings_workflow WHERE tenant_id=$1) workflow,(SELECT count(*)::int FROM accounting_settings_workflow_history h JOIN accounting_settings_workflow w ON w.accounting_settings_workflow_id=h.accounting_settings_workflow_id WHERE w.tenant_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND idempotency_key LIKE 'settings-deep-%') audit,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND event_type='ACCOUNTING_SETTINGS_DRAFT_CREATED') outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE tenant_id=$1 AND idempotency_key LIKE 'settings-deep-%') receipt",[scope.tenantId])).rows[0];
  assert.deepEqual(empty,{workflow:0,history:0,audit:0,outbox:0,receipt:0});
});

pgTest('intercompany clearing accepts exact ASSET and LIABILITY presentation directions and rejects EQUITY or reversed directions',async()=>{
  const cases=[
    {label:'asset-debit',accountClass:'ASSET',normalBalance:'DEBIT',valid:true},
    {label:'liability-credit',accountClass:'LIABILITY',normalBalance:'CREDIT',valid:true},
    {label:'equity-credit',accountClass:'EQUITY',normalBalance:'CREDIT',valid:false},
    {label:'asset-credit',accountClass:'ASSET',normalBalance:'CREDIT',valid:false},
    {label:'liability-debit',accountClass:'LIABILITY',normalBalance:'DEBIT',valid:false}
  ];
  let version=400;
  for(const item of cases){
    const target=period('2026-08','2026-08-01','2026-08-31'),scope=await seedScope({periods:[target]});
    const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
    const ids=childIds(fixture);
    ids.coa=await cloneApprovedChild(scope,ids.coa,snapshot=>{snapshot.settings.accounts.find(row=>row.role==='INTERCOMPANY_CLEARING').account_class=item.accountClass;},version++);
    ids.report_mapping=await cloneApprovedChild(scope,ids.report_mapping,snapshot=>{const row=snapshot.settings.account_mappings.find(value=>value.account_role==='INTERCOMPANY_CLEARING');row.statement='BS';row.normal_balance=item.normalBalance;row.contra=false;},version++);
    const actors=await lifecycleActors(scope,`settings-clearing-${item.label}`);
    const create=()=>actors.maker.createAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,childSettingSnapshotIds:ids,reason:reason('Create'),idempotencyKey:`settings-clearing-${item.label}-create`});
    if(item.valid){
      let workflow=await create();
      workflow=await advance(scope,actors,workflow,`settings-clearing-${item.label}`,'ACTIVATE');
      assert.equal(workflow.status,'ACTIVE',item.label);
    }else{
      await assert.rejects(create(),error=>error.code==='23514',item.label);
      const empty=(await adminPool.query("SELECT (SELECT count(*)::int FROM accounting_settings_workflow WHERE tenant_id=$1) workflow,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND idempotency_key=$2) audit,(SELECT count(*)::int FROM idempotency_receipt WHERE tenant_id=$1 AND idempotency_key=$2) receipt",[scope.tenantId,`settings-clearing-${item.label}-create`])).rows[0];
      assert.deepEqual(empty,{workflow:0,audit:0,receipt:0},item.label);
    }
  }
});

pgTest('deep SQL parity rejects scalar type, range, array-item and nullable-reference drift while accepting integral JSON decimals',async()=>{
  const invalidCases=[
    {label:'vendor-string-integer',family:'vendor_treatment',mutate:s=>{s.settings.vendor_rules[0].payment_terms_days='30';}},
    {label:'materiality-string-integer',family:'materiality',mutate:s=>{s.settings.ap_stale_days='30';}},
    {label:'numeric-money4',family:'materiality',mutate:s=>{s.settings.ap_aging_amount=100;}},
    {label:'reversed-vendor-range',family:'vendor_treatment',mutate:s=>{s.settings.vendor_rules[0].effective_from='2026-12-01';s.settings.vendor_rules[0].effective_to='2026-01-01';}},
    {label:'empty-vendor-alias',family:'vendor_treatment',mutate:s=>{s.settings.vendor_rules[0].aliases=[' '];}},
    {label:'numeric-tax-evidence',family:'tax',mutate:s=>{s.settings.tax_codes[0].evidence_requirements=[7];}},
    {label:'empty-loan-evidence',family:'loan_capitalization_policy',mutate:s=>{s.settings.required_evidence=[''];}},
    {label:'numeric-coa-dimension',family:'coa',mutate:s=>{s.settings.accounts[0].dimension_requirements=[3];}},
    {label:'empty-intercompany-dimension',family:'intercompany',mutate:s=>{s.settings.entities[0].dimension_requirements=[' '];}},
    {label:'null-tax-enum',family:'tax',mutate:s=>{s.settings.treatment=null;}},
    {label:'numeric-dimension-ref',family:'project_property_cost_code',mutate:s=>{s.settings.dimension_rules[0].cost_code_ref=123;}},
    {label:'object-loan-ref',family:'loan_capitalization_policy',mutate:s=>{s.settings.qualifying_combinations[0].property_ref={id:'property-1'};}},
    {label:'null-non-business-date',family:'period_close_policy',mutate:s=>{s.settings.non_business_dates=[null];}}
  ];
  let version=500;
  for(const item of invalidCases){
    const target=period('2026-08','2026-08-01','2026-08-31'),scope=await seedScope({periods:[target]});
    const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
    const ids=childIds(fixture),maker=await roleKernel(scope,`settings-scalar-${item.label}`,'ACCOUNTING_SETTINGS_WORKFLOW_MAKER');
    ids[item.family]=await cloneApprovedChild(scope,ids[item.family],item.mutate,version++);
    const key=`settings-scalar-${item.label}-create`;
    await assert.rejects(maker.createAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,childSettingSnapshotIds:ids,reason:reason('Create'),idempotencyKey:key}),error=>error.code==='23514',item.label);
    const empty=(await adminPool.query("SELECT (SELECT count(*)::int FROM accounting_settings_workflow WHERE tenant_id=$1) workflow,(SELECT count(*)::int FROM accounting_settings_workflow_history h JOIN accounting_settings_workflow w ON w.accounting_settings_workflow_id=h.accounting_settings_workflow_id WHERE w.tenant_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND idempotency_key=$2) audit,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND aggregate_type='ACCOUNTING_SETTINGS_WORKFLOW') outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE tenant_id=$1 AND idempotency_key=$2) receipt",[scope.tenantId,key])).rows[0];
    assert.deepEqual(empty,{workflow:0,history:0,audit:0,outbox:0,receipt:0},item.label);
  }

  const target=period('2026-08','2026-08-01','2026-08-31'),scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const ids=childIds(fixture);
  ids.vendor_treatment=await cloneApprovedChildWithJsonbPatch(scope,ids.vendor_treatment,['settings','vendor_rules','0','payment_terms_days'],'1.0',version++);
  ids.materiality=await cloneApprovedChildWithJsonbPatch(scope,ids.materiality,['settings','ap_stale_days'],'1.0',version++);
  const actors=await lifecycleActors(scope,'settings-integral-decimal');
  let workflow=await actors.maker.createAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,periodId:target.periodId,childSettingSnapshotIds:ids,reason:reason('Create'),idempotencyKey:'settings-integral-decimal-create'});
  workflow=await advance(scope,actors,workflow,'settings-integral-decimal','ACTIVATE');
  assert.equal(workflow.status,'ACTIVE');
});

pgTest('retained workflow evidence remains readable after entity deactivation while new lifecycle actions fail closed',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31');
  const scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const actors=await lifecycleActors(scope,'settings-inactive-history');
  const draft=await createDraft(scope,target,fixture,actors,'settings-inactive-history');
  await adminPool.query('UPDATE entity SET active=false WHERE tenant_id=$1 AND entity_id=$2',[scope.tenantId,scope.entityId]);
  const evidence=await readWorkflowEvidence(actors.maker,scope,draft.accounting_settings_workflow_id);
  assert.equal(evidence.selected_child_snapshots.length,10);
  assert.equal(evidence.canonical_parent_hash,draft.canonical_parent_hash);
  await assert.rejects(transition(scope,actors,draft,'SUBMIT','settings-inactive-history'),error=>error.code==='P0002');
  const unchanged=(await adminPool.query("SELECT status,revision::int revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key='settings-inactive-history-submit') failed_audit,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key='settings-inactive-history-submit') failed_receipt FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$1",[draft.accounting_settings_workflow_id])).rows[0];
  assert.deepEqual(unchanged,{status:'DRAFT',revision:0,history:1,failed_audit:0,failed_receipt:0});
});

pgTest('historical evidence survives current entity master drift and a later PRIMARY overlap while lifecycle validation rejects them',async()=>{
  const target=period('2026-08','2026-08-01','2026-08-31');
  const scope=await seedScope({periods:[target]});
  const fixture=await installApprovedAiSettingsFixture({pool:adminPool,ids:{...scope,periodId:target.periodId},companyCode:scope.sourceEntityId,settingsVersion:1,includeParent:false});
  const actors=await lifecycleActors(scope,'settings-master-drift');
  const draft=await createDraft(scope,target,fixture,actors,'settings-master-drift');
  await adminPool.query("UPDATE entity SET entity_code=$3,base_currency='EUR' WHERE tenant_id=$1 AND entity_id=$2",[scope.tenantId,scope.entityId,'DRIFT'+randomUUID().replaceAll('-','').slice(0,8).toUpperCase()]);
  const overlap=period('2026-08-OVERLAP','2026-08-15','2026-09-14');
  await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status,ledger_code) VALUES($1,$2,$3,$4,$5,$6,'OPEN','PRIMARY')",[overlap.periodId,scope.tenantId,scope.entityId,overlap.code,overlap.start,overlap.end]);
  const evidence=await readWorkflowEvidence(actors.maker,scope,draft.accounting_settings_workflow_id);
  assert.equal(evidence.selected_child_snapshots.length,10);
  assert.equal(evidence.canonical_parent_snapshot.company_code,scope.sourceEntityId);
  assert.equal(evidence.canonical_parent_snapshot.currency,'USD');
  const visible=await actors.submitter.readAccountingSettingsWorkflow({tenantId:scope.tenantId,entityId:scope.entityId,workflowId:draft.accounting_settings_workflow_id});
  assert.equal(visible.source_current,false);
  assert.deepEqual(visible.action_flags,{can_submit:false,can_review:false,can_approve:false,can_activate:false});
  await assert.rejects(transition(scope,actors,draft,'SUBMIT','settings-master-drift'),error=>error.code==='23514');
  const unchanged=(await adminPool.query("SELECT status,revision::int revision,(SELECT count(*)::int FROM accounting_settings_workflow_history WHERE accounting_settings_workflow_id=$1) history,(SELECT count(*)::int FROM audit_event WHERE idempotency_key='settings-master-drift-submit') failed_audit,(SELECT count(*)::int FROM idempotency_receipt WHERE idempotency_key='settings-master-drift-submit') failed_receipt FROM accounting_settings_workflow WHERE accounting_settings_workflow_id=$1",[draft.accounting_settings_workflow_id])).rows[0];
  assert.deepEqual(unchanged,{status:'DRAFT',revision:0,history:1,failed_audit:0,failed_receipt:0});
});
