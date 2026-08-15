import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import contract from '../api/openapi-accounting.json' with {type:'json'};

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const path=`/api/v1/entities/${entityId}/ai/amortization/coverage-evidence`;
const body={sourceDocumentId:'11111111-1111-4111-8111-111111111111',sourcePayloadHash:'sha256:'+'1'.repeat(64),coverageStart:'2026-01-01',coverageEnd:'2026-12-31',evidenceRef:'source_attachment:policy.pdf#coverage',evidenceHash:'sha256:'+'2'.repeat(64),extractionMethod:'SIGNED_ATTACHMENT_FIELD'};
const result={ai_amortization_coverage_evidence_id:'22222222-2222-4222-8222-222222222222',can_create_draft:false,can_review:false,can_approve:false,can_post:false,idempotent:false};

test('AI amortization coverage evidence is authenticated, idempotent, source-bound, and grants no accounting action',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({recordAiAmortizationCoverageEvidence:async input=>(seen.push(input),result)})});
  const response=await api({method:'POST',url:path,headers:{'idempotency-key':'coverage-evidence-1'},body});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:result});assert.deepEqual(seen,[{tenantId,entityId,...body,idempotencyKey:'coverage-evidence-1'}]);
});

test('AI amortization coverage evidence rejects escalation, non-retained evidence, and malformed coverage',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({recordAiAmortizationCoverageEvidence:async()=>result})});
  for(const request of [
    {headers:{},body},{headers:{'idempotency-key':'coverage-evidence-1','if-match':'"0"'},body},{headers:{'idempotency-key':'coverage-evidence-1'},body:{...body,can_post:true}},{headers:{'idempotency-key':'coverage-evidence-1'},body:{...body,coverageEnd:'2026-12-30'}},{headers:{'idempotency-key':'coverage-evidence-1'},body:{...body,evidenceHash:'sha256:bad'}},{headers:{'idempotency-key':'coverage-evidence-1'},body:{...body,extractionMethod:'MODEL_GUESS'}}
  ])assert.equal((await api({method:'POST',url:path,...request})).status,400);
});

test('AI amortization coverage evidence fails closed when persistence is absent or response grants action',async()=>{
  const absent=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({})});
  const missing=await absent({method:'POST',url:path,headers:{'idempotency-key':'coverage-evidence-1'},body});assert.equal(missing.status,503);assert.equal(missing.body.code,'AI_AMORTIZATION_COVERAGE_EVIDENCE_UNAVAILABLE');
  const escalated=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({recordAiAmortizationCoverageEvidence:async()=>({...result,can_post:true})})});
  assert.equal((await escalated({method:'POST',url:path,headers:{'idempotency-key':'coverage-evidence-1'},body})).status,500);
});

test('OpenAPI describes immutable retained evidence, not a Draft or posting command',()=>{
  const operation=contract.paths['/entities/{entityId}/ai/amortization/coverage-evidence'].post;
  assert.equal(operation.operationId,'recordAiAmortizationCoverageEvidence');assert.match(operation.description,/cannot create a Draft JE/);
  const request=contract.components.schemas.AiAmortizationCoverageEvidenceRequest;
  assert.equal(request.additionalProperties,false);assert.deepEqual(request.required,Object.keys(body));
});
