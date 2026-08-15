import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import contract from '../api/openapi-accounting.json' with {type:'json'};

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const path=`/api/v1/entities/${entityId}/ai/amortization/coverage-evidence`;
const row={ai_amortization_coverage_evidence_id:'11111111-1111-4111-8111-111111111111',source_document_id:'22222222-2222-4222-8222-222222222222',source_payload_hash:'sha256:'+'1'.repeat(64),source_document_version:2,coverage_start:'2026-01-01',coverage_end:'2026-12-31',evidence_ref:'source_attachment:insurance-policy.pdf#coverage',evidence_hash:'sha256:'+'2'.repeat(64),extraction_method:'SIGNED_ATTACHMENT_FIELD',coverage_hash:'sha256:'+'3'.repeat(64),created_by:'controller-a',created_at:'2026-08-15T00:00:00.000Z',can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('AI amortization coverage evidence read is authenticated, no-store, bounded, and cannot become a command',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'viewer-a'}),kernelFactory:async()=>({listAiAmortizationCoverageEvidence:async input=>(seen.push(input),[row])})});
  const response=await api({method:'GET',url:`${path}?limit=1`,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:[row]});assert.deepEqual(seen,[{tenantId,entityId,limit:1}]);
  for(const request of [{url:`${path}?limit=0`,headers:{},body:null},{url:path,headers:{'idempotency-key':'must-not-accept'},body:null},{url:path,headers:{},body:{}}])assert.equal((await api({method:'GET',...request})).status,400);
});

test('AI amortization coverage evidence read fails closed without repository capability',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'viewer-a'}),kernelFactory:async()=>({})});
  const response=await api({method:'GET',url:path,headers:{},body:null});assert.equal(response.status,503);assert.equal(response.body.code,'AI_AMORTIZATION_COVERAGE_EVIDENCE_READ_UNAVAILABLE');
});

test('OpenAPI describes a no-action coverage-evidence read separately from the recorder',()=>{
  const operation=contract.paths['/entities/{entityId}/ai/amortization/coverage-evidence'];
  assert.equal(operation.get.operationId,'listAiAmortizationCoverageEvidence');assert.match(operation.get.description,/cannot create a Draft JE/);assert.equal(operation.post.operationId,'recordAiAmortizationCoverageEvidence');
});
