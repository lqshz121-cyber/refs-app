import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId=randomUUID(),entityId=randomUUID(),counts={source_record_count:0,source_amount:'0.0000',controlled_test_posted_count:0,formal_mapping_posted_count:0,mapping_missing_count:0,mapping_ready_count:0,mapping_ambiguous_count:0};
const data={schema_version:'WBS_H1_IMPORT_INVENTORY_V1',company_code:'SUCF',currency:'USD',date_from:'2026-01-01',date_to:'2026-06-30',limit:50,offset:0,totals:counts,months:Array.from({length:6},(_,index)=>({period_code:`2026-${String(index+1).padStart(2,'0')}`,...counts})),rows:[],source_mode:'REAL_WBS_STAGED',accounting_authority:'NONE',can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('WBS H1 inventory is an exact no-store GET and rejects anti-mock action drift',async()=>{
  const observed=[];let responseData=data;
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readWbsH1ImportInventory:async args=>(observed.push(args),responseData)})});
  const path=`/api/v1/entities/${entityId}/wbs/h1-import-inventory?limit=50&offset=0`;
  let response=await api({method:'GET',url:path,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,data);assert.deepEqual(observed[0],{tenantId,entityId,limit:50,offset:0});
  for(const request of [{method:'GET',url:path,body:{},headers:{}},{method:'GET',url:`${path}&unknown=1`,body:null,headers:{}},{method:'GET',url:path,body:null,headers:{'Idempotency-Key':'forbidden'}}])assert.equal((await api(request)).status,400);
  responseData={...data,can_post:true};response=await api({method:'GET',url:path,body:null,headers:{}});assert.equal(response.status,502);assert.equal(response.body.code,'WBS_H1_IMPORT_INVENTORY_PROTOCOL');
  const deniedApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readWbsH1ImportInventory:async()=>{const error=new Error('permission denied');error.code='42501';throw error;}})});
  response=await deniedApi({method:'GET',url:path,body:null,headers:{}});assert.equal(response.status,403);assert.equal(response.body.code,'WBS_READ_ACCESS_REQUIRED');assert.equal(response.body.message,'Forbidden');
});
