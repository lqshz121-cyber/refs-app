import test,{before,after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';
import {runtimeConfig} from '../runtime/config.mjs';import {createPool} from '../runtime/db.mjs';import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';import {PostgresGrantSync} from '../runtime/grant-sync.mjs';
import {boundedBankRequestReady} from '../runtime/bounded-bank-request-authorizer.mjs';
import {createBoundedBankRequestAuthorizer} from '../runtime/bounded-bank-request-authorizer.mjs';
import {createWbsTestImportService,WBS_TEST_IMPORT_GRANT_BUNDLES} from '../runtime/wbs-test-import-service.mjs';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {BANK_REQUEST_SETTINGS_ROLE,BANK_REQUEST_ACCOUNTING_VIEW_ROLE} from '../runtime/bank-request-settings-role.mjs';
import {installApprovedAiSettingsFixture} from './helpers/approved-ai-settings-fixture.mjs';
const accountingView=process.env.REFS_LOCAL_BANK_REQUEST_ROLE==='accounting-view';
const combined=accountingView||process.env.REFS_LOCAL_BANK_REQUEST_ROLE==='combined';
const permissions=accountingView?[...BANK_REQUEST_ACCOUNTING_VIEW_ROLE.permissions]:combined?[...BANK_REQUEST_SETTINGS_ROLE.permissions]:['WBS.TEST.BANK.IMPORT.REQUEST'];
const sql457=direction=>readFile(new URL(`../db/migrations/${direction==='down'?'down/':''}457_bank_request_settings_view.sql`,import.meta.url),'utf8');
const config=runtimeConfig();let admin,runtime,issuerPool,grantPool;
const sql=name=>readFile(new URL(`../db/migrations/${name.endsWith('-down.sql')?'down/':''}456_bounded_wbs_bank_import_request.sql`,import.meta.url),'utf8');
before(async()=>{for(const key of ['migrationDatabaseUrl','databaseUrl','contextIssuerDatabaseUrl','grantSyncDatabaseUrl']){const u=new URL(config[key]);assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname));assert.match(u.pathname,/_test$/);}admin=await createPool({databaseUrl:config.migrationDatabaseUrl,max:1});await migrateUp(admin,{});runtime=await createPool({databaseUrl:config.databaseUrl,max:1});issuerPool=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,max:1});grantPool=await createPool({databaseUrl:config.grantSyncDatabaseUrl,max:1});});
after(async()=>{await Promise.allSettled([admin,runtime,issuerPool,grantPool].filter(Boolean).map(p=>p.end()));});
test('human Bank request candidate enforces registered staging and finite isolated request authority',async()=>{
  // Before retained grants, down then up must work without modifying applied migrations.
  await admin.query(await sql457('down'));
  assert.equal((await admin.query("SELECT count(*)::int n FROM runtime_human_additive_permission_authority WHERE permission_code='ACCOUNTING.SETTINGS.WORKFLOW.VIEW' AND authority_class='BANK_IMPORT_REQUEST'")).rows[0].n,0);
  await admin.query(await sql457('up'));
  await admin.query(await sql('bounded-bank-request-candidate-down.sql'));
  assert.equal(await boundedBankRequestReady(runtime),false);
  assert.equal((await admin.query("SELECT active FROM permission_catalog WHERE permission_code='WBS.TEST.BANK.IMPORT.REQUEST'")).rows[0].active,false);
  await admin.query(await sql('bounded-bank-request-candidate.sql'));
  assert.equal((await admin.query("SELECT active FROM permission_catalog WHERE permission_code='WBS.TEST.BANK.IMPORT.REQUEST'")).rows[0].active,true);
  assert.equal(await boundedBankRequestReady(runtime),true);
  await assert.rejects(runtime.query('SELECT * FROM permission_catalog'),error=>error.code==='42501');
  await assert.rejects(runtime.query('SELECT * FROM runtime_human_permission_authority'),error=>error.code==='42501');
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),installationId=randomUUID(),actorId='isolated-bank-request-human';
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.slice(0,8)}`.toUpperCase(),'Isolated Bank request']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'WBPA','WBS','WBPA','WBPA','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status,ledger_code) VALUES($1,$2,$3,'2026-06','2026-06-01','2026-06-30','OPEN','PRIMARY')",[periodId,tenantId,entityId]);
  const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,tenantId,actorId})});
  const kernel=new PostgresAccountingKernel(runtime,{sessionProvider:()=>issuer.issue({tenantId})});
  const args=[tenantId,entityId,periodId,'WBPA','2026-06-01','2026-06-30',10];
  const request=(values=args)=>kernel.assertBoundedWbsBankImportRequest({tenantId:values[0],entityId:values[1],periodId:values[2],companyCode:values[3],dateFrom:values[4],dateTo:values[5],limit:values[6]});
  await assert.rejects(request(),error=>error.code==='42501');
  const sync=new PostgresGrantSync(grantPool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
  let grantVersion=0;
  const existingReads=['AI.AMORTIZATION.VIEW','AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW','WBS.AUTOREC.VIEW'];
  if(accountingView){
    await sync.reconcile({tenantId,entityId,actorId,permissions:existingReads,authorityClass:'READ',validUntil:new Date(Date.now()+3600000).toISOString(),expectedVersion:0,idempotencyKey:'isolated-existing-accounting-reader'});
    grantVersion=1;
    const before=await kernel.readCurrentActorAccess({tenantId,entityId});
    assert.deepEqual(before.permissions,existingReads);assert.equal(before.grant_set_version,grantVersion);
    await assert.rejects(request(),error=>error.code==='42501');
  }
  await sync.reconcile({tenantId,entityId,actorId,permissions,authorityClass:'BANK_IMPORT_REQUEST',validUntil:new Date(Date.now()+3600000).toISOString(),expectedVersion:grantVersion,idempotencyKey:'isolated-human-bank-request'});
  grantVersion++;
  if(accountingView){
    const after=await kernel.readCurrentActorAccess({tenantId,entityId});
    assert.deepEqual(after.permissions,[...permissions].sort());assert.deepEqual(after.configured_permissions,[...permissions].sort());
    assert.equal(after.grant_set_version,grantVersion);assert.equal(after.session_refresh_required,false);
    for(const permission of existingReads)await kernel.inSession(client=>client.query('SELECT refs_assert_scope($1,$2,$3)',[tenantId,entityId,permission]));
    await assert.rejects(kernel.inSession(client=>client.query('SELECT refs_assert_scope($1,$2,$3)',[tenantId,entityId,'AI.ANALYSIS.EXPLAIN'])),error=>error.code==='42501');
  }
  await assert.rejects(request(),error=>error.code==='42501');
  const targetEnvironment=process.env.REFS_LOCAL_BANK_REQUEST_TARGET_ENV||'staging';
  assert.ok(['staging','production'].includes(targetEnvironment));
  console.log(`Isolated Bank request target_environment=${targetEnvironment}`);
  await admin.query("SELECT refs_initialize_deployment_identity($1,$2,$3,'INITIALIZE_IMMUTABLE_DEPLOYMENT_IDENTITY')",[installationId,targetEnvironment,new URL(config.migrationDatabaseUrl).pathname.slice(1)]);
  if(targetEnvironment==='production'){
    await assert.rejects(request(),error=>error.code==='42501');
    assert.equal((await admin.query('SELECT count(*)::int count FROM ledger_line WHERE tenant_id=$1',[tenantId])).rows[0].count,0);
    return;
  }
  await request();
  if(combined){
    const fixture=await installApprovedAiSettingsFixture({pool:admin,ids:{tenantId,entityId,periodId},companyCode:'WBPA'});
    await kernel.readAccountingSettingsWorkflowOptions({tenantId,entityId,periodId});
    const settings=await kernel.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true});
    assert.equal(settings.settings_snapshot_id,fixture.settingsSnapshotId);assert.equal(settings.settings_hash,fixture.settingsSnapshotHash);assert.equal(settings.can_post,false);
    assert.equal(settings.report_mapping.settings.account_mappings.length,fixture.accounts.length);
    const history=await kernel.readAuthoritativeSettingHistory({tenantId,entityId,family:'AI_ACCOUNTING_REPORT_MAPPING_V1',limit:25});
    assert.equal(history.items[0].setting_snapshot_id,fixture.childRefs.report_mapping.setting_snapshot_id);assert.equal(history.items[0].integrity_verified,true);
    for(const permission of ['ACCOUNTING.SETTINGS.WORKFLOW.CREATE','ACCOUNTING.SETTINGS.WORKFLOW.APPROVE','ACCOUNTING.SETTINGS.WORKFLOW.ACTIVATE'])await assert.rejects(kernel.inSession(client=>client.query('SELECT refs_assert_scope($1,$2,$3)',[tenantId,entityId,permission])),error=>error.code==='42501');
    await assert.rejects(admin.query(await sql457('down')),error=>error.code==='55000');await admin.query('ROLLBACK');
  }
  // Real authenticated HTTP -> human request assertion -> distinct SERVICE
  // context -> retained test receipt. Synthetic Provider data is not WBS proof.
  const importerActor='isolated-bank-request-service';
  await sync.reconcile({tenantId,entityId,actorId:importerActor,permissions:['WBS.TEST.IMPORT'],authorityClass:'SERVICE',validUntil:null,expectedVersion:0,idempotencyKey:'isolated-bank-request-service-grant'});
  const serviceIssuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,tenantId,actorId:importerActor})});
  const importer=new PostgresAccountingKernel(runtime,{sessionProvider:()=>serviceIssuer.issue({tenantId})});
  const configured={tenantId,entityId,periodId,companyCode:'WBPA',dateFrom:'2026-06-01',dateTo:'2026-06-30'};
  const actors=Object.fromEntries(Object.keys(WBS_TEST_IMPORT_GRANT_BUNDLES).map(role=>[role,role==='importer'?importerActor:`unused-${role}`]));
  const observation={schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_bank_transactions',environment:'PRODUCTION',entity_id:entityId,captured_at:'2026-06-30T00:00:00.000Z',provider_content_sha256:'b'.repeat(64),scope:{company_codes:['WBPA'],date_range:['2026-06-01','2026-06-30']},record_count:1,rows:[{source_record_hash:`sha256:${'a'.repeat(64)}`,currency:'USD',accounting_date:'2026-06-15',amount:'12.3000',direction:'DEBIT',status:'POSTED'}],signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:`sha256:${'c'.repeat(64)}`};
  const service=createWbsTestImportService({scope:{tenantId,entityId,companyCode:'WBPA',actors},authorizeBoundedBankRequest:createBoundedBankRequestAuthorizer({kernel,scope:configured}),authorizeBank:async()=>assert.fail('no legacy fallback'),pilotService:{async readObservation(){return observation;}},kernelForActor:id=>{assert.equal(id,importerActor);return importer;}});
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId}),kernelFactory:async()=>kernel,wbsTestImportServiceFactory:async()=>service});
  const httpRequest={method:'POST',url:`/api/v1/entities/${entityId}/wbs/test-import/bank-transactions`,headers:{'idempotency-key':'isolated-bank-human-http-01'},body:{periodId,companyCode:'WBPA',dateFrom:'2026-06-01',dateTo:'2026-06-30',limit:10}};
  const first=await api(httpRequest),replay=await api(httpRequest);
  assert.equal(first.status,201,JSON.stringify(first.body));assert.equal(replay.status,200,JSON.stringify(replay.body));
  assert.equal(first.body.data.status,'FINALIZED');assert.equal(first.body.data.test_only,true);assert.equal(first.body.data.can_post,false);
  assert.equal(first.body.data.transaction_count,1);assert.equal(first.body.data.wbs_test_bank_import_receipt_id,replay.body.data.wbs_test_bank_import_receipt_id);
  await sync.reconcile({tenantId,entityId,actorId:importerActor,permissions:[],authorityClass:'SERVICE',validUntil:null,expectedVersion:1,idempotencyKey:'isolated-bank-request-service-revoke'});
  assert.equal((await api(httpRequest)).status,403);
  assert.equal((await admin.query('SELECT count(*)::int count FROM reconciliation WHERE tenant_id=$1',[tenantId])).rows[0].count,0);
  assert.equal((await admin.query('SELECT count(*)::int count FROM journal_entry WHERE tenant_id=$1',[tenantId])).rows[0].count,0);
  for(const [index,value] of [[0,randomUUID()],[1,randomUUID()],[3,'OTHER'],[4,'2026-05-01'],[5,'2026-07-01'],[6,11],[6,0],[2,randomUUID()]]){const invalid=[...args];invalid[index]=value;await assert.rejects(request(invalid));}
  for(const permission of ['WBS.TEST.IMPORT','BANK.RECONCILIATION.START','BANK.MATCH.CREATE','GL.JE.POST'])await assert.rejects(kernel.inSession(client=>client.query('SELECT refs_assert_scope($1,$2,$3)',[tenantId,entityId,permission])),error=>error.code==='42501');
  await assert.rejects(admin.query(await sql('bounded-bank-request-candidate-down.sql')),error=>error.code==='55000');
  await admin.query('ROLLBACK');
  await admin.query("UPDATE accounting_period SET status='SOFT_CLOSED',closed_by='owned-controller',closed_at=clock_timestamp(),version=version+1 WHERE period_id=$1",[periodId]);
  await assert.rejects(request(),error=>error.code==='55000');
  await admin.query("UPDATE accounting_period SET status='OPEN',closed_by=NULL,closed_at=NULL,version=version+1 WHERE period_id=$1",[periodId]);
  await request();
  // Simulate expiry in the disposable fixture; refresh via formal grant sync.
  await admin.query("UPDATE runtime_actor_grant SET valid_until=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND entity_id=$2 AND actor_id=$3",[tenantId,entityId,actorId]);
  await assert.rejects(request(),error=>error.code==='42501');
  if(accountingView)for(const permission of existingReads)await assert.rejects(kernel.inSession(client=>client.query('SELECT refs_assert_scope($1,$2,$3)',[tenantId,entityId,permission])),error=>error.code==='42501');
  await sync.reconcile({tenantId,entityId,actorId,permissions,authorityClass:'BANK_IMPORT_REQUEST',validUntil:new Date(Date.now()+3600000).toISOString(),expectedVersion:grantVersion,idempotencyKey:'isolated-human-bank-request-renew'});
  grantVersion++;
  await request();
  if(accountingView)assert.deepEqual((await kernel.readCurrentActorAccess({tenantId,entityId})).permissions,[...permissions].sort());
  await sync.reconcile({tenantId,entityId,actorId,permissions:[],authorityClass:'BANK_IMPORT_REQUEST',validUntil:new Date(Date.now()+3600000).toISOString(),expectedVersion:grantVersion,idempotencyKey:'isolated-human-bank-request-revoke'});
  await assert.rejects(request(),error=>error.code==='42501');
  if(combined)await assert.rejects(kernel.readAccountingSettingsWorkflowOptions({tenantId,entityId,periodId}),error=>error.code==='42501');
  if(accountingView)for(const permission of existingReads)await assert.rejects(kernel.inSession(client=>client.query('SELECT refs_assert_scope($1,$2,$3)',[tenantId,entityId,permission])),error=>error.code==='42501');
  assert.equal((await admin.query('SELECT count(*)::int count FROM ledger_line WHERE tenant_id=$1',[tenantId])).rows[0].count,0);
});
