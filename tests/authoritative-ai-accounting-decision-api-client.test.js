import test from 'node:test';
import assert from 'node:assert/strict';
import {aiAccountingDecisionCommandIdempotencyKey,createAuthoritativeAiAccountingDecisionDraft,decideAuthoritativeAiAccountingDecision,refreshAuthoritativeAiAccountingDecisionQueue} from '../src/accounting-api.js';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const entityId=id(1),periodId=id(2),decisionId=id(3),humanId=id(4),hash=`sha256:${'a'.repeat(64)}`;
const config={baseUrl:'https://accounting.example',entityId,periodId,getAccessToken:async()=> 'a'.repeat(48)};
const action_flags={can_accept_or_reject:true,can_create_draft:false,can_retain_posted_outcome:false,can_submit:false,can_review:false,can_approve:false,can_post:false};
const decision={ai_accounting_decision_id:decisionId,decision_hash:hash,packet_status:'READY_FOR_HUMAN_REVIEW',action_flags};

test('browser reads an empty retained decision page with no-store and exact scope',async()=>{
  let request;const data={schema_version:'AI_ACCOUNTING_DECISION_QUEUE_V1',scope:{tenant_id:id(9),entity_id:entityId,accounting_period_id:periodId},total_count:0,read_count:0,limit:50,offset:0,population_complete:true,rows:[]};
  const result=await refreshAuthoritativeAiAccountingDecisionQueue({config,fetcher:async(url,init)=>(request={url,init},{ok:true,json:async()=>({ok:true,data})})});
  assert.equal(result.ok,true);assert.match(request.url,/accounting-decision-queue/);assert.equal(request.init.method,'GET');assert.equal(request.init.cache,'no-store');assert.equal(result.data.rows.length,0);
  for(const unsafe of [{...data,population_complete:false},{...data,read_count:1},{...data,debug:true}]){const rejected=await refreshAuthoritativeAiAccountingDecisionQueue({config,fetcher:async()=>({ok:true,json:async()=>({ok:true,data:unsafe})})});assert.equal(rejected.code,'AI_ACCOUNTING_DECISION_QUEUE_PROTOCOL');}
});

test('human decision command uses stable hash-bound idempotency and validates its receipt',async()=>{
  const reason='Controller verified the retained source evidence.';
  const first=await aiAccountingDecisionCommandIdempotencyKey({config,decision,action:'ACCEPTED',reason}),second=await aiAccountingDecisionCommandIdempotencyKey({config,decision,action:'ACCEPTED',reason});assert.equal(first,second);assert.match(first,/^ai-accounting-decision:[0-9a-f]{64}$/);
  let request;const receipt={schema_version:'AI_ACCOUNTING_HUMAN_DECISION_V1',ai_accounting_decision_id:decisionId,ai_accounting_human_decision_id:humanId,decision_hash:hash,evidence_hash:hash,outcome:'ACCEPTED',can_create_draft:false,can_review:false,can_approve:false,can_post:false,idempotent:false};
  const result=await decideAuthoritativeAiAccountingDecision({config,decision,outcome:'ACCEPTED',reason,idempotencyKey:first,fetcher:async(url,init)=>(request={url,init},{ok:true,status:201,json:async()=>({ok:true,data:receipt})})});
  assert.equal(result.ok,true);assert.equal(request.init.cache,'no-store');assert.equal(request.init.headers['idempotency-key'],first);assert.equal(JSON.parse(request.init.body).expected_decision_hash,hash);
});

test('accepted evidence can create only a Draft receipt',async()=>{
  const accepted={...decision,human_decision:{ai_accounting_human_decision_id:humanId,outcome:'ACCEPTED',evidence_hash:hash},action_flags:{...action_flags,can_accept_or_reject:false,can_create_draft:true}},reason='Maker verified the accepted evidence for Draft creation.',idempotencyKey='decision-draft-key-1';
  const receipt={schema_version:'AI_ACCOUNTING_DECISION_DRAFT_V1',ai_accounting_decision_draft_evidence_id:id(5),ai_accounting_decision_id:decisionId,ai_accounting_human_decision_id:humanId,journal_entry_id:id(6),status:'DRAFT',revision:0,idempotent:false,can_review:false,can_approve:false,can_post:false};
  const result=await createAuthoritativeAiAccountingDecisionDraft({config,decision:accepted,reason,idempotencyKey,fetcher:async()=>({ok:true,status:201,json:async()=>({ok:true,data:receipt})})});
  assert.equal(result.ok,true);assert.equal(result.data.status,'DRAFT');assert.equal(result.data.can_post,false);
});
