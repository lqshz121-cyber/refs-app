import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=`sha256:${'a'.repeat(64)}`,tenantId=id(1),entityId=id(2),decisionId=id(3);
const principal={trusted:true,tenantId,actorId:'human-maker'};

test('human accepts an immutable decision without creating or advancing a Journal',async()=>{
  let seen;const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({humanDecideAiAccounting:async input=>(seen=input,{schema_version:'AI_ACCOUNTING_HUMAN_DECISION_V1',ai_accounting_decision_id:decisionId,ai_accounting_human_decision_id:id(4),decision_hash:hash,evidence_hash:hash,outcome:'ACCEPTED',can_create_draft:false,can_review:false,can_approve:false,can_post:false,idempotent:false})})});
  const response=await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/accounting-decisions/${decisionId}/human-decisions`,headers:{'idempotency-key':'human-decision-1'},body:{expected_decision_hash:hash,expected_revision:0,outcome:'ACCEPTED',reason:'Controller verified the retained source and proposed accounting treatment.'}});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.equal(seen.decisionId,decisionId);assert.equal(seen.outcome,'ACCEPTED');
});

test('accepted decision creates only a standard Draft through the authenticated kernel',async()=>{
  let seen;const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({createAiAccountingDecisionDraft:async input=>(seen=input,{schema_version:'AI_ACCOUNTING_DECISION_DRAFT_V1',ai_accounting_decision_draft_evidence_id:id(5),ai_accounting_decision_id:decisionId,ai_accounting_human_decision_id:id(4),journal_entry_id:id(9),status:'DRAFT',revision:0,idempotent:false,can_review:false,can_approve:false,can_post:false})})});
  const response=await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/accounting-decisions/${decisionId}/drafts`,headers:{'idempotency-key':'decision-draft-1'},body:{expected_decision_hash:hash,expected_acceptance_hash:hash,reason:'Create the human-controlled Draft from the accepted immutable decision.'}});
  assert.equal(response.status,201);assert.equal(response.body.data.status,'DRAFT');assert.equal(seen.decisionId,decisionId);assert.equal(response.body.data.can_post,false);
});

test('human decision and Draft routes reject open payloads and missing command evidence',async()=>{
  const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({humanDecideAiAccounting:async()=>assert.fail('must not call'),createAiAccountingDecisionDraft:async()=>assert.fail('must not call')})});
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/accounting-decisions/${decisionId}/human-decisions`,headers:{},body:{expected_decision_hash:hash,expected_revision:0,outcome:'ACCEPTED',reason:'valid reason'}})).status,400);
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/accounting-decisions/${decisionId}/drafts`,headers:{'idempotency-key':'x'},body:{expected_decision_hash:hash,expected_acceptance_hash:hash,reason:'valid reason',post:true}})).status,400);
});

test('OpenAPI exposes closed human decision and Draft commands without workflow escalation',async()=>{
  const spec=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
  const human=spec.paths['/entities/{entityId}/ai/accounting-decisions/{decisionId}/human-decisions'].post,draft=spec.paths['/entities/{entityId}/ai/accounting-decisions/{decisionId}/drafts'].post;
  assert.equal(human.requestBody.content['application/json'].schema.additionalProperties,false);assert.deepEqual(human.requestBody.content['application/json'].schema.properties.outcome.enum,['ACCEPTED','REJECTED']);
  assert.equal(draft.requestBody.content['application/json'].schema.additionalProperties,false);assert.deepEqual(Object.keys(draft.requestBody.content['application/json'].schema.properties).sort(),['expected_acceptance_hash','expected_decision_hash','reason']);
});
