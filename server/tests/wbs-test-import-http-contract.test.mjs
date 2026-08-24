import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {WbsTestImportError} from '../runtime/wbs-test-import-service.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='fe5a2a7c-3a26-4dd9-bdd8-6e46ba784231';
const url=`/api/v1/entities/${entityId}/wbs/test-import/payables`,body={periodId,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',limit:10};
const request=(overrides={})=>({method:'POST',url,headers:{'idempotency-key':'wbs-test-import-http-0001'},body,...overrides});
const result=(replay=false)=>({status:'WBS_TEST_PAYABLE_IMPORT_COMPLETE',imported_count:replay?0:1,replayed_count:replay?1:0,posted_count:0,failed_count:0,test_only:true});

test('authenticated test-import route returns only the exact no-store success DTO',async()=>{
  const calls=[],principals=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'authenticated-test-operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async principal=>(principals.push(principal),{importPayables:async args=>(calls.push(args),result())})});
  const response=await api(request());assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:result()});
  assert.deepEqual(principals,[{trusted:true,tenantId,actorId:'authenticated-test-operator'}]);assert.deepEqual(calls,[{tenantId,entityId,...body,idempotencyKey:'wbs-test-import-http-0001'}]);
});

test('same-key replay is HTTP 200 and retains exact closed counters',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({importPayables:async()=>result(true)})});
  const response=await api(request());assert.equal(response.status,200);assert.deepEqual(Object.keys(response.body.data).sort(),['failed_count','imported_count','posted_count','replayed_count','status','test_only']);assert.equal(response.body.data.replayed_count,1);
});

test('route is absent when mode wiring is disabled and rejects malformed command surfaces before service access',async()=>{
  const disabled=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({})});
  assert.equal((await disabled(request())).status,404);
  let calls=0;const enabled=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({importPayables:async()=>{calls++;return result();}})});
  for(const candidate of [request({headers:{}}),request({body:{...body,limit:11}}),request({body:{...body,actorId:'forbidden'}}),request({url:`${url}?extra=1`}),request({body:{...body,companyCode:'wbpa'}})])assert.equal((await enabled(candidate)).status,400);
  assert.equal(calls,0);
});

test('configured tenant/entity denial is a stable 403 and unsafe result shapes are internal failures',async()=>{
  const denied=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({importPayables:async()=>{throw new WbsTestImportError('WBS_TEST_IMPORT_SCOPE_DENIED','scope detail');}})});
  const forbidden=await denied(request());assert.equal(forbidden.status,403);assert.equal(forbidden.body.code,'WBS_TEST_IMPORT_SCOPE_DENIED');assert.equal(forbidden.body.message,'Forbidden');assert.equal(forbidden.headers['cache-control'],'no-store');
  const unsafe=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({importPayables:async()=>({...result(),raw_provider_row:{secret:'x'}})})});
  const response=await unsafe(request());assert.equal(response.status,500);assert.equal(response.body.message,'Internal server error');assert.equal(JSON.stringify(response).includes('secret'),false);
});
