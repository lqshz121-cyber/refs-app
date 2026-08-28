import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createAiFullControllerModelOrchestrator} from '../runtime/ai-full-controller-model-orchestrator.mjs';
import {buildAiFullControllerModelRunHash} from '../runtime/ai-full-controller-model-service.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';

const up=readFileSync(new URL('../db/migrations/277_ai_full_controller_model_wal.sql',import.meta.url),'utf8');
const down=readFileSync(new URL('../db/migrations/down/277_ai_full_controller_model_wal.sql',import.meta.url),'utf8');
const repository=readFileSync(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
const server=readFileSync(new URL('../runtime/accounting-server.mjs',import.meta.url),'utf8');
const http=readFileSync(new URL('../api/accounting-http.mjs',import.meta.url),'utf8');

test('277 retains actor-bound run chunk memo WAL with atomic audit and outbox',()=>{
  for(const token of ['ai_full_controller_model_run','ai_full_controller_model_chunk','ai_full_controller_model_memo','refs_ai_full_controller_canonical_json','refs_ai_full_controller_canonical_hash','refs_prepare_ai_full_controller_model_run','PREPARED','pg_advisory_xact_lock','refs_begin_ai_full_controller_model_run','refs_begin_ai_full_controller_model_chunk','refs_complete_ai_full_controller_model_chunk','refs_begin_ai_full_controller_model_memo','refs_complete_ai_full_controller_model_run','refs_abandon_ai_full_controller_model_stage',"'AI.ANALYSIS.EXPLAIN'",'Idempotency key conflicts','audit_event','outbox_event'])assert.ok(up.includes(token),`missing ${token}`);
  assert.match(down,/refuses retained AI model run evidence/);
});

test('production wiring is server-derived and exposes no accounting authority',()=>{
  for(const method of ['prepareAiFullControllerModelRun','beginAiFullControllerModelRun','beginAiFullControllerModelChunk','completeAiFullControllerModelChunk','beginAiFullControllerModelMemo','completeAiFullControllerModelRun','abandonAiFullControllerModelStage'])assert.ok(repository.includes(method));
  assert.match(server,/createAiFullControllerModelOrchestrator/);
  assert.match(server,/AI_FULL_CONTROLLER_MODEL_READINESS/);
  assert.match(server,/if\(aiGateway\)checks\.push\(runtimePool\.query\(AI_FULL_CONTROLLER_MODEL_READINESS\)\)/);
  assert.match(http,/full-controller-model-runs/);
  assert.match(http,/AI_FULL_CONTROLLER_MODEL_RESPONSE_INVALID/);
  assert.doesNotMatch(http,/full-controller-model-runs[\s\S]{0,1200}(can_create_draft\s*:\s*true|can_review\s*:\s*true|can_approve\s*:\s*true|can_post\s*:\s*true)/);
});

test('pre-scan reservation makes retry reuse one stable retained manifest without rescanning',async()=>{
  const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',accountingPeriodId='33333333-3333-4333-8333-333333333333',actorId='controller-a',idempotencyKey='stable-model-run-001',flags={can_create_draft:false,can_review:false,can_approve:false,can_post:false};
  let scans=0,gatewayCalls=0,inputManifest,runHash,output;
  const scanService={analyze:async()=>{scans++;return {schema_version:'AI_FULL_CONTROLLER_SCAN_V1',entity_id:entityId,current_accounting_period_id:accountingPeriodId,status:'COMPLETE',required_section_count:1,complete_section_count:1,finding_count:0,risk_summary:{high:0,medium:0,low:0},coverage_summary:{complete_section_count:1,unavailable_section_count:0,unavailable_sections:[]},sections:[{category:'VENDOR_SPEND',status:'COMPLETE',schema_version:'AI_VENDOR_SPEND_BATCH_V1',finding_count:0,findings:[],action_flags:flags}],action_flags:flags};}};
  const request={schema_version:'AI_FULL_CONTROLLER_MODEL_RUN_SCOPE_V1',tenant_id:tenantId,entity_id:entityId,accounting_period_id:accountingPeriodId,release_sha:'a'.repeat(40),requested_limit:500},requestHash=canonicalRequestHash(request),preparedAt='2026-08-23T20:30:00.000Z';
  const kernel={
    prepareAiFullControllerModelRun:async()=>inputManifest?{state:output?'REPLAY':'RESUME',requestHash,preparedAt,runHash,inputManifest,...(output?{output}: {})}:{state:'PREPARED',requestHash,preparedAt},
    beginAiFullControllerModelRun:async({inputManifest:manifest})=>{inputManifest??=structuredClone(manifest);runHash??=buildAiFullControllerModelRunHash({actorId,idempotencyKey,inputManifest});assert.deepEqual(manifest,inputManifest);return output?{state:'REPLAY',runHash,output}:{state:'STARTED',runHash};},
    beginAiFullControllerModelChunk:async({chunkIndex,chunkHash})=>({state:'STARTED',runHash,chunkIndex,chunkHash}),
    completeAiFullControllerModelChunk:async({response})=>({runHash,response}),
    beginAiFullControllerModelMemo:async({chunkResponseHashes,reductionManifest})=>({state:'STARTED',runHash,chunkResponseHashes,reductionHash:reductionManifest.reduction_hash}),
    completeAiFullControllerModelRun:async({output:value})=>(output=structuredClone(value),{runHash,output}),
    abandonAiFullControllerModelStage:async()=>{}
  };
  const gateway={analyzeJson:async({traceId})=>{gatewayCalls++;if(gatewayCalls===1)throw new Error('transient');return {elapsedMs:1,model:'controlled-model',providerRequestId:null,traceId,result:{headline:'No retained findings.',narrative:'The retained population contains no findings.',risk_summary:{high:0,medium:0,low:0},controller_actions:[],action_flags:flags}};}};
  const orchestrator=createAiFullControllerModelOrchestrator({scanService,gateway,kernel,releaseSha:'a'.repeat(40)});
  await assert.rejects(orchestrator.analyze({tenantId,entityId,accountingPeriodId,actorId,idempotencyKey,limit:500}),error=>error.code==='AI_FULL_SCAN_MODEL_EXECUTION_FAILED');
  const retained=structuredClone(inputManifest),result=await orchestrator.analyze({tenantId,entityId,accountingPeriodId,actorId,idempotencyKey,limit:500});
  assert.equal(scans,1);assert.deepEqual(inputManifest,retained);assert.equal(result.action_flags.can_post,false);
});
