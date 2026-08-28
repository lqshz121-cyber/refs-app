import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenantId=id(1),entityId=id(2),periodId=id(3),decisionId=id(4),hash=`sha256:${'a'.repeat(64)}`;
const actions={can_accept_or_reject:true,can_create_draft:false,can_retain_posted_outcome:false,can_submit:false,can_review:false,can_approve:false,can_post:false};
const packet={schema_version:'AI_ACCOUNTING_DECISION_PACKET_V1',status:'READY_FOR_HUMAN_REVIEW',tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId,source:{source_document_id:id(5),source_document_line_id:id(6),source_payload_hash:hash,source_line_hash:hash},proposed_journal:{status:'SUGGESTED_ONLY',lines:[{},{}]},expected_report_deltas:[{}],action_flags:{can_create_draft:false,can_review:false,can_approve:false,can_post:false}};
const row={schema_version:'AI_ACCOUNTING_DECISION_QUEUE_ITEM_V1',ai_accounting_decision_id:decisionId,decision_hash:hash,packet_status:'READY_FOR_HUMAN_REVIEW',created_at:'2026-08-28T12:00:00.000Z',packet,workflow_state:'AWAITING_HUMAN_DECISION',human_decision:null,draft_evidence:null,latest_posted_outcome_review:null,action_flags:actions};
const queue={schema_version:'AI_ACCOUNTING_DECISION_QUEUE_V1',scope:{tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId},total_count:1,read_count:1,limit:50,offset:0,population_complete:true,rows:[row]};
const principal={trusted:true,tenantId,actorId:'decision-maker'};

test('retained decision queue is a no-store scoped read with no command authority',async()=>{
  let seen;const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({readAiAccountingDecisionQueue:async input=>(seen=input,queue)})});
  const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/ai/accounting-decision-queue?periodId=${periodId}&limit=50&offset=0`,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(seen,{tenantId,entityId,accountingPeriodId:periodId,limit:50,offset:0});assert.equal(response.body.data.rows[0].action_flags.can_post,false);
});

test('retained decision queue rejects partial, duplicate, open, and post-capable evidence',async()=>{
  for(const unsafe of [
    {...queue,population_complete:false},
    {...queue,read_count:2,rows:[row,row]},
    {...queue,rows:[{...row,debug:'open'}]},
    {...queue,rows:[{...row,action_flags:{...actions,can_post:true}}]},
    {...queue,rows:[{...row,human_decision:{ai_accounting_human_decision_id:id(7),outcome:'REJECTED',decision_hash:hash,evidence_hash:hash,reason:'Controller rejected retained evidence.',decided_by:'controller',decided_at:'2026-08-28T12:01:00.000Z'}}]},
  ]){
    const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({readAiAccountingDecisionQueue:async()=>unsafe})});
    const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/ai/accounting-decision-queue?periodId=${periodId}`,headers:{},body:null});
    assert.equal(response.status,502);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.code,'AI_ACCOUNTING_DECISION_QUEUE_RESPONSE_INVALID');
  }
});

test('OpenAPI exposes only the closed recoverable decision queue GET',async()=>{
  const spec=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
  const operation=spec.paths['/entities/{entityId}/ai/accounting-decision-queue'].get;
  assert.equal(operation.responses['200'].content['application/json'].schema.properties.data.$ref,'#/components/schemas/AiAccountingDecisionQueue');
  assert.equal(spec.components.schemas.AiAccountingDecisionQueue.additionalProperties,false);
  assert.equal(spec.components.schemas.AiAccountingDecisionQueueActions.properties.can_post.const,false);
});
