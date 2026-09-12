import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,webcrypto} from 'node:crypto';
import {createAuthoritativeNativeExpense,readAuthoritativeNativeExpenseCreateOptions} from '../src/accounting-api.js';

const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),attachmentId=randomUUID();
const config={tenantId,entityId,periodId,baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const options={schema_version:'NATIVE_EXPENSE_CREATE_OPTIONS_V1',entity_id:entityId,period_id:periodId,vendors:[{vendor_ref:'VENDOR-1',vendor_name:'Vendor One'}],bank_cash_accounts:[{bank_member_ref:'BANK-1',bank_name:'Main Bank',cash_account_code:'100100',cash_account_name:'Cash',currency:'USD'}],expense_accounts:[{expense_account_code:'610100',expense_account_name:'Utilities'}],attachments:[{attachment_id:attachmentId,name:'Invoice.pdf',media_type:'application/pdf',size_bytes:'1200',content_hash:'sha256:'+'a'.repeat(64),verified_at:'2026-09-13T00:00:00.000000Z'}]};
const input={number:'EXP-1001',vendorRef:'VENDOR-1',bankMemberRef:'BANK-1',cashAccountCode:'100100',expenseAccountCode:'610100',date:'2026-09-13',currency:'USD',amount:'25.0000',reason:'Record reviewed direct-bank utility expense',attachmentIds:[attachmentId]};
const receipt={expense_id:randomUUID(),journal_entry_id:randomUUID(),status:'DRAFT',revision:0,idempotent:false};

test('expense client loads verified scoped creation options',async()=>{
 let seen;const result=await readAuthoritativeNativeExpenseCreateOptions({config,fetcher:async(url,init)=>{seen={url,init};return new Response(JSON.stringify({ok:true,data:options}),{status:200});}});
 assert.equal(result.ok,true);assert.match(seen.url,new RegExp(`/entities/${entityId}/ap/expenses/options\\?periodId=${periodId}`));assert.equal(seen.init.method,'GET');assert.equal(seen.init.cache,'no-store');assert.equal(seen.init.credentials,'include');assert.match(seen.init.headers.authorization,/^Bearer /);
 assert.equal((await readAuthoritativeNativeExpenseCreateOptions({config,fetcher:async()=>new Response(JSON.stringify({ok:true,data:{...options,attachments:Array.from({length:101},()=>options.attachments[0])}}),{status:200})})).ok,false);
});

test('expense client writes only selected current options using a stable request identity',async()=>{
 const requests=[];const fetcher=async(url,init)=>{requests.push({url,init});if(requests.length===1)throw new Error('lost response');return new Response(JSON.stringify({ok:true,data:{...receipt,idempotent:true}}),{status:200});};
 assert.equal((await createAuthoritativeNativeExpense({config,options,input,fetcher,cryptoApi:webcrypto})).ok,false);
 const replay=await createAuthoritativeNativeExpense({config,options,input,fetcher,cryptoApi:webcrypto});assert.equal(replay.ok,true);assert.equal(replay.data.expense_id,receipt.expense_id);assert.equal(requests[0].init.headers['idempotency-key'],requests[1].init.headers['idempotency-key']);
 const payload=JSON.parse(requests[1].init.body);assert.deepEqual(Object.keys(payload).sort(),['amount','attachmentIds','bankMemberRef','cashAccountCode','currency','date','expenseAccountCode','number','periodId','reason','vendorRef']);assert.deepEqual(payload.attachmentIds,[attachmentId]);assert.equal(payload.periodId,periodId);
 await createAuthoritativeNativeExpense({config,options,input:{...input,reason:'Record reviewed corrected direct-bank utility expense'},fetcher,cryptoApi:webcrypto});assert.notEqual(requests[2].init.headers['idempotency-key'],requests[1].init.headers['idempotency-key']);
});

test('expense client blocks stale selections and invalid successful receipts before accepting a save',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return new Response(JSON.stringify({ok:true,data:receipt}),{status:201});};
 for(const patch of [{input:{...input,vendorRef:'VENDOR-404'}},{input:{...input,currency:'CAD'}},{input:{...input,amount:'0.0000'}},{input:{...input,attachmentIds:[randomUUID()] }},{input:{...input,reason:'short'}},{input:{...input,date:'not-a-date'}},{options:{...options,entity_id:randomUUID()}},{config:{}}])assert.equal((await createAuthoritativeNativeExpense({config,options,input,fetcher,cryptoApi:webcrypto,...patch})).ok,false);assert.equal(calls,0);
 for(const wrong of [{...receipt,status:'POSTED'},{...receipt,expense_id:undefined},{...receipt,idempotent:true}])assert.equal((await createAuthoritativeNativeExpense({config,options,input,fetcher:async()=>new Response(JSON.stringify({ok:true,data:wrong}),{status:201}),cryptoApi:webcrypto})).ok,false);
 assert.equal((await createAuthoritativeNativeExpense({config,options,input,fetcher,cryptoApi:webcrypto})).ok,true);
});
