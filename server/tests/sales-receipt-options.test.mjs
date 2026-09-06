import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222';
const url=`/api/v1/entities/${entityId}/ar/sales-receipt-options`;
const page=(optionKind,patch={})=>({schema_version:'SALES_RECEIPT_OPTIONS_V1',entity_id:entityId,option_kind:optionKind,query:'',after_ref:null,limit:50,rows:[{ref:'001',label:'Current company choice',kind:optionKind}],next_ref:null,...patch});
const apiFor=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel});
const get=(api,query,patch={})=>api({method:'GET',url:url+query,headers:{},...patch});
test('sales receipt input choices use authenticated scope and bounded pages for all four kinds',async()=>{
 for(const optionKind of ['CUSTOMER','BANK','CASH_ACCOUNT','CATEGORY_ACCOUNT']){
  const calls=[],api=apiFor({readSalesReceiptOptions:async a=>(calls.push(a),page(optionKind))});
  const response=await get(api,`?optionKind=${optionKind}`);assert.equal(response.status,200);assert.deepEqual(response.body.data,page(optionKind));assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(calls,[{tenantId,entityId,optionKind,query:'',afterRef:null,limit:50}]);
 }
 const calls=[],api=apiFor({readSalesReceiptOptions:async a=>(calls.push(a),page('CUSTOMER',{query:'Client',after_ref:'000',limit:1,rows:[{ref:'001',label:'Client',kind:'AFFILIATE'}],next_ref:'001'}))});
 assert.equal((await get(api,'?optionKind=CUSTOMER&query=Client&afterRef=000&limit=1')).status,200);
 for(const query of ['', '?optionKind=VENDOR','?optionKind=BANK&limit=0','?optionKind=BANK&limit=101','?optionKind=BANK&limit=1e1','?optionKind=BANK&query=%20bad','?optionKind=BANK&afterRef=','?optionKind=BANK&actorId=spoof','?optionKind=BANK&optionKind=CUSTOMER'])assert.equal((await get(api,query)).status,400,query);
 for(const patch of [{body:{}},{headers:{'if-match':'0'}},{headers:{'idempotency-key':'not-a-command'}}])assert.equal((await get(api,'?optionKind=BANK',patch)).status,400);
 assert.equal(calls.length,1);
});
test('sales receipt input choices reject wrong scope, kinds and pagination without fabricating options',async()=>{
 for(const changed of [page('BANK',{entity_id:tenantId}),page('CUSTOMER'),page('BANK',{rows:[{ref:'001',label:'Wrong',kind:'VENDOR'}]}),page('BANK',{rows:[{ref:'002',label:'Bank',kind:'BANK'},{ref:'001',label:'Bank',kind:'BANK'}]}),page('BANK',{next_ref:'001'}),page('BANK',{query:'other'}),page('BANK',{rows:[{ref:'001',label:'Bank',kind:'BANK',tenant_id:tenantId}]})])assert.equal((await get(apiFor({readSalesReceiptOptions:async()=>changed}),'?optionKind=BANK')).status,500);
 assert.equal((await get(apiFor({}),'?optionKind=BANK')).status,503);
 assert.equal((await get(apiFor({readSalesReceiptOptions:async()=>{throw Object.assign(new Error('Denied'),{code:'42501'});}}),'?optionKind=BANK')).status,403);
});
