import assert from 'node:assert/strict';
import test from 'node:test';
import {buildAiFullControllerScanEvidence} from '../runtime/ai-full-controller-scan-evidence-contract.mjs';
import {buildAiFullControllerModelInputChunks} from '../runtime/ai-full-controller-model-input-contract.mjs';
import {buildAiFullControllerModelRunHash,createAiFullControllerModelService} from '../runtime/ai-full-controller-model-service.mjs';

const tenant='11111111-1111-4111-8111-111111111111',entity='22222222-2222-4222-8222-222222222222',period='33333333-3333-4333-8333-333333333333',snapshotId='44444444-4444-4444-8444-444444444444',flags={can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const manifest=()=>{const finding=index=>({entity_id:entity,accounting_period_id:period,rule_id:`AI_VENDOR_REVIEW_${index}`,risk_level:index?'MEDIUM':'HIGH',reason:`Retained evidence ${index}.`,suggested_action:'Human review.'}),snapshot=buildAiFullControllerScanEvidence({tenantId:tenant,entityId:entity,accountingPeriodId:period,releaseSha:'a'.repeat(40),capturedAt:'2026-08-23T21:00:00.000Z',requestedLimit:500,scan:{schema_version:'AI_FULL_CONTROLLER_SCAN_V1',entity_id:entity,current_accounting_period_id:period,status:'COMPLETE',required_section_count:1,complete_section_count:1,finding_count:2,risk_summary:{high:1,medium:1,low:0},coverage_summary:{complete_section_count:1,unavailable_section_count:0,unavailable_sections:[]},sections:[{category:'VENDOR_REVIEW',status:'COMPLETE',schema_version:'AI_VENDOR_REVIEW_BATCH_V1',finding_count:2,findings:[finding(0),finding(1)],action_flags:flags}],action_flags:flags}});return buildAiFullControllerModelInputChunks({snapshotId,evidenceSnapshot:snapshot,retainedFindingIds:snapshot.sections[0].findings.map((item,index)=>({section_category:'VENDOR_REVIEW',finding_index:index,finding_id:`55555555-5555-4555-8555-55555555555${index}`,finding_hash:item.finding_hash})),chunkSize:1});};
const resultFor=(facts,isMemo=false,traceId='trace')=>{const findings=isMemo?facts.root_nodes.flatMap(item=>item.priority_findings.map(finding=>finding.finding_id)):facts.findings.map(item=>item.finding_id);return {traceId,providerRequestId:'provider-1',model:'controlled-model',elapsedMs:5,result:{headline:isMemo?'Controller Memo':'Chunk review',narrative:'Only retained evidence is summarized.',risk_summary:isMemo?facts.risk_summary:facts.findings[0].evidence.risk_level==='HIGH'?{high:1,medium:0,low:0}:{high:0,medium:1,low:0},controller_actions:[{category:'VENDOR_REVIEW',finding_ids:findings,action:'Human review only.'}],action_flags:flags}};};
const repository=events=>({
  beginAiFullControllerModelRun:async value=>(events.push(['begin-run',value]),{state:'STARTED',runHash:buildAiFullControllerModelRunHash({actorId:value.actorId,idempotencyKey:value.idempotencyKey,inputManifest:value.inputManifest})}),
  beginAiFullControllerModelChunk:async value=>(events.push(['begin-chunk',value.chunkIndex]),{state:'STARTED',runHash:value.runHash,chunkIndex:value.chunkIndex,chunkHash:value.chunkHash}),
  completeAiFullControllerModelChunk:async value=>(events.push(['complete-chunk',value.chunkIndex]),{runHash:value.runHash,response:value.response}),
  beginAiFullControllerModelMemo:async value=>(events.push(['begin-memo',value.chunkResponseHashes.length]),{state:'STARTED',runHash:value.runHash,reductionHash:value.reductionManifest.reduction_hash,chunkResponseHashes:value.chunkResponseHashes}),
  completeAiFullControllerModelRun:async value=>(events.push(['complete-run',value.output.output_hash]),{runHash:value.runHash,output:value.output}),
  abandonAiFullControllerModelStage:async value=>events.push(['abandon',value.errorCode])
});

test('durably reserves exact input before model calls, seals every chunk, and retains one final memo',async()=>{
  const input=manifest(),events=[],calls=[];
  const service=createAiFullControllerModelService({repository:repository(events),gateway:{analyzeJson:async value=>(calls.push(value),resultFor(value.facts,value.traceName.endsWith('memo'),value.traceId))}});
  const output=await service.analyze({actorId:'oidc|controller',idempotencyKey:'full-scan-run-001',inputManifest:input});
  assert.equal(output.chunk_count,2);assert.deepEqual(events.map(item=>item[0]),['begin-run','begin-chunk','complete-chunk','begin-chunk','complete-chunk','begin-memo','complete-run']);assert.equal(calls.length,3);assert.equal(calls[0].facts.chunk_hash,input.chunk_hashes[0]);assert.equal(calls[2].facts.root_nodes.length,2);assert.deepEqual(output.action_flags,flags);
});

test('replays durable output without a model call',async()=>{
  const input=manifest(),events=[],first=createAiFullControllerModelService({repository:repository(events),gateway:{analyzeJson:async value=>resultFor(value.facts,value.traceName.endsWith('memo'),value.traceId)}}),output=await first.analyze({actorId:'actor',idempotencyKey:'full-scan-run-002',inputManifest:input});
  let calls=0;const replayRepository={...repository([]),beginAiFullControllerModelRun:async value=>({state:'REPLAY',runHash:buildAiFullControllerModelRunHash({actorId:value.actorId,idempotencyKey:value.idempotencyKey,inputManifest:value.inputManifest}),output})};
  const replay=await createAiFullControllerModelService({repository:replayRepository,gateway:{analyzeJson:async()=>{calls++;throw new Error('must not call');}}}).analyze({actorId:'actor',idempotencyKey:'full-scan-run-002',inputManifest:input});
  assert.equal(calls,0);assert.equal(replay.output_hash,output.output_hash);
});

test('rejects an internally valid durable replay retained under a different idempotency trace',async()=>{
  const input=manifest(),sourceKey='full-scan-run-source',source=createAiFullControllerModelService({repository:repository([]),gateway:{analyzeJson:async value=>resultFor(value.facts,value.traceName.endsWith('memo'),value.traceId)}}),output=await source.analyze({actorId:'actor',idempotencyKey:sourceKey,inputManifest:input});
  let calls=0;const replayRepository={...repository([]),beginAiFullControllerModelRun:async value=>({state:'REPLAY',runHash:buildAiFullControllerModelRunHash({actorId:value.actorId,idempotencyKey:value.idempotencyKey,inputManifest:value.inputManifest}),output})};
  await assert.rejects(()=>createAiFullControllerModelService({repository:replayRepository,gateway:{analyzeJson:async()=>{calls++;throw new Error('must not call');}}}).analyze({actorId:'actor',idempotencyKey:'full-scan-run-target',inputManifest:input}),error=>error.code==='AI_FULL_SCAN_MODEL_TRACE_INVALID');
  assert.equal(calls,0);
});

test('fails closed and records recovery state for unsafe model output or transport failure',async()=>{
  const input=manifest();
  for(const gateway of [{analyzeJson:async value=>({...resultFor(value.facts,false,value.traceId),result:{...resultFor(value.facts,false,value.traceId).result,action_flags:{...flags,can_post:true}}})},{analyzeJson:async()=>{throw new Error('transport failed');}}]){
    const events=[],service=createAiFullControllerModelService({repository:repository(events),gateway});
    await assert.rejects(()=>service.analyze({actorId:'actor',idempotencyKey:'full-scan-run-003',inputManifest:input}),error=>/^AI_FULL_SCAN_MODEL_/.test(error.code));assert.equal(events.at(-1)[0],'abandon');
  }
  assert.throws(()=>createAiFullControllerModelService({gateway:{analyzeJson(){}}}),error=>error.code==='AI_FULL_SCAN_MODEL_REPOSITORY_REQUIRED');
});

test('rejects an unsafe or drifted input manifest before durable persistence or model calls',async()=>{
  const input=structuredClone(manifest()),events=[];input.chunks[0].findings[0].evidence.reason='Authorization: Bearer secret-value-123456';let calls=0;
  const service=createAiFullControllerModelService({repository:repository(events),gateway:{analyzeJson:async()=>{calls++;}}});
  await assert.rejects(()=>service.analyze({actorId:'actor',idempotencyKey:'full-scan-run-004',inputManifest:input}),error=>error.code==='AI_FULL_SCAN_MODEL_OUTPUT_INPUT_INVALID');assert.equal(events.length,0);assert.equal(calls,0);
});

test('rejects credential-bearing actor or idempotency metadata before receipts or model traces',async()=>{
  for(const scope of [{actorId:'Authorization: Bearer secret-value-123456',idempotencyKey:'full-scan-run-005'},{actorId:'actor',idempotencyKey:'token=secret-value-123456'}]){const events=[];let calls=0;const service=createAiFullControllerModelService({repository:repository(events),gateway:{analyzeJson:async()=>{calls++;}}});await assert.rejects(()=>service.analyze({...scope,inputManifest:manifest()}),error=>error.code==='AI_FULL_SCAN_MODEL_RUN_INVALID');assert.equal(events.length,0);assert.equal(calls,0);}
});

test('uses only the repository-returned sealed chunk and rejects completion drift before memo',async()=>{
  const input=manifest(),events=[],base=repository(events),service=createAiFullControllerModelService({repository:{...base,completeAiFullControllerModelChunk:async value=>({runHash:value.runHash,response:{...value.response,headline:'database drift'}})},gateway:{analyzeJson:async value=>resultFor(value.facts,false,value.traceId)}});
  await assert.rejects(()=>service.analyze({actorId:'actor',idempotencyKey:'full-scan-run-006',inputManifest:input}),error=>error.code==='AI_FULL_SCAN_MODEL_OUTPUT_CHUNK_INVALID');assert.equal(events.some(item=>item[0]==='begin-memo'),false);
});

test('rejects caller policy expansion in an otherwise safe manifest before persistence',async()=>{
  const input={...manifest(),caller_policy:{auto_post:false}},events=[],service=createAiFullControllerModelService({repository:repository(events),gateway:{analyzeJson:async()=>{throw new Error('must not call');}}});await assert.rejects(()=>service.analyze({actorId:'actor',idempotencyKey:'full-scan-run-007',inputManifest:input}),error=>error.code==='AI_FULL_SCAN_MODEL_OUTPUT_INPUT_INVALID');assert.equal(events.length,0);
});

test('rejects open or malformed durable repository receipts',async()=>{
  const input=manifest(),base=repository([]),cases=[{...base,beginAiFullControllerModelRun:async()=>({state:'STARTED',runHash:'not-a-hash'})},{...base,beginAiFullControllerModelRun:async()=>({state:'STARTED',runHash:'sha256:'+'a'.repeat(64),extra:true})},{...base,beginAiFullControllerModelChunk:async()=>({state:'STARTED',extra:true})},{...base,beginAiFullControllerModelMemo:async()=>({state:'STARTED',extra:true})}];
  for(const value of cases)await assert.rejects(()=>createAiFullControllerModelService({repository:value,gateway:{analyzeJson:async facts=>resultFor(facts.facts,facts.traceName.endsWith('memo'),facts.traceId)}}).analyze({actorId:'actor',idempotencyKey:'full-scan-run-008',inputManifest:input}),error=>/^AI_FULL_SCAN_MODEL_/.test(error.code));
});

test('derives a stable canonical run hash and rejects a different well-formed repository hash',async()=>{
  const input=manifest(),request={actorId:'actor',idempotencyKey:'full-scan-run-hash',inputManifest:input},hash=buildAiFullControllerModelRunHash(request);
  assert.equal(hash,buildAiFullControllerModelRunHash({...request,inputManifest:structuredClone(input)}));
  const base=repository([]),service=createAiFullControllerModelService({repository:{...base,beginAiFullControllerModelRun:async()=>({state:'STARTED',runHash:'sha256:'+'f'.repeat(64)})},gateway:{analyzeJson:async()=>{throw new Error('must not call');}}});
  await assert.rejects(()=>service.analyze(request),error=>error.code==='AI_FULL_SCAN_MODEL_RUN_INVALID');
});

test('rejects well-formed chunk, memo, or completion receipts bound to another run hash',async()=>{
  const input=manifest(),wrong='sha256:'+'f'.repeat(64),base=repository([]),variants=[
    {...base,beginAiFullControllerModelChunk:async value=>({state:'STARTED',runHash:wrong,chunkIndex:value.chunkIndex,chunkHash:value.chunkHash})},
    {...base,completeAiFullControllerModelChunk:async value=>({runHash:wrong,response:value.response})},
    {...base,beginAiFullControllerModelMemo:async value=>({state:'STARTED',runHash:wrong,reductionHash:value.reductionManifest.reduction_hash,chunkResponseHashes:value.chunkResponseHashes})},
    {...base,completeAiFullControllerModelRun:async value=>({runHash:wrong,output:value.output})}
  ];
  for(const repositoryValue of variants)await assert.rejects(()=>createAiFullControllerModelService({repository:repositoryValue,gateway:{analyzeJson:async value=>resultFor(value.facts,value.traceName.endsWith('memo'),value.traceId)}}).analyze({actorId:'actor',idempotencyKey:'full-scan-run-receipt',inputManifest:input}),error=>/^AI_FULL_SCAN_MODEL_/.test(error.code));
});

test('rejects a gateway trace that is not exactly bound to the run idempotency key',async()=>{
  const events=[],service=createAiFullControllerModelService({repository:repository(events),gateway:{analyzeJson:async value=>resultFor(value.facts,value.traceName.endsWith('memo'),'wrong-trace')}});
  await assert.rejects(()=>service.analyze({actorId:'actor',idempotencyKey:'full-scan-run-010',inputManifest:manifest()}),error=>error.code==='AI_FULL_SCAN_MODEL_TRACE_INVALID');
  assert.deepEqual(events.map(item=>item[0]),['begin-run','begin-chunk','abandon']);
});

test('rejects finding scope drift even when the outer manifest remains secret-free',async()=>{
  const input=structuredClone(manifest());input.chunks[0].findings[0].evidence.entity_id='99999999-9999-4999-8999-999999999999';const events=[],service=createAiFullControllerModelService({repository:repository(events),gateway:{analyzeJson:async()=>{throw new Error('must not call');}}});await assert.rejects(()=>service.analyze({actorId:'actor',idempotencyKey:'full-scan-run-009',inputManifest:input}),error=>error.code==='AI_FULL_SCAN_MODEL_OUTPUT_INPUT_INVALID');assert.equal(events.length,0);
});
