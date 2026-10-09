import test from 'node:test';
import assert from 'node:assert/strict';
import {preauthorizedBankAccessConfig,createPreauthorizedBankAccess,assertPreauthorizedStagingTarget} from '../runtime/preauthorized-bank-access.mjs';
import {BANK_REQUEST_ACCOUNTING_VIEW_ROLE} from '../runtime/bank-request-settings-role.mjs';
const now=Date.parse('2026-10-09T12:00:00.000Z');
const env={NODE_ENV:'production',REFS_DEPLOYMENT_ENV:'staging',REFS_PREAUTHORIZED_BANK_ACCESS_MODE:'ENABLED',REFS_PREAUTHORIZED_BANK_ACCESS_CONFIRM:'FIXED_HUMAN_BANK_REQUEST_AND_READ_ONLY',REFS_PREAUTHORIZED_BANK_ACCESS_TENANT_ID:'6fb25daf-0799-4805-bede-be54230da33c',REFS_PREAUTHORIZED_BANK_ACCESS_ENTITY_ID:'1cfa5b82-7f38-461e-aa58-f94c5f824292',REFS_PREAUTHORIZED_BANK_ACCESS_ACTOR_ID:'oidc|approved-human',REFS_PREAUTHORIZED_BANK_ACCESS_EXPECTED_VERSION:'4',REFS_PREAUTHORIZED_BANK_ACCESS_VALID_UNTIL:'2026-10-10T11:00:00.000Z',REFS_EXPECTED_INSTALLATION_ID:'11111111-1111-4111-8111-111111111111',REFS_EXPECTED_DATABASE_NAME:'owned_staging'};
const config=()=>preauthorizedBankAccessConfig(env,now);
const principal={trusted:true,tenantId:env.REFS_PREAUTHORIZED_BANK_ACCESS_TENANT_ID,actorId:env.REFS_PREAUTHORIZED_BANK_ACCESS_ACTOR_ID};
test('preauthorization requires registered exact staging identity rather than legacy unregistered fallback',async()=>{
  let query;
  await assertPreauthorizedStagingTarget({query:async(sql,args)=>{query={sql,args};return {rows:[{asserted:true}]};}},{installationId:config().installationId,expectedDatabase:config().expectedDatabase});
  assert.equal(query.sql,'SELECT refs_assert_deployment_identity($1,$2,$3) AS asserted');assert.deepEqual(query.args,[config().installationId,'staging',config().expectedDatabase]);
  await assert.rejects(assertPreauthorizedStagingTarget({query:async()=>({rows:[{asserted:false}]})},{installationId:config().installationId,expectedDatabase:config().expectedDatabase}),{code:'DEPLOYMENT_IDENTITY_DENIED'});
});
test('activation captures identity and rejects malformed direct configuration and revision receipts',async()=>{
  for(const change of [{validUntil:'invalid'},{expectedVersion:-1},{installationId:'invalid'},{expectedDatabase:''}])assert.throws(()=>createPreauthorizedBankAccess({config:{...config(),...change},principal}),{code:'PREAUTHORIZED_ACCESS_DENIED'});
  const mutablePrincipal={...principal};let observedActor;
  const service=createPreauthorizedBankAccess({pool:{},config:config(),principal:mutablePrincipal,clock:()=>now,assertTarget:async()=>{},syncFactory:()=>({reconcile:async input=>{observedActor=input.actorId;return {permissions:input.permissions,authority_class:input.authorityClass,valid_until:input.validUntil,version:99};}})});
  mutablePrincipal.actorId='oidc|not-approved';
  await assert.rejects(service.activate({entityId:config().entityId,idempotencyKey:'approved-bank-access-v1'}),{code:'PREAUTHORIZED_ACCESS_RESULT_INVALID'});
  assert.equal(observedActor,principal.actorId);
});
test('preauthorization is disabled by default and requires exact finite staging policy',()=>{
  assert.equal(preauthorizedBankAccessConfig({}),null);
  assert.ok(Object.isFrozen(config()));
  for(const change of [{REFS_DEPLOYMENT_ENV:'production'},{REFS_PREAUTHORIZED_BANK_ACCESS_CONFIRM:''},{REFS_PREAUTHORIZED_BANK_ACCESS_VALID_UNTIL:'2026-10-10T12:00:00.000Z'},{REFS_PREAUTHORIZED_BANK_ACCESS_EXPECTED_VERSION:''},{REFS_EXPECTED_INSTALLATION_ID:''}])assert.throws(()=>preauthorizedBankAccessConfig({...env,...change},now),{code:'PREAUTHORIZED_ACCESS_DENIED'});
});
test('wrong subject tenant untrusted and internal identities cannot activate administrator policy',()=>{
  for(const change of [{trusted:false},{internalTest:true},{actorId:'oidc|other'},{tenantId:'other'}])assert.throws(()=>createPreauthorizedBankAccess({config:config(),principal:{...principal,...change}}),{code:'PREAUTHORIZED_ACCESS_DENIED'});
});
test('activation uses fixed ten-permission bundle, staging transaction guard and expected revision',async()=>{
  let request,options,guards=0;
  const service=createPreauthorizedBankAccess({pool:{},config:config(),principal,clock:()=>now,assertTarget:async()=>{guards++;},syncFactory:(p,o)=>{options=o;return {reconcile:async input=>{request=input;await o.principalProvider();await o.transactionGuard({});return {permissions:input.permissions,authority_class:input.authorityClass,valid_until:input.validUntil,version:5};}};}});
  const result=await service.activate({entityId:config().entityId,idempotencyKey:'approved-bank-access-v1'});
  assert.equal(result.version,5);assert.equal(result.permissionCount,10);assert.equal(guards,3);assert.equal(typeof options.transactionGuard,'function');assert.equal(request.actorId,principal.actorId);assert.equal(request.expectedVersion,4);assert.deepEqual(request.permissions,[...BANK_REQUEST_ACCOUNTING_VIEW_ROLE.permissions]);
  assert.ok(!request.permissions.some(p=>/POST|APPROVE|WBS\.TEST\.IMPORT$/.test(p)));
});
test('wrong entity expiry and mismatched grant receipt fail closed',async()=>{
  let called=0;
  const base={pool:{},config:config(),principal,clock:()=>now,assertTarget:async()=>{},syncFactory:()=>({reconcile:async()=>{called++;return {permissions:[]};}})};
  await assert.rejects(createPreauthorizedBankAccess(base).activate({entityId:'other',idempotencyKey:'approved-bank-access-v1'}),{code:'PREAUTHORIZED_ACCESS_DENIED'});assert.equal(called,0);
  await assert.rejects(createPreauthorizedBankAccess({...base,clock:()=>Date.parse(env.REFS_PREAUTHORIZED_BANK_ACCESS_VALID_UNTIL)}).activate({entityId:config().entityId,idempotencyKey:'approved-bank-access-v1'}),{code:'PREAUTHORIZED_ACCESS_DENIED'});assert.equal(called,0);
  await assert.rejects(createPreauthorizedBankAccess(base).activate({entityId:config().entityId,idempotencyKey:'approved-bank-access-v1'}),{code:'PREAUTHORIZED_ACCESS_RESULT_INVALID'});
});
test('policy status verifies fixed target without reconciling permissions',async()=>{
  let targetChecks=0;
  const service=createPreauthorizedBankAccess({pool:{},config:config(),principal,clock:()=>now,assertTarget:async()=>{targetChecks++;},syncFactory:()=>assert.fail('status must not grant')});
  const result=await service.describe({entityId:config().entityId});assert.equal(result.permissionCount,10);assert.equal(result.expectedVersion,4);assert.equal(targetChecks,1);
  await assert.rejects(service.describe({entityId:'other'}),{code:'PREAUTHORIZED_ACCESS_DENIED'});assert.equal(targetChecks,1);
});
