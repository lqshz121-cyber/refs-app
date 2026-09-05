import test from 'node:test';
import assert from 'node:assert/strict';
import {productionWorkflowRoleGrantConfig,grantProductionWorkflowRole} from '../runtime/production-workflow-role-grant.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {grantStagingWorkflowRole} from '../runtime/workflow-role-grant.mjs';
import {readFile} from 'node:fs/promises';
import {PostgresGrantSync} from '../runtime/grant-sync.mjs';
import {AUTHORITATIVE_WORKFLOW_ROLES,WORKFLOW_SOD_GROUPS,assertWorkflowRoleSafety,authoritativeWorkflowRoleGrantConfig,grantAuthenticatedWorkflowRole,grantConfiguredServiceWorkflowRole} from '../runtime/workflow-role-grant.mjs';

const validUntil='2026-08-24T00:00:00.000Z';
const base={NODE_ENV:'production',REFS_DEPLOYMENT_ENV:'staging',REFS_WORKFLOW_ROLE_CONFIRM:'AUTHORITATIVE_WORKFLOW_ROLE_ONLY',REFS_STAGE1_TENANT_ID:'11111111-1111-4111-8111-111111111111',REFS_STAGE1_ENTITY_ID:'22222222-2222-4222-8222-222222222222',REFS_WORKFLOW_ROLE:'WBS_PAYABLE_MAKER',REFS_WORKFLOW_GRANT_VALID_UNTIL:validUntil,REFS_WORKFLOW_GRANT_EXPECTED_VERSION:'2',REFS_WORKFLOW_GRANT_IDEMPOTENCY_KEY:'workflow-maker-0001',REFS_AUTHENTICATED_ACCESS_TOKEN:'opaque',OIDC_ISSUER:'https://issuer.example',OIDC_AUDIENCE:'refs',OIDC_JWKS_URI:'https://issuer.example/jwks'};
const permissions=role=>AUTHORITATIVE_WORKFLOW_ROLES[role].permissions;

test('production and staging ceremonies reassert inside the grant transaction after OIDC',async()=>{
  const config=authoritativeWorkflowRoleGrantConfig(base);
  for(const run of [grantProductionWorkflowRole,grantStagingWorkflowRole]){
    let preflight=0,auth=0,transactionGuard=0,mutations=0;
    const pool={query:async()=>{preflight++;return {rows:[{asserted:true}]};},connect:async()=>({release(){},query:async sql=>{
      if(sql==='SELECT session_user,current_user')return {rowCount:1,rows:[{session_user:'refs_grant_sync',current_user:'refs_grant_sync'}]};
      if(sql.includes('refs_assert_')){transactionGuard++;assert.equal(auth,1);throw Object.assign(new Error('sealed while OIDC was in flight'),{code:'42501'});}
      if(sql.includes('refs_grant_request_hash')||sql.includes('refs_reconcile_actor_grants'))mutations++;
      return {rowCount:0,rows:[]};
    }})};
    await assert.rejects(run(pool,config,{authenticator:{authenticate:async()=>{auth++;return {tenantId:config.tenantId,actorId:'fixture|oidc-race'};}}}),{code:'42501'});
    assert.equal(preflight,1);assert.equal(transactionGuard,1);assert.equal(mutations,0);
  }
});

