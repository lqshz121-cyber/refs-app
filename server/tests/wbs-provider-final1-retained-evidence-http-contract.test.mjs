import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c';
const entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const principal={trusted:true,tenantId,actorId:'oidc|wbs-provider-admission-service'};
const body={receipt:{signed:'receipt'},requestRawBase64:'cmVxdWVzdA==',responseRawBase64:'cmVzcG9uc2U=',packageRawBase64:'e30='};

function api(){
  const calls=[];
  const dispatch=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({}),wbsProviderFinal1RetainedEvidenceServiceFactory:async()=>({async admit(input){calls.push(input);return {status:'WBS_FINAL1_RETAINED_SOURCE_EVIDENCE',signature_verified:true,domain:input.domain,admission_id:'ca79111e-fbc5-4168-871d-aabd24813b18',idempotent:false,can_write_wbs:false,can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false};},async resumeInsurance(input){calls.push(input);return {status:'WBS_FINAL1_RETAINED_SOURCE_EVIDENCE',admission_id:'ca79111e-fbc5-4168-871d-aabd24813b18',idempotent:false};}})});
  return {dispatch,calls};
}

test('Insurance Phase B uses a dedicated exact observation/approval command with no raw artifacts',async()=>{
  const {dispatch,calls}=api(),observationId='55555555-5555-4555-8555-555555555555',approvalId='66666666-6666-4666-8666-666666666666';
  const payload={expectedObservationHash:'sha256:'+'a'.repeat(64),expectedApprovalId:approvalId,expectedDecisionHash:'sha256:'+'b'.repeat(64),expectedCompanyMappingHash:'sha256:'+'c'.repeat(64),reason:'Resume the exact retained versions after independent Controller approval.'};
  const response=await dispatch({method:'POST',url:`/api/v1/entities/${entityId}/wbs/provider-signed/final1/insurance/observations/${observationId}/admit`,headers:{'idempotency-key':'insurance-phase-b-resume-001'},body:payload});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.equal(calls.length,1);assert.equal(calls[0].observationId,observationId);assert.equal(calls[0].expectedApprovalId,approvalId);
  for(const forbidden of ['receipt','requestRawBase64','responseRawBase64','packageRawBase64','artifacts','storageRef'])assert.equal(Object.hasOwn(calls[0],forbidden),false);
});

for(const [segment,domain] of [['payables','PAYABLES'],['insurance','INSURANCE']])test(`Final-1 ${segment} admission is authenticated, strict, no-store, and no-action`,async()=>{
  const {dispatch,calls}=api();
  const response=await dispatch({method:'POST',url:`/api/v1/entities/${entityId}/wbs/provider-signed/final1/${segment}/admissions`,headers:{'idempotency-key':'wbs-final1-http-0001'},body});
  assert.equal(response.status,201);
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(calls.length,1);
  assert.equal(calls[0].domain,domain);
  assert.equal(calls[0].tenantId,tenantId);
  assert.equal(calls[0].entityId,entityId);
  assert.equal(response.body.data.can_write_wbs,false);
  assert.equal(response.body.data.can_post,false);
});

test('Final-1 admission rejects extra fields, queries, If-Match, and unavailable runtime',async()=>{
  for(const request of [
    {url:`/api/v1/entities/${entityId}/wbs/provider-signed/final1/payables/admissions?company=WBPA`,headers:{'idempotency-key':'wbs-final1-http-0001'},body},
    {url:`/api/v1/entities/${entityId}/wbs/provider-signed/final1/payables/admissions`,headers:{'idempotency-key':'wbs-final1-http-0001','if-match':'"0"'},body},
    {url:`/api/v1/entities/${entityId}/wbs/provider-signed/final1/payables/admissions`,headers:{'idempotency-key':'wbs-final1-http-0001'},body:{...body,companyCode:'WBPA'}}
  ]){
    const {dispatch,calls}=api();const response=await dispatch({method:'POST',...request});assert.equal(response.status,400);assert.equal(calls.length,0);
  }
  const dispatch=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({})});
  const unavailable=await dispatch({method:'POST',url:`/api/v1/entities/${entityId}/wbs/provider-signed/final1/payables/admissions`,headers:{'idempotency-key':'wbs-final1-http-0001'},body});
  assert.equal(unavailable.status,503);
  assert.equal(unavailable.body.code,'WBS_FINAL1_ADMISSION_UNAVAILABLE');
});
