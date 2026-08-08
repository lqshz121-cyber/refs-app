import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWbsAutoReconciliationReviewPlan} from '../runtime/wbs-inbound-data-adapter.mjs';

const hash='sha256:'+'a'.repeat(64);
const staged=({id,amount=100,direction,company='COMPANY-A',currency='USD',account='BANK-1',date='2026-08-09',type})=>({receipt_id:`receipt-${id}`,receipt_ref:`object://receipt/${id}`,receipt_hash:hash,raw_event_id:`raw-${id}`,source_document_id:`doc-${id}`,staging_item_id:`staging-${id}`,source_record_id:id,source_version:'v1',company_key:company,currency,amount,business_date:date,accounting_date:date,bank_account_ref:account,direction,review_event_id:`review-${id}`,stage:'STAGING_REVIEWED',source_type:type});
const bank=(id,amount,date)=>staged({id,amount,direction:'CREDIT',date,type:'BANK_TRANSACTION'});
const payable=(id,amount,date,options={})=>staged({id,amount,direction:'DEBIT',date,type:'PAYABLE',...options});
const run=(banks,businesses,options)=>buildWbsAutoReconciliationReviewPlan({bankRows:banks,businessRows:businesses,...options});

test('twelve sanitized golden scenarios express WBS→AutoRec controls without granting allocation or posting authority',()=>{
  const cases=[
    ['exact_one_to_one',run([bank('b1',100)],[payable('p1',100)]),plan=>plan.status==='REVIEW_REQUIRED'&&plan.allocation_plan.length===1&&plan.control_totals.allocated_total===100],
    ['one_bank_to_two_payables',run([bank('b1',100)],[payable('p1',40),payable('p2',60)]),plan=>plan.status==='REVIEW_REQUIRED'&&plan.allocation_plan.length===2],
    ['two_banks_to_one_payable',run([bank('b1',40),bank('b2',60)],[payable('p1',100)]),plan=>plan.status==='REVIEW_REQUIRED'&&plan.allocation_plan.length===2],
    ['partial_match_requires_review',run([bank('b1',150)],[payable('p1',100)]),plan=>plan.status==='PARTIAL_REVIEW_REQUIRED'&&plan.control_totals.bank_unallocated===50],
    ['amount_tolerance',run([bank('b1',100)],[payable('p1',100.005)],{tolerance:0.01}),plan=>plan.status==='REVIEW_REQUIRED'&&plan.control_totals.difference===0.005],
    ['date_tolerance',run([bank('b1',100,'2026-08-09')],[payable('p1',100,'2026-08-11')],{dateWindowDays:2}),plan=>plan.status==='REVIEW_REQUIRED'],
    ['cross_company_blocked',run([bank('b1',100)],[payable('p1',100,undefined,{company:'COMPANY-B'})]),plan=>plan.status==='BLOCKED'&&plan.exceptions[0].code==='WBS_AUTOREC_PLAN_SCOPE_MISMATCH'],
    ['cross_currency_blocked',run([bank('b1',100)],[payable('p1',100,undefined,{currency:'CAD'})]),plan=>plan.status==='BLOCKED'&&plan.exceptions[0].code==='WBS_AUTOREC_PLAN_SCOPE_MISMATCH'],
    ['bank_account_blocked',run([bank('b1',100)],[payable('p1',100,undefined,{account:'BANK-2'})]),plan=>plan.status==='BLOCKED'],
    ['date_outside_window_blocked',run([bank('b1',100,'2026-08-01')],[payable('p1',100,'2026-08-09')],{dateWindowDays:3}),plan=>plan.status==='BLOCKED'&&plan.exceptions[0].code==='WBS_AUTOREC_PLAN_DATE_WINDOW_MISMATCH'],
    ['missing_receipt_blocked',run([{...bank('b1',100),receipt_hash:''}],[payable('p1',100)]),plan=>plan.status==='BLOCKED'&&plan.exceptions[0].code==='WBS_AUTOREC_PLAN_TRACE_REQUIRED'],
    ['same_direction_blocked',run([bank('b1',100)],[{...payable('p1',100),direction:'CREDIT'}]),plan=>plan.status==='BLOCKED'&&plan.exceptions[0].code==='WBS_AUTOREC_PLAN_DIRECTION_MISMATCH']
  ];
  assert.equal(cases.length,12);
  for(const [name,plan,assertion] of cases){assert.ok(assertion(plan),name);assert.equal(plan.controls.can_allocate,false,name);assert.equal(plan.controls.can_post,false,name);}
});

test('a review proposal never counts one WBS source twice or mixes its versions',()=>{
  const duplicate=run([bank('b1',100),bank('b1',100)],[payable('p1',200)]);
  assert.equal(duplicate.status,'BLOCKED');
  assert.equal(duplicate.allocation_plan.length,0);
  assert.equal(duplicate.exceptions[0].code,'WBS_AUTOREC_PLAN_SOURCE_DUPLICATE');

  const mixedVersion=run([bank('b1',100),{...bank('b1',100),source_version:'v2'}],[payable('p1',200)]);
  assert.equal(mixedVersion.status,'BLOCKED');
  assert.equal(mixedVersion.allocation_plan.length,0);
  assert.ok(mixedVersion.exceptions.some(exception=>exception.code==='WBS_AUTOREC_PLAN_SOURCE_VERSION_AMBIGUOUS'));
});
