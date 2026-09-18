// P10 HTTP contract: outbox health is a bodyless no-store operational read that never returns a payload.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId=randomUUID(),entityId=randomUUID();
const data={schema_version:'OUTBOX_HEALTH_V1',accounting_authority:'NONE',can_dispatch:false,can_delete:false,entity_id:entityId,
  observed_at:'2026-09-18T02:00:00.000Z',stale_minutes:15,
  totals:{pending_count:3,published_count:1,failed_count:0,due_now_count:2,deferred_count:1,stale_pending_count:1,retried_count:1,max_attempt_count:3,errored_count:1,oldest_pending_age_seconds:7200},
  by_event_type:[{event_type:'JOURNAL_POSTED',pending_count:3,failed_count:0,max_attempt_count:3,oldest_pending_age_seconds:7200}],
  oldest_unpublished:[{outbox_event_id:randomUUID(),event_type:'JOURNAL_POSTED',aggregate_type:'JOURNAL_ENTRY',status:'PENDING',attempt_count:3,payload_hash:'sha256:'+'a'.repeat(64),last_error:'consumer 404'}],
  backlog_state:'STALE_BACKLOG'};
const api=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'ops'}),kernelFactory:async()=>kernel});
const failing=code=>async()=>{const e=new Error('kernel');e.code=code;throw e;};
const url=`/api/v1/entities/${entityId}/ops/outbox-health`;

test('P10: outbox health read is bodyless, no-store, bounded, scoped, and payload-free',async()=>{
  const observed=[];let answer=data;
  const a=api({readOutboxHealth:async args=>(observed.push(args),answer)});
  let r=await a({method:'GET',url,body:null,headers:{}});
  assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(r.body.data,data);
  assert.deepEqual(observed[0],{tenantId,entityId,staleMinutes:15},'the default window is 15 minutes');
  r=await a({method:'GET',url:`${url}?staleMinutes=240`,body:null,headers:{}});
  assert.equal(r.status,200);assert.equal(observed[1].staleMinutes,240);
  for(const q of ['?staleMinutes=0','?staleMinutes=-1','?staleMinutes=10081','?staleMinutes=abc','?staleMinutes=1.5','?other=1'])
    assert.equal((await a({method:'GET',url:url+q,body:null,headers:{}})).status,400,q);
  assert.equal((await a({method:'GET',url,body:{},headers:{}})).status,400);
  assert.equal((await a({method:'GET',url,body:null,headers:{'idempotency-key':'x'}})).status,400);
  assert.equal((await a({method:'GET',url,body:null,headers:{'if-match':'"0"'}})).status,400);
  // a kernel that leaks a payload is a protocol breach, not a pass-through
  answer={...data,oldest_unpublished:[{...data.oldest_unpublished[0],payload:{secret:'leak'}}]};
  assert.equal((await a({method:'GET',url,body:null,headers:{}})).status,502);
  answer={...data,can_dispatch:true};assert.equal((await a({method:'GET',url,body:null,headers:{}})).status,502);
  answer=data;
  assert.equal((await api({readOutboxHealth:failing('42501')})({method:'GET',url,body:null,headers:{}})).status,403);
  assert.equal((await api({readOutboxHealth:failing('22023')})({method:'GET',url,body:null,headers:{}})).status,400);
  assert.equal((await api({})({method:'GET',url,body:null,headers:{}})).status,503);
  assert.equal((await a({method:'POST',url,body:{},headers:{'idempotency-key':'p10-key-1'}})).status,404,'the health read has no command form');
});
