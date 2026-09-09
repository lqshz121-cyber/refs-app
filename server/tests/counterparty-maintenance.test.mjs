import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',changeId='33333333-3333-4333-8333-333333333333';
const url=`/api/v1/entities/${entityId}/counterparty-changes`;
const body={kind:'VENDOR',memberRef:'V-1',changeType:'CREATE',displayName:'Vendor one',active:true,reason:'Create vendor master'};
const receipt={counterparty_change_id:changeId,entity_id:entityId,member_ref:'V-1',kind:'VENDOR',status:'PENDING',revision:0,idempotent:false};
const apiFor=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel});
const send=(api,patch={})=>api({method:'POST',url,headers:{'idempotency-key':'master-propose-1'},body,...patch});
test('counterparty proposals use trusted scope, exact fields and strong update revisions',async()=>{
 const calls=[],api=apiFor({proposeCounterpartyChange:async args=>(calls.push(args),receipt)});
 const created=await send(api);assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.headers['cache-control'],'no-store');
 assert.deepEqual(calls,[{tenantId,entityId,...body,expectedVersion:0,idempotencyKey:'master-propose-1'}]);
 for(const patch of [{actorId:'spoof'},{tenantId},{expectedVersion:0},{requestHash:'spoof'},{kind:'BANK'},{memberRef:' leading'},
  {displayName:'bad\nname'},{active:'true'},{active:false},{reason:'short'},{changeType:'DELETE'}])assert.equal((await send(api,{body:{...body,...patch}})).status,400,JSON.stringify(patch));
 assert.equal((await send(api,{url:url+'?tenantId=spoof'})).status,400);
 assert.equal((await send(api,{headers:{'idempotency-key':'master-propose-1','if-match':'"0"'}})).status,400);
 assert.equal((await send(api,{body:{...body,changeType:'UPDATE'}})).status,428);
 assert.equal((await send(api,{body:{...body,changeType:'UPDATE'},headers:{'idempotency-key':'master-propose-2','if-match':'W/"0"'}})).status,412);
 assert.equal(calls.length,1);
 assert.equal((await send(api,{body:{...body,changeType:'UPDATE',active:false},headers:{'idempotency-key':'master-propose-2','if-match':'"7"'}})).status,201);
 assert.equal(calls[1].expectedVersion,7);assert.equal(calls[1].active,false);
});
test('counterparty review binds request identity and rejects unconfirmed or wrong-company receipts',async()=>{
 const calls=[],reviewReceipt={...receipt,status:'APPROVED',revision:1,member_revision:0};
 const req={url:url+'/'+changeId+'/review',body:{decision:'APPROVE',reason:'Reviewed vendor details'},headers:{'idempotency-key':'master-review-1','if-match':'"0"'}};
 const api=apiFor({reviewCounterpartyChange:async args=>(calls.push(args),reviewReceipt)});
 assert.equal((await send(api,req)).status,200);assert.deepEqual(calls,[{tenantId,entityId,changeId,...req.body,expectedVersion:0,idempotencyKey:'master-review-1'}]);
 for(const bad of [{...reviewReceipt,entity_id:tenantId},{...reviewReceipt,counterparty_change_id:entityId},{...reviewReceipt,status:'REJECTED'},
  {...reviewReceipt,member_revision:null},{...reviewReceipt,extra:true}])assert.equal((await send(apiFor({reviewCounterpartyChange:async()=>bad}),req)).status,500);
 assert.equal((await send(api,{...req,body:{...req.body,actorId:'spoof'}})).status,400);
 assert.equal((await send(api,{...req,headers:{...req.headers,'if-match':'"1"'}})).status,412);
 assert.equal((await send(apiFor({}),req)).status,503);
 assert.equal(calls.length,1);
});
