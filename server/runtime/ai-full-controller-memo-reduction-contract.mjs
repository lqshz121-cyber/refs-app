import {createHash} from 'node:crypto';
import {safeAiEvidenceTree} from './ai-secret-safety.mjs';

const HASH=/^sha256:[0-9a-f]{64}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const digest=value=>`sha256:${createHash('sha256').update(canonical(value),'utf8').digest('hex')}`;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const riskRank=Object.freeze({HIGH:0,MEDIUM:1,LOW:2});
const addRisk=(left,right)=>({high:left.high+right.high,medium:left.medium+right.medium,low:left.low+right.low});
const validRisk=value=>value&&Number.isSafeInteger(value.high)&&value.high>=0&&Number.isSafeInteger(value.medium)&&value.medium>=0&&Number.isSafeInteger(value.low)&&value.low>=0;
const prioritySort=(a,b)=>riskRank[a.risk_level]-riskRank[b.risk_level]||a.finding_id.localeCompare(b.finding_id);

export function buildAiFullControllerMemoReduction({inputManifest,sealedChunkResponses,groupSize=25,priorityLimit=10}={}){
  if(!inputManifest||inputManifest.schema_version!=='AI_FULL_CONTROLLER_MODEL_INPUT_MANIFEST_V1'||!UUID.test(inputManifest.snapshot_id||'')||!HASH.test(inputManifest.snapshot_hash||'')||!Array.isArray(inputManifest.chunks)||!Array.isArray(sealedChunkResponses)||sealedChunkResponses.length!==inputManifest.chunks.length||!Number.isSafeInteger(groupSize)||groupSize<2||groupSize>100||!Number.isSafeInteger(priorityLimit)||priorityLimit<1||priorityLimit>100)fail('AI_FULL_SCAN_MEMO_REDUCTION_INVALID','Memo reduction requires exact retained chunks and bounded fanout.');
  const leaves=sealedChunkResponses.map((response,index)=>{
    const chunk=inputManifest.chunks[index];
    if(!response||response.chunk_index!==index||response.chunk_hash!==chunk.chunk_hash||!HASH.test(response.response_hash||'')||!validRisk(response.risk_summary)||!Array.isArray(response.controller_actions)||!safeAiEvidenceTree(response))fail('AI_FULL_SCAN_MEMO_REDUCTION_INVALID','Every reduction leaf must be one safe sealed chunk response.');
    const raw=structuredClone(response);delete raw.response_hash;if(digest(raw)!==response.response_hash)fail('AI_FULL_SCAN_MEMO_REDUCTION_INVALID','A reduction leaf response hash drifted.');
    const actionById=new Map();for(const action of response.controller_actions)for(const id of action.finding_ids||[])actionById.set(id,{category:action.category,action:action.action});
    const priorities=chunk.findings.map(item=>({finding_id:item.finding_id,category:item.section_category,risk_level:item.evidence.risk_level,action:actionById.get(item.finding_id)?.action?.slice(0,500)}));
    if(priorities.some(item=>!UUID.test(item.finding_id)||typeof item.action!=='string'))fail('AI_FULL_SCAN_MEMO_REDUCTION_INVALID','Reduction leaves require complete retained citations.');
    return {node_hash:response.response_hash,finding_count:chunk.findings.length,risk_summary:response.risk_summary,priority_findings:priorities.sort(prioritySort).slice(0,priorityLimit),headline:response.headline.slice(0,300)};
  });
  let current=leaves,level=0;const nodes=[];
  while(current.length>100){
    const next=[];
    for(let start=0;start<current.length;start+=groupSize){
      const children=current.slice(start,start+groupSize),risk=children.reduce((sum,item)=>addRisk(sum,item.risk_summary),{high:0,medium:0,low:0}),priorities=[...new Map(children.flatMap(item=>item.priority_findings).sort(prioritySort).map(item=>[item.finding_id,item])).values()].slice(0,priorityLimit);
      const payload={schema_version:'AI_FULL_CONTROLLER_MEMO_REDUCTION_NODE_V1',snapshot_id:inputManifest.snapshot_id,snapshot_hash:inputManifest.snapshot_hash,level,node_index:next.length,child_hashes:children.map(item=>item.node_hash),finding_count:children.reduce((sum,item)=>sum+item.finding_count,0),risk_summary:risk,priority_findings:priorities,headlines:children.map(item=>item.headline).slice(0,groupSize),action_flags:ACTIONS};
      const node=Object.freeze({...payload,node_hash:digest(payload)});nodes.push(node);next.push(node);
    }
    current=next;level++;
  }
  const payload={schema_version:'AI_FULL_CONTROLLER_MEMO_REDUCTION_V1',snapshot_id:inputManifest.snapshot_id,snapshot_hash:inputManifest.snapshot_hash,chunk_response_hashes:sealedChunkResponses.map(item=>item.response_hash),reduction_node_count:nodes.length,reduction_nodes:Object.freeze(nodes),root_nodes:Object.freeze(current),total_finding_count:inputManifest.total_finding_count,risk_summary:inputManifest.chunks.reduce((sum,chunk)=>addRisk(sum,{high:chunk.findings.filter(item=>item.evidence.risk_level==='HIGH').length,medium:chunk.findings.filter(item=>item.evidence.risk_level==='MEDIUM').length,low:chunk.findings.filter(item=>item.evidence.risk_level==='LOW').length}),{high:0,medium:0,low:0}),action_flags:ACTIONS};
  if(payload.root_nodes.length>100||payload.root_nodes.reduce((sum,item)=>sum+item.finding_count,0)!==payload.total_finding_count||!safeAiEvidenceTree(payload))fail('AI_FULL_SCAN_MEMO_REDUCTION_INVALID','Memo reduction did not preserve the complete retained population.');
  return Object.freeze({...payload,reduction_hash:digest(payload)});
}
