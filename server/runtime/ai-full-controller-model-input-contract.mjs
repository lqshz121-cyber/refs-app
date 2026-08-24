import {createHash} from 'node:crypto';
import {safeAiEvidenceTree} from './ai-secret-safety.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^sha256:[0-9a-f]{64}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const MAP_KEYS=['finding_hash','finding_id','finding_index','section_category'].sort();
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const digest=value=>`sha256:${createHash('sha256').update(canonical(value),'utf8').digest('hex')}`;
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify(keys);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

export function buildAiFullControllerModelInputChunks({snapshotId,evidenceSnapshot,retainedFindingIds,chunkSize=50}={}){
  if(!UUID.test(snapshotId||'')||!Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>100)fail('AI_FULL_SCAN_MODEL_INPUT_SCOPE_INVALID','Model input requires one retained snapshot identity and a bounded chunk size.');
  if(!evidenceSnapshot||evidenceSnapshot.schema_version!=='AI_FULL_CONTROLLER_SCAN_EVIDENCE_V1'||evidenceSnapshot.scan_status!=='COMPLETE'||!HASH.test(evidenceSnapshot.snapshot_hash||'')||!safeAiEvidenceTree(evidenceSnapshot)||evidenceSnapshot.sections?.some(section=>section.status!=='COMPLETE'))fail('AI_FULL_SCAN_MODEL_INPUT_SNAPSHOT_INVALID','Only one complete, safe, retained Full Controller snapshot may reach the model boundary.');
  const unsigned=structuredClone(evidenceSnapshot);delete unsigned.snapshot_hash;
  if(digest(unsigned)!==evidenceSnapshot.snapshot_hash)fail('AI_FULL_SCAN_MODEL_INPUT_SNAPSHOT_HASH_MISMATCH','The retained Full Controller snapshot hash does not match its closed payload.');
  if(!Array.isArray(retainedFindingIds)||retainedFindingIds.length!==evidenceSnapshot.finding_count)fail('AI_FULL_SCAN_MODEL_INPUT_FINDING_MAP_INVALID','Every retained finding requires exactly one persistent identity.');
  const expected=[];
  for(const section of evidenceSnapshot.sections)for(const finding of section.findings)expected.push({section_category:section.category,finding_index:finding.finding_index,finding_hash:finding.finding_hash,evidence:finding.evidence});
  const ids=new Set(),coordinates=new Set();
  const findings=retainedFindingIds.map((mapping,index)=>{
    if(!exactKeys(mapping,MAP_KEYS)||!UUID.test(mapping.finding_id||'')||!HASH.test(mapping.finding_hash||'')||!Number.isSafeInteger(mapping.finding_index)||mapping.finding_index<0)fail('AI_FULL_SCAN_MODEL_INPUT_FINDING_MAP_INVALID','Retained finding identities must use the closed mapping contract.');
    const coordinate=`${mapping.section_category}:${mapping.finding_index}`;
    if(ids.has(mapping.finding_id)||coordinates.has(coordinate))fail('AI_FULL_SCAN_MODEL_INPUT_FINDING_MAP_INVALID','Retained finding identities and coordinates must be unique.');ids.add(mapping.finding_id);coordinates.add(coordinate);
    const source=expected[index];
    if(!source||mapping.section_category!==source.section_category||mapping.finding_index!==source.finding_index||mapping.finding_hash!==source.finding_hash||digest(source.evidence)!==source.finding_hash)fail('AI_FULL_SCAN_MODEL_INPUT_FINDING_HASH_MISMATCH','Retained finding identity does not match the canonical snapshot order and hash.');
    return Object.freeze({finding_id:mapping.finding_id,section_category:mapping.section_category,finding_index:mapping.finding_index,finding_hash:mapping.finding_hash,evidence:source.evidence});
  });
  const chunkCount=Math.max(1,Math.ceil(findings.length/chunkSize)),chunks=[];
  for(let index=0;index<chunkCount;index++){
    const chunkFindings=findings.slice(index*chunkSize,(index+1)*chunkSize);
    const payload={schema_version:'AI_FULL_CONTROLLER_MODEL_INPUT_CHUNK_V1',snapshot_id:snapshotId,snapshot_hash:evidenceSnapshot.snapshot_hash,tenant_id:evidenceSnapshot.tenant_id,entity_id:evidenceSnapshot.entity_id,accounting_period_id:evidenceSnapshot.accounting_period_id,release_sha:evidenceSnapshot.release_sha,chunk_index:index,chunk_count:chunkCount,total_finding_count:findings.length,section_categories:evidenceSnapshot.registered_section_categories,risk_summary:evidenceSnapshot.risk_summary,findings:chunkFindings,action_flags:ACTIONS};
    chunks.push(Object.freeze({...payload,chunk_hash:digest(payload)}));
  }
  return Object.freeze({schema_version:'AI_FULL_CONTROLLER_MODEL_INPUT_MANIFEST_V1',snapshot_id:snapshotId,snapshot_hash:evidenceSnapshot.snapshot_hash,chunk_count:chunks.length,total_finding_count:findings.length,chunk_hashes:Object.freeze(chunks.map(chunk=>chunk.chunk_hash)),chunks:Object.freeze(chunks),action_flags:ACTIONS});
}

