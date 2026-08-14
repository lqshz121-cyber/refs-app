import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import contract from '../api/openapi-accounting.json' with {type:'json'};

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const path=`/api/v1/entities/${entityId}/ai/amortization/proposals`;
const body={sourceDocumentId:'11111111-1111-4111-8111-111111111111',sourcePayloadHash:'sha256:'+'1'.repeat(64),coverageStart:'2026-01-01',coverageEnd:'2026-12-31',prepaidAccountCode:'141100',expenseAccountCode:'660100',memberTrace:{project_ref:null,property_ref:null,allocation_basis:'ENTITY_ONLY'},confidence:0.95,reason:'Retained insurance policy evidence supports a whole-month prepaid proposal.'};
const result={ai_amortization_schedule_id:'22222222-2222-4222-8222-222222222222',status:'PROPOSED',can_create_draft:false,can_review:false,can_approve:false,can_post:false,idempotent:false};

test('AI amortization proposal is authenticated, idempotent, and stops before a Draft',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({proposeAiAmortizationSchedule:async input=>(seen.push(input),result)})});
  const response=await api({method:'POST',url:path,headers:{'idempotency-key':'amortization-proposal-1'},body});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:result});assert.deepEqual(seen,[{tenantId,entityId,sourceDocumentId:body.sourceDocumentId,sourcePayloadHash:body.sourcePayloadHash,coverageStart:body.coverageStart,coverageEnd:body.coverageEnd,prepaidAccountCode:body.prepaidAccountCode,expenseAccountCode:body.expenseAccountCode,memberTrace:body.memberTrace,confidence:body.confidence,reason:body.reason,idempotencyKey:'amortization-proposal-1'}]);
});

test('AI amortization proposal rejects authority escalation and malformed source evidence',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({proposeAiAmortizationSchedule:async()=>result})});
  for(const request of [
    {headers:{},body},{headers:{'idempotency-key':'amortization-proposal-1','if-match':'"0"'},body},{headers:{'idempotency-key':'amortization-proposal-1'},body:{...body,can_post:true}},{headers:{'idempotency-key':'amortization-proposal-1'},body:{...body,coverageEnd:'2026-12-30'}},{headers:{'idempotency-key':'amortization-proposal-1'},body:{...body,memberTrace:{project_ref:'P-1',property_ref:null,allocation_basis:'ENTITY_ONLY'}}},{headers:{'idempotency-key':'amortization-proposal-1'},body:{...body,sourcePayloadHash:'sha256:bad'}}
  ])assert.equal((await api({method:'POST',url:path,...request})).status,400);
});

test('AI amortization proposal fails closed when persistence capability is absent',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({})});
  const response=await api({method:'POST',url:path,headers:{'idempotency-key':'amortization-proposal-1'},body});assert.equal(response.status,503);assert.equal(response.body.code,'AI_AMORTIZATION_PROPOSAL_UNAVAILABLE');
});

test('OpenAPI describes an immutable no-action proposal, never a Draft or posting command',()=>{
  const operation=contract.paths['/entities/{entityId}/ai/amortization/proposals'].post;
  assert.equal(operation.operationId,'proposeAiAmortizationSchedule');assert.match(operation.description,/cannot create a Draft JE/);
  const request=contract.components.schemas.AiAmortizationProposalRequest;
  assert.equal(request.additionalProperties,false);assert.deepEqual(request.required,Object.keys(body));
});
