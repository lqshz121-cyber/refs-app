import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWbsAutoRecExecutionIntent,createWbsAutoRecExecutionIntentService,WbsAutoRecExecutionContractError} from '../runtime/wbs-autorec-execution-contract.mjs';

const hash=letter=>'sha256:'+letter.repeat(64);
const trace={company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',allocated_amount:'100.0000',bank_business_date:'2026-08-01',bank_accounting_date:'2026-08-01',business_business_date:'2026-08-01',business_accounting_date:'2026-08-01',bank_receipt_id:'r-bank',bank_receipt_ref:'object://receipt/bank',bank_receipt_hash:hash('a'),business_receipt_id:'r-pay',business_receipt_ref:'object://receipt/pay',business_receipt_hash:hash('b'),bank_raw_event_id:'raw-bank',business_raw_event_id:'raw-pay',bank_source_document_id:'doc-bank',business_source_document_id:'doc-pay',bank_source_record_id:'bank-1',bank_source_version:'v1',business_source_record_id:'pay-1',business_source_version:'v1',bank_staging_item_id:'stg-bank',business_staging_item_id:'stg-pay'};
const review={request_type:'AUTOREC_REVIEW_REQUEST',status:'REVIEW_REQUIRED',review_candidate_id:'candidate-1',company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',allocated_amount:'100.0000',trace};
const journal=(type,lines)=>({accounting_type:type,source_system:'REFS_STANDARD_JE',status:'POSTED',journal_entry_id:`je-${type}`,audit_event_id:`audit-${type}`,audit_event_type:'AUTO_JOURNAL_CREATED',company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',source_trace:trace,ledger_lines:lines});
const posted=[journal('PAYABLE_INCUR',[{ledger_line_id:'l1',account_code:'291001',member_ref:'V-1',debit_amount:0,credit_amount:100},{ledger_line_id:'l2',account_code:'610000',debit_amount:100,credit_amount:0}]),journal('AUTOC',[{ledger_line_id:'l3',account_code:'291001',member_ref:'V-1',debit_amount:100,credit_amount:0},{ledger_line_id:'l4',account_code:'111000',member_ref:'B-1',debit_amount:0,credit_amount:100}])];
const reservationReceipt={reservation_id:'reservation-1',request_hash:hash('c'),control_hash:hash('d'),version:'1',review_candidate_id:'candidate-1',bank_source_record_id:'bank-1',bank_source_version:'v1',business_source_record_id:'pay-1',business_source_version:'v1',allocated_amount:'100.0000'};
const execute=input=>buildWbsAutoRecExecutionIntent({...input,idempotencyKey:input.idempotencyKey??'wbs-autorec-exec-001'});

test('REFS execution intent separates WBS observation from reservation, release, and incur authority',()=>{
  assert.throws(()=>buildWbsAutoRecExecutionIntent({command:'RESERVE',currentState:'REVIEW_REQUIRED',reviewCandidate:review}),error=>error.code==='WBS_AUTOREC_EXECUTION_IDEMPOTENCY_REQUIRED');
  assert.throws(()=>execute({command:'RESERVE',currentState:'REVIEW_REQUIRED',reviewCandidate:{...review,trace:{...trace,business_source_version:''}}}),error=>error.code==='WBS_AUTOREC_EXECUTION_REVIEW_REQUIRED');
  assert.throws(()=>execute({command:'RESERVE',currentState:'REVIEW_REQUIRED',reviewCandidate:{...review,trace:{...trace,bank_receipt_ref:''}}}),error=>error.code==='WBS_AUTOREC_EXECUTION_REVIEW_REQUIRED');
  const reserved=execute({command:'RESERVE',currentState:'REVIEW_REQUIRED',reviewCandidate:review});
  assert.deepEqual({state:reserved.next_state,dispatch:reserved.can_dispatch,post:reserved.can_post},{state:'RESERVED',dispatch:false,post:false});
  assert.throws(()=>execute({command:'RELEASE',currentState:'RESERVED',reviewCandidate:review}),error=>error instanceof WbsAutoRecExecutionContractError&&error.code==='WBS_AUTOREC_EXECUTION_RESERVATION_REQUIRED');
  assert.throws(()=>execute({command:'RELEASE',currentState:'RESERVED',reviewCandidate:review,reservationReceipt:{...reservationReceipt,review_candidate_id:'candidate-other'}}),error=>error.code==='WBS_AUTOREC_EXECUTION_RESERVATION_REQUIRED');
  const released=execute({command:'RELEASE',currentState:'RESERVED',reviewCandidate:review,reservationReceipt});
  assert.equal(released.next_state,'RELEASED');
  assert.throws(()=>execute({command:'INCUR',currentState:'RELEASED',reviewCandidate:review,postedJournals:[{...posted[0],status:'DRAFT'},posted[1]]}),error=>error.code==='WBS_AUTOREC_G11_POSTED_EVIDENCE_REQUIRED');
  const incurred=execute({command:'INCUR',currentState:'RELEASED',reviewCandidate:review,postedJournals:posted});
  assert.equal(incurred.next_state,'INCURRED');assert.equal(incurred.g11.status,'POSTED_TRACE_VERIFIED');assert.equal(incurred.can_post,false);
});

test('reverse is a two-leg standard Draft/Post workflow and cannot be inferred from WBS display status',()=>{
  const draft=execute({command:'REQUEST_REVERSE',currentState:'INCURRED',reviewCandidate:review,reason:'Correct received evidence'});
  assert.equal(draft.next_state,'REVERSE_DRAFT_REQUIRED');assert.equal(draft.can_create_draft,false);
  const reversed=execute({command:'COMPLETE_REVERSE',currentState:'REVERSE_DRAFT_REQUIRED',reviewCandidate:review,postedJournals:posted,postedReversalJournals:[{journal_entry_id:'reversal-pay',reverses_journal_entry_id:'je-PAYABLE_INCUR',status:'POSTED'},{journal_entry_id:'reversal-autoc',reverses_journal_entry_id:'je-AUTOC',status:'POSTED'}]});
  assert.equal(reversed.next_state,'REVERSED');assert.equal(reversed.posted_reversals.length,2);
  assert.throws(()=>execute({command:'COMPLETE_REVERSE',currentState:'REVERSE_DRAFT_REQUIRED',reviewCandidate:review,postedJournals:posted,postedReversalJournals:[{journal_entry_id:'reversal-pay',reverses_journal_entry_id:'je-PAYABLE_INCUR',status:'POSTED'},{journal_entry_id:'reversal-two',reverses_journal_entry_id:'je-PAYABLE_INCUR',status:'POSTED'}]}),error=>error.code==='WBS_AUTOREC_EXECUTION_REVERSE_EVIDENCE_REQUIRED');
  assert.throws(()=>execute({command:'RELEASE',currentState:'INCURRED',reviewCandidate:review,reservationReceipt}),error=>error.code==='WBS_AUTOREC_EXECUTION_TRANSITION_INVALID');
});

test('execution intents replay only the exact canonical command for one review candidate',()=>{
  const service=createWbsAutoRecExecutionIntentService();
  const input={command:'RESERVE',currentState:'REVIEW_REQUIRED',reviewCandidate:review,idempotencyKey:'wbs-autorec-replay-001'};
  const first=service.prepare(input),replay=service.prepare(input);
  assert.equal(first.replayed,false);assert.equal(replay.replayed,true);assert.equal(replay.request_hash,first.request_hash);
  assert.throws(()=>service.prepare({...input,command:'REQUEST_REVERSE',currentState:'INCURRED',reason:'different command'}),error=>error.code==='WBS_AUTOREC_EXECUTION_REPLAY_CONFLICT');
});
