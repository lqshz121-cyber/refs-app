import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {buildAiFullControllerScanEvidence} from '../runtime/ai-full-controller-scan-evidence-contract.mjs';
import {buildAiFullControllerModelInputChunks} from '../runtime/ai-full-controller-model-input-contract.mjs';
import {buildAiFullControllerModelOutput} from '../runtime/ai-full-controller-model-output-contract.mjs';

const tenant='11111111-1111-4111-8111-111111111111',entity='22222222-2222-4222-8222-222222222222',period='33333333-3333-4333-8333-333333333333',snapshotId='44444444-4444-4444-8444-444444444444';
const flags={can_create_draft:false,can_review:false,can_approve:false,can_post:false},metadata={provider_request_id:'req-1',model:'controlled-model',elapsed_ms:12};
const finding=index=>({entity_id:entity,accounting_period_id:period,rule_id:`AI_VENDOR_REVIEW_${index}`,risk_level:index===0?'HIGH':'MEDIUM',reason:`Retained evidence ${index}.`,suggested_action:'Human Controller review.'});
const manifest=()=>{const snapshot=buildAiFullControllerScanEvidence({tenantId:tenant,entityId:entity,accountingPeriodId:period,releaseSha:'a'.repeat(40),capturedAt:'2026-08-23T21:00:00.000Z',requestedLimit:500,scan:{schema_version:'AI_FULL_CONTROLLER_SCAN_V1',entity_id:entity,current_accounting_period_id:period,status:'COMPLETE',required_section_count:1,complete_section_count:1,finding_count:2,risk_summary:{high:1,medium:1,low:0},coverage_summary:{complete_section_count:1,unavailable_section_count:0,unavailable_sections:[]},sections:[{category:'VENDOR_REVIEW',status:'COMPLETE',schema_version:'AI_VENDOR_REVIEW_BATCH_V1',finding_count:2,findings:[finding(0),finding(1)],action_flags:flags}],action_flags:flags}});return buildAiFullControllerModelInputChunks({snapshotId,evidenceSnapshot:snapshot,retainedFindingIds:snapshot.sections[0].findings.map((item,index)=>({section_category:'VENDOR_REVIEW',finding_index:index,finding_id:`55555555-5555-4555-8555-55555555555${index}`,finding_hash:item.finding_hash})),chunkSize:1});};
const response=(input,index)=>({schema_version:'AI_FULL_CONTROLLER_MODEL_CHUNK_RESPONSE_V1',snapshot_id:input.snapshot_id,snapshot_hash:input.snapshot_hash,chunk_index:index,chunk_hash:input.chunk_hashes[index],headline:`Chunk ${index}`,narrative:'Only retained evidence is summarized.',risk_summary:index===0?{high:1,medium:0,low:0}:{high:0,medium:1,low:0},controller_actions:[{category:'VENDOR_REVIEW',finding_ids:[input.chunks[index].findings[0].finding_id],action:'Human review only.'}],model_metadata:metadata,action_flags:flags});
const memo=(input,hashes)=>({schema_version:'AI_FULL_CONTROLLER_MEMO_V1',snapshot_id:input.snapshot_id,snapshot_hash:input.snapshot_hash,chunk_response_hashes:hashes,headline:'Controller Memo',narrative:'Both retained findings require human review.',risk_summary:{high:1,medium:1,low:0},controller_actions:[{category:'VENDOR_REVIEW',finding_ids:input.chunks.flatMap(chunk=>chunk.findings.map(item=>item.finding_id)),action:'Review retained evidence.'}],model_metadata:metadata,action_flags:flags});
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const responseHashes=chunks=>chunks.map(item=>`sha256:${createHash('sha256').update(canonical(item)).digest('hex')}`);

test('binds every chunk and final memo to exact retained finding IDs, risks, hashes, and zero authority',()=>{
  const input=manifest(),chunks=input.chunks.map((_,index)=>response(input,index));
  const hashes=responseHashes(chunks);
  const output=buildAiFullControllerModelOutput({inputManifest:input,chunkResponses:chunks,finalMemo:memo(input,hashes)});
  assert.equal(output.chunk_count,2);assert.equal(output.total_finding_count,2);assert.match(output.output_hash,/^sha256:/);assert.deepEqual(output.action_flags,flags);
});

test('rejects omitted chunks, invented or duplicated citations, risk drift, hash drift, authority, and secrets',()=>{
  const input=manifest(),chunks=input.chunks.map((_,index)=>response(input,index));
  const hashes=responseHashes(chunks),baseMemo=memo(input,hashes);
  const cases=[
    {chunkResponses:chunks.slice(1),finalMemo:baseMemo},
    {chunkResponses:[{...chunks[0],controller_actions:[{...chunks[0].controller_actions[0],finding_ids:['99999999-9999-4999-8999-999999999999']}]},chunks[1]],finalMemo:baseMemo},
    {chunkResponses:[{...chunks[0],risk_summary:{high:0,medium:1,low:0}},chunks[1]],finalMemo:baseMemo},
    {chunkResponses:chunks,finalMemo:{...baseMemo,chunk_response_hashes:[hashes[1],hashes[0]]}},
    {chunkResponses:chunks,finalMemo:{...baseMemo,action_flags:{...flags,can_post:true}}},
    {chunkResponses:chunks,finalMemo:{...baseMemo,narrative:'Authorization: Bearer secret-value-123456'}}
  ];
  for(const value of cases)assert.throws(()=>buildAiFullControllerModelOutput({inputManifest:input,...value}),error=>/^AI_FULL_SCAN_MODEL_OUTPUT_/.test(error.code));
});