test('grant transaction guard reruns on serialization retry and protects revision reads',async()=>{
  let guards=0,hashes=0;
  const pool={connect:async()=>({release(){},query:async sql=>{
    if(sql==='SELECT session_user,current_user')return {rowCount:1,rows:[{session_user:'refs_grant_sync',current_user:'refs_grant_sync'}]};
    if(sql.includes('refs_grant_request_hash')){hashes++;return {rowCount:1,rows:[{request_hash:'sha256:fixture'}]};}
    if(sql.includes('refs_reconcile_actor_grants'))return {rowCount:1,rows:[{result:{version:1}}]};
    if(sql.includes('refs_current_actor_grant_set_version'))return {rowCount:1,rows:[{version:1}]};
    return {rowCount:0,rows:[]};
  }})};
  const sync=new PostgresGrantSync(pool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'}),transactionGuard:async()=>{guards++;if(guards===1)throw Object.assign(new Error('stale snapshot'),{code:'40001'});}});
  assert.equal((await sync.reconcile({authorityClass:'ANALYSIS',validUntil})).version,1);assert.equal(guards,2);assert.equal(hashes,1);
  assert.equal(await sync.currentVersion({}),1);assert.equal(guards,3);
});

test('staging ceremony demands successful database guard before authentication or grant reservation',async()=>{
  const config=authoritativeWorkflowRoleGrantConfig(base);let calls=0;
  for(const rows of [[],[{asserted:false}],[{asserted:null}]])await assert.rejects(grantStagingWorkflowRole({query:async sql=>{assert.match(sql,/refs_assert_staging_deployment_target/);return {rows};}},config,{authenticator:{authenticate:async()=>{calls++;}}}),{code:'DEPLOYMENT_IDENTITY_DENIED'});
  assert.equal(calls,0);
});

test('every executable legacy grant entry attests before OIDC, automatic reconciliation or HTTP listen',async()=>{
  const cli=await readFile(new URL('../tools/stage1-bootstrap.mjs',import.meta.url),'utf8');
  assert.ok(cli.indexOf('await assertStagingDeploymentTarget(')<cli.indexOf('await grantStage1AuthenticatedReadAccess('));
  const startup=await readFile(new URL('../runtime/start-accounting-server.mjs',import.meta.url),'utf8');
  const guarded=startup.indexOf('if(grantSyncPool)await assertStagingDeploymentTarget(');assert.ok(guarded>0);
  for(const operation of ['await reconcileWbsTestImportActorGrants(','await reconcileControlledTestAiWorkflowActorGrants(','server.listen('])assert.ok(guarded<startup.indexOf(operation));
});

test('production ceremony requires exact deployment identity and retains four URL isolation',async()=>{
  const urls=runtimeConfig({}),env={...base,REFS_DEPLOYMENT_ENV:'production',REFS_WORKFLOW_ROLE_CONFIRM:'PRODUCTION_WORKFLOW_ROLE_ONLY',REFS_EXPECTED_INSTALLATION_ID:'33333333-3333-4333-8333-333333333333',REFS_EXPECTED_DATABASE_NAME:'refs_kernel_test',DATABASE_URL:urls.databaseUrl,MIGRATION_DATABASE_URL:urls.migrationDatabaseUrl,CONTEXT_ISSUER_DATABASE_URL:urls.contextIssuerDatabaseUrl,GRANT_SYNC_DATABASE_URL:urls.grantSyncDatabaseUrl};
  const config=productionWorkflowRoleGrantConfig(env);
  for(const change of [{REFS_EXPECTED_INSTALLATION_ID:''},{REFS_EXPECTED_DATABASE_NAME:'other'},{REFS_DEPLOYMENT_ENV:'staging'},{REFS_WORKFLOW_ROLE_CONFIRM:base.REFS_WORKFLOW_ROLE_CONFIRM},{DATABASE_URL:urls.grantSyncDatabaseUrl},{CONTEXT_ISSUER_DATABASE_URL:urls.contextIssuerDatabaseUrl.replace('55432','55433')}])assert.throws(()=>productionWorkflowRoleGrantConfig({...env,...change}));
  let authCalls=0,writes=0;
  await assert.rejects(grantProductionWorkflowRole({query:async(sql,args)=>{assert.match(sql,/refs_assert_deployment_identity/);assert.deepEqual(args,[config.installationId,'production',config.expectedDatabase]);throw Object.assign(new Error('denied'),{code:'42501'});},connect:async()=>{writes++;} },config,{authenticator:{authenticate:async()=>{authCalls++;}}}),{code:'42501'});
  assert.equal(authCalls,0);assert.equal(writes,0);
});

test('workflow roles are frozen single-authority exact replacements and exclude service permissions',()=>{
  const config=authoritativeWorkflowRoleGrantConfig(base);
  assert.deepEqual(config.permissions,permissions('WBS_PAYABLE_MAKER'));
  assert.equal(config.authorityClass,'DRAFT');assert.equal(config.validUntil,validUntil);
  for(const definition of Object.values(AUTHORITATIVE_WORKFLOW_ROLES)){
    assert.equal(Object.isFrozen(definition),true);assert.equal(Object.isFrozen(definition.permissions),true);
    assert.equal(new Set(definition.permissions).size,definition.permissions.length);
    if(definition.principalKind==='HUMAN')assert.equal(definition.permissions.some(permission=>['WBS.SNAPSHOT.IMPORT','WBS.BANK.ADMIT','BANK.AUTOREC.SYNC','OUTBOX.DISPATCH'].includes(permission)),false);
    assert.equal(assertWorkflowRoleSafety(definition),definition);
  }
  assert.deepEqual(AUTHORITATIVE_WORKFLOW_ROLES.WBS_SNAPSHOT_IMPORTER_SERVICE,{authorityClass:'SERVICE',principalKind:'SERVICE',permissions:['WBS.SNAPSHOT.IMPORT']});
  assert.deepEqual(AUTHORITATIVE_WORKFLOW_ROLES.OUTBOX_DISPATCHER_SERVICE,{authorityClass:'SERVICE',principalKind:'SERVICE',permissions:['OUTBOX.DISPATCH']});
  assert.deepEqual(AUTHORITATIVE_WORKFLOW_ROLES.AUDIT_READER,{authorityClass:'ANALYSIS',principalKind:'HUMAN',permissions:['AUDIT.VIEW']});
  assert.deepEqual(AUTHORITATIVE_WORKFLOW_ROLES.AI_ACCOUNTING_DECISION_MAKER,{authorityClass:'DRAFT',principalKind:'HUMAN',permissions:['AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW','WBS.AUTOREC.VIEW','GL.JE.CREATE']});
  assert.deepEqual(permissions('WBS_OPERATOR_ATTESTER'),['WBS.AUTOREC.VIEW','WBS.PAYABLE.OPERATOR_ATTEST']);
  assert.equal(permissions('WBS_PAYABLE_MAKER').includes('GL.JE.SUBMIT'),false);
  assert.equal(permissions('BANK_RECONCILIATION_MAKER').includes('GL.JE.SUBMIT'),false);
  assert.deepEqual(permissions('BANK_MATCH_REVIEWER').slice(-1),['BANK.MATCH.REVIEW']);
  assert.deepEqual(permissions('BANK_MATCH_UNMATCHER').slice(-1),['BANK.MATCH.UNMATCH']);
  assert.equal(permissions('BANK_MATCH_REVIEWER').includes('BANK.MATCH.UNMATCH'),false);
  assert.equal(permissions('BANK_MATCH_UNMATCHER').includes('BANK.MATCH.REVIEW'),false);
  for(const role of ['AI_FINDING_ASSIGNER','AI_FINDING_RESOLVER','AR_INVOICE_MAKER','AR_RECEIPT_MAKER','AR_RECEIPT_REVERSAL_MAKER','AP_PAYMENT_MAKER','GL_REPORT_SNAPSHOT_PREPARER','GL_REPORT_SNAPSHOT_APPROVER','GL_PERIOD_CLOSER','GL_PERIOD_REOPENER'])assert.ok(AUTHORITATIVE_WORKFLOW_ROLES[role]);
  assert.deepEqual(permissions('GL_PERIOD_REOPENER'),['AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW','WBS.AUTOREC.VIEW','GL.PERIOD.REOPEN']);
  assert.deepEqual(Object.fromEntries(['AP_PAYMENT_MAKER','AP_PAYMENT_REVERSAL_MAKER','AP_VENDOR_CREDIT_MAKER','AP_VENDOR_CREDIT_ALLOCATOR','AR_RECEIPT_MAKER','AR_RECEIPT_REVERSAL_MAKER','AR_CREDIT_MEMO_MAKER','AR_CREDIT_MEMO_ALLOCATOR','AR_REFUND_MAKER','WBS_H1_ACCOUNTING_RECONCILER'].map(name=>[name,AUTHORITATIVE_WORKFLOW_ROLES[name].authorityClass])),{
    AP_PAYMENT_MAKER:'PAYMENT',AP_PAYMENT_REVERSAL_MAKER:'REVERSAL',AP_VENDOR_CREDIT_MAKER:'ADJUSTMENT',AP_VENDOR_CREDIT_ALLOCATOR:'ALLOCATION',AR_RECEIPT_MAKER:'RECEIPT',AR_RECEIPT_REVERSAL_MAKER:'REVERSAL',AR_CREDIT_MEMO_MAKER:'ADJUSTMENT',AR_CREDIT_MEMO_ALLOCATOR:'ALLOCATION',AR_REFUND_MAKER:'REFUND',WBS_H1_ACCOUNTING_RECONCILER:'RECONCILE'
  });
});

test('unified matrix rejects mixed lifecycle stages and service-only human scope',()=>{
  assert.ok(WORKFLOW_SOD_GROUPS.length>=6);
  assert.throws(()=>assertWorkflowRoleSafety({authorityClass:'DRAFT',principalKind:'HUMAN',permissions:['GL.JE.CREATE','GL.JE.SUBMIT']}),error=>error.code==='WORKFLOW_ROLE_SCOPE_DENIED');
  assert.throws(()=>assertWorkflowRoleSafety({authorityClass:'REVIEW',principalKind:'HUMAN',permissions:['BANK.MATCH.REVIEW','BANK.MATCH.UNMATCH']}),error=>error.code==='WORKFLOW_ROLE_SCOPE_DENIED');
  assert.throws(()=>assertWorkflowRoleSafety({authorityClass:'DRAFT',principalKind:'HUMAN',permissions:['AP.VIEW','WBS.SNAPSHOT.IMPORT']}),error=>error.code==='WORKFLOW_ROLE_SCOPE_DENIED');
  assert.throws(()=>assertWorkflowRoleSafety({authorityClass:'CLOSE',principalKind:'HUMAN',permissions:['GL.PERIOD.CLOSE','GL.PERIOD.REOPEN']}),error=>error.code==='WORKFLOW_ROLE_SCOPE_DENIED');
  assert.throws(()=>assertWorkflowRoleSafety({authorityClass:'SERVICE',principalKind:'SERVICE',permissions:['WBS.SNAPSHOT.IMPORT','AP.VIEW']}),error=>error.code==='WORKFLOW_ROLE_SCOPE_DENIED');
});

test('workflow role config fails closed for environment, expiry, role, and scope drift',()=>{
  for(const environment of [
    {...base,REFS_DEPLOYMENT_ENV:'production'},
    {...base,REFS_WORKFLOW_ROLE:'CONTROLLER'},
    {...base,REFS_WORKFLOW_GRANT_EXPECTED_VERSION:'x'},
    {...base,REFS_STAGE1_ENTITY_ID:'not-uuid'},
    {...base,REFS_WORKFLOW_GRANT_VALID_UNTIL:''},
    {...base,REFS_WORKFLOW_GRANT_VALID_UNTIL:'2026-02-30T00:00:00.000Z'},
    {...base,REFS_WORKFLOW_GRANT_VALID_UNTIL:'2026-08-24T00:00:00+00:00'},
  ])assert.throws(()=>authoritativeWorkflowRoleGrantConfig(environment),error=>/WORKFLOW_ROLE_(ENV_DENIED|CONFIG_INVALID|CONFIG_MISSING)/.test(error.code));
});

test('authenticated role grant derives actor and sends finite single-authority exact replacement',async()=>{
  const config=authoritativeWorkflowRoleGrantConfig(base),calls=[];
  const pool={connect:async()=>({query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql==='BEGIN ISOLATION LEVEL SERIALIZABLE')return {};
    if(sql.includes('session_user')&&sql.includes('current_user'))return {rowCount:1,rows:[{session_user:'refs_grant_sync',current_user:'refs_grant_sync'}]};
    if(sql.startsWith('SELECT refs_grant_request_hash_v2'))return {rowCount:1,rows:[{request_hash:'sha256:request'}]};
    if(sql.startsWith('SELECT refs_reconcile_actor_grants_v2'))return {rowCount:1,rows:[{result:{permissions:[...config.permissions].reverse(),authority_class:'DRAFT',valid_until:validUntil,version:3,idempotent:false}}]};
    return {rowCount:0,rows:[]};
  },release(){}})};
  const result=await grantAuthenticatedWorkflowRole(pool,config,{authenticator:{authenticate:async()=>({tenantId:config.tenantId,actorId:'auth0|maker'})}});
  assert.deepEqual(result,{role:'WBS_PAYABLE_MAKER',authorityClass:'DRAFT',validUntil,idempotent:false,version:3,permissionCount:config.permissions.length});
  const reconcile=calls.find(call=>call.sql.startsWith('SELECT refs_reconcile_actor_grants_v2'));
  assert.equal(reconcile.args[1],'auth0|maker');assert.deepEqual(reconcile.args[3],config.permissions);
  assert.equal(reconcile.args[4],'DRAFT');assert.equal(reconcile.args[5],validUntil);
});

