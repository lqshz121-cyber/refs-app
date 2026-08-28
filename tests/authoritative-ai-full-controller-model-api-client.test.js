import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import test from 'node:test';
import {runAuthoritativeAiFullControllerModel} from '../src/accounting-api.js';

const entityId='22222222-2222-4222-8222-222222222222',periodId='33333333-3333-4333-8333-333333333333',snapshotId='44444444-4444-4444-8444-444444444444',findingId='55555555-5555-4555-8555-555555555555';
const config={baseUrl:'https://accounting.example',entityId,periodId,getAccessToken:async()=> 'a'.repeat(48)};
const actions={can_create_draft:false,can_review:false,can_approve:false,can_post:false},hash='sha256:'+'a'.repeat(64),risk={high:1,medium:0,low:0};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const digest=value=>`sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
const metadata=trace_id=>({provider_request_id:null,model:'controlled-model',elapsed_ms:4,trace_id});
const controllerAction={category:'VENDOR_MONTHLY_SPEND',finding_ids:[findingId],action:'Review the retained source evidence and approved policy.'};
const chunkBase={schema_version:'AI_FULL_CONTROLLER_MODEL_CHUNK_RESPONSE_V1',snapshot_id:snapshotId,snapshot_hash:hash,chunk_index:0,chunk_hash:hash,headline:'One high-risk retained finding.',narrative:'The complete retained scan contains one high-risk vendor finding.',risk_summary:risk,controller_actions:[controllerAction],action_flags:actions,model_metadata:metadata('controller-run-001:chunk:0')};
const chunk={...chunkBase,response_hash:digest(chunkBase)};
const memo={schema_version:'AI_FULL_CONTROLLER_MEMO_V1',snapshot_id:snapshotId,snapshot_hash:hash,chunk_response_hashes:[chunk.response_hash],memo_reduction_hash:hash,memo_citation_finding_ids:[findingId],headline:'Controller review is required.',narrative:'Review the retained vendor evidence before close.',risk_summary:risk,controller_actions:[controllerAction],action_flags:actions,model_metadata:metadata('controller-run-001:memo')};
const outputBase={schema_version:'AI_FULL_CONTROLLER_MODEL_OUTPUT_V1',snapshot_id:snapshotId,snapshot_hash:hash,chunk_count:1,total_finding_count:1,chunk_responses:[chunk],final_memo:memo,action_flags:actions};
const data={...outputBase,output_hash:digest(outputBase)};
const secretMemo={...memo,narrative:'Bearer abcdefghijklmnop must never reach the browser.'},secretBase={...outputBase,final_memo:secretMemo},secretData={...secretBase,output_hash:digest(secretBase)};
const riskDriftBase={...outputBase,total_finding_count:2},riskDriftData={...riskDriftBase,output_hash:digest(riskDriftBase)};

test('browser runs one durable no-store Full Controller model analysis with server-owned inputs',async()=>{
  let request;
  const result=await runAuthoritativeAiFullControllerModel({config,idempotencyKey:'controller-run-001',cryptoApi:webcrypto,fetcher:async(url,init)=>(request={url,init},{ok:true,json:async()=>({ok:true,data})})});
  assert.equal(result.ok,true);
  assert.equal(request.url,`https://accounting.example/api/v1/entities/${entityId}/ai/full-controller-model-runs`);
  assert.equal(request.init.method,'POST');
  assert.equal(request.init.cache,'no-store');
  assert.equal(request.init.headers['idempotency-key'],'controller-run-001');
  assert.deepEqual(JSON.parse(request.init.body),{periodId,limit:500});
  assert.equal(result.data.final_memo.memo_citation_finding_ids[0],findingId);
  assert.equal(Object.isFrozen(result.data.final_memo),true);
});

test('browser rejects invalid scope before any Full Controller model request',async()=>{
  let calls=0;
  const result=await runAuthoritativeAiFullControllerModel({config:{...config,periodId:'wrong'},idempotencyKey:'controller-run-001',cryptoApi:webcrypto,fetcher:async()=>{calls+=1;}});
  assert.equal(result.ok,false);assert.equal(result.code,'AI_FULL_CONTROLLER_MODEL_SCOPE_INVALID');assert.equal(calls,0);
});

test('browser rejects action authority, secret expansion, cross-snapshot chunks, citation drift, and output hash drift',async()=>{
  const unsafe=[
    {...data,action_flags:{...actions,can_post:true}},
    {...data,final_memo:{...memo,raw_prompt:'secret'}},secretData,riskDriftData,
    {...data,chunk_responses:[{...chunk,snapshot_id:'66666666-6666-4666-8666-666666666666'}]},
    {...data,final_memo:{...memo,chunk_response_hashes:[hash]}},
    {...data,final_memo:{...memo,memo_citation_finding_ids:[findingId,findingId]}},
    {...data,output_hash:hash}
  ];
  for(const value of unsafe){const result=await runAuthoritativeAiFullControllerModel({config,idempotencyKey:'controller-run-001',cryptoApi:webcrypto,fetcher:async()=>({ok:true,json:async()=>({ok:true,data:value})})});assert.equal(result.ok,false);assert.equal(result.code,'AI_FULL_CONTROLLER_MODEL_PROTOCOL');}
});
