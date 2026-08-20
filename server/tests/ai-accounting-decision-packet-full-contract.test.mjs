import test from 'node:test';
import assert from 'node:assert/strict';
import {AI_ACCOUNTING_CLASSIFICATIONS,AI_ACCOUNTING_SOURCE_TYPES,assertAiAccountingSourceV1,buildAiAccountingDecisionPacketFullV1} from '../runtime/ai-accounting-decision-packet-full-contract.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=n=>`sha256:${String(n).repeat(64).slice(0,64)}`;
const scope={tenantId:id(1),entityId:id(2),accountingPeriodId:id(3)};
const details={
  INVOICE:{invoice_date:'2026-07-15',invoice_number:'INV-7',service_period_end:'2026-07-31',service_period_start:'2026-07-01'},
  PAYMENT:{bank_transaction_id:id(20),payee_ref:'VENDOR-7',payment_date:'2026-07-16'},
  LOAN_TRANSACTION:{lender_ref:'LENDER-1',loan_ref:'LOAN-1',transaction_kind:'DRAW'},
  REVENUE:{customer_ref:'TENANT-1',performance_period_end:'2026-07-31',performance_period_start:'2026-07-01',revenue_kind:'RENT'},
  DEPOSIT:{deposit_kind:'SECURITY_DEPOSIT',lease_ref:'LEASE-1',tenant_ref:'TENANT-1'},
  INTERCOMPANY:{counterparty_company_code:'WBPB',counterparty_entity_id:id(21),intercompany_kind:'DUE_TO'},
  REIMBURSEMENT:{beneficiary_ref:'EMPLOYEE-1',original_source_document_id:id(22),reimbursement_kind:'PROJECT_COST'}
};
const source=(source_type='INVOICE',overrides={})=>({schema_version:'AI_ACCOUNTING_SOURCE_V1',tenant_id:scope.tenantId,entity_id:scope.entityId,company_code:'WBPA',accounting_period_id:scope.accountingPeriodId,business_date:'2026-07-15',accounting_date:'2026-07-15',currency:'USD',amount:'100.0000',source_document_id:id(4),source_document_line_id:id(5),source_payload_hash:hash(1),source_line_hash:hash(2),source_type,project_ref:null,property_ref:null,vendor_ref:source_type==='INVOICE'?'VENDOR-7':null,member_ref:null,cost_code_ref:null,completeness_status:'COMPLETE',duplicate_status:'NONE',admission_status:'ADMITTED',exception_codes:[],source_detail:details[source_type],...overrides});
const traces=['ACCOUNT','CLASSIFICATION','MATERIALITY','APPROVAL','REPORT'].map((policy_type,index)=>({policy_type,snapshot_id:id(30+index),version:1,snapshot_hash:hash(3+index),rule_id:`${policy_type}_RULE_V1`}));
const risk={risk_level:'MEDIUM',policy_rule_id:'RISK_POLICY_V1',materiality_threshold:'50.0000',approval_threshold:'500.0000',confidence_floor:.9,threshold_comparison:'AT_OR_ABOVE_MATERIALITY'};
const line=(line_number,side,account_code,amount='100.0000')=>({line_number,side,account_code,account_class:side==='DEBIT'?'EXPENSE':'LIABILITY',account_type:side==='DEBIT'?'OPERATING_EXPENSE':'ACCOUNTS_PAYABLE',amount,currency:'USD',project_ref:null,property_ref:null,member_ref:null,cost_code_ref:null,dimension_requirements:[],source_document_id:id(4),source_document_line_id:id(5),source_line_hash:hash(2)});
const delta=(statement='INCOME_STATEMENT')=>({statement,accounting_period_id:scope.accountingPeriodId,account_code:'610000',account_class:'EXPENSE',direction:'INCREASE',amount:'100.0000',currency:'USD',project_ref:null,property_ref:null,member_ref:null,cost_code_ref:null,source_document_line_id:id(5)});
const input=(overrides={})=>({ ...scope,source:source(),classification:'EXPENSE',ruleId:'EXPENSE_POLICY_V1',reason:'Approved policy classifies this complete admitted invoice as current-period expense.',confidence:.94,risk,requiredHumanFields:['controller_conclusion'],policyTraces:traces,proposedJournal:{status:'SUGGESTED_ONLY',balanced:true,reversal_policy:'NONE',lines:[line(1,'DEBIT','610000'),line(2,'CREDIT','211000')]},expectedReportDeltas:[delta()],...overrides});

