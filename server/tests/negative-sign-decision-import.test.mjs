// R09: the negative-amount decision sheet validator. No database, no real data: every identity is
// a synthetic sha256, every amount is an aggregate invented for the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  DECISION_SCHEMA, DECISION_OPTIONS, UNDECIDED,
  validateDecisionSheet, decisionPermits, allowedActions, decimalSum,
} from '../runtime/negative-sign-decision-import.mjs';

const id=s=>`sha256:${createHash('sha256').update(String(s)).digest('hex')}`;
const entry=(over={})=>({
  source_category:'PAYABLE_ADJUSTMENT',stable_id_hash:id(over.stable_id_hash??'a'),company_code:'C001',period_code:'2026-03',currency:'USD',
  row_count:10,amount_sign:'NEGATIVE',absolute_total:'12345.6700',risk:'HIGH',
  candidate_meaning:'CREDIT_NOTE_FROM_VENDOR',candidate_rationale:'evidence pack E-12',
  debit_effect:'291001',credit_effect:'610000',evidence_ref:'E-12',
  prepared_by:'preparer-1',prepared_at:'2026-09-24T08:00:00Z',approver:'approver-1',
  decided_meaning:UNDECIDED,decided_at:null,decision_reason:null,exception:null,
  ...over,stable_id_hash:over.stable_id_hash?id(over.stable_id_hash):id('a'),
});
const decided=(over={})=>entry({decided_meaning:'CREDIT_NOTE_FROM_VENDOR',decided_at:'2026-09-24T09:00:00Z',
  decision_reason:'Vendor credit note confirmed by controller; see evidence pack E-12.',
  decision_evidence:{vendor_member_ref:'VENDOR-0001',credit_evidence_ref:'E-12'},...over});
const sheet=(entries,extra={})=>({schema_version:DECISION_SCHEMA,entries,...extra});

test('NSD-1: an undecided entry is an exception, never a decision, and permits no draft',()=>{
  const r=validateDecisionSheet(sheet([entry()]));
  assert.equal(r.ok,true);
  assert.deepEqual(r.accepted,[]);
  assert.equal(r.exceptions.length,1);
  assert.equal(r.exceptions[0].reason,'UNDECIDED');
  for(const action of ['CREATE_AP_PAYMENT_DRAFT','CREATE_REVERSAL_DRAFT','CREATE_AP_VENDOR_CREDIT_DRAFT','CREATE_NEGATIVE_PAYABLE_DRAFT','POST','APPROVE_MAPPING'])
    assert.equal(decisionPermits(UNDECIDED,action),false,action);
  assert.equal(decisionPermits(UNDECIDED,'ROUTE_TO_EXCEPTION_QUEUE'),true);
});

test('NSD-2: a complete sign-off is accepted with exactly the actions its meaning allows',()=>{
  const r=validateDecisionSheet(sheet([decided()]));
  assert.equal(r.ok,true);
  assert.equal(r.accepted.length,1);
  assert.deepEqual(r.accepted[0].allowed_actions,['CREATE_AP_VENDOR_CREDIT_DRAFT']);
  assert.equal(decisionPermits('CREDIT_NOTE_FROM_VENDOR','CREATE_AP_VENDOR_CREDIT_DRAFT'),true);
  assert.equal(decisionPermits('CREDIT_NOTE_FROM_VENDOR','CREATE_AP_PAYMENT_DRAFT'),false,'a credit note must not be treated as a payment');
});

test('NSD-3: POST is never permitted by any decision, and unknown meanings permit nothing',()=>{
  for(const meaning of Object.keys(DECISION_OPTIONS))assert.equal(decisionPermits(meaning,'POST'),false,meaning);
  assert.equal(decisionPermits('SOMETHING_NEW','CREATE_AP_PAYMENT_DRAFT'),false);
  assert.deepEqual(allowedActions('SOMETHING_NEW'),allowedActions(UNDECIDED),'unknown falls back to the undecided allowance');
  for(const meaning of Object.keys(DECISION_OPTIONS))assert.ok(!DECISION_OPTIONS[meaning].allows.includes('POST'));
});

test('NSD-4: four eyes -- approver must differ from preparer; a decision needs a reason, a date and its evidence',()=>{
  const same=validateDecisionSheet(sheet([decided({approver:'preparer-1'})]));
  assert.match(same.exceptions[0].problems.join('\n'),/must differ from prepared_by/);
  const noReason=validateDecisionSheet(sheet([decided({decision_reason:'short'})]));
  assert.match(noReason.exceptions[0].problems.join('\n'),/decision_reason: 8-2000/);
  const noDate=validateDecisionSheet(sheet([decided({decided_at:null})]));
  assert.match(noDate.exceptions[0].problems.join('\n'),/decided_at: required/);
  const noEvidence=validateDecisionSheet(sheet([decided({decision_evidence:{vendor_member_ref:'VENDOR-0001'}})]));
  assert.match(noEvidence.exceptions[0].problems.join('\n'),/decision_evidence\.credit_evidence_ref/);
  const dateWhileUndecided=validateDecisionSheet(sheet([entry({decided_at:'2026-09-24T09:00:00Z'})]));
  assert.match(dateWhileUndecided.exceptions[0].problems.join('\n'),/must be null while decided_meaning is UNDECIDED/);
});

