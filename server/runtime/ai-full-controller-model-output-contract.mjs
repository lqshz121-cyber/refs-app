import {createHash} from 'node:crypto';
import {safeAiEvidenceTree} from './ai-secret-safety.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^sha256:[0-9a-f]{64}$/;
const CODE=/^[A-Z][A-Z0-9_]{2,127}$/;
const ACTION_KEYS=['can_create_draft','can_review','can_approve','can_post'].sort();
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const digest=value=>`sha256:${createHash('sha256').update(canonical(value),'utf8').digest('hex')}`;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
const text=(value,max)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max;
const actions=value=>exact(value,ACTION_KEYS)&&ACTION_KEYS.every(key=>value[key]===false);
const risks=value=>exact(value,['high','medium','low'])&&Object.values(value).every(count=>Number.isSafeInteger(count)&&count>=0);
const model=value=>exact(value,['elapsed_ms','model','provider_request_id'])&&text(value.model,255)&&(value.provider_request_id===null||text(value.provider_request_id,255))&&Number.isSafeInteger(value.elapsed_ms)&&value.elapsed_ms>=0&&value.elapsed_ms<=86_400_000;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const riskSummary=findings=>({high:findings.filter(item=>item.evidence.risk_level==='HIGH').length,medium:findings.filter(item=>item.evidence.risk_level==='MEDIUM').length,low:findings.filter(item=>item.evidence.risk_level==='LOW').length});
const validateActions=(value,byId,expectedIds)=>{
  if(!Array.isArray(value)||value.length>100)return false;
  const cited=[];
  for(const item of value){
    if(!exact(item,['action','category','finding_ids'])||!CODE.test(item.category||'')||!text(item.action,2000)||!Array.isArray(item.finding_ids)||item.finding_ids.length<1||item.finding_ids.length>100||new Set(item.finding_ids).size!==item.finding_ids.length)return false;
    for(const id of item.finding_ids){if(!UUID.test(id)||byId.get(id)?.section_category!==item.category)return false;cited.push(id);}
  }
  return cited.length===expectedIds.length&&new Set(cited).size===cited.length&&expectedIds.every(id=>cited.includes(id));
};

export function buildAiFullControllerModelOutput({inputManifest,chunkResponses,finalMemo}={}){
  if(!inputManifest||inputManifest.schema_version!=='AI_FULL_CONTROLLER_MODEL_INPUT_MANIFEST_V1'||!UUID.test(inputManifest.snapshot_id||'')||!HASH.test(inputManifest.snapshot_hash||'')||!Number.isSafeInteger(inputManifest.chunk_count)||inputManifest.chunk_count<1||!Array.isArray(inputManifest.chunks)||inputManifest.chunks.length!==inputManifest.chunk_count||!Array.isArray(inputManifest.chunk_hashes)||!actions(inputManifest.action_flags)||!safeAiEvidenceTree(inputManifest))fail('AI_FULL_SCAN_MODEL_OUTPUT_INPUT_INVALID','Model output requires one safe, complete retained input manifest.');
  const allFindings=inputManifest.chunks.flatMap(chunk=>chunk.findings||[]),allById=new Map(allFindings.map(item=>[item.finding_id,item]));
  if(allById.size!==allFindings.length||inputManifest.total_finding_count!==allFindings.length)fail('AI_FULL_SCAN_MODEL_OUTPUT_INPUT_INVALID','Input manifest finding identities are incomplete or duplicated.');
  for(const [index,chunk] of inputManifest.chunks.entries()){
    if(chunk.chunk_index!==index||chunk.chunk_count!==inputManifest.chunk_count||chunk.snapshot_id!==inputManifest.snapshot_id||chunk.snapshot_hash!==inputManifest.snapshot_hash||chunk.chunk_hash!==inputManifest.chunk_hashes[index])fail('AI_FULL_SCAN_MODEL_OUTPUT_INPUT_INVALID','Input chunks must be complete, ordered, and bound to the retained snapshot.');
    const unsigned=structuredClone(chunk);delete unsigned.chunk_hash;if(digest(unsigned)!==chunk.chunk_hash)fail('AI_FULL_SCAN_MODEL_OUTPUT_INPUT_INVALID','An input chunk hash does not match its closed payload.');
  }
  if(!Array.isArray(chunkResponses)||chunkResponses.length!==inputManifest.chunk_count)fail('AI_FULL_SCAN_MODEL_OUTPUT_CHUNK_SET_INVALID','Every input chunk requires exactly one model response.');
  const responses=chunkResponses.map((response,index)=>{
    if(!exact(response,['action_flags','chunk_hash','chunk_index','controller_actions','headline','model_metadata','narrative','risk_summary','schema_version','snapshot_hash','snapshot_id'])||response.schema_version!=='AI_FULL_CONTROLLER_MODEL_CHUNK_RESPONSE_V1'||response.snapshot_id!==inputManifest.snapshot_id||response.snapshot_hash!==inputManifest.snapshot_hash||response.chunk_index!==index||response.chunk_hash!==inputManifest.chunk_hashes[index]||!text(response.headline,500)||!text(response.narrative,8000)||!risks(response.risk_summary)||!actions(response.action_flags)||!model(response.model_metadata)||!safeAiEvidenceTree(response))fail('AI_FULL_SCAN_MODEL_OUTPUT_CHUNK_INVALID','A model chunk response is unsafe or not bound to its exact input.');
    const chunk=inputManifest.chunks[index],byId=new Map(chunk.findings.map(item=>[item.finding_id,item])),ids=[...byId.keys()];
    if(JSON.stringify(response.risk_summary)!==JSON.stringify(riskSummary(chunk.findings))||!validateActions(response.controller_actions,byId,ids))fail('AI_FULL_SCAN_MODEL_OUTPUT_CHUNK_INVALID','A model chunk response omitted, duplicated, or invented retained evidence.');
    return Object.freeze({...structuredClone(response),response_hash:digest(response)});
  });
  if(!exact(finalMemo,['action_flags','chunk_response_hashes','controller_actions','headline','model_metadata','narrative','risk_summary','schema_version','snapshot_hash','snapshot_id'])||finalMemo.schema_version!=='AI_FULL_CONTROLLER_MEMO_V1'||finalMemo.snapshot_id!==inputManifest.snapshot_id||finalMemo.snapshot_hash!==inputManifest.snapshot_hash||!Array.isArray(finalMemo.chunk_response_hashes)||JSON.stringify(finalMemo.chunk_response_hashes)!==JSON.stringify(responses.map(item=>item.response_hash))||!text(finalMemo.headline,500)||!text(finalMemo.narrative,12000)||!risks(finalMemo.risk_summary)||JSON.stringify(finalMemo.risk_summary)!==JSON.stringify(riskSummary(allFindings))||!actions(finalMemo.action_flags)||!model(finalMemo.model_metadata)||!validateActions(finalMemo.controller_actions,allById,[...allById.keys()])||!safeAiEvidenceTree(finalMemo))fail('AI_FULL_SCAN_MODEL_OUTPUT_MEMO_INVALID','Controller Memo must synthesize every retained chunk without inventing evidence or authority.');
  const payload={schema_version:'AI_FULL_CONTROLLER_MODEL_OUTPUT_V1',snapshot_id:inputManifest.snapshot_id,snapshot_hash:inputManifest.snapshot_hash,chunk_count:responses.length,total_finding_count:allFindings.length,chunk_responses:Object.freeze(responses),final_memo:Object.freeze(structuredClone(finalMemo)),action_flags:ACTIONS};
  return Object.freeze({...payload,output_hash:digest(payload)});
}
