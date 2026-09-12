import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',periodId='33333333-3333-4333-8333-333333333333';
const options={schema_version:'NATIVE_EXPENSE_CREATE_OPTIONS_V1',entity_id:entityId,period_id:periodId,vendors:[{vendor_ref:'VENDOR-1',vendor_name:'Vendor'}],bank_cash_accounts:[{bank_member_ref:'BANK-1',bank_name:'Bank',cash_account_code:'111000',cash_account_name:'Cash',currency:'USD'}],expense_accounts:[{expense_account_code:'610000',expense_account_name:'Operating expense'}],attachments:[{attachment_id:'44444444-4444-4444-8444-444444444444',name:'support.pdf',media_type:'application/pdf',size_bytes:'1',content_hash:'sha256:'+'0'.repeat(64),verified_at:'2026-07-18T01:00:00.000000Z'}]};
const root=`/api/v1/entities/${entityId}/ap/expenses/options?periodId=${periodId}`;
const apiFor=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'expense-maker'}),kernelFactory:async()=>kernel});
const get=(api,url=root,patch={})=>api({method:'GET',url,headers:{},...patch});

test('native expense options are scoped, no-store and command-header free',async()=>{
  const calls=[],api=apiFor({readNativeExpenseCreateOptions:async args=>(calls.push(args),options)}),response=await get(api);
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,options);assert.deepEqual(calls,[{tenantId,entityId,periodId}]);
  assert.equal((await get(api,root,{headers:{'idempotency-key':'forbidden'}})).status,400);
  assert.equal((await get(api,root+'&x=1')).status,400);
  assert.equal((await get(api,`/api/v1/entities/${entityId}/ap/expenses/options`)).status,400);
});

test('native expense options reject malformed backend selections and missing runtime support',async()=>{
  assert.equal((await get(apiFor({readNativeExpenseCreateOptions:async()=>({...options,entity_id:tenantId})}))).status,500);
  assert.equal((await get(apiFor({}))).status,503);
});
