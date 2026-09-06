import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',bankSourceId='33333333-3333-4333-8333-333333333333';
const url=`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/sales-receipt-candidates`;
const row={sales_receipt_id:'44444444-4444-4444-8444-444444444444',receipt_revision:'1',receipt_number:'SALE-1',period_id:tenantId,customer_ref:'C-1',customer_name:'Customer',bank_member_ref:'BANK-1',cash_account_code:'111000',accounting_date:'2026-08-15',currency:'USD',amount:'9007199254740993.1234',journal_entry_id:'55555555-5555-4555-8555-555555555555',journal_revision:'4',journal_line_id:'66666666-6666-4666-8666-666666666666',ledger_line_id:'77777777-7777-4777-8777-777777777777',date_delta_days:0};
const page={schema_version:'SALES_RECEIPT_BANK_CANDIDATES_V1',entity_id:entityId,bank_source_id:bankSourceId,bank_revision:'0',after_id:null,limit:50,rows:[row],next_id:null};
const apiFor=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'matcher'}),kernelFactory:async()=>kernel});
const get=(api,query='',patch={})=>api({method:'GET',url:url+query,headers:{},...patch});
test('cash sale candidates retain exact typed identities, money and authenticated scope',async()=>{
 const calls=[],api=apiFor({readSalesReceiptBankCandidates:async a=>(calls.push(a),page)});
 const result=await get(api);assert.equal(result.status,200,JSON.stringify(result.body));assert.deepEqual(result.body.data,page);assert.equal(result.headers['cache-control'],'no-store');
 assert.deepEqual(calls,[{tenantId,entityId,bankSourceId,afterId:null,limit:50}]);
 for(const query of ['?limit=0','?limit=101','?limit=1e1','?limit=1&limit=2','?afterId=bad','?actorId=spoof'])assert.equal((await get(api,query)).status,400);
 for(const patch of [{body:{}},{headers:{'if-match':'0'}},{headers:{'idempotency-key':'not-a-command'}}])assert.equal((await get(api,'',patch)).status,400);
 assert.equal(calls.length,1,'invalid read requests never reach the repository');
});
test('cash sale candidate output rejects mismatched source, malformed money, trace and cursor',async()=>{
 for(const changed of [{...page,bank_source_id:entityId},{...page,entity_id:tenantId},{...page,rows:[{...row,amount:9007199254740993}]},{...page,rows:[{...row,amount:'0.0000'}]},{...page,rows:[{...row,accounting_date:'2026-02-30'}]},{...page,rows:[{...row,journal_line_id:null}]},{...page,rows:[row,row]},{...page,next_id:row.sales_receipt_id},{...page,rows:[{...row,payment_occurrence_id:row.sales_receipt_id}]},{...page,rows:[{...row,receipt_revision:'9223372036854775808'}]}])assert.equal((await get(apiFor({readSalesReceiptBankCandidates:async()=>changed}))).status,500);
 assert.equal((await get(apiFor({}))).status,503);
 assert.equal((await get(apiFor({readSalesReceiptBankCandidates:async()=>{throw Object.assign(new Error('Denied'),{code:'42501'});}}))).status,403);
 const afterId='11111111-1111-4111-8111-111111111111';
 assert.equal((await get(apiFor({readSalesReceiptBankCandidates:async()=>({...page,after_id:afterId,limit:1,next_id:row.sales_receipt_id})}),`?afterId=${afterId}&limit=1`)).status,200);
});
