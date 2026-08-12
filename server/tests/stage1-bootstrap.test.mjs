import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {STAGE1_READ_PERMISSIONS,grantStage1AuthenticatedReadAccess,grantStage1ReadAccess,stage1AuthenticatedGrantConfig,stage1GrantConfig,stage1ProvisionConfig,stage1SelfGrantConfig} from '../runtime/stage1-bootstrap.mjs';

const serverRoot=fileURLToPath(new URL('..',import.meta.url));

const base={
  NODE_ENV:'production',REFS_DEPLOYMENT_ENV:'staging',REFS_STAGE1_BOOTSTRAP_CONFIRM:'STAGE1_AUTHORITATIVE_ONLY',
  REFS_STAGE1_TENANT_ID:'11111111-1111-4111-8111-111111111111',REFS_STAGE1_TENANT_CODE:'STAGE1',REFS_STAGE1_TENANT_NAME:'Stage 1 tenant',
  REFS_STAGE1_ENTITY_ID:'22222222-2222-4222-8222-222222222222',REFS_STAGE1_ENTITY_CODE:'ENTITY_1',REFS_STAGE1_ENTITY_NAME:'Stage 1 entity',
  REFS_STAGE1_PERIOD_ID:'33333333-3333-4333-8333-333333333333',REFS_STAGE1_PERIOD_CODE:'2026-08',REFS_STAGE1_PERIOD_START:'2026-08-01',REFS_STAGE1_PERIOD_END:'2026-08-31',
  REFS_STAGE1_BASE_CURRENCY:'USD',REFS_STAGE1_CASH_ACCOUNT_CODE:'111000',REFS_STAGE1_PROVISION_IDEMPOTENCY_KEY:'stage1-provision-20260809-001',
  REFS_STAGE1_OIDC_SUBJECT:'auth0|observed-subject',REFS_STAGE1_GRANT_EXPECTED_VERSION:'0',REFS_STAGE1_GRANT_IDEMPOTENCY_KEY:'stage1-grant-20260809-001',
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

test('Stage 1 grant wrapper refuses an altered permission set before reaching PostgreSQL',async()=>{
  const config={...stage1GrantConfig(base),permissions:['AP.VIEW']};
  await assert.rejects(grantStage1ReadAccess({},config),error=>error.code==='STAGE1_GRANT_SCOPE_DENIED');
});

test('authenticated Stage 1 grants derive only the verified access-token subject and reject tenant swaps before PostgreSQL',async()=>{
  const config=stage1AuthenticatedGrantConfig({...base,REFS_AUTHENTICATED_ACCESS_TOKEN:'opaque-access-token',OIDC_ISSUER:'https://issuer.example',OIDC_AUDIENCE:'refs-stage1',OIDC_JWKS_URI:'https://issuer.example/jwks'});
  assert.equal(Object.hasOwn(config,'actorId'),false);
  await assert.rejects(grantStage1AuthenticatedReadAccess({},config,{authenticator:{authenticate:async()=>({tenantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actorId:'auth0|swapped'})}}),error=>error.code==='STAGE1_GRANT_TENANT_DENIED');
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
