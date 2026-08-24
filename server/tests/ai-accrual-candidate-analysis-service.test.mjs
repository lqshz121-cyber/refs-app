import assert from 'node:assert/strict';
import test from 'node:test';
import {AiAccrualCandidateError} from '../runtime/ai-accrual-candidate-evaluator.mjs';
import {createAiAccrualCandidateAnalysisService} from '../runtime/ai-accrual-candidate-analysis-service.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='4e0b2744-2366-46d5-8b34-6ccf49deaabf';
const hash=n=>`sha256:${String(n).repeat(64).slice(0,64)}`;
const requiredSignedKeys=Object.freeze(['signed_invoice_no','signed_invoice_date','signed_business_id','signed_service_period_start','signed_service_period_end','signed_recurring_obligation_id','signed_contract_id','signed_charge_code','signed_service_frequency','signed_obligation_status']);
const accrualKeys=Object.freeze(requiredSignedKeys.slice(3));
const row=ordinal=>({entity_id:entityId,source_entity_id:'WBPA',source_system:'WBS',source_module:'payable',document_type:'WBS_FINAL1_PAYABLE',source_status:'PENDING_REVIEW',source_document_id:`00000000-0000-4000-8000-00000000000${ordinal}`,source_document_line_id:`10000000-0000-4000-8000-00000000000${ordinal}`,accounting_period_id:`20000000-0000-4000-8000-00000000000${ordinal}`,period_code:`2026-0${ordinal+1}`,period_ordinal:ordinal,period_closed:true,payload_hash:hash(ordinal),currency:'USD',amount:'1250.00',party_ref:'VENDOR-17',external_dimension_refs:{schema_version:'WBS_FINAL1_RETAINED_SOURCE_LINE_V1',domain:'PAYABLES',accounting_period_resolution:'EXACT_PRIMARY_PERIOD',accounting_period_id:`20000000-0000-4000-8000-00000000000${ordinal}`,raw_row_hash:hash(ordinal),signed_invoice_no:`INV-${ordinal}`,signed_invoice_date:`2026-0${ordinal+1}-01`,signed_business_id:`WBS-BUSINESS-${ordinal}`,signed_service_period_start:`2026-0${ordinal+1}-01`,signed_service_period_end:`2026-0${ordinal+1}-28`,signed_recurring_obligation_id:'WBS-OBL-17',signed_contract_id:null,signed_charge_code:null,signed_service_frequency:'MONTHLY',signed_obligation_status:'ACTIVE'}});
const request={tenantId,entityId,companyCode:'WBPA',currentPeriodId:periodId,currentPeriodKey:'2026-05',currentPeriodOrdinal:4};

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

test('a saturated retained-history reader fails closed before obligation lookups or accounting conclusions',async()=>{
  let currentCalls=0,postedCalls=0;
  const saturated=Array.from({length:241},(_,index)=>row(index%3+1));
  const service=createAiAccrualCandidateAnalysisService({retainedHistoryReader:async()=>saturated,currentSourceReader:async()=>{currentCalls++;return [];},postedSourceReader:async()=>{postedCalls++;return [];}});
  await assert.rejects(()=>service.analyze(request),error=>error instanceof AiAccrualCandidateError&&error.code==='AI_ACCRUAL_HISTORY_POPULATION_INCOMPLETE');
  assert.equal(currentCalls,0);assert.equal(postedCalls,0);
});

test('a complete required10 explicitly-null payable is retained outside accrual analysis and cannot poison valid history',async()=>{
  const explicitNonAccrual={...row(4),external_dimension_refs:{...row(4).external_dimension_refs,...Object.fromEntries(accrualKeys.map(key=>[key,null]))}};
  let currentCalls=0;
  const service=createAiAccrualCandidateAnalysisService({retainedHistoryReader:async()=>[explicitNonAccrual,row(3),row(2),row(1)],currentSourceReader:async()=>{currentCalls++;return [];},postedSourceReader:async()=>[]});
  const result=await service.analyze(request);
  assert.equal(result.excluded_explicit_non_accrual_evidence_count,1);assert.equal(result.candidates.length,1);assert.equal(currentCalls,1);
  const onlyNull=createAiAccrualCandidateAnalysisService({retainedHistoryReader:async()=>[explicitNonAccrual],currentSourceReader:async()=>{throw new Error('no obligation lookup for null evidence');},postedSourceReader:async()=>{throw new Error('no posted lookup for null evidence');}});
  const empty=await onlyNull.analyze(request);assert.equal(empty.candidates.length,0);assert.equal(empty.excluded_explicit_non_accrual_evidence_count,1);
  assert.deepEqual({draft:empty.can_create_draft,review:empty.can_review,approve:empty.can_approve,post:empty.can_post},{draft:false,review:false,approve:false,post:false});
});

