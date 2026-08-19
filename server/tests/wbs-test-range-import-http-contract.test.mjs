import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='00000000-0000-4000-8000-000000000001',entityId='00000000-0000-4000-8000-000000000002';
const body={companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-01-31',pageSize:10,maxPages:1000};
const url=`/api/v1/entities/${entityId}/wbs/test-import/range`;
const result={status:'WBS_TEST_MONTH_IMPORT_COMPLETE',period_code:'2026-01',date_from:'2026-01-01',date_to:'2026-01-31',page_size:10,payables:{provider_page_count:124,h1_record_count:1237,record_count:1,imported_count:1,replayed_count:0,posted_count:1},bank:{provider_page_count:1,record_count:1,reconciliation:{bank_account_ref:'WBS_TEST_BANK_2026_01',period_code:'2026-01',period_id:'00000000-0000-4000-8000-000000000006',reconciliation_id:'00000000-0000-4000-8000-000000000004',transaction_count:1},bank_source_ids:['00000000-0000-4000-8000-000000000005']},test_only:true};
const request=(overrides={})=>({method:'POST',url,headers:{'idempotency-key':'wbs-h1-2026-v1'},body,...overrides});

test('routes one exact authenticated H1 month command and returns the closed monthly receipt',async()=>{
  const calls=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({importRange:async args=>(calls.push(args),result)})});
  const response=await api(request());assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:result});
  assert.deepEqual(calls,[{tenantId,entityId,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-01-31',pageSize:10,maxPages:1000,idempotencyKey:'wbs-h1-2026-v1'}]);
});

test('rejects malformed paging and identity surfaces before calling the range service',async()=>{
  let calls=0;const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({importRange:async()=>{calls++;return result;}})});
  for(const candidate of [request({headers:{}}),request({body:{...body,pageSize:5}}),request({body:{...body,pageSize:11}}),request({body:{...body,maxPages:1001}}),request({body:{...body,actorId:'forbidden'}}),request({url:`${url}?cursor=forbidden`})])assert.equal((await api(candidate)).status,400);
  assert.equal(calls,0);
});
