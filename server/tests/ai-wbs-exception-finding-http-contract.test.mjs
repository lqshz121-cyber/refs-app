import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import contract from '../api/openapi-accounting.json' with {type:'json'};

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const path=`/api/v1/entities/${entityId}/ai/findings/wbs-exceptions`;
const row={ai_finding_id:'11111111-1111-4111-8111-111111111111',finding_key:'WBS_EXCEPTION:11111111-1111-4111-8111-111111111111',source_evidence_row_id:'22222222-2222-4222-8222-222222222222',source_record_id:'AP-1',source_version:'operator:2026-01-01:abc',source_row_hash:'sha256:'+'1'.repeat(64),provider_content_hash:'sha256:'+'2'.repeat(64),observation_hash:'sha256:'+'3'.repeat(64),rule_id:'WBS_UNSIGNED_SOURCE',risk_level:'MEDIUM',confidence:'0.9800',status:'OPEN',reason:'Unsigned provider source remains exception evidence.',suggested_action:'Obtain a provider-signed source before human review.',suggested_owner:'CONTROLLER',due_date:null,due_date_status:'HUMAN_ASSIGNMENT_REQUIRED',created_at:'2026-08-14T00:00:00Z',can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('persisted AI WBS exception findings are authenticated, bounded GET-only evidence',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({listAiWbsExceptionFindings:async input=>(seen.push(input),[row])})});
  const response=await api({method:'GET',url:`${path}?limit=25`,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:[row]});assert.deepEqual(seen,[{tenantId,entityId,limit:25}]);
  for(const request of [
    {method:'GET',url:path,headers:{'idempotency-key':'forbidden'},body:null},
    {method:'GET',url:path,headers:{'if-match':'"0"'},body:null},
    {method:'GET',url:`${path}?limit=101`,headers:{},body:null},
    {method:'GET',url:`${path}?unknown=1`,headers:{},body:null},
    {method:'GET',url:path,headers:{},body:{}}
  ])assert.equal((await api(request)).status,400);
});

test('AI finding reader fails closed when the authoritative repository is absent',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({})});
  const response=await api({method:'GET',url:path,headers:{},body:null});assert.equal(response.status,503);assert.equal(response.body.code,'AI_FINDING_READ_UNAVAILABLE');
});

test('OpenAPI exposes the finding reader as read-only evidence with no action authority',()=>{
  const operation=contract.paths['/entities/{entityId}/ai/findings/wbs-exceptions'].get;
  assert.equal(operation.operationId,'listPersistedAiWbsExceptionFindings');assert.match(operation.description,/raw provider payloads/);assert.match(operation.description,/cannot create a Draft/);
  const schema=contract.components.schemas.AiWbsExceptionFinding;
  assert.equal(schema.additionalProperties,false);for(const field of ['can_create_draft','can_review','can_approve','can_post'])assert.equal(schema.properties[field].const,false);
  assert.equal(schema.properties.due_date_status.const,'HUMAN_ASSIGNMENT_REQUIRED');assert.deepEqual(schema.properties.rule_id.enum,['WBS_UNSIGNED_SOURCE','WBS_ENTITY_SCOPE_EXCEPTION']);
});
