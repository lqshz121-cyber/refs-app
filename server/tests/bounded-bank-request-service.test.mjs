import test from 'node:test';import assert from 'node:assert/strict';
import {createWbsTestImportService,WBS_TEST_IMPORT_GRANT_BUNDLES} from '../runtime/wbs-test-import-service.mjs';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {createBoundedBankRequestAuthorizer} from '../runtime/bounded-bank-request-authorizer.mjs';
const tenantId='11111111-1111-4111-a111-111111111111',entityId='22222222-2222-4222-a222-222222222222',periodId='33333333-3333-4333-a333-333333333333';
const scope={tenantId,entityId,companyCode:'WBPA',actors:Object.fromEntries(Object.keys(WBS_TEST_IMPORT_GRANT_BUNDLES).map(role=>[role,`isolated-${role}`]))};
const input={tenantId,entityId,periodId,companyCode:'WBPA',dateFrom:'2026-06-01',dateTo:'2026-06-30',limit:10,idempotencyKey:'bounded-request-service-01'};
test('bounded caller denial precedes Provider and service kernels, without legacy fallback',async()=>{
  let calls=0;const denial=new Error('human request revoked');
  const {idempotencyKey,...expected}=input;
  const service=createWbsTestImportService({scope,authorizeBoundedBankRequest:async value=>{assert.deepEqual(value,expected);throw denial;},authorizeBank:async()=>{calls++;},pilotService:{async readObservation(){calls++;}},kernelForActor:()=>{calls++;}});
  await assert.rejects(service.importBankTransactions(input),error=>error===denial);assert.equal(calls,0);
});
test('bounded import permission does not authorize month-range import',async()=>{
  let bounded=0,reads=0;const denied=new Error('legacy range denied');
  const service=createWbsTestImportService({scope,authorizeBoundedBankRequest:async()=>{bounded++;},authorizeBank:async()=>{throw denied;},pilotService:{async readObservation(){reads++;},async readObservationPage(){reads++;}},kernelForActor:()=>assert.fail('range denial precedes kernels')});
  await assert.rejects(service.importRange({...input,pageSize:10}),error=>error===denied);assert.equal(bounded,0);assert.equal(reads,0);
});

test('authenticated HTTP request reaches bounded authorization before any Provider or service actor access',async()=>{
  const calls=[];
  const configured={tenantId,entityId,periodId,companyCode:input.companyCode,dateFrom:input.dateFrom,dateTo:input.dateTo};
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'human-bank-requester'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async principal=>{
    assert.equal(principal.actorId,'human-bank-requester');
    return createWbsTestImportService({scope,authorizeBoundedBankRequest:createBoundedBankRequestAuthorizer({scope:configured,kernel:{async assertBoundedWbsBankImportRequest(args){calls.push(args);throw Object.assign(new Error('formal request grant denied'),{code:'42501'});}}}),authorizeBank:async()=>assert.fail('no legacy fallback'),pilotService:{async readObservation(){assert.fail('denial precedes Provider');}},kernelForActor:()=>assert.fail('denial precedes service actor')});
  }});
  const {tenantId:ignoredTenant,entityId:ignoredEntity,idempotencyKey,...body}=input;
  const request={method:'POST',url:`/api/v1/entities/${entityId}/wbs/test-import/bank-transactions`,headers:{'idempotency-key':idempotencyKey},body};
  const response=await api(request);
  assert.equal(response.status,403);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0],{...configured,limit:10});
  assert.equal((await api({...request,body:{...body,actorId:'service-importer'}})).status,400);
  assert.equal(calls.length,1);
});
