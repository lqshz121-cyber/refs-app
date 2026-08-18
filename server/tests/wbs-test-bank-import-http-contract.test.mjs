import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='fe5a2a7c-3a26-4dd9-bdd8-6e46ba784231';
const url=`/api/v1/entities/${entityId}/wbs/test-import/bank-transactions`,body={periodId,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',limit:2};
const result=(idempotent=false)=>({wbs_controlled_test_bank_import_id:'00000001-0000-4000-8000-000000000001',reconciliation_id:'00000002-0000-4000-8000-000000000001',bank_source_ids:['00000003-0000-4000-8000-000000000001'],bank_account_ref:'WBS_TEST_BANK',statement_ending_date:'2026-08-11',transaction_count:1,status:'DRAFT',provenance_mode:'CONTROLLED_TEST_UNSIGNED',test_only:true,idempotent});
const request=(overrides={})=>({method:'POST',url,headers:{'idempotency-key':'wbs-test-bank-http-0001'},body,...overrides});

test('routes the exact authenticated command and returns a closed no-store receipt',async()=>{
  const calls=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({importBankTransactions:async args=>(calls.push(args),result())})});
  const response=await api(request());assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:result()});assert.deepEqual(calls,[{tenantId,entityId,...body,idempotencyKey:'wbs-test-bank-http-0001'}]);
});

test('uses 200 for replay and keeps the route absent when test mode is disabled',async()=>{
  const enabled=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({importBankTransactions:async()=>result(true)})});assert.equal((await enabled(request())).status,200);
  const disabled=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({})});assert.equal((await disabled(request())).status,404);
});

test('rejects malformed surfaces before service access',async()=>{
  let calls=0;const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({importBankTransactions:async()=>{calls++;return result();}})});
  for(const candidate of [request({headers:{}}),request({body:{...body,limit:11}}),request({body:{...body,extra:true}}),request({url:`${url}?extra=1`})])assert.equal((await api(candidate)).status,400);assert.equal(calls,0);
});
