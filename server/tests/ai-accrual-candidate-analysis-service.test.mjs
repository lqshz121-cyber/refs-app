import assert from 'node:assert/strict';
import test from 'node:test';
import {AiAccrualCandidateError} from '../runtime/ai-accrual-candidate-evaluator.mjs';
import {createAiAccrualCandidateAnalysisService} from '../runtime/ai-accrual-candidate-analysis-service.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='4e0b2744-2366-46d5-8b34-6ccf49deaabf';
const hash=n=>`sha256:${String(n).repeat(64).slice(0,64)}`;
const row=ordinal=>({entity_id:entityId,source_system:'WBS',source_module:'payable',document_type:'WBS_FINAL1_PAYABLE',source_status:'PENDING_REVIEW',source_document_id:`00000000-0000-4000-8000-00000000000${ordinal}`,source_document_line_id:`10000000-0000-4000-8000-00000000000${ordinal}`,accounting_period_id:`20000000-0000-4000-8000-00000000000${ordinal}`,period_code:`2026-0${ordinal+1}`,period_ordinal:ordinal,period_closed:true,payload_hash:hash(ordinal),currency:'USD',amount:'1250.00',party_ref:'VENDOR-17',external_dimension_refs:{schema_version:'WBS_FINAL1_RETAINED_SOURCE_LINE_V1',domain:'PAYABLES',accounting_period_resolution:'EXACT_PRIMARY_PERIOD',accounting_period_id:`20000000-0000-4000-8000-00000000000${ordinal}`,raw_row_hash:hash(ordinal),signed_service_period_start:`2026-0${ordinal+1}-01`,signed_service_period_end:`2026-0${ordinal+1}-28`,signed_recurring_obligation_id:'WBS-OBL-17',signed_contract_id:null,signed_charge_code:null,signed_service_frequency:'MONTHLY',signed_obligation_status:'ACTIVE'}});
const request={tenantId,entityId,currentPeriodId:periodId,currentPeriodKey:'2026-05',currentPeriodOrdinal:4};

test('read-only accrual analysis composes retained evidence into a no-action review candidate',async()=>{
  let currentCalls=0,postedCalls=0;
  const service=createAiAccrualCandidateAnalysisService({retainedHistoryReader:async()=>[row(3),row(2),row(1)],currentSourceReader:async input=>{currentCalls++;assert.equal(input.recurringObligationId,'WBS-OBL-17');return [];},postedSourceReader:async()=>{postedCalls++;return [];}});
  const result=await service.analyze(request);
  assert.equal(result.status,'AI_ACCRUAL_ANALYSIS_COMPLETE');assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].status,'ACCRUAL_CANDIDATE_REVIEW_REQUIRED');
  assert.deepEqual({draft:result.can_create_draft,review:result.can_review,approve:result.can_approve,post:result.can_post},{draft:false,review:false,approve:false,post:false});assert.equal(currentCalls,1);assert.equal(postedCalls,1);
});

test('invalid retained source or a current retained source prevents a candidate and no model or command boundary exists',async()=>{
  const bad=createAiAccrualCandidateAnalysisService({retainedHistoryReader:async()=>[{...row(3),payload_hash:'bad'}],currentSourceReader:async()=>[],postedSourceReader:async()=>[]});
  await assert.rejects(()=>bad.analyze(request),error=>error instanceof AiAccrualCandidateError&&error.code==='ACCRUAL_RETAINED_SOURCE_INVALID');
  const existing=createAiAccrualCandidateAnalysisService({retainedHistoryReader:async()=>[row(3),row(2),row(1)],currentSourceReader:async()=>['30000000-0000-4000-8000-000000000001'],postedSourceReader:async()=>[]});
  assert.deepEqual((await existing.analyze(request)).candidates,[]);
});
