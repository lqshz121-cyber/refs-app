import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',actorId='authenticated-test-user';
const result={status:'CONTROLLED_TEST_AI_WORKFLOW_POSTED',test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY',idempotent:false,parent_source_document_id:'33333333-3333-4333-8333-333333333333',source_document_id:'44444444-4444-4444-8444-444444444444',ai_amortization_schedule_id:'55555555-5555-4555-8555-555555555555',journal_entry_id:'66666666-6666-4666-8666-666666666666',posting_batch_id:'77777777-7777-4777-8777-777777777777'};
const body={periodId:'88888888-8888-4888-8888-888888888888',parentSourceDocumentId:result.parent_source_document_id,coverageStart:'2026-08-01',coverageEnd:'2026-08-31',reason:'Run isolated test workflow'};

test('controlled test AI route binds authenticated identity and returns a closed no-store receipt',async()=>{
  let received;
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId}),kernelFactory:async()=>({}),controlledTestAiWorkflowServiceFactory:async()=>({run:async input=>(received=input,result)})});
  const response=await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/controlled-test-workflow/run`,headers:{authorization:'Bearer test','idempotency-key':'controlled-test-http-001'},body});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:result});
  assert.deepEqual(received,{tenantId,entityId,periodId:body.periodId,parentSourceDocumentId:body.parentSourceDocumentId,coverageStart:body.coverageStart,coverageEnd:body.coverageEnd,reason:body.reason,initiatedBy:actorId,idempotencyKey:'controlled-test-http-001'});
});

test('controlled test AI route returns 201 initially and 200 for an exact same-key POSTED replay',async()=>{
  let calls=0;
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId}),kernelFactory:async()=>({}),controlledTestAiWorkflowServiceFactory:async()=>({run:async()=>({...result,idempotent:calls++>0})})});
  const request={method:'POST',url:`/api/v1/entities/${entityId}/ai/controlled-test-workflow/run`,headers:{authorization:'Bearer test','idempotency-key':'controlled-test-http-replay-001'},body};
  const first=await api(request),replay=await api(request);
  assert.equal(first.status,201);assert.equal(first.body.data.idempotent,false);
  assert.equal(replay.status,200);assert.equal(replay.body.data.idempotent,true);assert.equal(replay.headers['cache-control'],'no-store');
});

test('controlled test AI route returns a closed resumable PARTIAL receipt without hiding durable progress',async()=>{
  const partial={status:'CONTROLLED_TEST_AI_WORKFLOW_PARTIAL',test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY',retryable:true,completed_stage:'DRAFT_CREATED',idempotency_key:'controlled-test-http-partial-001',parent_source_document_id:result.parent_source_document_id,source_document_id:result.source_document_id,ai_amortization_schedule_id:result.ai_amortization_schedule_id,journal_entry_id:result.journal_entry_id,posting_batch_id:null};
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId}),kernelFactory:async()=>({}),controlledTestAiWorkflowServiceFactory:async()=>({run:async()=>partial})});
  const response=await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/controlled-test-workflow/run`,headers:{authorization:'Bearer test','idempotency-key':partial.idempotency_key},body});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:partial});
});

test('controlled test AI route rejects body identity injection and does not expose a service when disabled',async()=>{
  const auth=async()=>({trusted:true,tenantId,actorId});
  const injected=await createAccountingApi({authenticate:auth,kernelFactory:async()=>({})})({method:'POST',url:`/api/v1/entities/${entityId}/ai/controlled-test-workflow/run`,headers:{'idempotency-key':'controlled-test-http-002'},body:{...body,actorId:'attacker'}});
  assert.equal(injected.status,400);assert.equal(injected.body.code,'IDENTITY_FIELD_FORBIDDEN');
  const disabled=await createAccountingApi({authenticate:auth,kernelFactory:async()=>({})})({method:'POST',url:`/api/v1/entities/${entityId}/ai/controlled-test-workflow/run`,headers:{'idempotency-key':'controlled-test-http-003'},body});
  assert.equal(disabled.status,404);assert.equal(disabled.body.code,'ROUTE_NOT_FOUND');
});