test('role wrapper rejects altered permission, authority, and tenant',async()=>{
  const config=authoritativeWorkflowRoleGrantConfig(base);
  await assert.rejects(grantAuthenticatedWorkflowRole({}, {...config,permissions:[...config.permissions,'GL.JE.POST']}),error=>error.code==='WORKFLOW_ROLE_SCOPE_DENIED');
  await assert.rejects(grantAuthenticatedWorkflowRole({}, {...config,authorityClass:'POST'}),error=>error.code==='WORKFLOW_ROLE_SCOPE_DENIED');
  await assert.rejects(grantAuthenticatedWorkflowRole({},config,{authenticator:{authenticate:async()=>({tenantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actorId:'auth0|maker'})}}),error=>error.code==='WORKFLOW_ROLE_TENANT_DENIED');
});

test('provider service role is finite, exact, platform-synced, and unavailable to authenticated humans',async()=>{
  const serviceConfig=authoritativeWorkflowRoleGrantConfig({...base,REFS_WORKFLOW_ROLE:'WBS_SNAPSHOT_IMPORTER_SERVICE',WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID:'oidc|wbs-provider-admission-service',REFS_AUTHENTICATED_ACCESS_TOKEN:undefined,OIDC_ISSUER:undefined,OIDC_AUDIENCE:undefined,OIDC_JWKS_URI:undefined}),calls=[];
  assert.equal(serviceConfig.principalKind,'SERVICE');assert.equal(serviceConfig.validUntil,validUntil);assert.deepEqual(serviceConfig.permissions,['WBS.SNAPSHOT.IMPORT']);
  const pool={connect:async()=>({query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql==='BEGIN ISOLATION LEVEL SERIALIZABLE')return {};
    if(sql.includes('session_user')&&sql.includes('current_user'))return {rowCount:1,rows:[{session_user:'refs_grant_sync',current_user:'refs_grant_sync'}]};
    if(sql.startsWith('SELECT refs_grant_request_hash_v2'))return {rowCount:1,rows:[{request_hash:'sha256:service'}]};
    if(sql.startsWith('SELECT refs_reconcile_actor_grants_v2'))return {rowCount:1,rows:[{result:{permissions:['WBS.SNAPSHOT.IMPORT'],authority_class:'SERVICE',valid_until:validUntil,version:3,idempotent:false}}]};
    return {rowCount:0,rows:[]};
  },release(){}})};
  const result=await grantConfiguredServiceWorkflowRole(pool,serviceConfig);
  assert.equal(result.role,'WBS_SNAPSHOT_IMPORTER_SERVICE');
  const reconcile=calls.find(call=>call.sql.startsWith('SELECT refs_reconcile_actor_grants_v2'));
  assert.equal(reconcile.args[1],'oidc|wbs-provider-admission-service');assert.equal(reconcile.args[4],'SERVICE');assert.equal(reconcile.args[5],validUntil);
  await assert.rejects(grantAuthenticatedWorkflowRole(pool,serviceConfig,{authenticator:{authenticate:async()=>({tenantId:serviceConfig.tenantId,actorId:'auth0|human'})}}),error=>error.code==='WORKFLOW_ROLE_SCOPE_DENIED');
  await assert.rejects(grantConfiguredServiceWorkflowRole(pool,{...serviceConfig,serviceActorId:'short'}),error=>error.code==='WORKFLOW_ROLE_SERVICE_PRINCIPAL_DENIED');
  await assert.rejects(grantConfiguredServiceWorkflowRole(pool,serviceConfig,{principalProvider:async()=>({trusted:false,serviceId:'platform-iam-sync'})}),error=>error.code==='GRANT_SYNC_PRINCIPAL_DENIED');
});

test('outbox dispatcher uses its dedicated service actor and exact replacement bundle',()=>{
  const config=authoritativeWorkflowRoleGrantConfig({...base,REFS_WORKFLOW_ROLE:'OUTBOX_DISPATCHER_SERVICE',OUTBOX_DISPATCH_ACTOR_ID:'service|refs-outbox-dispatch',REFS_AUTHENTICATED_ACCESS_TOKEN:undefined,OIDC_ISSUER:undefined,OIDC_AUDIENCE:undefined,OIDC_JWKS_URI:undefined});
  assert.equal(config.serviceActorId,'service|refs-outbox-dispatch');assert.equal(config.principalKind,'SERVICE');assert.equal(config.authorityClass,'SERVICE');assert.deepEqual(config.permissions,['OUTBOX.DISPATCH']);
  assert.throws(()=>authoritativeWorkflowRoleGrantConfig({...base,REFS_WORKFLOW_ROLE:'OUTBOX_DISPATCHER_SERVICE',OUTBOX_DISPATCH_ACTOR_ID:''}),error=>error.code==='WORKFLOW_ROLE_CONFIG_MISSING');
});
