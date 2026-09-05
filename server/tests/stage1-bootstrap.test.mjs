import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {STAGE1_CONTROLLED_TEST_WORKFLOW_PERMISSIONS,STAGE1_READ_PERMISSIONS,STAGE1_WBS_OPERATOR_PERMISSIONS,STAGE1_WBS_READ_PERMISSIONS,grantStage1AuthenticatedReadAccess,grantStage1ReadAccess,grantStage1SelfReadAccess,stage1AuthenticatedGrantConfig,stage1GrantConfig,stage1ProvisionConfig,stage1SelfControlledTestWorkflowUpgradeConfig,stage1SelfGrantConfig,stage1SelfWbsOperatorUpgradeConfig,stage1SelfWbsReadUpgradeConfig,upgradeStage1ControlledTestWorkflowAccess,upgradeStage1WbsOperatorAccess,upgradeStage1WbsReadAccess} from '../runtime/stage1-bootstrap.mjs';

const serverRoot=fileURLToPath(new URL('..',import.meta.url));

const base={
  NODE_ENV:'production',REFS_DEPLOYMENT_ENV:'staging',REFS_STAGE1_BOOTSTRAP_CONFIRM:'STAGE1_AUTHORITATIVE_ONLY',
  REFS_STAGE1_TENANT_ID:'11111111-1111-4111-8111-111111111111',REFS_STAGE1_TENANT_CODE:'STAGE1',REFS_STAGE1_TENANT_NAME:'Stage 1 tenant',
  REFS_STAGE1_ENTITY_ID:'22222222-2222-4222-8222-222222222222',REFS_STAGE1_ENTITY_CODE:'ENTITY_1',REFS_STAGE1_ENTITY_NAME:'Stage 1 entity',
  REFS_STAGE1_PERIOD_ID:'33333333-3333-4333-8333-333333333333',REFS_STAGE1_PERIOD_CODE:'2026-08',REFS_STAGE1_PERIOD_START:'2026-08-01',REFS_STAGE1_PERIOD_END:'2026-08-31',
  REFS_STAGE1_BASE_CURRENCY:'USD',REFS_STAGE1_CASH_ACCOUNT_CODE:'111000',REFS_STAGE1_PROVISION_IDEMPOTENCY_KEY:'stage1-provision-20260809-001',
  REFS_STAGE1_OIDC_SUBJECT:'auth0|observed-subject',REFS_STAGE1_GRANT_EXPECTED_VERSION:'0',REFS_STAGE1_GRANT_IDEMPOTENCY_KEY:'stage1-grant-20260809-001',REFS_STAGE1_GRANT_VALID_UNTIL:'2026-08-24T00:00:00.000Z',
};

test('Stage 1 bootstrap configuration is explicit, calendar-valid and fixed to minimal accounts and read permissions',()=>{
  const provision=stage1ProvisionConfig(base),grant=stage1GrantConfig(base);
  assert.deepEqual(provision.accounts.map(row=>row.accountCode),['111000','120200','291001']);
  assert.deepEqual(grant.permissions,STAGE1_READ_PERMISSIONS);
  assert.equal(grant.actorId,'auth0|observed-subject');
});

test('Stage 1 bootstrap refuses non-staging execution, invalid scope, incomplete months and account collisions',()=>{
  for(const environment of [
    {...base,NODE_ENV:'test'},
    {...base,REFS_DEPLOYMENT_ENV:'production'},
    {...base,REFS_STAGE1_BOOTSTRAP_CONFIRM:'yes'},
    {...base,REFS_STAGE1_TENANT_ID:'not-a-uuid'},
    {...base,REFS_STAGE1_PERIOD_END:'2026-08-30'},
    {...base,REFS_STAGE1_CASH_ACCOUNT_CODE:'291001'},
  ])assert.throws(()=>stage1ProvisionConfig(environment),error=>error.code==='STAGE1_BOOTSTRAP_ENV_DENIED'||error.code==='STAGE1_BOOTSTRAP_CONFIG_INVALID');
  assert.throws(()=>stage1GrantConfig({...base,REFS_STAGE1_OIDC_SUBJECT:' '}),error=>error.code==='STAGE1_BOOTSTRAP_CONFIG_MISSING');
});

test('self-service reader activation is disabled unless the explicit staging-only flag is present',()=>{
  assert.equal(stage1SelfGrantConfig(base),null);
  const config=stage1SelfGrantConfig({...base,REFS_STAGE1_SELF_GRANT_ENABLED:'STAGE1_AUTHORITATIVE_ONLY'});
  assert.deepEqual(config.permissions,STAGE1_READ_PERMISSIONS);
  assert.equal(config.expectedVersion,0);
  assert.throws(()=>stage1SelfGrantConfig({...base,REFS_STAGE1_SELF_GRANT_ENABLED:'STAGE1_AUTHORITATIVE_ONLY',REFS_DEPLOYMENT_ENV:'production'}),error=>error.code==='STAGE1_BOOTSTRAP_ENV_DENIED');
});

