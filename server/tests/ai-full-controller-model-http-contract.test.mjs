import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='4e0b2744-2366-46d5-8b34-6ccf49deaabf';
const path=`/api/v1/entities/${entityId}/ai/full-controller-model-runs`;
const flags={can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const hash='sha256:'+'a'.repeat(64),snapshot='11111111-1111-4111-8111-111111111111';
const metadata={provider_request_id:null,model:'controlled-model',elapsed_ms:1,trace_id:'controller-run-001:chunk:0'},chunkBase={schema_version:'AI_FULL_CONTROLLER_MODEL_CHUNK_RESPONSE_V1',snapshot_id:snapshot,snapshot_hash:hash,chunk_index:0,chunk_hash:hash,headline:'No retained findings.',narrative:'The complete retained population contains no findings.',risk_summary:{high:0,medium:0,low:0},controller_actions:[],action_flags:flags,model_metadata:metadata},chunk={...chunkBase,response_hash:canonicalRequestHash(chunkBase)},memo={schema_version:'AI_FULL_CONTROLLER_MEMO_V1',snapshot_id:snapshot,snapshot_hash:hash,chunk_response_hashes:[chunk.response_hash],memo_reduction_hash:hash,memo_citation_finding_ids:[],headline:'No retained findings.',narrative:'The complete retained population contains no findings.',risk_summary:{high:0,medium:0,low:0},controller_actions:[],action_flags:flags,model_metadata:{...metadata,trace_id:'controller-run-001:memo'}},outputBase={schema_version:'AI_FULL_CONTROLLER_MODEL_OUTPUT_V1',snapshot_id:snapshot,snapshot_hash:hash,chunk_count:1,total_finding_count:0,chunk_responses:[chunk],final_memo:memo,action_flags:flags},output={...outputBase,output_hash:canonicalRequestHash(outputBase)};

test('model run accepts only server-derived scope and stable idempotency',async()=>{
  const seen=[],api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({}),aiFullControllerModelServiceFactory:async()=>({analyze:async input=>(seen.push(input),output)})});
  const response=await api({method:'POST',url:path,headers:{'idempotency-key':'controller-run-001'},body:{periodId,limit:500}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(seen,[{tenantId,entityId,accountingPeriodId:periodId,actorId:'controller-a',idempotencyKey:'controller-run-001',limit:500}]);
  for(const request of [{headers:{},body:{periodId}},{headers:{'idempotency-key':'controller-run-002'},body:{periodId,policy:{}}},{headers:{'idempotency-key':'controller-run-003'},body:{periodId,actorId:'x'}},{headers:{'idempotency-key':'controller-run-004','if-match':'0'},body:{periodId}}])assert.equal((await api({method:'POST',url:path,...request})).status,400);
});

test('model run is disabled without controlled gateway wiring and rejects unsafe authority or secrets',async()=>{
  let api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({})});assert.equal((await api({method:'POST',url:path,headers:{'idempotency-key':'controller-run-005'},body:{periodId}})).status,503);
  for(const unsafe of [{...output,action_flags:{...flags,can_post:true}},{...output,final_memo:{action_flags:flags,narrative:'Authorization: Bearer secret-value-123456'}}]){api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({}),aiFullControllerModelServiceFactory:async()=>({analyze:async()=>unsafe})});const response=await api({method:'POST',url:path,headers:{'idempotency-key':'controller-run-006'},body:{periodId}});assert.equal(response.status,502);assert.doesNotMatch(JSON.stringify(response.body),/secret-value/);}
});

test('OpenAPI closes the command and every nested model receipt',()=>{
  const api=JSON.parse(readFileSync(new URL('../api/openapi-accounting.json',import.meta.url),'utf8')),operation=api.paths['/entities/{entityId}/ai/full-controller-model-runs']?.post;
  assert.ok(operation);assert.equal(operation.requestBody.content['application/json'].schema.additionalProperties,false);
  for(const name of ['AiFullControllerModelOutput','AiFullControllerModelChunk','AiFullControllerModelMemo','AiFullControllerModelAction','AiFullControllerModelMetadata','AiFullControllerModelRisk'])assert.equal(api.components.schemas[name].additionalProperties,false,name);
});
