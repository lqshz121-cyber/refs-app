import assert from 'node:assert/strict';
import test from 'node:test';
import contract from '../api/openapi-accounting.json' with {type:'json'};
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='4e0b2744-2366-46d5-8b34-6ccf49deaabf';
const path=`/api/v1/entities/${entityId}/ai/accrual-candidates?periodId=${periodId}`;
const safe={status:'AI_ACCRUAL_ANALYSIS_COMPLETE',entity_id:entityId,accounting_period_id:periodId,excluded_explicit_non_accrual_evidence_count:1,candidates:[],can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const hash=value=>`sha256:${String(value).repeat(64)}`;
const trace=(sourceDocumentId,sourceDocumentLineId,accountingPeriodId,periodKey)=>({source_document_id:sourceDocumentId,source_document_line_id:sourceDocumentLineId,source_payload_hash:hash('a'),source_line_hash:hash('b'),accounting_period_id:accountingPeriodId,period_key:periodKey,service_period_start:`${periodKey}-01`,service_period_end:`${periodKey}-28`,recurring_obligation_id:'WBS-OBL-001',service_frequency:'MONTHLY',obligation_status:'ACTIVE',currency:'USD',amount:'125.0000'});
const candidate={status:'ACCRUAL_CANDIDATE_REVIEW_REQUIRED',rule_id:'RECURRING_OBLIGATION_MISSING_CURRENT_PERIOD',entity_id:entityId,accounting_period_id:periodId,period_key:'2026-08',recurring_obligation_id:'WBS-OBL-001',service_frequency:'MONTHLY',currency:'USD',historical_amounts:['125.0000','125.0000','125.0000'],prior_source_trace:[trace('3d96eb2d-c24d-4057-861c-3a373461f599','2532039d-fcb8-462e-867d-6769a01b3aa3','3c49cbd7-9b02-4ea9-ae0a-9411fbc0ca0c','2026-07'),trace('50ee7927-ee5c-4843-80ed-138a72c768cb','5fdefcb7-28b0-4ff7-939c-cad03a68bc82','b896ee35-17f8-434e-818f-72593acb9faa','2026-06'),trace('b1ac14b5-cdd2-49c2-aa61-b28c2d0dbcd3','f20d638d-a138-4807-adfe-6fcf3259116f','4504c4fc-85db-4a05-8ab0-7dac2542dfb4','2026-05')],required_human_fields:['owner','due_date','accrual_basis','account_mapping','member_trace','reversing_entry_decision'],can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('AI accrual candidates are authenticated, period-bound no-store analysis reads with no accounting authority',async()=>{
  const seen=[];const api=createAccountingApi({
    authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),
    kernelFactory:async()=>{throw new Error('accrual endpoint must not invoke the accounting kernel directly');},
    aiAccrualCandidateAnalysisServiceFactory:async principal=>({analyze:async input=>(seen.push({principal,input}),safe)})
  });
  const response=await api({method:'GET',url:path,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:safe});assert.deepEqual(seen,[{principal:{trusted:true,tenantId,actorId:'controller-a'},input:{tenantId,entityId,currentPeriodId:periodId}}]);
  const candidateApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({}),aiAccrualCandidateAnalysisServiceFactory:async()=>({analyze:async()=>({...safe,candidates:[candidate]})})});
  const candidateResponse=await candidateApi({method:'GET',url:path,headers:{},body:null});assert.equal(candidateResponse.status,200);assert.deepEqual(candidateResponse.body.data.candidates,[candidate]);
  for(const request of [{url:`/api/v1/entities/${entityId}/ai/accrual-candidates`,headers:{},body:null},{url:`${path}&x=1`,headers:{},body:null},{url:path,headers:{'idempotency-key':'forbidden'},body:null},{url:path,headers:{},body:{}}])assert.equal((await api({method:'GET',...request})).status,400);
});

test('AI accrual candidate analysis fails closed when unavailable or unsafe',async()=>{
  const missing=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({})});const unavailable=await missing({method:'GET',url:path,headers:{},body:null});assert.equal(unavailable.status,503);assert.equal(unavailable.body.code,'SERIALIZATION_RETRY_EXHAUSTED');
  const missingCount={...safe};delete missingCount.excluded_explicit_non_accrual_evidence_count;
  const invalidResults=[
    missingCount,
    {...safe,excluded_explicit_non_accrual_evidence_count:'1'},
    {...safe,excluded_explicit_non_accrual_evidence_count:-1},
    {...safe,excluded_explicit_non_accrual_evidence_count:1001},
    {...safe,excluded_explicit_non_accrual_evidence_count:1.5},
    {...safe,excluded_explicit_non_accrual_evidence_count:Number.MAX_SAFE_INTEGER+1},
    {...safe,extra_provider_field:'must not cross the HTTP boundary'},
    {...safe,candidates:{}},
    {...safe,candidates:[{...candidate,raw_response:{authorization:'Bearer must-not-cross'}}]},
    {...safe,candidates:[{...candidate,entity_id:'eaef8436-2d51-4d70-a39b-cb337d6f8618'}]},
    {...safe,candidates:[candidate,{...candidate}]},
    ...['can_create_draft','can_review','can_approve','can_post'].map(action=>({...safe,[action]:true})),
  ];
  for(const result of invalidResults){
    const unsafe=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({}),aiAccrualCandidateAnalysisServiceFactory:async()=>({analyze:async()=>result})});
    const response=await unsafe({method:'GET',url:path,headers:{},body:null});assert.equal(response.status,502);assert.equal(response.body.code,'AI_ACCRUAL_ANALYSIS_RESPONSE_INVALID');
  }
  const operation=contract.paths['/entities/{entityId}/ai/accrual-candidates'].get;assert.equal(operation.operationId,'analyzeAiAccrualCandidates');assert.match(operation.description,/cannot create a Draft, review, approve, post, or write WBS/i);
});