test('self-service WBS reader upgrade is retired in favor of workflow grants',()=>{
  assert.equal(stage1SelfWbsReadUpgradeConfig(base),null);
  assert.equal(stage1SelfWbsReadUpgradeConfig({...base,REFS_STAGE1_SELF_GRANT_ENABLED:'STAGE1_AUTHORITATIVE_ONLY'}),null);
});

test('self-service WBS operator upgrade is retired in favor of workflow grants',()=>{
  assert.equal(stage1SelfWbsOperatorUpgradeConfig(base),null);
  assert.equal(stage1SelfWbsOperatorUpgradeConfig({...base,REFS_STAGE1_SELF_GRANT_ENABLED:'STAGE1_AUTHORITATIVE_ONLY'}),null);
});

test('controlled test single-actor self-upgrade is no longer exposed',()=>{
  const enabled={...base,REFS_STAGE1_SELF_GRANT_ENABLED:'STAGE1_AUTHORITATIVE_ONLY',REFS_WBS_TEST_IMPORT_MODE:'ENABLED'};
  assert.equal(stage1SelfControlledTestWorkflowUpgradeConfig(base),null);
  assert.equal(stage1SelfControlledTestWorkflowUpgradeConfig(enabled),null);
  assert.equal(stage1SelfControlledTestWorkflowUpgradeConfig({...enabled,REFS_WBS_TEST_IMPORT_MODE:'DISABLED'}),null);
});

test('Stage 1 grant wrapper refuses an altered permission set before reaching PostgreSQL',async()=>{
  const config={...stage1GrantConfig(base),permissions:['AP.VIEW']};
  await assert.rejects(grantStage1ReadAccess({},config),error=>error.code==='STAGE1_GRANT_SCOPE_DENIED');
});

test('Stage 1 WBS upgrade wrapper refuses altered versions and permission sets before PostgreSQL',async()=>{
  const config={tenantId:base.REFS_STAGE1_TENANT_ID,entityId:base.REFS_STAGE1_ENTITY_ID,actorId:'auth0|reader',expectedVersion:1,authorityClass:'ANALYSIS',validUntil:base.REFS_STAGE1_GRANT_VALID_UNTIL,permissions:STAGE1_WBS_READ_PERMISSIONS,idempotencyKey:'wbs-read-upgrade-0001'};
  await assert.rejects(upgradeStage1WbsReadAccess({}, {...config,expectedVersion:0}),error=>error.code==='STAGE1_WBS_READ_UPGRADE_SCOPE_DENIED');
  await assert.rejects(upgradeStage1WbsReadAccess({}, {...config,permissions:[...STAGE1_READ_PERMISSIONS,'WBS.SNAPSHOT.IMPORT']}),error=>error.code==='STAGE1_WBS_READ_UPGRADE_SCOPE_DENIED');
  await assert.rejects(upgradeStage1WbsReadAccess({},config),error=>error.code==='STAGE1_WBS_READ_UPGRADE_RETIRED');
});

test('Stage 1 WBS operator wrapper refuses broader or altered grants before PostgreSQL',async()=>{
  const config={tenantId:base.REFS_STAGE1_TENANT_ID,entityId:base.REFS_STAGE1_ENTITY_ID,actorId:'auth0|reader',expectedVersion:2,authorityClass:'ATTEST',validUntil:base.REFS_STAGE1_GRANT_VALID_UNTIL,permissions:STAGE1_WBS_OPERATOR_PERMISSIONS,idempotencyKey:'wbs-operator-upgrade-0001'};
  await assert.rejects(upgradeStage1WbsOperatorAccess({}, {...config,expectedVersion:1}),error=>error.code==='STAGE1_WBS_OPERATOR_UPGRADE_SCOPE_DENIED');
  await assert.rejects(upgradeStage1WbsOperatorAccess({}, {...config,permissions:[...STAGE1_WBS_READ_PERMISSIONS,'WBS.SNAPSHOT.IMPORT']}),error=>error.code==='STAGE1_WBS_OPERATOR_UPGRADE_SCOPE_DENIED');
  await assert.rejects(upgradeStage1WbsOperatorAccess({},config),error=>error.code==='STAGE1_WBS_OPERATOR_UPGRADE_RETIRED');
});

