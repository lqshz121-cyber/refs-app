import test from 'node:test';import assert from 'node:assert/strict';
import {createBoundedBankRequestAuthorizer,boundedBankRequestConfig} from '../runtime/bounded-bank-request-authorizer.mjs';
const tenantId='11111111-1111-4111-a111-111111111111',entityId='22222222-2222-4222-a222-222222222222',periodId='33333333-3333-4333-a333-333333333333';
const scope={tenantId,entityId,companyCode:'WBPA',periodId,dateFrom:'2026-06-01',dateTo:'2026-06-30'};
const selection={...scope,periodId,dateFrom:'2026-06-01',dateTo:'2026-06-30',limit:10};
test('request startup mode defaults disabled and requires exact staging pilot configuration',()=>{
  assert.equal(boundedBankRequestConfig({},scope),null);
  const env={REFS_WBS_BANK_REQUEST_MODE:'ENABLED',REFS_DEPLOYMENT_ENV:'staging',REFS_WBS_BANK_REQUEST_PERIOD_ID:periodId,REFS_WBS_BANK_REQUEST_DATE_FROM:'2026-06-01',REFS_WBS_BANK_REQUEST_DATE_TO:'2026-06-30'};
  assert.deepEqual(boundedBankRequestConfig(env,scope),scope);
  for(const change of [{REFS_DEPLOYMENT_ENV:'production'},{REFS_WBS_BANK_REQUEST_MODE:'AUTO'},{REFS_WBS_BANK_REQUEST_PERIOD_ID:''},{REFS_WBS_BANK_REQUEST_DATE_TO:'2026-07-01'}])assert.throws(()=>boundedBankRequestConfig({...env,...change},scope),{code:'WBS_BANK_REQUEST_CONFIG_INVALID'});
});
test('bounded request invokes exact authenticated kernel, without issuing authority',async()=>{const calls=[];const authorize=createBoundedBankRequestAuthorizer({scope,kernel:{async assertBoundedWbsBankImportRequest(value){calls.push(value);}}});assert.equal(await authorize(selection),true);assert.deepEqual(calls,[selection]);});
test('out-of-scope selections deny before kernel access',async()=>{let calls=0;const authorize=createBoundedBankRequestAuthorizer({scope,kernel:{async assertBoundedWbsBankImportRequest(){calls++;}}});for(const change of [{tenantId:entityId},{entityId:tenantId},{companyCode:'OTHER'},{periodId:null},{limit:0},{limit:11},{dateFrom:'2026-06-02'},{dateTo:'2026-07-01'},{dateFrom:'2026-07-01',dateTo:'2026-07-31'}])await assert.rejects(authorize({...selection,...change}),{code:'WBS_BANK_REQUEST_SCOPE_DENIED'});assert.equal(calls,0);});
test('kernel authorization denial is never converted into permission or fallback',async()=>{const denial=new Error('revoked');const authorize=createBoundedBankRequestAuthorizer({scope,kernel:{async assertBoundedWbsBankImportRequest(){throw denial;}}});await assert.rejects(authorize(selection),error=>error===denial);assert.throws(()=>createBoundedBankRequestAuthorizer({scope,kernel:{}}),{code:'WBS_BANK_REQUEST_CONFIG_INVALID'});});
test('another H1 month or period identity cannot expand the configured June pilot',async()=>{
  let calls=0;const authorize=createBoundedBankRequestAuthorizer({scope,kernel:{async assertBoundedWbsBankImportRequest(){calls++;}}});
  for(const change of [{periodId:tenantId},{dateFrom:'2026-05-01',dateTo:'2026-05-31'}])await assert.rejects(authorize({...selection,...change}),{code:'WBS_BANK_REQUEST_SCOPE_DENIED'});
  assert.equal(calls,0);
});
test('body-supplied actor and authority are not forwarded to the authenticated kernel',async()=>{
  let request;const configured={...scope};const authorize=createBoundedBankRequestAuthorizer({scope:configured,kernel:{async assertBoundedWbsBankImportRequest(value){request=value;}}});
  configured.companyCode='OTHER';
  await authorize({...selection,actorId:'service-importer',principalKind:'SERVICE',permissions:['WBS.TEST.IMPORT'],trusted:true});
  assert.deepEqual(request,selection);
});
test('incomplete or impossible configured scope fails before returning an authorizer',()=>{
  const kernel={async assertBoundedWbsBankImportRequest(){assert.fail('invalid configuration');}};
  for(const change of [{periodId:null},{dateFrom:'2026-07-01',dateTo:'2026-07-31'},{dateTo:'2026-06-31'},{dateFrom:undefined}])assert.throws(()=>createBoundedBankRequestAuthorizer({scope:{...scope,...change},kernel}),{code:'WBS_BANK_REQUEST_CONFIG_INVALID'});
});
