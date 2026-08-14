import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const path=`/api/v1/entities/${entityId}/ai/analysis-explanation`;
const memo={traceId:'ai-analysis-001',providerRequestId:'provider-001',model:'gpt-4.1-mini',elapsedMs:20,result:{headline:'Review duplicate payables.',risk_level:'HIGH',narrative:'Two retained duplicate payable findings require controller review.',controller_actions:[{category:'DUPLICATE_PAYABLE',finding_ids:['11111111-1111-4111-8111-111111111111'],action:'Compare source evidence before any follow-up.'}],can_create_draft:false,can_review:false,can_approve:false,can_post:false}};

test('AI analysis explanation is an authenticated, empty-body, no-action command with a stable request trace',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({}),aiAnalysisExplanationServiceFactory:async principal=>(assert.equal(principal.actorId,'controller-a'),{explain:async input=>(seen.push(input),memo)})});
  const response=await api({method:'POST',url:path,headers:{'idempotency-key':'ai-analysis-001'},body:{}});assert.equal(response.status,200);assert.deepEqual(response.body,{ok:true,data:memo});assert.deepEqual(seen,[{tenantId,entityId,actorId:'controller-a',traceId:'ai-analysis-001'}]);
  for(const request of [{headers:{},body:{}},{headers:{'idempotency-key':'ai-analysis-002'},body:{unexpected:true}},{headers:{'idempotency-key':'ai-analysis-003'},body:{actorId:'forbidden'}},{headers:{'idempotency-key':'ai-analysis-004'},body:null}])assert.equal((await api({method:'POST',url:path,...request})).status,400);
});

test('AI analysis explanation is unavailable rather than falling back to browser or mock analysis',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({})});
  const response=await api({method:'POST',url:path,headers:{'idempotency-key':'ai-analysis-001'},body:{}});assert.equal(response.status,503);assert.equal(response.body.code,'AI_ANALYSIS_EXPLANATION_UNAVAILABLE');
});
