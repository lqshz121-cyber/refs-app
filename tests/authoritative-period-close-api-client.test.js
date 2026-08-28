import test from 'node:test';
import assert from 'node:assert/strict';
import {closeAuthoritativePeriod,periodCloseCommandIdempotencyKey,refreshAuthoritativePeriodCloseReadiness} from '../src/accounting-api.js';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const entityId=id(1),periodId=id(2),hash=`sha256:${'a'.repeat(64)}`;
const config={baseUrl:'https://accounting.example',entityId,periodId,getAccessToken:async()=>'a'.repeat(48)};
const readiness={schema_version:'PERIOD_CLOSE_READINESS_V1',tenant_id:id(9),entity_id:entityId,period_id:periodId,period_code:'2026-08',period_version:'3',period_status:'OPEN',settings_snapshot_id:id(4),settings_hash:hash,close_policy_snapshot_id:id(5),close_policy_hash:hash,financial_statement_snapshot_id:id(6),financial_statement_snapshot_hash:hash,ledger_evidence_hash:hash,unposted_journal_count:0,admitted_source_blocker_count:0,blockers:[],ready:true,can_close:true,readiness_hash:hash};

test('browser reads exact no-store period close readiness',async()=>{
  let request;
  const result=await refreshAuthoritativePeriodCloseReadiness({config,fetcher:async(url,init)=>(request={url,init},{ok:true,json:async()=>({ok:true,data:readiness})})});
  assert.equal(result.ok,true);assert.match(request.url,/periods\/.+\/close-readiness$/);assert.equal(request.init.method,'GET');assert.equal(request.init.cache,'no-store');assert.equal(result.data.readiness_hash,hash);
  for(const unsafe of [{...readiness,entity_id:id(7)},{...readiness,ready:false},{...readiness,debug:true}]){const rejected=await refreshAuthoritativePeriodCloseReadiness({config,fetcher:async()=>({ok:true,json:async()=>({ok:true,data:unsafe})})});assert.equal(rejected.code,'PERIOD_CLOSE_READINESS_PROTOCOL');}
});

test('close command binds strong version, readiness hash, reason and idempotency key',async()=>{
  let request;const receipt={schema_version:'PERIOD_CLOSE_RECEIPT_V2',period_id:periodId,status:'CLOSED',version:4,readiness_hash:hash,closed_by:'auth0|controller',idempotent:false};
  const reason='Controller verified all retained close evidence.',key=await periodCloseCommandIdempotencyKey({config,readiness,reason}),replayKey=await periodCloseCommandIdempotencyKey({config,readiness,reason});assert.equal(key,replayKey);assert.match(key,/^period-close:[0-9a-f]{64}$/);
  const result=await closeAuthoritativePeriod({config,readiness,reason,idempotencyKey:key,fetcher:async(url,init)=>(request={url,init},{ok:true,json:async()=>({ok:true,data:receipt})})});
  assert.equal(result.ok,true);assert.equal(request.init.method,'POST');assert.equal(request.init.cache,'no-store');assert.equal(request.init.headers['if-match'],'"3"');assert.equal(request.init.headers['idempotency-key'],key);assert.deepEqual(JSON.parse(request.init.body),{expectedReadinessHash:hash,reason});
  const stale=await closeAuthoritativePeriod({config,readiness:{...readiness,ready:false,can_close:false,blockers:[{code:'UNPOSTED_JOURNALS',count:1}]},reason:'Controller verified all retained close evidence.',idempotencyKey:'period-close-key-0001',fetcher:async()=>{throw new Error('must not call network')}});assert.equal(stale.code,'PERIOD_CLOSE_COMMAND_INVALID');
  const forged=await closeAuthoritativePeriod({config,readiness,reason:'Controller verified all retained close evidence.',idempotencyKey:'period-close-key-0001',fetcher:async()=>({ok:true,json:async()=>({ok:true,data:{...receipt,readiness_hash:`sha256:${'b'.repeat(64)}`}})})});assert.equal(forged.code,'PERIOD_CLOSE_PROTOCOL');
});
