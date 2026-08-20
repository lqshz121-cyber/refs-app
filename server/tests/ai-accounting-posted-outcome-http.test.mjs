import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';

const entityId='11111111-1111-4111-8111-111111111111',decisionId='22222222-2222-4222-8222-222222222222',reviewId='33333333-3333-4333-8333-333333333333',hash=`sha256:${'a'.repeat(64)}`;
const principal={trusted:true,tenantId:'44444444-4444-4444-8444-444444444444',actorId:'controller'};
const evidence={schema_version:'AI_ACCOUNTING_POSTED_OUTCOME_EVIDENCE_V1',ai_accounting_decision_id:decisionId,decision_hash:hash,human_decision_id:null,acceptance_hash:null,draft_evidence_id:null,draft_evidence_hash:null,journal_entry_id:null,journal_status:null,journal_revision:null,proposed_lines_hash:hash,journal_lines_hash:hash,ledger_lines_hash:hash,workflow_evidence_hash:hash,financial_statement_snapshot_id:null,financial_statement_snapshot_hash:null,ledger_evidence_hash:null,proposed_journal_exact:false,posted_ledger_exact:false,workflow_exact:false,report_snapshot_exact:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('Posted outcome route accepts only CAS selection and returns closed no-action evidence',async()=>{
  let seen;const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({retainAiAccountingPostedOutcomeReview:async input=>(seen=input,{schema_version:'AI_ACCOUNTING_POSTED_OUTCOME_REVIEW_V1',ai_accounting_posted_outcome_review_id:reviewId,ai_accounting_decision_id:decisionId,review_revision:0,status:'MISSING',reason_codes:['REPORT_SNAPSHOT_MISSING'],review_hash:hash,evidence,can_create_draft:false,can_review:false,can_approve:false,can_post:false,idempotent:false})})});
  const response=await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/accounting-decisions/${decisionId}/posted-outcome-reviews`,headers:{'idempotency-key':'posted-outcome-1'},body:{expected_decision_hash:hash,expected_review_revision:-1}});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.equal(seen.decisionId,decisionId);assert.equal(seen.expectedReviewRevision,-1);assert.deepEqual(response.body.data.reason_codes,['REPORT_SNAPSHOT_MISSING']);
});

test('Posted outcome route rejects caller evidence, missing idempotency and action-enabled responses',async()=>{
  const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({retainAiAccountingPostedOutcomeReview:async()=>({schema_version:'AI_ACCOUNTING_POSTED_OUTCOME_REVIEW_V1',ai_accounting_posted_outcome_review_id:reviewId,ai_accounting_decision_id:decisionId,review_revision:0,status:'CONSISTENT',reason_codes:[],review_hash:hash,evidence:{},can_create_draft:true,can_review:false,can_approve:false,can_post:false,idempotent:false})})});
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/accounting-decisions/${decisionId}/posted-outcome-reviews`,headers:{'idempotency-key':'posted-outcome-bad-input'},body:{expected_decision_hash:hash,expected_review_revision:-1,ledger:[]}})).status,400);
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/accounting-decisions/${decisionId}/posted-outcome-reviews`,headers:{},body:{expected_decision_hash:hash,expected_review_revision:-1}})).status,400);
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/accounting-decisions/${decisionId}/posted-outcome-reviews`,headers:{'idempotency-key':'posted-outcome-unsafe-response'},body:{expected_decision_hash:hash,expected_review_revision:-1}})).status,502);
});

test('OpenAPI exposes one closed server-derived outcome command without workflow authority',async()=>{
  const spec=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8')),op=spec.paths['/entities/{entityId}/ai/accounting-decisions/{decisionId}/posted-outcome-reviews'].post,schema=op.requestBody.content['application/json'].schema;
  assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required.sort(),['expected_decision_hash','expected_review_revision']);assert.match(op.description,/cannot provide policy, workflow, Journal, ledger, or report evidence/);assert.match(op.description,/cannot create, review, approve, or post/);
});
