import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import contract from '../api/openapi-accounting.json' with {type:'json'};

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const path=`/api/v1/entities/${entityId}/ai/findings/duplicate-payables`;
const row={ai_duplicate_payable_finding_id:'11111111-1111-4111-8111-111111111111',source_document_id:'22222222-2222-4222-8222-222222222222',candidate_source_document_id:'33333333-3333-4333-8333-333333333333',source_payload_hash:'sha256:'+'1'.repeat(64),source_document_version:'4',candidate_payload_hash:'sha256:'+'2'.repeat(64),candidate_document_version:'5',match_key_hash:'sha256:'+'3'.repeat(64),rule_id:'DUPLICATE_PAYABLE_EXACT',risk_level:'HIGH',confidence:'1.0000',status:'OPEN',reason:'Two payable sources have the same retained exact accounting identity.',suggested_action:'Compare source records before any Draft or payment activity.',suggested_owner:'CONTROLLER',due_date:null,due_date_status:'HUMAN_ASSIGNMENT_REQUIRED',created_at:'2026-08-14T00:00:00Z',can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('AI duplicate payable findings are authenticated, bounded GET-only evidence',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({listAiDuplicatePayableFindings:async input=>(seen.push(input),[row])})});
  const response=await api({method:'GET',url:`${path}?limit=25`,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:[row]});assert.deepEqual(seen,[{tenantId,entityId,limit:25}]);
  for(const request of [{method:'GET',url:path,headers:{'idempotency-key':'forbidden'},body:null},{method:'GET',url:`${path}?limit=101`,headers:{},body:null},{method:'GET',url:`${path}?unknown=1`,headers:{},body:null},{method:'GET',url:path,headers:{},body:{}}])assert.equal((await api(request)).status,400);
});

test('AI duplicate payable finding reader fails closed without its repository capability',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({})});
  const response=await api({method:'GET',url:path,headers:{},body:null});assert.equal(response.status,503);assert.equal(response.body.code,'AI_DUPLICATE_PAYABLE_FINDING_READ_UNAVAILABLE');
});

test('OpenAPI exposes exact duplicate findings as immutable no-action evidence',()=>{
  const operation=contract.paths['/entities/{entityId}/ai/findings/duplicate-payables'].get;
  assert.equal(operation.operationId,'listPersistedAiDuplicatePayableFindings');assert.match(operation.description,/cannot change either source/);
  const schema=contract.components.schemas.AiDuplicatePayableFinding;
  assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.rule_id.const,'DUPLICATE_PAYABLE_EXACT');
  for(const field of ['can_create_draft','can_review','can_approve','can_post'])assert.equal(schema.properties[field].const,false);
});
