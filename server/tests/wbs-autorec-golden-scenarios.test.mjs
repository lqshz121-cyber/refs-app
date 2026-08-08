import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildWbsAutoReconciliationReviewPlan,buildReceiptBoundWbsAutoReconciliationReviewPlan} from '../runtime/wbs-inbound-data-adapter.mjs';
import {projectObservedWbsAutoRecControlEvidence} from '../runtime/wbs-inbound-autorec-projection.mjs';

const hash='sha256:'+'a'.repeat(64);
const staged=({id,amount=100,direction,company='COMPANY-A',currency='USD',account='BANK-1',date='2026-08-09',type})=>({receipt_id:`receipt-${id}`,receipt_ref:`object://receipt/${id}`,receipt_hash:hash,raw_event_id:`raw-${id}`,source_document_id:`doc-${id}`,staging_item_id:`staging-${id}`,source_record_id:id,source_version:'v1',company_key:company,currency,amount,business_date:date,accounting_date:date,bank_account_ref:account,direction,review_event_id:`review-${id}`,stage:'STAGING_REVIEWED',source_type:type});
const bank=(id,amount,date)=>staged({id,amount,direction:'CREDIT',date,type:'BANK_TRANSACTION'});
const payable=(id,amount,date,options={})=>staged({id,amount,direction:'DEBIT',date,type:'PAYABLE',...options});
const run=(banks,businesses,options)=>buildWbsAutoReconciliationReviewPlan({bankRows:banks,businessRows:businesses,...options});
const policy={policy_id:'policy-bank-1',version:'1',mapping_id:'matching-policy-map',mapping_version:'4',rule_id:'amount-date-rule',rule_version:'2',bank_mapping_id:'bank-map',bank_mapping_version:'3',business_mapping_id:'payable-map',business_mapping_version:'5',status:'APPROVED',company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',amount_tolerance:'0.0100',date_window_days:2,receipt_id:'policy-receipt-1',receipt_ref:'object://receipt/policy-1',receipt_hash:hash};
const goldenArtifact=JSON.parse(readFileSync(new URL('../contracts/wbs-autorec-golden-scenarios-v1.json',import.meta.url),'utf8'));

test('provider-backed review plan uses one approved receipt-bound matching policy, never caller matching parameters',()=>{
  const matchedBank={...bank('b-rule',100,'2026-08-09'),mapping_id:'bank-map',mapping_version:'3'};
  const matchedPayable={...payable('p-rule',100.005,'2026-08-11'),mapping:{mapping_id:'payable-map',mapping_version:'5'}};
  const plan=buildReceiptBoundWbsAutoReconciliationReviewPlan({bankRows:[matchedBank],businessRows:[matchedPayable],matchingPolicy:policy,tolerance:999,dateWindowDays:999});
  assert.equal(plan.status,'REVIEW_REQUIRED');
  assert.equal(plan.control_totals.tolerance,0.01);
  assert.equal(plan.trace.length,1);
  assert.deepEqual(plan.matching_policy,{policy_id:'policy-bank-1',version:'1',mapping_id:'matching-policy-map',mapping_version:'4',rule_id:'amount-date-rule',rule_version:'2',bank_mapping_id:'bank-map',bank_mapping_version:'3',business_mapping_id:'payable-map',business_mapping_version:'5',receipt_id:'policy-receipt-1',receipt_ref:'object://receipt/policy-1',receipt_hash:hash});
  assert.equal(plan.controls.matching_policy_required,true);
  const missing=buildReceiptBoundWbsAutoReconciliationReviewPlan({bankRows:[bank('b-missing',100)],businessRows:[payable('p-missing',100)]});
  const crossScope=buildReceiptBoundWbsAutoReconciliationReviewPlan({bankRows:[{...bank('b-cross',100),mapping_id:'bank-map',mapping_version:'3'}],businessRows:[{...payable('p-cross',100),mapping_id:'payable-map',mapping_version:'5'}],matchingPolicy:{...policy,currency:'CAD'}});
  const mappingMismatch=buildReceiptBoundWbsAutoReconciliationReviewPlan({bankRows:[{...bank('b-map',100),mapping_id:'wrong',mapping_version:'3'}],businessRows:[{...payable('p-map',100),mapping_id:'payable-map',mapping_version:'5'}],matchingPolicy:policy});
  assert.equal(missing.status,'BLOCKED');assert.equal(crossScope.status,'BLOCKED');
  assert.equal(missing.exceptions[0].code,'WBS_AUTOREC_MATCHING_POLICY_REQUIRED');
  assert.equal(crossScope.allocation_plan.length,0);
  assert.equal(mappingMismatch.exceptions[0].code,'WBS_AUTOREC_MATCHING_POLICY_MAPPING_MISMATCH');
});

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

test('required WBS golden matrix retains the twelve accounting-boundary scenarios',()=>{
  const control={company_key:'COMPANY-A',user_ref:'MASKED',completed_match_period:'M:08/2026',completed_release_period:'R:08/2026',completed_incur_period:'C:08/2026',quantity:1,released_quantity:0,incurred_quantity:0,amount:'100.0000',released_amount:'0.0000',incurred_amount:'0.0000',reconciliation_balance:'100.0000',new_balance:'100.0000',balance_date:'2026-08-09'};
  const receipt={receipt_id:'receipt-control',receipt_ref:'object://receipt/control',receipt_hash:hash,source_record_id:'control-1',source_version:'v1'};
  const released={detail_kind:'RELEASED_PAYMENT',company_key:'COMPANY-A',...receipt,posting_date:'2026-08-09',payment:'100.0000',reviewer:'Reviewer'};
  const journal={detail_kind:'JE_TRACE',company_key:'COMPANY-A',...receipt,source_record_id:'journal-291001',posting_date:'2026-08-09',journal_no:'AUTOC-1',account_code:'291001',debit:'100.0000',credit:'100.0000',review_status:'REVIEWED',approval_status:'APPROVED',posting_status:'POSTED'};
  const cases=[
    ['exact_match',()=>run([bank('b-exact',100)],[payable('p-exact',100)]).status==='REVIEW_REQUIRED'],
    ['partial_match',()=>run([bank('b-partial',150)],[payable('p-partial',100)]).control_totals.bank_unallocated===50],
    ['one_to_many',()=>run([bank('b-one-many',100)],[payable('p-many-1',40),payable('p-many-2',60)]).allocation_plan.length===2],
    ['many_to_one',()=>run([bank('b-many-1',40),bank('b-many-2',60)],[payable('p-one',100)]).allocation_plan.length===2],
    ['cross_company_block',()=>run([bank('b-company',100)],[payable('p-company',100,undefined,{company:'COMPANY-B'})]).status==='BLOCKED'],
    ['amount_and_date_tolerance',()=>run([bank('b-tol',100,'2026-08-09')],[payable('p-tol',100.005,'2026-08-11')],{tolerance:0.01,dateWindowDays:2}).status==='REVIEW_REQUIRED'],
    ['duplicate_replay_block',()=>run([bank('b-replay',100),bank('b-replay',100)],[payable('p-replay',200)]).status==='BLOCKED'],
    ['cancel_or_reopen_never_follows_wbs_released_state',()=>{const detail=projectObservedWbsAutoRecControlEvidence({companyRows:[control],detailRows:[released]}).details[0];return detail.observed_state==='RELEASED'&&detail.can_transition_state===false&&detail.can_post===false;}],
    ['nul_company_isolation',()=>{const plan=run([bank('b-nul',100)],[payable('p-nul',100,undefined,{company:'NUL'})]);return plan.status==='BLOCKED'&&plan.exceptions.some(item=>item.code==='WBS_AUTOREC_PLAN_SCOPE_MISMATCH');}],
    ['invalid_2064_date_quarantined',()=>run([bank('b-date','100','2064-02-30')],[payable('p-date',100,'2064-02-30')]).status==='BLOCKED'],
    ['291001_trace_is_evidence_not_posting',()=>{const detail=projectObservedWbsAutoRecControlEvidence({companyRows:[control],detailRows:[journal]}).details[0];return detail.observed_fields.account_code==='291001'&&detail.can_post===false&&detail.can_transition_state===false;}],
    ['report_as_source_blocked',()=>run([{...bank('control-only',100),source_type:'AUTOREC_BANK_CONTROL'}],[payable('p-report',100)]).status==='BLOCKED']
  ];
  assert.equal(cases.length,12);
  for(const [name,assertion] of cases)assert.ok(assertion(),name);
});

test('golden acceptance artifact has twelve sanitized source-to-target controls and bidirectional trace requirements',()=>{
  assert.equal(goldenArtifact.contract,'WBS_AUTOREC_GOLDEN_SCENARIOS_V1');
  assert.equal(goldenArtifact.classification,'SANITIZED_LOCAL_ACCEPTANCE_EVIDENCE');
  const required=new Set(['exact_one_to_one','partial_match','one_to_many','many_to_one','amount_and_date_tolerance','cross_company_block','duplicate_replay_block','reopen_boundary','nul_company_isolation','invalid_2064_date_quarantined','posted_291001_trace','report_as_source_blocked']);
  assert.equal(goldenArtifact.scenarios.length,required.size);
  for(const scenario of goldenArtifact.scenarios){
    assert.ok(required.delete(scenario.id),scenario.id);
    assert.ok(Object.keys(scenario.input).length>0,`${scenario.id} input`);
    assert.ok(Object.keys(scenario.expected).length>0,`${scenario.id} expected controls`);
    assert.ok(scenario.forward_trace.includes('receipt')||scenario.forward_trace.includes('control_receipt')||scenario.forward_trace.includes('policy_receipt'),`${scenario.id} forward receipt trace`);
    assert.ok(scenario.reverse_trace.includes('receipt_hash')||scenario.reverse_trace.includes('control_receipt')||scenario.reverse_trace.includes('policy_receipt'),`${scenario.id} reverse receipt trace`);
    assert.equal(JSON.stringify(scenario),JSON.stringify(scenario).replace(/(?:token|cookie|password|secret)/gi,'redacted'),`${scenario.id} may not contain sensitive locator keys`);
  }
  const reports=goldenArtifact.scenarios.find(scenario=>scenario.id==='report_as_source_blocked');
  assert.deepEqual(reports.input.source_types,['COST_GENERAL_LEDGER','PROPERTY_COMPARISON']);
  assert.deepEqual(reports.expected.allowed_control_statuses,['RECONCILED','DIFFERENCE']);
  for(const trace of ['wbs_control_snapshot','approved_mapping','refs_metric_snapshot'])assert.ok(reports.forward_trace.includes(trace),`report forward ${trace}`);
  for(const trace of ['refs_metric_snapshot','wbs_control_snapshot'])assert.ok(reports.reverse_trace.includes(trace),`report reverse ${trace}`);
  assert.equal(required.size,0);
});
