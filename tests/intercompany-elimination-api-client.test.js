import assert from 'node:assert/strict';
import test from 'node:test';
import {intercompanyEliminationCommandIdempotencyKey,transitionAuthoritativeIntercompanyElimination} from '../src/accounting-api.js';
import {intercompanyEliminationBatch} from '../server/tests/helpers/intercompany-elimination-fixture.mjs';

const reason='Submit the exact reciprocal balance evidence for independent review.';
const eventHash=`sha256:${'3'.repeat(64)}`;
const pending=(draft,idempotent=true)=>({...draft,status:'PENDING_REVIEW',revision:'1',submitted_by:'maker',submitted_at:'2026-09-12T00:01:00Z',action_flags:{can_create_draft:false,can_submit:false,can_review:false,can_approve:false,can_cancel:false,can_post:false},history:[...draft.history,{from_status:'DRAFT',to_status:'PENDING_REVIEW',revision:'1',actor_id:'maker',reason,event_hash:eventHash,created_at:'2026-09-12T00:01:00Z'}],idempotent});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>({ok:true,data})});

test('intercompany elimination client reuses one deterministic command key after an uncertain response',async()=>{
 const base=intercompanyEliminationBatch(),batch={...base,action_flags:{...base.action_flags,can_submit:true}},config={baseUrl:'https://fixture.example',tenantId:'11111111-1111-4111-8111-111111111111',entityId:batch.reporting_entity_id,periodId:batch.reporting_period_id,getAccessToken:async()=>'fixture-token-'.repeat(4)};
 const key=await intercompanyEliminationCommandIdempotencyKey({config,batch,action:'SUBMIT',reason}),same=await intercompanyEliminationCommandIdempotencyKey({config,batch,action:'SUBMIT',reason});
 assert.equal(key,same);assert.match(key,/^intercompany-elimination:[0-9a-f]{64}$/);
 let captured;
 const uncertain=await transitionAuthoritativeIntercompanyElimination({config,batch,action:'SUBMIT',reason,idempotencyKey:key,fetcher:async(url,options)=>{captured={url,options};throw new Error('connection reset after commit');}});
 assert.equal(uncertain.ok,false);assert.equal(uncertain.code,'ACCOUNTING_API_UNREACHABLE');
 const recovered=await transitionAuthoritativeIntercompanyElimination({config,batch,action:'SUBMIT',reason,idempotencyKey:key,fetcher:async(url,options)=>{assert.equal(url,captured.url);assert.equal(options.headers['idempotency-key'],captured.options.headers['idempotency-key']);return response(pending(batch,true));}});
 assert.equal(recovered.ok,true);assert.equal(recovered.data.idempotent,true);
});

test('intercompany elimination client rejects non-200 lifecycle statuses and cross-scope receipts',async()=>{
 const base=intercompanyEliminationBatch(),batch={...base,action_flags:{...base.action_flags,can_submit:true}},config={baseUrl:'https://fixture.example',tenantId:'11111111-1111-4111-8111-111111111111',entityId:batch.reporting_entity_id,periodId:batch.reporting_period_id,getAccessToken:async()=>'fixture-token-'.repeat(4)},key=await intercompanyEliminationCommandIdempotencyKey({config,batch,action:'SUBMIT',reason});
 for(const status of [201,204]){const result=await transitionAuthoritativeIntercompanyElimination({config,batch,action:'SUBMIT',reason,idempotencyKey:key,fetcher:async()=>({ok:true,status,json:async()=>{throw new Error('unexpected JSON read')}})});assert.equal(result.code,'INTERCOMPANY_ELIMINATION_PROTOCOL',`status ${status}: ${JSON.stringify(result)}`);}
 const forged=pending(batch);forged.reporting_entity_id=forged.source_entity_id;
 const result=await transitionAuthoritativeIntercompanyElimination({config,batch,action:'SUBMIT',reason,idempotencyKey:key,fetcher:async()=>response(forged)});assert.equal(result.code,'INTERCOMPANY_ELIMINATION_PROTOCOL');
});

test('intercompany elimination command identity changes with revision, evidence, action and reason',async()=>{
 const batch=intercompanyEliminationBatch(),config={tenantId:'11111111-1111-4111-8111-111111111111',entityId:batch.reporting_entity_id,periodId:batch.reporting_period_id};
 const original=await intercompanyEliminationCommandIdempotencyKey({config,batch,action:'SUBMIT',reason});
 const variants=[{...batch,revision:'1'},{...batch,source_evidence_hash:`sha256:${'9'.repeat(64)}`}];
 for(const value of variants)assert.notEqual(await intercompanyEliminationCommandIdempotencyKey({config,batch:value,action:'SUBMIT',reason}),original);
 assert.notEqual(await intercompanyEliminationCommandIdempotencyKey({config,batch,action:'REVIEW',reason}),original);
 assert.notEqual(await intercompanyEliminationCommandIdempotencyKey({config,batch,action:'SUBMIT',reason:`${reason} Again`}),original);
});
