import assert from 'node:assert/strict';
import {accountingApiConfig,createAuthoritativeBusinessDocument,refreshAuthoritativeDocuments} from '../src/accounting-api.js';
const entityId='11111111-1111-4111-8111-111111111111';
const periodId='33333333-3333-4333-8333-333333333333';
assert.equal(accountingApiConfig({__REFS_ACCOUNTING_API__:{baseUrl:'http://unsafe.example',entityId,periodId}}),null);
assert.equal(accountingApiConfig({__REFS_ACCOUNTING_API__:{baseUrl:'https://api.example/',entityId,periodId}}).baseUrl,'https://api.example');
const rows={'/ap/bills':[{business_document_id:entityId,document_number:'B-1',counterparty_ref:'V-1',counterparty_name:'Vendor',currency:'USD',accounting_date:'2026-08-01',due_date:'2026-08-31',gross_amount:'10.2500',open_balance:'7.2500',status:'PARTIALLY_PAID',posted_journal_entry_id:null,version:3}],'/ar/invoices':[{business_document_id:'22222222-2222-4222-8222-222222222222',document_number:'I-1',counterparty_ref:'C-1',counterparty_name:'Customer',currency:'USD',accounting_date:'2026-08-01',due_date:null,gross_amount:'8.0000',open_balance:'8.0000',status:'OPEN',posted_journal_entry_id:null,version:0}]};
const config=accountingApiConfig({__REFS_ACCOUNTING_API__:{baseUrl:'https://api.example/',entityId,periodId}});
(async()=>{
  const result=await refreshAuthoritativeDocuments({config,fetcher:async url=>({ok:true,json:async()=>({ok:true,data:rows[new URL(url).pathname.replace(`/api/v1/entities/${entityId}`,'')]})})});
  assert.equal(result.ok,true);assert.equal(result.ap.bills[0].open_balance,7.25);assert.equal(result.ar.invoices[0].inv_no,'I-1');
  let call;const created=await createAuthoritativeBusinessDocument({config,kind:'AP_BILL',idempotencyKey:'AP-BILL-request-0001',document:{documentNumber:'B-2',counterpartyRef:'V-2',counterpartyName:'Vendor 2',currency:'USD',accountingDate:'2026-08-01',dueDate:'2026-08-31',amount:3,offsetAccountCode:'641600'},fetcher:async(url,options)=>{call={url,options};return {ok:true,status:201,json:async()=>({ok:true,data:{business_document_id:entityId,status:'DRAFT'}})};}});
  assert.equal(created.ok,true);assert.match(call.url,/\/ap\/bills$/);assert.equal(call.options.credentials,'include');assert.equal(call.options.headers['idempotency-key'],'AP-BILL-request-0001');assert.equal(JSON.parse(call.options.body).periodId,periodId);
  console.log('accounting-api-client: all assertions passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