test('controlled test workflow wrapper refuses altered versions and permissions before PostgreSQL',async()=>{
  const config={tenantId:base.REFS_STAGE1_TENANT_ID,entityId:base.REFS_STAGE1_ENTITY_ID,actorId:'auth0|reader',expectedVersion:3,permissions:STAGE1_CONTROLLED_TEST_WORKFLOW_PERMISSIONS,idempotencyKey:'controlled-test-upgrade-0001'};
  await assert.rejects(upgradeStage1ControlledTestWorkflowAccess({}, {...config,expectedVersion:2}),error=>error.code==='STAGE1_CONTROLLED_TEST_UPGRADE_SCOPE_DENIED');
  await assert.rejects(upgradeStage1ControlledTestWorkflowAccess({}, {...config,permissions:[...STAGE1_WBS_OPERATOR_PERMISSIONS,'WBS.TEST.IMPORT']}),error=>error.code==='STAGE1_CONTROLLED_TEST_UPGRADE_SCOPE_DENIED');
  await assert.rejects(upgradeStage1ControlledTestWorkflowAccess({},config),error=>error.code==='STAGE1_CONTROLLED_TEST_UPGRADE_RETIRED');
});

test('self-service read activation derives a rolling expiry and current grant revision on the server',async()=>{
  const calls=[];
  const sync={
    currentVersion:async input=>(calls.push(['version',input]),7),
    reconcile:async input=>(calls.push(['reconcile',input]),{idempotent:false,version:8,permissions:[...STAGE1_READ_PERMISSIONS]}),
  };
  const now=Date.parse('2026-08-29T12:00:00.000Z');
  const result=await grantStage1SelfReadAccess({query:async()=>({rows:[{asserted:true}]})}, {tenantId:base.REFS_STAGE1_TENANT_ID,entityId:base.REFS_STAGE1_ENTITY_ID,actorId:'auth0|reader',authorityClass:'ANALYSIS',permissions:[...STAGE1_READ_PERMISSIONS],idempotencyKey:'reader-activation-0001',expectedVersion:0,validUntil:'2026-08-24T00:00:00.000Z'}, {clock:()=>now,syncFactory:()=>sync});
  assert.deepEqual(result,{idempotent:false,version:8,permissionCount:5});
  assert.deepEqual(calls[0],['version',{tenantId:base.REFS_STAGE1_TENANT_ID,actorId:'auth0|reader',entityId:base.REFS_STAGE1_ENTITY_ID}]);
  assert.equal(calls[1][1].expectedVersion,7);
  assert.equal(calls[1][1].validUntil,'2026-08-30T11:00:00.000Z');
  assert.notEqual(calls[1][1].validUntil,base.REFS_STAGE1_GRANT_VALID_UNTIL);
});

test('Stage 1 runtime no longer calls legacy grant hashes or self-upgrade SQL wrappers',async()=>{
  const source=await import('node:fs/promises').then(({readFile})=>readFile(new URL('../runtime/stage1-bootstrap.mjs',import.meta.url),'utf8'));
  assert.doesNotMatch(source,/refs_grant_request_hash\(/);
  assert.doesNotMatch(source,/refs_upgrade_stage1_(?:wbs_autorec_read|wbs_operator_attest|controlled_test_workflow)\(/);
  for(const code of ['STAGE1_WBS_READ_UPGRADE_RETIRED','STAGE1_WBS_OPERATOR_UPGRADE_RETIRED','STAGE1_CONTROLLED_TEST_UPGRADE_RETIRED'])assert.match(source,new RegExp(code));
  assert.match(source,/authorityClass:config\.authorityClass,validUntil:config\.validUntil/);
});

test('authenticated Stage 1 grants derive only the verified access-token subject and reject tenant swaps before PostgreSQL',async()=>{
  const config=stage1AuthenticatedGrantConfig({...base,REFS_AUTHENTICATED_ACCESS_TOKEN:'opaque-access-token',OIDC_ISSUER:'https://issuer.example',OIDC_AUDIENCE:'refs-stage1',OIDC_JWKS_URI:'https://issuer.example/jwks'});
  assert.equal(Object.hasOwn(config,'actorId'),false);
  await assert.rejects(grantStage1AuthenticatedReadAccess({query:async()=>({rows:[{asserted:true}]})},config,{authenticator:{authenticate:async()=>({tenantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actorId:'auth0|swapped'})}}),error=>error.code==='STAGE1_GRANT_TENANT_DENIED');
});

test('Stage 1 CLI failure output contains only a stable code and never echoes configuration or secrets',()=>{
  const canary='stage1-secret-canary-never-log';
  const result=spawnSync(process.execPath,['tools/stage1-bootstrap.mjs','provision'],{
    cwd:serverRoot,
    encoding:'utf8',
    env:{...process.env,...base,REFS_STAGE1_TENANT_NAME:canary,MIGRATION_DATABASE_URL:''},
  });
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  assert.match(result.stderr,/^stage1-bootstrap: [A-Z0-9_]+\r?\n$/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(canary),false);
  assert.equal(`${result.stdout}${result.stderr}`.includes(base.REFS_STAGE1_TENANT_ID),false);
  assert.equal(`${result.stdout}${result.stderr}`.includes(base.REFS_STAGE1_OIDC_SUBJECT),false);
});
