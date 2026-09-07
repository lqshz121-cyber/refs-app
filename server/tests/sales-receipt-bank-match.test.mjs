import test from 'node:test';import assert from 'node:assert/strict';import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',bankSourceId='33333333-3333-4333-8333-333333333333',salesReceiptId='44444444-4444-4444-8444-444444444444';
const url=`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/sales-receipt-matches`,body={salesReceiptId,expectedReceiptRevision:1,reason:'Reviewed cash sale bank evidence'},headers={'if-match':'"2"','idempotency-key':'cash-sale-match-001'};
const result={bank_match_id:'55555555-5555-4555-8555-555555555555',bank_source_id:bankSourceId,sales_receipt_id:salesReceiptId,journal_entry_id:'66666666-6666-4666-8666-666666666666',journal_line_id:'77777777-7777-4777-8777-777777777777',ledger_line_id:'88888888-8888-4888-8888-888888888888',status:'ACTIVE',revision:0,idempotent:false};
const apiFor=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'matcher'}),kernelFactory:async()=>kernel});
const send=(api,patch={})=>api({method:'POST',url,body,headers,...patch});
test('cash sale bank match uses trusted scope, exact versions and explicit typed receipt',async()=>{
 const calls=[],api=apiFor({createSalesReceiptBankMatch:async args=>(calls.push(args),result)});
 const response=await send(api);assert.equal(response.status,201,JSON.stringify(response.body));assert.deepEqual(response.body.data,result);
 assert.deepEqual(calls,[{tenantId,entityId,bankSourceId,salesReceiptId,expectedBankVersion:2,expectedReceiptVersion:1,reason:body.reason,idempotencyKey:headers['idempotency-key']}]);
 assert.equal((await send(apiFor({createSalesReceiptBankMatch:async()=>({...result,idempotent:true})}))).status,200);
 for(const patch of [{salesReceiptId:'invalid'},{expectedReceiptRevision:-1},{expectedReceiptRevision:'1'},{reason:'short'},{actorId:'spoof'}])assert.equal((await send(api,{body:{...body,...patch}})).status,400);
 assert.equal((await send(api,{headers:{'idempotency-key':'cash-sale-match-001'}})).status,428);
 assert.equal((await send(api,{url:url+'?extra=value'})).status,400);assert.equal(calls.length,1);
});
test('cash sale bank match rejects unavailable and malformed command receipts',async()=>{
 for(const patch of [{bank_source_id:entityId},{sales_receipt_id:entityId},{ledger_line_id:null},{status:'DRAFT'},{revision:1},{idempotent:'true'},{payment_occurrence_id:salesReceiptId}])assert.equal((await send(apiFor({createSalesReceiptBankMatch:async()=>({...result,...patch})}))).status,500);
 assert.equal((await send(apiFor({}))).status,503);
 assert.equal((await send(apiFor({createSalesReceiptBankMatch:async()=>{throw Object.assign(new Error('Denied'),{code:'42501'});}}))).status,403);
});