test('accepts every closed source variant with common scope, date, lineage, and control fields',()=>{
  assert.deepEqual(AI_ACCOUNTING_SOURCE_TYPES,Object.keys(details));
  for(const type of AI_ACCOUNTING_SOURCE_TYPES)assert.equal(assertAiAccountingSourceV1(source(type),scope).source_type,type);
  for(const unsafe of [{vendor_ref:'VENDOR-7',source_type:'PAYMENT',source_detail:details.PAYMENT,raw_package:{}},{admission_status:'NOT_ADMITTED'},{duplicate_status:'POSSIBLE'},{completeness_status:'INCOMPLETE'},{company_code:''}]){
    if(Object.hasOwn(unsafe,'raw_package'))assert.throws(()=>assertAiAccountingSourceV1({...source('PAYMENT'),...unsafe},scope),error=>error.code==='AI_ACCOUNTING_SOURCE_INVALID');
  }
});

test('supports the ten required accounting classifications without granting actions',()=>{
  assert.deepEqual(AI_ACCOUNTING_CLASSIFICATIONS,['EXPENSE','CAPITALIZATION','PREPAID','ACCRUAL','LOAN','REVENUE','DEPOSIT','INTERCOMPANY','REIMBURSEMENT','BLOCKED']);
  for(const classification of AI_ACCOUNTING_CLASSIFICATIONS.filter(value=>value!=='BLOCKED')){
    const packet=buildAiAccountingDecisionPacketFullV1(input({classification}));
    assert.equal(packet.classification,classification);assert.equal(packet.proposed_journal.status,'SUGGESTED_ONLY');assert.deepEqual(packet.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  }
});

test('accepts balanced 2..N lines and exact monetary report deltas',()=>{
  const packet=buildAiAccountingDecisionPacketFullV1(input({proposedJournal:{status:'SUGGESTED_ONLY',balanced:true,reversal_policy:'NONE',lines:[line(1,'DEBIT','610000','60.0000'),line(2,'DEBIT','620000','40.0000'),line(3,'CREDIT','211000','100.0000')]},expectedReportDeltas:[delta(),{...delta('BALANCE_SHEET'),account_code:'211000',account_class:'LIABILITY'}]}));
  assert.equal(packet.proposed_journal.lines.length,3);assert.equal(Object.isFrozen(packet.source),true);assert.equal(Object.isFrozen(packet.policy_traces[0]),true);
  for(const bad of [
    {status:'SUGGESTED_ONLY',balanced:true,reversal_policy:'NONE',lines:[line(1,'DEBIT','610000'),line(2,'CREDIT','211000','99.0000')]},
    {status:'SUGGESTED_ONLY',balanced:true,reversal_policy:'NONE',lines:[line(1,'DEBIT','610000')]}
  ])assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({proposedJournal:bad})),error=>error.code==='AI_ACCOUNTING_SUGGESTED_JOURNAL_INVALID');
});

test('incomplete, duplicate, unadmitted, or excepted sources are EXCEPTION with zero effects',()=>{
  for(const override of [{completeness_status:'INCOMPLETE'},{duplicate_status:'POSSIBLE'},{admission_status:'QUARANTINED'},{exception_codes:['MISSING_ENTITY']}]){
    const src=source('INVOICE',override),packet=buildAiAccountingDecisionPacketFullV1(input({source:src,classification:'BLOCKED',proposedJournal:{status:'SUGGESTED_ONLY',balanced:false,reversal_policy:'NONE',lines:[]},expectedReportDeltas:[]}));
    assert.equal(packet.status,'EXCEPTION');assert.deepEqual(packet.proposed_journal.lines,[]);assert.deepEqual(packet.expected_report_deltas,[]);
  }
});

test('risk must be backed by approved materiality and approval policy traces',()=>{
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({policyTraces:traces.filter(trace=>trace.policy_type!=='MATERIALITY')})),error=>error.code==='AI_ACCOUNTING_DECISION_POLICY_INVALID');
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({risk:{...risk,materiality_threshold:'hardcoded'}})),error=>error.code==='AI_ACCOUNTING_DECISION_POLICY_INVALID');
});

test('prepaid schedule and accrual reversal policies retain their exact supporting trace',()=>{
  const prepaid=buildAiAccountingDecisionPacketFullV1(input({classification:'PREPAID',reversalPolicy:'AMORTIZATION_SCHEDULE',proposedJournal:{status:'SUGGESTED_ONLY',balanced:true,reversal_policy:'AMORTIZATION_SCHEDULE',lines:[line(1,'DEBIT','141000'),line(2,'CREDIT','211000')]},amortizationScheduleTrace:{schedule_id:id(40),schedule_hash:hash(9)}}));
  assert.equal(prepaid.amortization_schedule_trace.schedule_id,id(40));
  const accrual=buildAiAccountingDecisionPacketFullV1(input({classification:'ACCRUAL',reversalPolicy:'NEXT_OPEN_PERIOD',proposedJournal:{status:'SUGGESTED_ONLY',balanced:true,reversal_policy:'NEXT_OPEN_PERIOD',lines:[line(1,'DEBIT','610000'),line(2,'CREDIT','220000')]}}));
  assert.equal(accrual.proposed_journal.reversal_policy,'NEXT_OPEN_PERIOD');
});
