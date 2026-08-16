import assert from 'node:assert/strict';
import test from 'node:test';
import contract from '../api/openapi-accounting.json' with {type:'json'};
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='4e0b2744-2366-46d5-8b34-6ccf49deaabf';
const path=`/api/v1/entities/${entityId}/ai/accrual-candidates?periodId=${periodId}`;
const safe={status:'AI_ACCRUAL_ANALYSIS_COMPLETE',entity_id:entityId,accounting_period_id:periodId,candidates:[],can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('AI accrual candidates are authenticated, period-bound no-store analysis reads with no accounting authority',async()=>{
  const seen=[];const api=createAccountingApi({
    authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),
    kernelFactory:async()=>{throw new Error('accrual endpoint must not invoke the accounting kernel directly');},
    aiAccrualCandidateAnalysisServiceFactory:async principal=>({analyze:async input=>(seen.push({principal,input}),safe)})
  });
  const response=await api({method:'GET',url:path,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:safe});assert.deepEqual(seen,[{principal:{trusted:true,tenantId,actorId:'controller-a'},input:{tenantId,entityId,currentPeriodId:periodId}}]);
  for(const request of [{url:`/api/v1/entities/${entityId}/ai/accrual-candidates`,headers:{},body:null},{url:`${path}&x=1`,headers:{},body:null},{url:path,headers:{'idempotency-key':'forbidden'},body:null},{url:path,headers:{},body:{}}])assert.equal((await api({method:'GET',...request})).status,400);
});

test('AI accrual candidate analysis fails closed when unavailable or unsafe',async()=>{
  const missing=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({})});const unavailable=await missing({method:'GET',url:path,headers:{},body:null});assert.equal(unavailable.status,503);assert.equal(unavailable.body.code,'SERIALIZATION_RETRY_EXHAUSTED');
  const unsafe=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({}),aiAccrualCandidateAnalysisServiceFactory:async()=>({analyze:async()=>({...safe,can_create_draft:true})})});assert.equal((await unsafe({method:'GET',url:path,headers:{},body:null})).status,502);
  const operation=contract.paths['/entities/{entityId}/ai/accrual-candidates'].get;assert.equal(operation.operationId,'analyzeAiAccrualCandidates');assert.match(operation.description,/cannot create a Draft, review, approve, post, or write WBS/i);
});
