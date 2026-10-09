import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
const entity='1cfa5b82-7f38-461e-aa58-f94c5f824292';
const principal={trusted:true,tenantId:'6fb25daf-0799-4805-bede-be54230da33c',actorId:'oidc|approved-human'};
const url=`/api/v1/entities/${entity}/access/preauthorized-bank-read-grant/activate`;
const request={method:'POST',url,headers:{'idempotency-key':'approved-bank-access-v1'},body:{}};
test('activation is absent without administrator configuration',async()=>{
  const dispatch=createAccountingApi({authenticate:async()=>principal,kernelFactory:()=>({})});
  assert.equal((await dispatch(request)).status,404);
});
test('preauthorization status is authenticated exact-scope read-only and absent when disabled',async()=>{
  let captured,activated=false;
  const statusUrl=url.replace('/activate','');
  const dispatch=createAccountingApi({authenticate:async()=>principal,kernelFactory:()=>({}),preauthorizedBankAccessServiceFactory:p=>({describe:async input=>{captured={p,input};return {entityId:entity,role:'WBS_BANK_IMPORT_REQUESTER_ACCOUNTING_VIEWER',expectedVersion:4,validUntil:'2026-10-10T11:00:00.000Z',permissionCount:10};},activate:async()=>{activated=true;}})});
  const response=await dispatch({method:'GET',url:statusUrl,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(captured,{p:principal,input:{entityId:entity}});assert.equal(activated,false);
  assert.equal((await dispatch({method:'GET',url:statusUrl+'?actorId=other',headers:{}})).status,400);
  const disabled=createAccountingApi({authenticate:async()=>principal,kernelFactory:()=>({})});
  assert.equal((await disabled({method:'GET',url:statusUrl,headers:{}})).status,404);
});
test('activation rejects all caller-controlled authority and command overrides',async()=>{
  let called=0;const dispatch=createAccountingApi({authenticate:async()=>principal,kernelFactory:()=>({}),preauthorizedBankAccessServiceFactory:()=>{called++;return {activate:async()=>({})};}});
  for(const body of [{actorId:'other'},{permissions:['GL.JE.POST']},{validUntil:'2099'},{role:'JE_POSTER'},{tenantId:principal.tenantId}])assert.equal((await dispatch({...request,body})).status,400);
  assert.equal((await dispatch({...request,url:url+'?role=JE_POSTER'})).status,400);
  assert.equal((await dispatch({...request,headers:{...request.headers,'if-match':'"4"'}})).status,400);
  assert.equal(called,0);
});
test('activation derives principal and entity from authenticated route and retains replay receipt',async()=>{
  let captured;const dispatch=createAccountingApi({authenticate:async()=>principal,kernelFactory:()=>({}),preauthorizedBankAccessServiceFactory:p=>({activate:async input=>{captured={p,input};return {role:'WBS_BANK_IMPORT_REQUESTER_ACCOUNTING_VIEWER',version:5,validUntil:'2026-10-10T11:00:00.000Z',permissionCount:10,idempotent:true};}})});
  const response=await dispatch(request);assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(captured,{p:principal,input:{entityId:entity,idempotencyKey:request.headers['idempotency-key']}});
});
test('expired or mismatched administrator authorization remains visible as403',async()=>{
  const dispatch=createAccountingApi({authenticate:async()=>principal,kernelFactory:()=>({}),preauthorizedBankAccessServiceFactory:()=>{throw Object.assign(new Error('denied'),{code:'PREAUTHORIZED_ACCESS_DENIED'});}});
  const response=await dispatch(request);assert.equal(response.status,403);assert.equal(response.body.code,'PREAUTHORIZED_ACCESS_DENIED');
});
