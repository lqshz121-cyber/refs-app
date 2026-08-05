import assert from 'node:assert/strict';
import {proposeDraftJE} from '../src/ai-accounting.js';

const finding={id:'AI:SOURCE_TRACE:4:2026-07:PROJECT-1:PROPERTY-1:SRC-1',skill:'AI_AUDIT',rule:'SOURCE_TRACE',risk:'MEDIUM',object_type:'SOURCE_DOCUMENT',object:'SRC-1',review_owner:'ACCOUNTING_OPS',confidence:0.95,source_refs:['SRC-1'],dimensions:{entity_id:'4',project_id:'PROJECT-1',property_id:'PROPERTY-1',period_code:'2026-07'}};
const evidence={schema:'AI_DECISION_EVIDENCE_V1',input_refs:['source:SRC-1'],policy_gates:['DRAFT_ONLY','HUMAN_REVIEW_REQUIRED','NO_AUTOMATIC_POSTING']};
const jeSpec={entity_id:'4',project_id:'PROJECT-1',property_id:'PROPERTY-1',member_trace:{entity_id:'4',project_id:'PROJECT-1',property_id:'PROPERTY-1'},period_code:'2026-07',je_date:'2026-07-31',source_doc_id:'SRC-1',je_type:'AUTO',lines:[{account_code:'610000',debit_amount:100,credit_amount:0},{account_code:'210000',debit_amount:0,credit_amount:100}]};

const proposed=proposeDraftJE({finding,evidence,jeSpec});
assert.equal(proposed.draft.posting_status,'DRAFT');
assert.equal(proposed.draft.accounting_period,'2026-07');
assert.equal(proposed.draft.source_document_id,'SRC-1');
assert.match(proposed.draft.idempotency_key,/^AI-DRAFT:SRC-1:SOURCE_TRACE:/);
assert.deepEqual(proposed.draft.member_trace,{entity_id:'4',project_id:'PROJECT-1',property_id:'PROPERTY-1'});
assert.equal(proposed.draft.lines.reduce((sum,line)=>sum+line.debit_amount-line.credit_amount,0),0);
for (const [field,value] of Object.entries({entity_id:null,period_code:null,source_doc_id:null,je_type:null})) assert.throws(()=>proposeDraftJE({finding,evidence,jeSpec:{...jeSpec,[field]:value}}),new RegExp(field==='period_code'?'accounting period':field==='source_doc_id'?'source document':field==='je_type'?'JE type':'entity'));
assert.throws(()=>proposeDraftJE({finding,evidence,jeSpec:{...jeSpec,member_trace:{entity_id:'4',project_id:null,property_id:'PROPERTY-1'}}}),/project_id member trace/);
assert.throws(()=>proposeDraftJE({finding,evidence,jeSpec:{...jeSpec,member_trace:{entity_id:'4',project_id:'WRONG',property_id:'PROPERTY-1'}}}),/project_id member trace/);
assert.throws(()=>proposeDraftJE({finding:{...finding,rule:null},evidence,jeSpec}),/AI rule/);
assert.throws(()=>proposeDraftJE({finding,evidence,jeSpec:{...jeSpec,idempotency_key:''}}),/idempotency/);
assert.throws(()=>proposeDraftJE({finding,evidence,jeSpec:{...jeSpec,je_date:'2026-08-01'}}),/date must belong/);
assert.throws(()=>proposeDraftJE({finding,evidence,jeSpec:{...jeSpec,lines:[{account_code:'610000',debit_amount:100,credit_amount:0},{account_code:'210000',debit_amount:0,credit_amount:99}]}}),/balanced/);
assert.throws(()=>proposeDraftJE({finding,evidence:{...evidence,input_refs:['source:OTHER']},jeSpec}),/retained in evidence/);
const entityOnlyFinding={...finding,dimensions:{entity_id:'4',period_code:'2026-07'}};
const entityOnly=proposeDraftJE({finding:entityOnlyFinding,evidence,jeSpec:{...jeSpec,project_id:null,property_id:null,member_trace:{entity_id:'4',project_id:null,property_id:null}}});
assert.deepEqual(entityOnly.draft.member_trace,{entity_id:'4',project_id:null,property_id:null});
console.log('ai-draft-je-contract: all assertions passed');
