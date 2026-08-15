import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import contract from '../api/openapi-accounting.json' with {type:'json'};

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const scheduleId='11111111-1111-4111-8111-111111111111',scheduleLineId='22222222-2222-4222-8222-222222222222',journalEntryId='33333333-3333-4333-8333-333333333333';
const path=`/api/v1/entities/${entityId}/ai/amortization/schedules/${scheduleId}/lines/${scheduleLineId}/acceptances`;
const body={journalEntryId,reason:'Controller confirmed the source coverage, month, accounts, and balanced Draft entry.'};
const result={ai_amortization_schedule_acceptance_id:'44444444-4444-4444-8444-444444444444',status:'ACCEPTED_FOR_STANDARD_JE_WORKFLOW',can_create_draft:false,can_review:false,can_approve:false,can_post:false,idempotent:false};

test('AI amortization acceptance binds a pre-existing standard Draft and retains normal journal workflow controls',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-b'}),kernelFactory:async()=>({acceptAiAmortizationSchedule:async input=>(seen.push(input),result)})});
  const response=await api({method:'POST',url:path,headers:{'idempotency-key':'amortization-acceptance-1'},body});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:result});
  assert.deepEqual(seen,[{tenantId,entityId,aiAmortizationScheduleId:scheduleId,aiAmortizationScheduleLineId:scheduleLineId,journalEntryId,reason:body.reason,idempotencyKey:'amortization-acceptance-1'}]);
});

test('AI amortization acceptance refuses client authority, body expansion, malformed IDs, and optimistic-write headers',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-b'}),kernelFactory:async()=>({acceptAiAmortizationSchedule:async()=>result})});
  for(const request of [
    {headers:{},body},{headers:{'idempotency-key':'amortization-acceptance-1','if-match':'"0"'},body},{headers:{'idempotency-key':'amortization-acceptance-1'},body:{...body,canPost:true}},{headers:{'idempotency-key':'amortization-acceptance-1'},body:{...body,journalEntryId:'bad'}},{headers:{'idempotency-key':'amortization-acceptance-1'},body:{...body,reason:'short'}}
  ])assert.equal((await api({method:'POST',url:path,...request})).status,400);
});

test('AI amortization acceptance fails closed when the controller-binding capability is absent',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-b'}),kernelFactory:async()=>({})});
  const response=await api({method:'POST',url:path,headers:{'idempotency-key':'amortization-acceptance-1'},body});assert.equal(response.status,503);assert.equal(response.body.code,'AI_AMORTIZATION_ACCEPTANCE_UNAVAILABLE');
});

test('OpenAPI describes controller acceptance as a binding to an existing Draft, not an AI posting path',()=>{
  const operation=contract.paths['/entities/{entityId}/ai/amortization/schedules/{scheduleId}/lines/{scheduleLineId}/acceptances'].post;
  assert.equal(operation.operationId,'acceptAiAmortizationSchedule');assert.match(operation.description,/existing, exact standard Draft JE/);assert.match(operation.description,/normal submit, review, approval, and posting remain separate/i);
});
