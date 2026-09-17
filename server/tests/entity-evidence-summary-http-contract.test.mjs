// P0-F6: the evidence-summary read distinguishes "nothing imported" from a real zero.
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID();
const summary={schema_version:'ENTITY_EVIDENCE_SUMMARY_V1',entity_id:entityId,period_id:periodId,journal_count:0,posted_journal_count:0,raw_event_count:0,staging_item_count:0,source_document_count:0,last_raw_event_at:null,evidence_state:'NO_EVIDENCE_IMPORTED'};
const api=(result)=>{const reads=[];return {reads,api:createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readEntityEvidenceSummary:async input=>{reads.push(input);return result;}})})};};
const path=`/api/v1/entities/${entityId}/evidence-summary?periodId=${periodId}`;
test('GET evidence-summary is a bodyless, no-store read that returns the kernel summary verbatim',async()=>{
  const {api:a,reads}=api(summary);const r=await a({method:'GET',url:path,body:null,headers:{}});
  assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(r.body,{ok:true,data:summary});assert.deepEqual(reads,[{tenantId,entityId,periodId}]);
});
test('query, header and body discipline match the scope read',async()=>{
  const {api:a}=api(summary);
  assert.equal((await a({method:'GET',url:`${path}&x=1`,body:null,headers:{}})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await a({method:'GET',url:path,body:null,headers:{'If-Match':'"0"'}})).body.code,'IF_MATCH_NOT_ALLOWED');
  assert.equal((await a({method:'GET',url:path,body:{},headers:{}})).body.code,'READ_BODY_FORBIDDEN');
  assert.equal((await a({method:'GET',url:`/api/v1/entities/${entityId}/evidence-summary`,body:null,headers:{}})).status,400);
});
test('a kernel answer that breaks the contract is refused as 502, never passed through',async()=>{
  for(const bad of [{...summary,evidence_state:'GUESS'},{...summary,journal_count:-1},{...summary,entity_id:randomUUID()},{...summary,extra:1},{...summary,last_raw_event_at:'yesterday'}]){
    const {api:a}=api(bad);const r=await a({method:'GET',url:path,body:null,headers:{}});assert.equal(r.status,502,JSON.stringify(bad).slice(0,60));assert.equal(r.body.code,'ENTITY_EVIDENCE_SUMMARY_INVALID');
  }
});
test('a kernel without the read method is 503, not a crash',async()=>{
  const a=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({})});
  const r=await a({method:'GET',url:path,body:null,headers:{}});assert.equal(r.status,503);assert.equal(r.body.ok,false);
});
