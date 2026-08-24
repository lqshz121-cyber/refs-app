import assert from 'node:assert/strict';
import test from 'node:test';
import {buildAiFullControllerScanEvidence} from '../runtime/ai-full-controller-scan-evidence-contract.mjs';
import {buildAiFullControllerModelInputChunks} from '../runtime/ai-full-controller-model-input-contract.mjs';
import {createAiFullControllerModelService} from '../runtime/ai-full-controller-model-service.mjs';

const tenant='11111111-1111-4111-8111-111111111111',entity='22222222-2222-4222-8222-222222222222',period='33333333-3333-4333-8333-333333333333',snapshotId='44444444-4444-4444-8444-444444444444',flags={can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const manifest=()=>{const finding=index=>({entity_id:entity,accounting_period_id:period,rule_id:`AI_VENDOR_REVIEW_${index}`,risk_level:index?'MEDIUM':'HIGH',reason:`Retained evidence ${index}.`,suggested_action:'Human review.'}),snapshot=buildAiFullControllerScanEvidence({tenantId:tenant,entityId:entity,accountingPeriodId:period,releaseSha:'a'.repeat(40),capturedAt:'2026-08-23T21:00:00.000Z',requestedLimit:500,scan:{schema_version:'AI_FULL_CONTROLLER_SCAN_V1',entity_id:entity,current_accounting_period_id:period,status:'COMPLETE',required_section_count:1,complete_section_count:1,finding_count:2,risk_summary:{high:1,medium:1,low:0},coverage_summary:{complete_section_count:1,unavailable_section_count:0,unavailable_sections:[]},sections:[{category:'VENDOR_REVIEW',status:'COMPLETE',schema_version:'AI_VENDOR_REVIEW_BATCH_V1',finding_count:2,findings:[finding(0),finding(1)],action_flags:flags}],action_flags:flags}});return buildAiFullControllerModelInputChunks({snapshotId,evidenceSnapshot:snapshot,retainedFindingIds:snapshot.sections[0].findings.map((item,index)=>({section_category:'VENDOR_REVIEW',finding_index:index,finding_id:`55555555-5555-4555-8555-55555555555${index}`,finding_hash:item.finding_hash})),chunkSize:1});};
const resultFor=(facts,isMemo=false)=>{const findings=isMemo?facts.root_nodes.flatMap(item=>item.priority_findings.map(finding=>finding.finding_id)):facts.findings.map(item=>item.finding_id);return {traceId:'trace',providerRequestId:'provider-1',model:'controlled-model',elapsedMs:5,result:{headline:isMemo?'Controller Memo':'Chunk review',narrative:'Only retained evidence is summarized.',risk_summary:isMemo?facts.risk_summary:facts.findings[0].evidence.risk_level==='HIGH'?{high:1,medium:0,low:0}:{high:0,medium:1,low:0},controller_actions:[{category:'VENDOR_REVIEW',finding_ids:findings,action:'Human review only.'}],action_flags:flags}};};
const repository=events=>({
  beginAiFullControllerModelRun:async value=>(events.push(['begin-run',value]),{state:'STARTED',runHash:'sha256:'+'a'.repeat(64)}),
  beginAiFullControllerModelChunk:async value=>(events.push(['begin-chunk',value.chunkIndex]),{state:'STARTED'}),
  completeAiFullControllerModelChunk:async value=>(events.push(['complete-chunk',value.chunkIndex]),value.response),
  beginAiFullControllerModelMemo:async value=>(events.push(['begin-memo',value.chunkResponseHashes.length]),{state:'STARTED'}),
  completeAiFullControllerModelRun:async value=>(events.push(['complete-run',value.output.output_hash]),value.output),
  abandonAiFullControllerModelStage:async value=>events.push(['abandon',value.errorCode])
});

test('durably reserves exact input before model calls, seals every chunk, and retains one final memo',async()=>{
  const input=manifest(),events=[],calls=[];
  const service=createAiFullControllerModelService({repository:repository(events),gateway:{analyzeJson:async value=>(calls.push(value),resultFor(value.facts,value.traceName.endsWith('memo')))}});
  const output=await service.analyze({actorId:'oidc|controller',idempotencyKey:'full-scan-run-001',inputManifest:input});
  assert.equal(output.chunk_count,2);assert.deepEqual(events.map(item=>item[0]),['begin-run','begin-chunk','complete-chunk','begin-chunk','complete-chunk','begin-memo','complete-run']);assert.equal(calls.length,3);assert.equal(calls[0].facts.chunk_hash,input.chunk_hashes[0]);assert.equal(calls[2].facts.root_nodes.length,2);assert.deepEqual(output.action_flags,flags);
});

test('replays durable output without a model call',async()=>{
  const input=manifest(),events=[],first=createAiFullControllerModelService({repository:repository(events),gateway:{analyzeJson:async value=>resultFor(value.facts,value.traceName.endsWith('memo'))}}),output=await first.analyze({actorId:'actor',idempotencyKey:'full-scan-run-002',inputManifest:input});
  let calls=0;const replayRepository={...repository([]),beginAiFullControllerModelRun:async()=>({state:'REPLAY',output})};
  const replay=await createAiFullControllerModelService({repository:replayRepository,gateway:{analyzeJson:async()=>{calls++;throw new Error('must not call');}}}).analyze({actorId:'actor',idempotencyKey:'full-scan-run-002',inputManifest:input});
  assert.equal(calls,0);assert.equal(replay.output_hash,output.output_hash);
});

test('fails closed and records recovery state for unsafe model output or transport failure',async()=>{
  const input=manifest();
  for(const gateway of [{analyzeJson:async value=>({...resultFor(value.facts),result:{...resultFor(value.facts).result,action_flags:{...flags,can_post:true}}})},{analyzeJson:async()=>{throw new Error('transport failed');}}]){
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
