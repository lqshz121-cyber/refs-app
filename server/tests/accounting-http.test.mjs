import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createAccountingApi,createAccountingHttpServer} from '../api/accounting-http.mjs';

const tenantId=randomUUID(),entityId=randomUUID(),journalEntryId=randomUUID(),periodId=randomUUID();
const calls=[];const invoke=name=>async args=>{calls.push([name,args]);return {journal_entry_id:journalEntryId,status:'DRAFT',idempotent:false};};
const kernel={createManualJournal:invoke('createManualJournal'),createAutoJournal:invoke('createAutoJournal'),transitionJournal:invoke('transitionJournal'),postJournal:invoke('postJournal'),createJournalAdjustment:invoke('createJournalAdjustment')};
const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel});
const command=(path,body={},headers={})=>api({method:'POST',url:path,body,headers:{'Idempotency-Key':'idem-key-0001',...headers}});

test('manual command derives tenant/entity/actor boundary from authenticated context',async()=>{
  calls.length=0;const body={periodId,journalNumber:'JE-1',journalDate:'2026-08-02',currency:'USD',attachmentIds:[],lines:[]};
  const response=await command(`/api/v1/entities/${entityId}/journal-entries/manual`,body);
  assert.equal(response.status,201);assert.equal(calls[0][0],'createManualJournal');
  assert.deepEqual(calls[0][1],{...body,tenantId,entityId,idempotencyKey:'idem-key-0001'});
});

test('transition and post require optimistic concurrency and route authoritative ids',async()=>{
  calls.length=0;let response=await command(`/api/v1/entities/${entityId}/journal-entries/${journalEntryId}/transitions/review`,{reason:'reviewed'},{'If-Match':'"3"'});
  assert.equal(response.status,201);assert.equal(calls[0][0],'transitionJournal');assert.equal(calls[0][1].expectedRevision,3);assert.equal(calls[0][1].action,'REVIEW');
  response=await command(`/api/v1/entities/${entityId}/journal-entries/${journalEntryId}/post`,{periodId});assert.equal(response.status,428);
});

test('identity spoofing, missing idempotency, unauthenticated and malformed paths fail closed',async()=>{
  assert.equal((await command(`/api/v1/entities/${entityId}/journal-entries/manual`,{actorId:'attacker'})).status,400);
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/journal-entries/manual`,headers:{},body:{}})).status,400);
  const denied=createAccountingApi({authenticate:async()=>null,kernelFactory:async()=>kernel});assert.equal((await denied({method:'POST',url:'/',body:{}})).status,401);
  assert.equal((await command('/api/v1/entities/not-a-uuid/journal-entries/manual',{})).status,400);
});

test('database errors map to stable HTTP classes without leaking internal failures',async()=>{
  const failing=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({createManualJournal:async()=>{const error=new Error('secret SQL');error.code='42501';throw error;}})});
  const denied=await failing({method:'POST',url:`/api/v1/entities/${entityId}/journal-entries/manual`,headers:{'Idempotency-Key':'idem-key-0002'},body:{}});assert.equal(denied.status,403);
  const broken=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({createManualJournal:async()=>{throw new Error('database password leaked');}})});
  const internal=await broken({method:'POST',url:`/api/v1/entities/${entityId}/journal-entries/manual`,headers:{'Idempotency-Key':'idem-key-0003'},body:{}});assert.equal(internal.status,500);assert.equal(internal.body.message,'Internal server error');
});

test('real HTTP listener parses JSON, enforces size limits and emits no-store problem responses',async()=>{
  const server=createAccountingHttpServer({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel,maxBodyBytes:64});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    let response=await fetch(`${base}/api/v1/entities/${entityId}/journal-entries/manual`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'idem-http-0001'},body:'{' });
    assert.equal(response.status,400);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).code,'INVALID_JSON');
    response=await fetch(`${base}/api/v1/entities/${entityId}/journal-entries/manual`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'idem-http-0002'},body:JSON.stringify({description:'x'.repeat(100)})});
    assert.equal(response.status,413);assert.equal((await response.json()).code,'BODY_TOO_LARGE');
  }finally{await new Promise(resolve=>server.close(resolve));}
});
