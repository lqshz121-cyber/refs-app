import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',documentId='33333333-3333-4333-8333-333333333333',periodId='44444444-4444-4444-8444-444444444444',attachmentId='55555555-5555-4555-8555-555555555555';
const receipt={payment_occurrence_id:'66666666-6666-4666-8666-666666666666',business_allocation_id:'77777777-7777-4777-8777-777777777777',business_document_id:documentId,journal_entry_id:'88888888-8888-4888-8888-888888888888',status:'DRAFT',allocation_status:'PENDING',revision:0,idempotent:false};
const body={periodId,number:'SETTLE-1',date:'2026-08-15',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:'9999999999999999.9999',reason:'Native settlement evidence',attachmentIds:[attachmentId]};
const apiFor=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel});
const routes=[['AP_PAYMENT',`/api/v1/entities/${entityId}/ap/bills/${documentId}/native-payments`],['AR_RECEIPT',`/api/v1/entities/${entityId}/ar/invoices/${documentId}/native-receipts`]];
const send=(api,url,patch={})=>api({method:'POST',url,body,headers:{'idempotency-key':'native-settle-001'},...patch});

test('native settlements preserve exact decimal evidence input and derive kind, tenant and source from authenticated routing',async()=>{
  for(const [settlementKind,url] of routes){
    const calls=[],api=apiFor({createNativeSettlement:async args=>(calls.push(args),receipt)});
    const r=await send(api,url);assert.equal(r.status,201,JSON.stringify(r.body));assert.deepEqual(r.body.data,receipt);
    assert.deepEqual(calls,[{tenantId,entityId,settlementKind,businessDocumentId:documentId,...body,idempotencyKey:'native-settle-001'}]);
    const replay=await send(apiFor({createNativeSettlement:async()=>({...receipt,idempotent:true})}),url);assert.equal(replay.status,200);
    for(const patch of [{amount:1},{amount:'0'},{amount:'-1'},{amount:'1.00001'},{amount:'1e2'},{amount:'10000000000000000'},
      {number:''},{number:' padded'},{bankMemberRef:'BANK\n'},{date:'2026-02-30'},{reason:'short'},
      {attachmentIds:[]},{attachmentIds:[attachmentId,attachmentId]},{attachmentIds:['bad']},{tenantId},{actorId:'spoof'},{requestHash:'spoof'},{unexpected:true}]){
      assert.equal((await send(api,url,{body:{...body,...patch}})).status,400,JSON.stringify(patch));
    }
    assert.equal((await send(api,url+'?periodId='+periodId)).status,400);
    assert.equal((await send(api,url,{headers:{'idempotency-key':'native-settle-001','if-match':'"0"'}})).status,400);
    assert.equal(calls.length,1,'invalid commands never reach the transaction');
  }
});

test('native settlements reject unconfirmed command receipts and fail closed when implementation is absent',async()=>{
  for(const [,url] of routes){
    assert.equal((await send(apiFor({}),url)).status,503);
    for(const bad of [null,{status:'DRAFT'},{...receipt,business_document_id:periodId},{...receipt,journal_entry_id:'bad'},
      {...receipt,status:'POSTED'},{...receipt,allocation_status:'ACTIVE'},{...receipt,revision:1},{...receipt,idempotent:'false'},{...receipt,extra:true}]){
      assert.equal((await send(apiFor({createNativeSettlement:async()=>bad}),url)).status,500,JSON.stringify(bad));
    }
  }
});
