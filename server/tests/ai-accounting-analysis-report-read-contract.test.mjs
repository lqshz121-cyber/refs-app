import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',path=`/api/v1/entities/${entityId}/ai/analysis-reports`;
const report={idempotency_key:'ai-analysis-report-0001',request_hash:'sha256:'+'a'.repeat(64),actor_id:'oidc|controller',completed_at:'2026-08-16T00:00:00.000Z',report:{traceId:'ai-analysis-report-0001',providerRequestId:'provider-001',model:'gpt-4.1-mini',elapsedMs:20,result:{headline:'Controller memo',risk_level:'HIGH',narrative:'Retained duplicate-payable evidence requires review.',controller_actions:[{category:'DUPLICATE_PAYABLE',finding_ids:['11111111-1111-4111-8111-111111111111'],action:'Compare retained source evidence.'}],can_create_draft:false,can_review:false,can_approve:false,can_post:false}},can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('AI accounting analysis reports are authenticated, bounded, no-store reads with no accounting authority',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({listAiAccountingAnalysisReports:async input=>(seen.push(input),[report])})});
  const response=await api({method:'GET',url:`${path}?limit=5`,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:[report]});assert.deepEqual(seen,[{tenantId,entityId,limit:5}]);
  for(const request of [{url:path,headers:{'idempotency-key':'forbidden'},body:null},{url:path,headers:{},body:{}},{url:`${path}?limit=0`,headers:{},body:null},{url:`${path}?x=1`,headers:{},body:null}])assert.equal((await api({method:'GET',...request})).status,400);
});

test('AI accounting analysis report reads fail closed without a persistent report reader',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({})});
  const response=await api({method:'GET',url:path,headers:{},body:null});assert.equal(response.status,503);assert.equal(response.body.code,'SERIALIZATION_RETRY_EXHAUSTED');
});

test('AI accounting analysis report HTTP boundary rejects trace, ordering, shape, and action drift',async()=>{
  const earlier={...report,idempotency_key:'ai-analysis-report-0002',completed_at:'2026-08-15T00:00:00.000Z',report:{...report.report,traceId:'ai-analysis-report-0002'}};
  for(const unsafe of [[{...report,report:{...report.report,traceId:'wrong'}}],[earlier,report],[{...report,can_review:true}],[{...report,extra:true}],[{...report,completed_at:'2026-02-30T00:00:00.000Z'}],[{...report,actor_id:'Bearer sk-live-EXAMPLECREDENTIAL'}]]){const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({listAiAccountingAnalysisReports:async()=>unsafe})});const response=await api({method:'GET',url:`${path}?limit=5`,headers:{},body:null});assert.equal(response.status,502);}
});
