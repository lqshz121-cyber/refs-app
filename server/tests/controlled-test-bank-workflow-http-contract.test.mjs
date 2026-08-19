import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='fe5a2a7c-3a26-4dd9-bdd8-6e46ba784231',reconciliationId='00000002-0000-4000-8000-000000000001';
const url=`/api/v1/entities/${entityId}/wbs/test-import/bank-workflow/run`,body={periodId,reconciliationId,reason:'Complete controlled WBS Bank lifecycle'};
const result=idempotent=>({status:'CONTROLLED_TEST_BANK_WORKFLOW_REOPENED',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent,reconciliation_id:reconciliationId,processed_count:1,matched_count:0,adjusted_count:1,cleared_count:1,journal_entry_ids:['00000003-0000-4000-8000-000000000001'],revision:5,snapshot_id:'00000004-0000-4000-8000-000000000001',snapshot_hash:`sha256:${'a'.repeat(64)}`});

test('routes exact authenticated Bank runner command and returns closed no-store result',async()=>{
  const calls=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({run:async args=>(calls.push(args),result(false))})});
  const response=await api({method:'POST',url,headers:{'idempotency-key':'controlled-bank-http-001'},body});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:result(false)});
  assert.deepEqual(calls,[{tenantId,entityId,...body,idempotencyKey:'controlled-bank-http-001',maxItems:25}]);
  const replay=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({run:async()=>result(true)})});
  assert.equal((await replay({method:'POST',url,headers:{'idempotency-key':'controlled-bank-http-001'},body})).status,200);
});

test('returns a closed PARTIAL receipt and forwards an explicit bounded chunk size',async()=>{
  const partial={status:'CONTROLLED_TEST_BANK_WORKFLOW_PARTIAL',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:false,reconciliation_id:reconciliationId,total_count:1888,processed_count:100,matched_count:0,adjusted_count:100,cleared_count:100,remaining_count:1788,revision:100};let received;
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({run:async args=>(received=args,partial)})});
  const response=await api({method:'POST',url,headers:{'idempotency-key':'controlled-bank-http-partial-001'},body:{...body,maxItems:100}});
  assert.equal(response.status,200);assert.deepEqual(response.body,{ok:true,data:partial});assert.equal(received.maxItems,100);
  assert.equal((await api({method:'POST',url,headers:{'idempotency-key':'controlled-bank-http-partial-001'},body:{...body,maxItems:101}})).status,400);
});

test('keeps runner absent when disabled and rejects injected or malformed selection',async()=>{
  const disabled=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({})});assert.equal((await disabled({method:'POST',url,headers:{'idempotency-key':'controlled-bank-http-001'},body})).status,404);
  let calls=0;const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({run:async()=>{calls++;return result(false);}})});
  for(const candidate of [{...body,actorId:'attacker'},{...body,reconciliationId:'bad'},{...body,reason:'short'}])assert.equal((await api({method:'POST',url,headers:{'idempotency-key':'controlled-bank-http-001'},body:candidate})).status,400);
  assert.equal(calls,0);
});

test('routes an explicit one-to-six monthly scope array without accepting mixed single/range selectors',async()=>{
  const range={status:'CONTROLLED_TEST_BANK_RANGE_WORKFLOW_REOPENED',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:false,scope_count:1,processed_count:1,matched_count:0,adjusted_count:1,cleared_count:1,results:[result(false)]};let received;
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({runRange:async args=>(received=args,range)})});
  const rangeBody={scopes:[{periodId,reconciliationId}],reason:body.reason};const response=await api({method:'POST',url,headers:{'idempotency-key':'controlled-bank-range-http-001'},body:rangeBody});assert.equal(response.status,201);assert.deepEqual(response.body.data,range);assert.deepEqual(received,{tenantId,entityId,...rangeBody,idempotencyKey:'controlled-bank-range-http-001'});
  assert.equal((await api({method:'POST',url,headers:{'idempotency-key':'controlled-bank-range-http-002'},body:{...body,scopes:rangeBody.scopes}})).status,400);
});
