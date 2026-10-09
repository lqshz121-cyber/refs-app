import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runtimeConfig} from '../runtime/config.mjs';
import {createPool} from '../runtime/db.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresGrantSync} from '../runtime/grant-sync.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {SETTINGS_MAPPING_READ_ROLE as role} from '../runtime/settings-mapping-read-role.mjs';
import {installApprovedAiSettingsFixture} from './helpers/approved-ai-settings-fixture.mjs';
const config=runtimeConfig();let admin,runtime,issuerPool,grantPool;
before(async()=>{
  for(const key of ['migrationDatabaseUrl','databaseUrl','contextIssuerDatabaseUrl','grantSyncDatabaseUrl']){const url=new URL(config[key]);assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));assert.match(url.pathname,/_test$/);}
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,max:1});await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,max:1});issuerPool=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,max:1});grantPool=await createPool({databaseUrl:config.grantSyncDatabaseUrl,max:1});
});
after(async()=>{await Promise.allSettled([admin,runtime,issuerPool,grantPool].filter(Boolean).map(pool=>pool.end()));});
test('formal settings READ grant admits exact read scopes and denies writes and another entity',async()=>{
  const tenantId=randomUUID(),entityId=randomUUID(),other=randomUUID(),periodId=randomUUID(),actorId='isolated-settings-read-user';
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.slice(0,8)}`.toUpperCase(),'Isolated read-role test']);
  for(const id of [entityId,other])await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,$3,'USD')",[id,tenantId,`E${id.slice(0,8)}`.toUpperCase()]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status,ledger_code) VALUES($1,$2,$3,'2026-06','2026-06-01','2026-06-30','OPEN','PRIMARY')",[periodId,tenantId,entityId]);
  const companyCode=`E${entityId.slice(0,8)}`.toUpperCase();
  const fixture=await installApprovedAiSettingsFixture({pool:admin,ids:{tenantId,entityId,periodId},companyCode});
  const sync=new PostgresGrantSync(grantPool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
  await sync.reconcile({tenantId,entityId,actorId,permissions:[...role.permissions],authorityClass:role.authorityClass,validUntil:new Date(Date.now()+3600000).toISOString(),expectedVersion:0,idempotencyKey:'isolated-settings-read-grant'});
  const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,tenantId,actorId})});
  const kernel=new PostgresAccountingKernel(runtime,{sessionProvider:()=>issuer.issue({tenantId})});
  const check=(entity,permission)=>kernel.inSession(client=>client.query('SELECT refs_assert_scope($1,$2,$3)',[tenantId,entity,permission]));
  for(const permission of role.permissions){await check(entityId,permission);await assert.rejects(check(other,permission),error=>error.code==='42501');}
  for(const permission of ['ACCOUNTING.SETTINGS.WORKFLOW.CREATE','ACCOUNTING.SETTINGS.WORKFLOW.APPROVE','ACCOUNTING.SETTINGS.WORKFLOW.ACTIVATE','WBS.H1.SETTINGS.DECIDE','WBS.TEST.IMPORT','GL.JE.POST'])await assert.rejects(check(entityId,permission),error=>error.code==='42501');
  const options=await kernel.readAccountingSettingsWorkflowOptions({tenantId,entityId,periodId});assert.ok(options);
  const settings=await kernel.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true});
  assert.equal(settings.settings_snapshot_id,fixture.settingsSnapshotId);
  assert.equal(settings.settings_hash,fixture.settingsSnapshotHash);
  assert.equal(settings.report_mapping.settings.account_mappings.length,fixture.accounts.length);
  assert.equal(settings.can_post,false);
  const history=await kernel.readAuthoritativeSettingHistory({tenantId,entityId,family:'AI_ACCOUNTING_REPORT_MAPPING_V1',limit:25});
  assert.equal(history.items.length,1);
  assert.equal(history.items[0].setting_snapshot_id,fixture.childRefs.report_mapping.setting_snapshot_id);
  assert.equal(history.items[0].integrity_verified,true);
  await assert.rejects(kernel.readAccountingSettingsWorkflowOptions({tenantId,entityId:other,periodId}),error=>error.code==='42501');
  // Expiry is simulated only in the owned disposable fixture, never in staging.
  await admin.query("UPDATE runtime_actor_grant SET valid_until=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND entity_id=$2 AND actor_id=$3",[tenantId,entityId,actorId]);
  for(const permission of role.permissions)await assert.rejects(check(entityId,permission),error=>error.code==='42501');
  await sync.reconcile({tenantId,entityId,actorId,permissions:[...role.permissions],authorityClass:role.authorityClass,validUntil:new Date(Date.now()+3600000).toISOString(),expectedVersion:1,idempotencyKey:'isolated-settings-read-renew'});
  await kernel.readAccountingSettingsWorkflowOptions({tenantId,entityId,periodId});
  await sync.reconcile({tenantId,entityId,actorId,permissions:[],authorityClass:role.authorityClass,validUntil:new Date(Date.now()+3600000).toISOString(),expectedVersion:2,idempotencyKey:'isolated-settings-read-revoke'});
  for(const permission of role.permissions)await assert.rejects(check(entityId,permission),error=>error.code==='42501');
  await assert.rejects(kernel.readAccountingSettingsWorkflowOptions({tenantId,entityId,periodId}),error=>error.code==='42501');
  await assert.rejects(kernel.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true}),error=>error.code==='42501');
  await assert.rejects(kernel.readAuthoritativeSettingHistory({tenantId,entityId,family:'AI_ACCOUNTING_REPORT_MAPPING_V1',limit:25}),error=>error.code==='42501');
  assert.equal((await admin.query('SELECT count(*)::int count FROM ledger_line WHERE tenant_id=$1',[tenantId])).rows[0].count,0);
});
