import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',periodId='33333333-3333-4333-8333-333333333333',receiptId='44444444-4444-4444-8444-444444444444',journalId='55555555-5555-4555-8555-555555555555';
const record={sales_receipt_id:receiptId,period_id:periodId,receipt_number:'SALE-1',customer_ref:'C-1',customer_name:'Customer',bank_member_ref:'BANK-1',cash_account_code:'111000',category_account_code:'400000',accounting_date:'2026-07-18',currency:'USD',amount:'9999999999999999.9999',description:'Verified sale evidence',status:'DRAFT',revision:'0',journal_entry_id:journalId,journal_number:'SALE-1',journal_status:'DRAFT',journal_revision:'0',created_at:'2026-07-18T01:00:00.000000Z',posted_at:null};
const detail={schema_version:'SALES_RECEIPT_DETAIL_V1',entity_id:entityId,record};
const page={schema_version:'SALES_RECEIPT_PAGE_V1',entity_id:entityId,period_id:periodId,after_id:null,limit:50,rows:[record],next_id:null};
const root=`/api/v1/entities/${entityId}/ar/sales-receipts`;
const apiFor=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>kernel});
const get=(api,url,patch={})=>api({method:'GET',url,headers:{},...patch});
test('sales receipt reads derive scope and preserve exact saved data',async()=>{
 const calls=[],api=apiFor({readSalesReceipt:async a=>(calls.push(a),detail),listSalesReceipts:async a=>(calls.push(a),page)});
 const d=await get(api,`${root}/${receiptId}`);assert.equal(d.status,200);assert.deepEqual(d.body.data,detail);assert.equal(d.headers['cache-control'],'no-store');
 const p=await get(api,`${root}?periodId=${periodId}`);assert.equal(p.status,200);assert.deepEqual(p.body.data,page);
 assert.deepEqual(calls,[{tenantId,entityId,receiptId},{tenantId,entityId,periodId,afterId:null,limit:50}]);
 for(const url of [root,`${root}?periodId=${periodId}&limit=0`,`${root}?periodId=${periodId}&limit=101`,`${root}?periodId=${periodId}&limit=1e1`,`${root}?periodId=${periodId}&actorId=spoof`,`${root}?periodId=${periodId}&periodId=${periodId}`,`${root}/${receiptId}?periodId=${periodId}`])assert.equal((await get(api,url)).status,400,url);
 for(const patch of [{body:{}},{headers:{'if-match':'0'}},{headers:{'idempotency-key':'read-key-1'}}])assert.equal((await get(api,`${root}/${receiptId}`,patch)).status,400);
 assert.equal(calls.length,2);
});
test('sales receipt reads reject wrong scope, lossy money and inconsistent journal state',async()=>{
 for(const changed of [{...detail,entity_id:tenantId},{...detail,extra:true},...[
  {sales_receipt_id:journalId},{amount:1.2345},{amount:'1.23456'},{status:'POSTED'},
  {journal_status:'POSTED'},{posted_at:record.created_at},{revision:'-1'},{accounting_date:'2026-02-30'},
  {cash_account_code:record.category_account_code},{journal_entry_id:null}
 ].map(patch=>({...detail,record:{...record,...patch}}))])assert.equal((await get(apiFor({readSalesReceipt:async()=>changed}),`${root}/${receiptId}`)).status,500,JSON.stringify(changed));
 for(const changed of [{...page,period_id:tenantId},{...page,rows:[record,record]},{...page,next_id:receiptId},{...page,rows:[{...record,period_id:tenantId}]},{...page,after_id:receiptId}])assert.equal((await get(apiFor({listSalesReceipts:async()=>changed}),`${root}?periodId=${periodId}`)).status,500);
 assert.equal((await get(apiFor({}),`${root}/${receiptId}`)).status,503);
 assert.equal((await get(apiFor({listSalesReceipts:async()=>{throw Object.assign(new Error('Cursor belongs to another period'),{code:'22023'});}}),`${root}?periodId=${periodId}&afterId=${receiptId}`)).status,400);
});
