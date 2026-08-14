import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeDraftJE,applyAIReviewOutcome} from '../src/ai-accounting.js';
import {MemoryJEDatabase} from '../server/db/memory-je-db.mjs';
import {JEService} from '../server/api/je-service.mjs';

const actors=Object.freeze({
  maker:{user_id:'accountant-maker',role_code:'STAFF_ACCT'},
  reviewer:{user_id:'accounting-reviewer',role_code:'REVIEWER'},
  approver:{user_id:'controller-approver',role_code:'ACCT_MANAGER'},
  poster:{user_id:'senior-poster',role_code:'SENIOR_ACCT'}
});

test('test-data AI proposal needs human review and then follows the standard four-role JE workflow',()=>{
  const finding={id:'AI:ACCRUAL:TEST-DATA-2026-07',skill:'ACCRUAL_ACCOUNTING',rule:'MISSING_ACCRUAL',risk:'MEDIUM',object_type:'PAYABLE',object:'BILL-TEST-1001',review_owner:'CONTROLLER',confidence:0.94,source_refs:['BILL-TEST-1001'],dimensions:{entity_id:'2',period_code:'2026-07'}};
  const evidence={schema:'AI_DECISION_EVIDENCE_V1',input_refs:['bill:BILL-TEST-1001'],policy_gates:['DRAFT_ONLY','HUMAN_REVIEW_REQUIRED','NO_AUTOMATIC_POSTING']};
  const proposal=proposeDraftJE({finding,evidence,jeSpec:{entity_id:'2',member_trace:{entity_id:'2',project_id:null,property_id:null},period_code:'2026-07',je_date:'2026-07-31',source_doc_id:'BILL-TEST-1001',je_type:'AUTO',source_system:'AI_TEST_DATA',rule_code:'R-AI-ACCRUAL',description:'Test-data July accrual proposed for controller review',lines:[{account_code:'610000',debit_amount:1250,credit_amount:0},{account_code:'210000',debit_amount:0,credit_amount:1250}]}});

  assert.equal(proposal.draft.posting_status,'DRAFT');
  assert.throws(()=>applyAIReviewOutcome({draft:proposal.draft,outcome:{decision:'POST',idempotency_key:'ai-test-post'},actor:'controller-approver'}),/APPROVE, REJECT or EDIT/);
  const reviewed=applyAIReviewOutcome({draft:proposal.draft,outcome:{decision:'APPROVE',idempotency_key:'ai-test-review-1001',reason:'Controller checked the retained test-data invoice support.'},actor:'controller-approver'});
  assert.equal(reviewed.draft.posting_status,'DRAFT');
  assert.equal(reviewed.draft.ai_review_state,'APPROVE');

  const database=new MemoryJEDatabase({periods:[{entity_id:2,period_code:'2026-07',status:'OPEN'}]});
  const service=new JEService(database,{now:()=> '2026-07-31T12:00:00.000Z',isValidAccount:code=>['610000','210000'].includes(code)});
  const standardDraft={je_id:'AI-TEST-1001',je_number:'JE-AI-TEST-1001',entity_id:2,period_code:'2026-07',je_date:'2026-07-31',je_type:'AUTO',source_system:'AI_TEST_DATA',source_doc_id:proposal.draft.source_document_id,rule_code:'R-AI-ACCRUAL',setting_used:{source:'AI_TEST_DATA',version:1},mapping_used:{debit_account:'610000',credit_account:'210000',version:1},idempotency_key:'ai-test-data/accrual/BILL-TEST-1001/2026-07',description:reviewed.draft.description,attachments:[],lines:proposal.draft.lines};
  assert.equal(service.create({actor:actors.maker,je:standardDraft}).data.je.posting_status,'DRAFT');
  assert.equal(service.transition({actor:actors.maker,id:'AI-TEST-1001',action:'submit'}).data.je.posting_status,'PENDING_REVIEW');
  assert.equal(service.transition({actor:actors.reviewer,id:'AI-TEST-1001',action:'review'}).data.je.posting_status,'PENDING_APPROVAL');
  assert.equal(service.transition({actor:actors.approver,id:'AI-TEST-1001',action:'approve'}).data.je.posting_status,'APPROVED');
  assert.equal(service.transition({actor:actors.poster,id:'AI-TEST-1001',action:'post'}).data.je.posting_status,'POSTED');
  const posted=database.readJE('AI-TEST-1001');
  assert.equal(posted.created_by,actors.maker.user_id);
  assert.equal(posted.reviewer,actors.reviewer.user_id);
  assert.equal(posted.approver,actors.approver.user_id);
  assert.equal(posted.posted_by,actors.poster.user_id);
  assert.deepEqual(posted.lines,proposal.draft.lines);
  assert.equal(posted.lines.reduce((sum,line)=>sum+line.debit_amount-line.credit_amount,0),0);
});
