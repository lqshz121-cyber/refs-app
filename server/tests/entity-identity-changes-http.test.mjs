import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId=randomUUID(),entityId=randomUUID();
const data={schema_version:'ENTITY_IDENTITY_CHANGES_V1',entity_id:entityId,limit:50,offset:0,total:1,rows:[{changed_at:'2026-09-17T09:00:00.000Z',change_kind:'UPDATE',db_session_user:'refs_migrator',refs_actor:null,name_before_sha256:'sha256:'+'a'.repeat(64),name_after_sha256:'sha256:'+'b'.repeat(64),name_after_length:21,source_binding_before:'WBS:WBPA',source_binding_after:'WBS:WBPA',active_before:true,active_after:true}]};
test('O11: identity-changes is a bodyless no-store GET with exact paging, 403 on 42501, and refuses a payload that leaks a name',async()=>{
  const observed=[];let answer=data;
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readEntityIdentityChanges:async args=>(observed.push(args),answer)})});
  const path=`/api/v1/entities/${entityId}/identity-changes?limit=50&offset=0`;
  let r=await api({method:'GET',url:path,body:null,headers:{}});
  assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(r.body.data,data);assert.deepEqual(observed[0],{tenantId,entityId,limit:50,offset:0});
  for(const req of [{method:'GET',url:path,body:{},headers:{}},{method:'GET',url:`${path}&x=1`,body:null,headers:{}},{method:'GET',url:path,body:null,headers:{'if-match':'"1"'}},{method:'GET',url:`/api/v1/entities/${entityId}/identity-changes?limit=999`,body:null,headers:{}}])assert.equal((await api(req)).status,400);
  answer={...data,rows:[{...data.rows[0],name_after:'Real Company LLC'}]};r=await api({method:'GET',url:path,body:null,headers:{}});assert.equal(r.status,502);assert.equal(r.body.code,'ENTITY_IDENTITY_CHANGES_PROTOCOL');
  const denied=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readEntityIdentityChanges:async()=>{const e=new Error('denied');e.code='42501';throw e;}})});
  assert.equal((await denied({method:'GET',url:path,body:null,headers:{}})).status,403);
});