test('NSD-5: each meaning enforces its own prerequisite and ledger effect',()=>{
  const rev=validateDecisionSheet(sheet([decided({decided_meaning:'REVERSAL_OF_PRIOR_ACCRUAL',debit_effect:'610000',credit_effect:'291001',decision_evidence:{}})]));
  assert.match(rev.exceptions[0].problems.join('\n'),/original_journal_ref/,'a reversal must name the original journal');
  const neg=validateDecisionSheet(sheet([decided({decided_meaning:'NEGATIVE_PAYABLE_ACCRUAL',debit_effect:'610000',credit_effect:'291001',decision_evidence:{}})]));
  assert.match(neg.exceptions[0].problems.join('\n'),/owner_written_confirmation_ref/,'the riskiest reading needs written Owner confirmation');
  const err=validateDecisionSheet(sheet([decided({decided_meaning:'SOURCE_DATA_ERROR',decision_evidence:{wbs_correction_ref:'WBS-CR-9'}})]));
  assert.match(err.exceptions[0].problems.join('\n'),/has no ledger effect; leave debit\/credit empty/);
  const errOk=validateDecisionSheet(sheet([decided({decided_meaning:'SOURCE_DATA_ERROR',debit_effect:null,credit_effect:null,decision_evidence:{wbs_correction_ref:'WBS-CR-9'}})]));
  assert.equal(errOk.accepted.length,1);
  assert.deepEqual(errOk.accepted[0].allowed_actions,['ROUTE_TO_EXCEPTION_QUEUE']);
  assert.equal(decisionPermits('SOURCE_DATA_ERROR','FLIP_SIGN'),false,'REFS never flips a sign on its own');
  const pay=validateDecisionSheet(sheet([decided({decided_meaning:'PAYMENT_OR_SETTLEMENT',debit_effect:'111000',credit_effect:'111000',decision_evidence:{matched_payable_ref:'BILL-1',bank_member_ref:'BANK-1'}})]));
  assert.match(pay.exceptions[0].problems.join('\n'),/debit_effect: PAYMENT_OR_SETTLEMENT debits 291001/);
});

test('NSD-6: risk is derived, not chosen -- negatives are at least HIGH, |amount| >= 1,000,000 is CRITICAL',()=>{
  const low=validateDecisionSheet(sheet([entry({risk:'LOW'})]));
  assert.match(low.exceptions[0].problems.join('\n'),/never below HIGH/);
  const big=validateDecisionSheet(sheet([entry({absolute_total:'1000000.0000',risk:'HIGH'})]));
  assert.match(big.exceptions[0].problems.join('\n'),/must be CRITICAL/);
  const bigOk=validateDecisionSheet(sheet([entry({absolute_total:'1000000.0000',risk:'CRITICAL'})]));
  assert.equal(bigOk.exceptions[0].reason,'UNDECIDED','no other problem');
});

test('NSD-7: control totals cover the whole sheet, and a mismatch rejects every entry, including valid ones',()=>{
  const entries=[decided({stable_id_hash:'x',row_count:70,absolute_total:'24000000.0000',risk:'CRITICAL'}),entry({stable_id_hash:'y',row_count:5,absolute_total:'343397.2400'})];
  const short=validateDecisionSheet(sheet(entries),{expectedRowCount:76,expectedAbsoluteTotal:'24343397.2400'});
  assert.equal(short.ok,false);
  assert.match(short.sheetProblems.join('\n'),/row_count sums to 75, expected 76/);
  assert.deepEqual(short.accepted,[],'a sheet with a missing group accepts nothing');
  assert.deepEqual(short.exceptions.map(e=>e.reason),['SHEET_INVALID','UNDECIDED']);
  const full=validateDecisionSheet(sheet([entries[0],entry({stable_id_hash:'y',row_count:6,absolute_total:'343397.2400'})]),{expectedRowCount:76,expectedAbsoluteTotal:'24343397.2400'});
  assert.equal(full.ok,true);
  assert.equal(full.accepted.length,1);
  assert.deepEqual(full.controlTotals,{row_count:76,absolute_total:'24343397.2400',expected_row_count:76,expected_absolute_total:'24343397.2400',row_count_matches:true,absolute_total_matches:true});
});

test('NSD-8: identity is a hash, duplicates are rejected, and payload-looking text is refused',()=>{
  const bad=validateDecisionSheet(sheet([{...entry(),stable_id_hash:'INV-2026-0001'}]));
  assert.match(bad.exceptions[0].problems.join('\n'),/must be sha256:<64 hex>/);
  const dup=validateDecisionSheet(sheet([entry(),entry()]));
  assert.match(dup.exceptions[1].problems.join('\n'),/duplicates entries\[0\]/);
  const smell=validateDecisionSheet(sheet([entry({candidate_rationale:'Invoice #4471 from Acme Roofing LLC for repairs'})]));
  assert.match(smell.exceptions[0].problems.join('\n'),/looks like transaction payload/);
});

test('NSD-9: the shipped template is itself rejected (placeholder row), so it can never be imported as-is',()=>{
  const template=JSON.parse(readFileSync(new URL('../templates/negative-amount-sign-decision.template.json',import.meta.url),'utf8'));
  const r=validateDecisionSheet(template,{expectedRowCount:76,expectedAbsoluteTotal:'24343397.2400'});
  assert.equal(r.ok,false);
  assert.match(r.sheetProblems.join('\n'),/template placeholder row/);
  assert.deepEqual(r.accepted,[]);
});

test('NSD-10: decimal sums are exact',()=>{
  assert.equal(decimalSum(['0.1000','0.2000']),'0.3000');
  assert.equal(decimalSum(['24000000.0000','343397.2400']),'24343397.2400');
  assert.equal(decimalSum([]),'0.0000');
});
