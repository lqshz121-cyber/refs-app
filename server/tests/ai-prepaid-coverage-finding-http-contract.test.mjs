import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import contract from '../api/openapi-accounting.json' with {type:'json'};

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const path=`/api/v1/entities/${entityId}/ai/findings/prepaid-coverage`;
const row={ai_prepaid_coverage_finding_id:'11111111-1111-4111-8111-111111111111',source_document_id:'22222222-2222-4222-8222-222222222222',source_document_line_id:'33333333-3333-4333-8333-333333333333',source_payload_hash:'sha256:'+'1'.repeat(64),source_document_version:'4',source_line_hash:'sha256:'+'2'.repeat(64),rule_id:'PREPAID_COVERAGE_REQUIRED',risk_level:'MEDIUM',confidence:'0.9500',status:'OPEN',reason:'Insurance source line has no retained whole-month coverage evidence.',suggested_action:'Obtain coverage dates before controller review.',suggested_owner:'CONTROLLER',due_date:null,due_date_status:'HUMAN_ASSIGNMENT_REQUIRED',created_at:'2026-08-14T00:00:00Z',can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('AI prepaid coverage findings are authenticated, bounded GET-only evidence',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({listAiPrepaidCoverageFindings:async input=>(seen.push(input),[row])})});
  const response=await api({method:'GET',url:`${path}?limit=25`,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:[row]});assert.deepEqual(seen,[{tenantId,entityId,limit:25}]);
  for(const request of [{method:'GET',url:path,headers:{'idempotency-key':'forbidden'},body:null},{method:'GET',url:`${path}?limit=101`,headers:{},body:null},{method:'GET',url:`${path}?unknown=1`,headers:{},body:null},{method:'GET',url:path,headers:{},body:{}}])assert.equal((await api(request)).status,400);
});

test('AI prepaid coverage reader fails closed without its repository capability',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({})});
  const response=await api({method:'GET',url:path,headers:{},body:null});assert.equal(response.status,503);assert.equal(response.body.code,'AI_PREPAID_COVERAGE_FINDING_READ_UNAVAILABLE');
});

test('OpenAPI exposes prepaid coverage findings as source-bound, no-action evidence',()=>{
  const operation=contract.paths['/entities/{entityId}/ai/findings/prepaid-coverage'].get;
  assert.equal(operation.operationId,'listPersistedAiPrepaidCoverageFindings');
  assert.match(operation.description,/whole-month coverage evidence/);
  assert.match(operation.description,/cannot create a Draft/);
  const schema=contract.components.schemas.AiPrepaidCoverageFinding;
  assert.equal(schema.additionalProperties,false);
  assert.equal(schema.properties.rule_id.const,'PREPAID_COVERAGE_REQUIRED');
  assert.equal(schema.properties.source_payload_hash.pattern,'^sha256:[0-9a-f]{64}$');
  for(const field of ['can_create_draft','can_review','can_approve','can_post'])assert.equal(schema.properties[field].const,false);
});
