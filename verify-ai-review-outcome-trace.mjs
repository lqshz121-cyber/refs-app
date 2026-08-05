import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildAIReviewOutcomeTrace, createAIReviewOutcomeRepository, proposeDraftJE } from './src/ai-accounting.js';

const finding={id:'AI:TRACE:4:2026-07:SRC-9',skill:'AI_AUDIT',rule:'SOURCE_TRACE',risk:'MEDIUM',object_type:'SOURCE_DOCUMENT',object:'SRC-9',review_owner:'CONTROLLER',confidence:0.97,source_refs:['SRC-9'],dimensions:{entity_id:'4',period_code:'2026-07'}};
const evidence={schema:'AI_DECISION_EVIDENCE_V1',input_refs:['source:SRC-9'],policy_gates:['DRAFT_ONLY','HUMAN_REVIEW_REQUIRED','NO_AUTOMATIC_POSTING']};
const draft=proposeDraftJE({finding,evidence,jeSpec:{entity_id:'4',member_trace:{entity_id:'4',project_id:'P-9',property_id:'PROP-9'},period_code:'2026-07',je_date:'2026-07-31',source_doc_id:'SRC-9',je_type:'AUTO',lines:[{account_code:'610000',debit_amount:125,credit_amount:0},{account_code:'210000',debit_amount:0,credit_amount:125}]}}).draft;
const memory=()=>{const rows=new Map();return {load:(key,fallback)=>rows.has(key)?structuredClone(rows.get(key)):structuredClone(fallback),save:(key,value)=>rows.set(key,structuredClone(value))};};

const storage=memory();
const repository=createAIReviewOutcomeRepository(storage);
const input={draft,outcome:{decision:'APPROVE',idempotency_key:'trace-approve-1',reason:'Source retained',review_metadata:{authorization:'Bearer secret-token',comment:'Controller checked source'}},actor:'controller-9'};
const result=repository.apply(input);
assert.equal(result.draft.posting_status,'DRAFT');
assert.equal(result.draft.ai_review_revision,1);
assert.equal(result.event.payload.revision,1);
const [trace]=buildAIReviewOutcomeTrace(repository.read());
assert.equal(trace.actor,'controller-9');
assert.equal(trace.decision,'APPROVE');
assert.equal(trace.revision,1);
assert.equal(trace.wal_state,'COMMITTED');
assert.equal(trace.recovery_state,'NOT_REQUIRED');
assert.equal(trace.evidence_state,'COMPLETE');
assert.equal(trace.posting_status,'DRAFT');
assert.equal(trace.controls.read_only,true);
assert.equal(trace.controls.can_create_draft,false);
assert.equal(trace.controls.can_approve,false);
assert.equal(trace.controls.can_post,false);
assert.match(trace.canonical_redacted_payload,/Source retained/);
assert.match(trace.canonical_redacted_payload,/\[REDACTED\]/);
assert.doesNotMatch(trace.canonical_redacted_payload,/secret-token/);
assert.throws(()=>repository.apply({...input,outcome:{...input.outcome,decision:'REJECT'}}),/idempotency conflict/);

const recoveryStorage=memory();
let writes=0;
const failing={load:recoveryStorage.load,save:(key,value)=>{writes+=1;if(writes===2) throw new Error('commit unavailable');recoveryStorage.save(key,value);}};
assert.throws(()=>createAIReviewOutcomeRepository(failing).apply({draft,outcome:{decision:'REJECT',idempotency_key:'trace-recover-1',reason:'Missing support'},actor:'controller-9'}),/commit unavailable/);
const recoveryRepository=createAIReviewOutcomeRepository(recoveryStorage);
const recovered=recoveryRepository.recover()[0];
assert.equal(recovered.status,'RECOVERED');
assert.equal(recovered.draft.ai_review_revision,1);
assert.equal(recovered.event.payload.revision,1);
const [recoveredTrace]=buildAIReviewOutcomeTrace(recoveryRepository.read());
assert.equal(recoveredTrace.recovery_state,'RECOVERED');
assert.ok(recoveredTrace.recovered_at);
assert.equal(recoveredTrace.posting_status,'DRAFT');

const ui=fs.readFileSync(new URL('./src/module-aiaudit.jsx',import.meta.url),'utf8');
assert.match(ui,/Human review outcome trace/);
assert.match(ui,/Canonical redacted payload/);
assert.match(ui,/Draft creation[\s\S]*Disabled/);
assert.match(ui,/Approval \/ posting[\s\S]*Disabled/);

console.log('ai-review-outcome-trace: canonical redaction, actor/time/decision/revision, WAL recovery, replay conflict, read-only UI and Draft-only controls passed');
