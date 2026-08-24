import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {buildAiFullControllerMemoReduction} from '../runtime/ai-full-controller-memo-reduction-contract.mjs';
import {redactAiFacts} from '../runtime/litellm-gateway.mjs';

const snapshot='11111111-1111-4111-8111-111111111111',hash='sha256:'+'a'.repeat(64),flags={can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`,digest=value=>`sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
const fixture=count=>{const chunks=[],responses=[];for(let index=0;index<count;index++){const finding={finding_id:`${index.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`,section_category:'VENDOR_REVIEW',evidence:{risk_level:index%3===0?'HIGH':index%3===1?'MEDIUM':'LOW'}};chunks.push({chunk_index:index,chunk_hash:`sha256:${index.toString(16).padStart(64,'0')}`,findings:[finding]});const raw={chunk_index:index,chunk_hash:chunks[index].chunk_hash,risk_summary:{high:finding.evidence.risk_level==='HIGH'?1:0,medium:finding.evidence.risk_level==='MEDIUM'?1:0,low:finding.evidence.risk_level==='LOW'?1:0},controller_actions:[{category:'VENDOR_REVIEW',finding_ids:[finding.finding_id],action:'Human review only.'}],headline:`Chunk ${index}`,action_flags:flags};responses.push({...raw,response_hash:digest(raw)});}return {inputManifest:{schema_version:'AI_FULL_CONTROLLER_MODEL_INPUT_MANIFEST_V1',snapshot_id:snapshot,snapshot_hash:hash,total_finding_count:count,chunks},sealedChunkResponses:responses};};

test('reduces more than 100 complete chunk receipts into at most 100 hash-bound roots without losing population',()=>{
  const value=fixture(251),result=buildAiFullControllerMemoReduction({...value,groupSize:10,priorityLimit:20});assert.equal(result.chunk_response_hashes.length,251);assert.equal(result.root_nodes.length,26);assert.equal(result.root_nodes.reduce((sum,node)=>sum+node.finding_count,0),251);assert.equal(result.risk_summary.high+result.risk_summary.medium+result.risk_summary.low,251);assert.ok(result.reduction_node_count>0);assert.match(result.reduction_hash,/^sha256:/);assert.deepEqual(result.action_flags,flags);
  assert.throws(()=>redactAiFacts({chunk_responses:value.sealedChunkResponses}),error=>error.code==='AI_FACTS_ARRAY_LIMIT');assert.doesNotThrow(()=>redactAiFacts({root_nodes:result.root_nodes}));
});

test('keeps small runs direct and rejects drifted, unsafe, missing, or oversized reduction inputs',()=>{
  const small=fixture(3),direct=buildAiFullControllerMemoReduction(small);assert.equal(direct.reduction_node_count,0);assert.equal(direct.root_nodes.length,3);
  const cases=[()=>buildAiFullControllerMemoReduction({...small,sealedChunkResponses:small.sealedChunkResponses.slice(1)}),()=>{const changed=structuredClone(small);changed.sealedChunkResponses[0].headline='drift';return buildAiFullControllerMemoReduction(changed);},()=>{const changed=structuredClone(small);changed.sealedChunkResponses[0].headline='Authorization: Bearer secret-value-123456';const raw={...changed.sealedChunkResponses[0]};delete raw.response_hash;changed.sealedChunkResponses[0].response_hash=digest(raw);return buildAiFullControllerMemoReduction(changed);},()=>buildAiFullControllerMemoReduction({...small,groupSize:101})];
  for(const run of cases)assert.throws(run,error=>error.code==='AI_FULL_SCAN_MEMO_REDUCTION_INVALID');
});
