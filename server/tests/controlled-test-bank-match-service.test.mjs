import test from 'node:test';
import assert from 'node:assert/strict';
import {createControlledTestBankMatchService} from '../runtime/controlled-test-bank-match-service.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenantId=id(1),entityId=id(2),periodId=id(3),bankSourceId=id(4),businessDocumentId=id(5),paymentOccurrenceId=id(6),journalEntryId=id(7),journalLineId=id(8),ledgerLineId=id(9),bankMatchId=id(10);
const actors={importer:'fixture-importer',maker:'fixture-maker',submitter:'fixture-submitter',reviewer:'fixture-reviewer',approver:'fixture-approver',poster:'fixture-poster'};
const scope={tenantId,entityId,bankAccountRef:'WBS_TEST_BANK',cashAccountCode:'111000',actors};
const fixture=overrides=>({period_id:periodId,bank_source_id:bankSourceId,bank_version:0,bank_account_ref:'WBS_TEST_BANK',transaction_date:'2026-07-01',currency:'USD',payment_amount:'100.0000',business_document_id:businessDocumentId,document_number:'WBS-TEST-EXACT',active_bank_match_id:null,active_payment_occurrence_id:null,active_journal_entry_id:null,active_journal_line_id:null,active_ledger_line_id:null,active_match_revision:null,...overrides});

function harness({resolved=fixture(),candidateCount=1}={}){
  const calls=[];
  const kernels={
    importer:{
      async resolveWbsTestBankMatchFixture(args){calls.push(['resolve',args]);return resolved;},
      async listBankMatchCandidates(args){calls.push(['candidates',args]);return candidateCount===1?[{payment_occurrence_id:paymentOccurrenceId,journal_entry_id:journalEntryId,journal_line_id:journalLineId,ledger_line_id:ledgerLineId,occurrence_version:1}]:[];},
      async createBankPaymentMatch(args){calls.push(['match',args]);return {bank_match_id:bankMatchId,journal_line_id:journalLineId,ledger_line_id:ledgerLineId,revision:0,idempotent:false};}
    },
    maker:{async createApPayment(args){calls.push(['payment',args]);return {payment_occurrence_id:paymentOccurrenceId,journal_entry_id:journalEntryId,business_document_id:businessDocumentId};}},
    submitter:{async transitionJournal(args){calls.push(['submit',args]);return {status:'PENDING_REVIEW'};}},
    reviewer:{async transitionJournal(args){calls.push(['review',args]);return {status:'PENDING_APPROVAL'};}},
    approver:{async transitionJournal(args){calls.push(['approve',args]);return {status:'APPROVED'};}},
    poster:{async postJournal(args){calls.push(['post',args]);return {journal_entry_id:journalEntryId};}}
  };
  const service=createControlledTestBankMatchService({scope,authorize:async args=>calls.push(['authorize',args]),kernelForActor:actor=>kernels[Object.entries(actors).find(([,value])=>value===actor)?.[0]]});
  return {service,calls};
}

const input={tenantId,entityId,reason:'Create exact isolated test match',idempotencyKey:'isolated-bank-match-001'};

test('posts one exact AP payment through six actors before creating one Bank Match',async()=>{
  const {service,calls}=harness();
  const result=await service.run(input);
  assert.deepEqual(result,{status:'CONTROLLED_TEST_BANK_MATCH_ACTIVE',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:false,period_id:periodId,bank_account_ref:'WBS_TEST_BANK',bank_source_id:bankSourceId,business_document_id:businessDocumentId,payment_amount:'100.0000',currency:'USD',payment_occurrence_id:paymentOccurrenceId,journal_entry_id:journalEntryId,journal_line_id:journalLineId,ledger_line_id:ledgerLineId,bank_match_id:bankMatchId,revision:0});
  assert.deepEqual(calls.map(([name])=>name),['authorize','resolve','payment','submit','review','approve','post','candidates','match']);
  const payment=calls.find(([name])=>name==='payment')[1];
  assert.equal(payment.bankMemberRef,'WBS_TEST_BANK');assert.equal(payment.cashAccountCode,'111000');assert.equal(payment.amount,'100.0000');
  assert.match(payment.paymentNumber,/^WBS-MATCH-[0-9a-f]{32}$/);assert.equal(payment.idempotencyKey,`wbs-test-bank-match:${bankSourceId}:payment`);assert.ok(!payment.paymentNumber.includes(input.idempotencyKey));
  for(const [name,args] of calls.filter(([name])=>['submit','review','approve','post','match'].includes(name)))assert.equal(args.idempotencyKey,`wbs-test-bank-match:${bankSourceId}:${name}`);
  assert.deepEqual(calls.filter(([name])=>['submit','review','approve'].includes(name)).map(([,args])=>[args.action,args.expectedRevision]),[['SUBMIT',0],['REVIEW',1],['APPROVE',2]]);
});

test('replays an existing exact active match without new workflow or match commands',async()=>{
  const resolved=fixture({active_bank_match_id:bankMatchId,active_payment_occurrence_id:paymentOccurrenceId,active_journal_entry_id:journalEntryId,active_journal_line_id:journalLineId,active_ledger_line_id:ledgerLineId,active_match_revision:0});
  const {service,calls}=harness({resolved});const result=await service.run(input);
  assert.equal(result.idempotent,true);assert.equal(result.bank_match_id,bankMatchId);
  assert.deepEqual(calls.map(([name])=>name),['authorize','resolve','payment']);
});

test('fails closed on cross-scope, unsafe fixture, ambiguous candidate, or conflicting active match',async()=>{
  await assert.rejects(harness().service.run({...input,entityId:id(99)}),error=>error.code==='CONTROLLED_TEST_BANK_MATCH_SELECTION_INVALID');
  await assert.rejects(harness({resolved:fixture({bank_account_ref:'WBS_TEST_BANK_2026_01'})}).service.run(input),error=>error.code==='CONTROLLED_TEST_BANK_MATCH_FIXTURE_INVALID');
  await assert.rejects(harness({candidateCount:0}).service.run(input),error=>error.code==='CONTROLLED_TEST_BANK_MATCH_CANDIDATE_INVALID');
  const conflict=fixture({active_bank_match_id:bankMatchId,active_payment_occurrence_id:id(90),active_journal_entry_id:journalEntryId,active_journal_line_id:journalLineId,active_ledger_line_id:ledgerLineId,active_match_revision:0});
  await assert.rejects(harness({resolved:conflict}).service.run(input),error=>error.code==='CONTROLLED_TEST_BANK_MATCH_CONFLICT');
});
