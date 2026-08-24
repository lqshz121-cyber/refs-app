import assert from 'node:assert/strict';
import test from 'node:test';
import {buildAiFullControllerScanEvidence} from '../runtime/ai-full-controller-scan-evidence-contract.mjs';
import {buildAiFullControllerModelInputChunks} from '../runtime/ai-full-controller-model-input-contract.mjs';

const tenant='11111111-1111-4111-8111-111111111111',entity='22222222-2222-4222-8222-222222222222',period='33333333-3333-4333-8333-333333333333',snapshotId='44444444-4444-4444-8444-444444444444';
const actions={can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const finding=index=>({entity_id:entity,accounting_period_id:period,rule_id:`AI_VENDOR_REVIEW_${index}`,risk_level:index%2?'MEDIUM':'HIGH',reason:`Retained accounting evidence ${index} requires Controller review before close.`,suggested_action:'Review the immutable source evidence before any accounting action.'});
const evidence=()=>buildAiFullControllerScanEvidence({tenantId:tenant,entityId:entity,accountingPeriodId:period,releaseSha:'a'.repeat(40),capturedAt:'2026-08-23T21:00:00.000Z',requestedLimit:500,scan:{schema_version:'AI_FULL_CONTROLLER_SCAN_V1',entity_id:entity,current_accounting_period_id:period,status:'COMPLETE',required_section_count:1,complete_section_count:1,finding_count:3,risk_summary:{high:2,medium:1,low:0},coverage_summary:{complete_section_count:1,unavailable_section_count:0,unavailable_sections:[]},sections:[{category:'VENDOR_REVIEW',status:'COMPLETE',schema_version:'AI_VENDOR_REVIEW_BATCH_V1',finding_count:3,findings:[finding(0),finding(1),finding(2)],action_flags:actions}],action_flags:actions}});
const ids=snapshot=>snapshot.sections[0].findings.map((item,index)=>({section_category:'VENDOR_REVIEW',finding_index:index,finding_id:`55555555-5555-4555-8555-55555555555${index}`,finding_hash:item.finding_hash}));

test('chunks every retained finding exactly once and binds the manifest to snapshot and chunk hashes',()=>{
  const snapshot=evidence(),result=buildAiFullControllerModelInputChunks({snapshotId,evidenceSnapshot:snapshot,retainedFindingIds:ids(snapshot),chunkSize:2});
  assert.equal(result.chunk_count,2);assert.equal(result.total_finding_count,3);assert.deepEqual(result.chunks.map(chunk=>chunk.findings.length),[2,1]);assert.deepEqual(result.chunk_hashes,result.chunks.map(chunk=>chunk.chunk_hash));
  assert.deepEqual(result.chunks.flatMap(chunk=>chunk.findings.map(item=>item.finding_id)),ids(snapshot).map(item=>item.finding_id));assert.deepEqual(result.action_flags,actions);
});

test('rejects incomplete snapshots, hash drift, missing or reordered identities, duplicate IDs, and secret-bearing evidence',()=>{
  const base=evidence();
  const cases=[
    ()=>buildAiFullControllerModelInputChunks({snapshotId,evidenceSnapshot:{...base,scan_status:'INCOMPLETE'},retainedFindingIds:ids(base)}),
    ()=>buildAiFullControllerModelInputChunks({snapshotId,evidenceSnapshot:{...base,release_sha:'b'.repeat(40)},retainedFindingIds:ids(base)}),
    ()=>buildAiFullControllerModelInputChunks({snapshotId,evidenceSnapshot:base,retainedFindingIds:ids(base).slice(1)}),
    ()=>buildAiFullControllerModelInputChunks({snapshotId,evidenceSnapshot:base,retainedFindingIds:ids(base).reverse()}),
    ()=>{const mapped=ids(base);mapped[1].finding_id=mapped[0].finding_id;return buildAiFullControllerModelInputChunks({snapshotId,evidenceSnapshot:base,retainedFindingIds:mapped});},
    ()=>{const unsafe=structuredClone(base);unsafe.sections[0].findings[0].evidence.reason='Authorization: Bearer abcdefghijklmnop';return buildAiFullControllerModelInputChunks({snapshotId,evidenceSnapshot:unsafe,retainedFindingIds:ids(base)});}
  ];
  for(const run of cases)assert.throws(run,error=>/^AI_FULL_SCAN_MODEL_INPUT_/.test(error.code));
});

test('represents a complete zero-finding scan as one empty audited chunk',()=>{
  const snapshot=buildAiFullControllerScanEvidence({tenantId:tenant,entityId:entity,accountingPeriodId:period,releaseSha:'a'.repeat(40),capturedAt:'2026-08-23T21:00:00.000Z',requestedLimit:500,scan:{schema_version:'AI_FULL_CONTROLLER_SCAN_V1',entity_id:entity,current_accounting_period_id:period,status:'COMPLETE',required_section_count:1,complete_section_count:1,finding_count:0,risk_summary:{high:0,medium:0,low:0},coverage_summary:{complete_section_count:1,unavailable_section_count:0,unavailable_sections:[]},sections:[{category:'VENDOR_REVIEW',status:'COMPLETE',schema_version:'AI_VENDOR_REVIEW_BATCH_V1',finding_count:0,findings:[],action_flags:actions}],action_flags:actions}});
  const result=buildAiFullControllerModelInputChunks({snapshotId,evidenceSnapshot:snapshot,retainedFindingIds:[]});assert.equal(result.chunk_count,1);assert.deepEqual(result.chunks[0].findings,[]);
});

