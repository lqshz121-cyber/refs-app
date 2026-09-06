import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',periodId='33333333-3333-4333-8333-333333333333',attachmentId='44444444-4444-4444-8444-444444444444';
const receipt={sales_receipt_id:periodId,journal_entry_id:attachmentId,status:'DRAFT',revision:0,idempotent:false};
const body={periodId,number:'SR-1',customerRef:'CUSTOMER-1',bankMemberRef:'BANK-1',cashAccountCode:'111000',categoryAccountCode:'400000',date:'2026-08-15',currency:'USD',amount:'9999999999999999.9999',reason:'Cash sale supporting evidence',attachmentIds:[attachmentId]};
const url=`/api/v1/entities/${entityId}/ar/sales-receipts`;
const apiFor=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel});
const send=(api,patch={})=>api({method:'POST',url,body,headers:{'idempotency-key':'native-sales-receipt-1'},...patch});
test('sales receipt command derives scope, retains decimal text and returns only a verified draft receipt',async()=>{
 const calls=[],api=apiFor({createNativeSalesReceipt:async args=>(calls.push(args),receipt)});
 const result=await send(api);assert.equal(result.status,201,JSON.stringify(result.body));assert.deepEqual(result.body.data,receipt);
 assert.deepEqual(calls,[{tenantId,entityId,...body,idempotencyKey:'native-sales-receipt-1'}]);
 assert.equal((await send(apiFor({createNativeSalesReceipt:async()=>({...receipt,idempotent:true})}))).status,200);
 for(const patch of [{amount:1},{amount:'0'},{amount:'-1'},{amount:'1.00001'},{amount:'1e4'},{amount:'10000000000000000'},
  {number:''},{customerRef:' padded'},{bankMemberRef:'BANK\n'},{currency:'usd'},{date:'2026-02-30'},{reason:'short'},
  {attachmentIds:[]},{attachmentIds:[attachmentId,attachmentId]},{attachmentIds:['bad']},{tenantId},{actorId:'spoof'},{requestHash:'spoof'},{extra:true}]){
  assert.equal((await send(api,{body:{...body,...patch}})).status,400,JSON.stringify(patch));
 }
 assert.equal((await send(api,{url:url+'?periodId='+periodId})).status,400);
 assert.equal((await send(api,{headers:{'idempotency-key':'native-sales-receipt-1','if-match':'"0"'}})).status,400);
 assert.equal(calls.length,1,'invalid commands cannot reach the transaction');
});
test('sales receipt command rejects malformed backend receipts and unavailable implementations',async()=>{
 assert.equal((await send(apiFor({}))).status,503);
 for(const bad of [null,{}, {...receipt,sales_receipt_id:'bad'},{...receipt,journal_entry_id:'bad'}, {...receipt,status:'POSTED'}, {...receipt,revision:1}, {...receipt,idempotent:'true'}, {...receipt,extra:true}])assert.equal((await send(apiFor({createNativeSalesReceipt:async()=>bad}))).status,500);
});
