import assert from 'node:assert/strict';
import test from 'node:test';
import {AiAccrualCandidateError,evaluateAiAccrualCandidate} from '../runtime/ai-accrual-candidate-evaluator.mjs';

const entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='4e0b2744-2366-46d5-8b34-6ccf49deaabf';
const hash=seed=>`sha256:${seed.repeat(64).slice(0,64)}`;
const record=({ordinal,period=`2026-0${ordinal+1}`,amount='1250.00',...rest}={})=>({service_period_start:`${period}-01`,service_period_end:`${period}-28`,recurring_obligation_id:'contract:vendor-17:maintenance',service_frequency:'MONTHLY',obligation_status:'ACTIVE',source_document_id:`00000000-0000-4000-8000-00000000000${ordinal}`,source_document_line_id:`10000000-0000-4000-8000-00000000000${ordinal}`,source_payload_hash:hash(String(ordinal)),source_line_hash:hash(String(ordinal+3)),entity_id:entityId,accounting_period_id:`20000000-0000-4000-8000-00000000000${ordinal}`,currency:'USD',amount,period_key:period,period_ordinal:ordinal,closed:true,...rest});
const input=overrides=>({entityId,currentPeriodId:periodId,currentPeriodKey:'2026-05',currentPeriodOrdinal:4,priorEvidence:[record({ordinal:3}),record({ordinal:2}),record({ordinal:1})],currentPeriodSourceDocumentIds:[],postedCurrentSourceDocumentIds:[],...overrides});

test('three exact signed prior obligations with no current source produce only a human review candidate',()=>{
  const result=evaluateAiAccrualCandidate(input());
  assert.equal(result.status,'ACCRUAL_CANDIDATE_REVIEW_REQUIRED');
  assert.equal(result.rule_id,'RECURRING_OBLIGATION_MISSING_CURRENT_PERIOD');
  assert.equal(result.prior_source_trace.length,3);
  assert.deepEqual(result.required_human_fields,['owner','due_date','accrual_basis','account_mapping','member_trace','reversing_entry_decision']);
  assert.deepEqual({draft:result.can_create_draft,review:result.can_review,approve:result.can_approve,post:result.can_post},{draft:false,review:false,approve:false,post:false});
});

test('incomplete, mismatched, or nonconsecutive evidence cannot become an accrual candidate',()=>{
  assert.throws(()=>evaluateAiAccrualCandidate(input({priorEvidence:[record({ordinal:3,source_line_hash:'sha256:not-a-hash'}),record({ordinal:2}),record({ordinal:1})]})),error=>error instanceof AiAccrualCandidateError&&error.code==='ACCRUAL_EVIDENCE_INVALID');
  assert.equal(evaluateAiAccrualCandidate(input({priorEvidence:[record({ordinal:3}),record({ordinal:2,recurring_obligation_id:'different'}),record({ordinal:1})]})).status,'NO_ACCRUAL_CANDIDATE');
  assert.equal(evaluateAiAccrualCandidate(input({priorEvidence:[record({ordinal:3}),record({ordinal:1}),record({ordinal:0})]})).reason,'HISTORICAL_PERIODS_NOT_CONSECUTIVE');
});

test('a retained or posted current-period source prevents an omitted-accrual claim',()=>{
  const source='30000000-0000-4000-8000-000000000001';
  assert.equal(evaluateAiAccrualCandidate(input({currentPeriodSourceDocumentIds:[source]})).reason,'CURRENT_PERIOD_RETAINED_SOURCE_EXISTS');
  assert.equal(evaluateAiAccrualCandidate(input({postedCurrentSourceDocumentIds:[source]})).reason,'CURRENT_PERIOD_POSTED_SOURCE_LINK_EXISTS');
});