test('missing, inherited, undefined, and partially-null required10 evidence reaches the strict adapter and fails closed',async()=>{
  const malformed=[];
  for(const key of requiredSignedKeys){const value=row(4);delete value.external_dimension_refs[key];malformed.push(value);}
  const inherited=row(4);const inheritedDimensions={...inherited.external_dimension_refs};delete inheritedDimensions.signed_business_id;inherited.external_dimension_refs=Object.assign(Object.create({signed_business_id:null}),inheritedDimensions);malformed.push(inherited);
  const undefinedKey=row(4);undefinedKey.external_dimension_refs.signed_invoice_date=undefined;malformed.push(undefinedKey);
  const partial=row(4);partial.external_dimension_refs.signed_service_frequency=null;malformed.push(partial);
  for(const value of malformed){
    let currentCalls=0,postedCalls=0;
    const service=createAiAccrualCandidateAnalysisService({retainedHistoryReader:async()=>[value,row(3),row(2),row(1)],currentSourceReader:async()=>{currentCalls++;return [];},postedSourceReader:async()=>{postedCalls++;return [];}});
    await assert.rejects(()=>service.analyze(request),error=>error instanceof AiAccrualCandidateError&&error.code==='ACCRUAL_RETAINED_SOURCE_INVALID');
    assert.equal(currentCalls,0);assert.equal(postedCalls,0);
  }
});

test('nullable source invoice bindings may be explicitly non-accrual, but undefined signed keys fail closed',async()=>{
  const nullable=row(4);Object.assign(nullable.external_dimension_refs,Object.fromEntries(accrualKeys.map(accrualKey=>[accrualKey,null])),{signed_invoice_no:null,signed_invoice_date:null,signed_business_id:null});
  const nullableService=createAiAccrualCandidateAnalysisService({retainedHistoryReader:async()=>[nullable],currentSourceReader:async()=>{throw new Error('no current lookup for explicit non-accrual');},postedSourceReader:async()=>{throw new Error('no posted lookup for explicit non-accrual');}});
  const nullableResult=await nullableService.analyze(request);assert.equal(nullableResult.excluded_explicit_non_accrual_evidence_count,1);assert.deepEqual(nullableResult.candidates,[]);
  const shapes=[];
  for(const [key,value] of [['signed_invoice_no',undefined],['signed_invoice_date',undefined],['signed_business_id',undefined]]){
    const valueRow=row(4);Object.assign(valueRow.external_dimension_refs,Object.fromEntries(accrualKeys.map(accrualKey=>[accrualKey,null])));valueRow.external_dimension_refs[key]=value;shapes.push(valueRow);
  }
  for(const value of shapes){
    let currentCalls=0,postedCalls=0;
    const service=createAiAccrualCandidateAnalysisService({retainedHistoryReader:async()=>[value],currentSourceReader:async()=>{currentCalls++;return [];},postedSourceReader:async()=>{postedCalls++;return [];}});
    await assert.rejects(()=>service.analyze(request),error=>error instanceof AiAccrualCandidateError&&error.code==='ACCRUAL_RETAINED_SOURCE_INVALID');
    assert.equal(currentCalls,0);assert.equal(postedCalls,0);
  }
});

test('malformed envelopes with seven null accrual fields are never excluded',async()=>{
  const malformed=[
    {rowPatch:{source_system:'BAD'}},{rowPatch:{entity_id:'not-a-uuid'}},{rowPatch:{entity_id:'c5e338aa-6b93-4be0-b40e-3c8b0a2d4037'}},{rowPatch:{source_entity_id:'OTHER'}},{rowPatch:{period_code:'bad-period'}},{rowPatch:{payload_hash:'sha256:bad'}},{rowPatch:{currency:'US'}},{rowPatch:{amount:'0'}},
    {dimensionPatch:{raw_row_hash:hash(9)}},{dimensionPatch:{schema_version:'BAD'}},{dimensionPatch:{domain:'INSURANCE'}},{dimensionPatch:{accounting_period_resolution:'UNRESOLVED'}},{dimensionPatch:{accounting_period_id:'not-a-uuid'}}
  ];
  for(const {rowPatch={},dimensionPatch={}} of malformed){
    const value={...row(4),...rowPatch,external_dimension_refs:{...row(4).external_dimension_refs,...Object.fromEntries(accrualKeys.map(key=>[key,null])),...dimensionPatch}};
    let currentCalls=0,postedCalls=0;
    const service=createAiAccrualCandidateAnalysisService({retainedHistoryReader:async()=>[value],currentSourceReader:async()=>{currentCalls++;return [];},postedSourceReader:async()=>{postedCalls++;return [];}});
    await assert.rejects(()=>service.analyze(request),error=>error instanceof AiAccrualCandidateError&&error.code==='ACCRUAL_RETAINED_SOURCE_INVALID');
    assert.equal(currentCalls,0);assert.equal(postedCalls,0);
  }
});
