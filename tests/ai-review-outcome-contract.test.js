import assert from 'node:assert/strict';
import {applyAIReviewOutcome,createAIReviewOutcomeRepository,proposeDraftJE} from '../src/ai-accounting.js';

const finding={id:'AI:REVIEW:4:2026-07:SRC-1',skill:'AI_AUDIT',rule:'SOURCE_TRACE',risk:'MEDIUM',object_type:'SOURCE_DOCUMENT',object:'SRC-1',review_owner:'ACCOUNTING_OPS',confidence:0.95,source_refs:['SRC-1'],dimensions:{entity_id:'4',period_code:'2026-07'}};
const evidence={schema:'AI_DECISION_EVIDENCE_V1',input_refs:['source:SRC-1'],policy_gates:['DRAFT_ONLY','HUMAN_REVIEW_REQUIRED','NO_AUTOMATIC_POSTING']};
const jeSpec={entity_id:'4',member_trace:{entity_id:'4',project_id:null,property_id:null},period_code:'2026-07',je_date:'2026-07-31',source_doc_id:'SRC-1',je_type:'AUTO',lines:[{account_code:'610000',debit_amount:100,credit_amount:0},{account_code:'210000',debit_amount:0,credit_amount:100}]};
const draft=proposeDraftJE({finding,evidence,jeSpec}).draft;
const memory=()=>{const rows=new Map();return {rows,load:(key,fallback)=>rows.has(key)?structuredClone(rows.get(key)):structuredClone(fallback),save:(key,value)=>rows.set(key,structuredClone(value))};};

const approved=applyAIReviewOutcome({draft,outcome:{decision:'APPROVE',idempotency_key:'review-approve-1',reason:'controller approval'},actor:'controller-1'});
assert.equal(approved.draft.posting_status,'DRAFT'); assert.equal(approved.draft.ai_review_state,'APPROVE'); assert.equal(approved.event.event_type,'AI_REVIEW_APPROVE');
const rejected=applyAIReviewOutcome({draft,outcome:{decision:'REJECT',idempotency_key:'review-reject-1',reason:'need source'},actor:'controller-1'});
assert.equal(rejected.draft.posting_status,'DRAFT'); assert.equal(rejected.draft.ai_review_state,'REJECT');
const edited=applyAIReviewOutcome({draft,outcome:{decision:'EDIT',idempotency_key:'review-edit-1',patch:{description:'Controller edited',review_note:'token=hidden'}},actor:'controller-1'});
assert.equal(edited.draft.description,'Controller edited'); assert.equal(edited.draft.posting_status,'DRAFT'); assert.equal(edited.event.payload.reason,null);
assert.throws(()=>applyAIReviewOutcome({draft,outcome:{decision:'POST',idempotency_key:'post-1'},actor:'controller-1'}),/APPROVE, REJECT or EDIT/);
assert.throws(()=>applyAIReviewOutcome({draft,outcome:{decision:'EDIT',idempotency_key:'edit-post',patch:{posting_status:'POSTED'}},actor:'controller-1'}),/immutable/);

const storage=memory(), repo=createAIReviewOutcomeRepository(storage);
const input={draft,outcome:{decision:'APPROVE',idempotency_key:'repo-approve-1',reason:'controller approval',review_metadata:{authorization:'secret'}},actor:'controller-1'};
const committed=repo.apply(input); assert.equal(committed.status,'COMMITTED'); assert.equal(committed.draft.posting_status,'DRAFT');
const replay=repo.apply(input); assert.equal(replay.status,'IDEMPOTENT_REUSE'); assert.equal(repo.read().events.length,1);
assert.equal(JSON.stringify(repo.read()).includes('secret'),false);
assert.throws(()=>repo.apply({...input,outcome:{...input.outcome,decision:'REJECT'}}),/idempotency conflict/);
assert.throws(()=>repo.apply({...input,outcome:{decision:'EDIT',idempotency_key:'repo-approve-1',patch:{description:'different'}}}),/idempotency conflict/);
assert.throws(()=>repo.apply({...input,actor:'controller-2'}),/idempotency conflict/);
assert.throws(()=>repo.apply({...input,draft:{...draft,ai_proposal_id:'other-proposal'}}),/idempotency conflict/);

const failingStore=memory(); let writes=0; const failing={load:failingStore.load,save:(key,value)=>{writes+=1;if(writes===2) throw new Error('simulated commit failure');failingStore.save(key,value);}};
const recoverable=createAIReviewOutcomeRepository(failing);
assert.throws(()=>recoverable.apply({...input,outcome:{...input.outcome,idempotency_key:'recover-1'}}),/simulated/);
assert.throws(()=>recoverable.apply({...input,outcome:{...input.outcome,idempotency_key:'recover-1',decision:'REJECT'}}),/idempotency conflict/);
const recovered=createAIReviewOutcomeRepository(failingStore).recover(); assert.equal(recovered.length,1); assert.equal(recovered[0].status,'RECOVERED'); assert.equal(recovered[0].draft.posting_status,'DRAFT');
console.log('ai-review-outcome-contract: approve/reject/edit, atomic WAL recovery, redaction and Draft-only assertions passed');
