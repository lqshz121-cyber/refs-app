import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import contract from '../api/openapi-accounting.json' with {type:'json'};

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const scheduleId='11111111-1111-4111-8111-111111111111',lineId='22222222-2222-4222-8222-222222222222';
const path=`/api/v1/entities/${entityId}/ai/amortization/schedules/${scheduleId}/drafts`;
const body={periodId:'33333333-3333-4333-8333-333333333333',scheduleLineId:lineId,expectedProposalHash:'sha256:'+'1'.repeat(64),attachmentIds:['44444444-4444-4444-8444-444444444444'],reason:'Controller converts the retained July schedule line into a standard Draft for review.'};
const result={ai_amortization_draft_evidence_id:'55555555-5555-4555-8555-555555555555',journal_entry_id:'66666666-6666-4666-8666-666666666666',journal_type:'MANUAL',status:'DRAFT',can_create_draft:false,can_review:false,can_approve:false,can_post:false,idempotent:false};

test('AI amortization Draft is a separately authorised human command and stops before standard JE workflow transitions',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'human-draft-maker'}),kernelFactory:async()=>({createAiAmortizationDraft:async input=>(seen.push(input),result)})});
  const response=await api({method:'POST',url:path,headers:{'idempotency-key':'ai-amortization-draft-0001'},body});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:result});
  assert.deepEqual(seen,[{tenantId,entityId,aiAmortizationScheduleId:scheduleId,aiAmortizationScheduleLineId:lineId,periodId:body.periodId,expectedProposalHash:body.expectedProposalHash,attachmentIds:body.attachmentIds,reason:body.reason,idempotencyKey:'ai-amortization-draft-0001'}]);
});

test('AI amortization Draft rejects authority escalation, stale/ambiguous evidence, and malformed command envelopes',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'human-draft-maker'}),kernelFactory:async()=>({createAiAmortizationDraft:async()=>result})});
  for(const request of [
    {headers:{},body},{headers:{'idempotency-key':'ai-amortization-draft-0001','if-match':'"0"'},body},{headers:{'idempotency-key':'ai-amortization-draft-0001'},body:{...body,can_post:true}},{headers:{'idempotency-key':'ai-amortization-draft-0001'},body:{...body,attachmentIds:[]}},{headers:{'idempotency-key':'ai-amortization-draft-0001'},body:{...body,expectedProposalHash:'sha256:bad'}}
  ])assert.equal((await api({method:'POST',url:path,...request})).status,400);
});

test('AI amortization Draft fails closed when the controlled kernel capability is absent',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'human-draft-maker'}),kernelFactory:async()=>({})});
  const response=await api({method:'POST',url:path,headers:{'idempotency-key':'ai-amortization-draft-0001'},body});assert.equal(response.status,503);assert.equal(response.body.code,'AI_AMORTIZATION_DRAFT_UNAVAILABLE');
});

test('OpenAPI exposes a human controlled standard Draft, never an AI review or post command',()=>{
  const operation=contract.paths['/entities/{entityId}/ai/amortization/schedules/{aiAmortizationScheduleId}/drafts'].post;
  assert.equal(operation.operationId,'createAiAmortizationDraft');assert.match(operation.description,/resulting standard MANUAL Draft/);
  const request=contract.components.schemas.AiAmortizationDraftRequest;
  assert.equal(request.additionalProperties,false);assert.deepEqual(request.required,Object.keys(body));
});
