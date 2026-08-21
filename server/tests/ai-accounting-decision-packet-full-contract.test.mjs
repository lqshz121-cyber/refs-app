import test from 'node:test';
import assert from 'node:assert/strict';
import {AI_ACCOUNTING_CLASSIFICATIONS,AI_ACCOUNTING_SOURCE_TYPES,assertAiAccountingSourceV1,buildAiAccountingDecisionPacketFullV1,deriveAiAccountingReportDeltas} from '../runtime/ai-accounting-decision-packet-full-contract.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=n=>`sha256:${String(n).repeat(64).slice(0,64)}`;
const scope={tenantId:id(1),entityId:id(2),accountingPeriodId:id(3)};
const details={
  INVOICE:{execution_evidence:{account_master:[{account_code:'211000',active:true,required_member_type:null,requires_member:false},{account_code:'610000',active:true,required_member_type:null,requires_member:false}],attachments:[{attachment_id:id(6),content_hash:hash(6),finalization_status:'VERIFIED_CLEAN',scan_status:'CLEAN',storage_version:'version-6'}]},invoice_date:'2026-07-15',invoice_number:'INV-7',service_period_end:'2026-07-31',service_period_start:'2026-07-01'},
  PAYMENT:{bank_transaction_id:id(20),payee_ref:'VENDOR-7',payment_date:'2026-07-16'},
  BANK_TRANSACTION:{bank_account_ref:'BANK-1',bank_transaction_id:id(23),memo:'ACH payment',transaction_date:'2026-07-16'},
  LOAN_TRANSACTION:{execution_evidence:{account_master:[{account_code:'211000',active:true,required_member_type:null,requires_member:false},{account_code:'610000',active:true,required_member_type:null,requires_member:false}],attachments:[{attachment_id:id(6),content_hash:hash(6),evidence_type:'source_attachment',finalization_status:'VERIFIED_CLEAN',scan_status:'CLEAN',storage_version:'version-6'}],import_lineage:{raw_event_id:id(25),source_record_id:'LOAN-TXN-1',source_version:'v1'}},lender_ref:'LENDER-1',loan_ref:'LOAN-1',transaction_kind:'DRAW'},
  CONSTRUCTION_COST:{contract_ref:'CONTRACT-1',purchase_order_ref:'PO-1',work_order_ref:'WO-1'},
  PROPERTY_MANAGEMENT:{report_kind:'RENT_ROLL',report_period_end:'2026-07-31',report_period_start:'2026-07-01'},
  TAX_STATEMENT:{coverage_period_end:'2027-06-30',coverage_period_start:'2026-07-01',jurisdiction:'TX',tax_kind:'PROPERTY_TAX'},
  FIXED_ASSET_EVENT:{asset_ref:'ASSET-1',event_kind:'PLACED_IN_SERVICE',placed_in_service_date:'2026-07-15'},
  CLOSING_SETTLEMENT:{settlement_date:'2026-07-15',settlement_ref:'CLOSE-1'},
  MANUAL_JOURNAL:{entry_date:'2026-07-15',journal_number:'MANUAL-1',original_journal_entry_id:id(24)},
  REVENUE:{customer_ref:'TENANT-1',performance_period_end:'2026-07-31',performance_period_start:'2026-07-01',revenue_kind:'RENT'},
  DEPOSIT:{deposit_kind:'SECURITY_DEPOSIT',lease_ref:'LEASE-1',tenant_ref:'TENANT-1'},
  INTERCOMPANY:{counterparty_company_code:'WBPB',counterparty_entity_id:id(21),intercompany_kind:'DUE_TO'},
  REIMBURSEMENT:{beneficiary_ref:'EMPLOYEE-1',original_source_document_id:id(22),reimbursement_kind:'PROJECT_COST'}
};
const source=(source_type='INVOICE',overrides={})=>{const incomplete=source_type==='INVOICE'&&overrides.completeness_status==='INCOMPLETE'&&!Object.hasOwn(overrides,'source_detail'),source_detail=incomplete?{...details.INVOICE,execution_evidence:{...details.INVOICE.execution_evidence,attachments:[...details.INVOICE.execution_evidence.attachments,{attachment_id:id(7),content_hash:hash(7),finalization_status:'PENDING',scan_status:'PENDING',storage_version:'pending:version-7'}]}}:details[source_type];return {schema_version:'AI_ACCOUNTING_SOURCE_V1',tenant_id:scope.tenantId,entity_id:scope.entityId,company_code:'WBPA',accounting_period_id:scope.accountingPeriodId,accounting_period_start:'2026-07-01',accounting_period_end:'2026-07-31',business_date:'2026-07-15',accounting_date:'2026-07-15',cash_direction:'NON_CASH',currency:'USD',amount:'100.0000',source_document_id:id(4),source_document_line_id:id(5),source_payload_hash:hash(1),source_line_hash:hash(2),source_type,project_ref:['CONSTRUCTION_COST'].includes(source_type)?'PROJECT-1':null,property_ref:['CONSTRUCTION_COST','PROPERTY_MANAGEMENT','CLOSING_SETTLEMENT'].includes(source_type)?'PROPERTY-1':null,vendor_ref:['INVOICE','CONSTRUCTION_COST'].includes(source_type)?'VENDOR-7':null,member_ref:null,cost_code_ref:source_type==='CONSTRUCTION_COST'?'COST-1':null,completeness_status:'COMPLETE',duplicate_status:'NONE',admission_status:'ADMITTED',exception_codes:[],source_detail,...overrides};};
const settings={id:id(29),hash:hash(29)};
const traces=['ACCOUNT','CLASSIFICATION','MATERIALITY','APPROVAL','PERIOD_CLOSE','REPORT','REVERSAL','INTERCOMPANY','TAX','DIMENSION','LOAN_CAPITALIZATION'].map((policy_type,index)=>({policy_type,snapshot_id:id(30+index),version:1,snapshot_hash:hash(3+index),rule_id:`${policy_type}_RULE_V1`,approval_status:'APPROVED',tenant_id:scope.tenantId,entity_id:scope.entityId,company_code:'WBPA',accounting_period_id:scope.accountingPeriodId,settings_snapshot_id:settings.id,settings_snapshot_hash:settings.hash}));
const approvalTrace=traces.find(trace=>trace.policy_type==='APPROVAL');
const workflowPolicy={approval_status:'APPROVED',tenant_id:scope.tenantId,entity_id:scope.entityId,company_code:'WBPA',period_id:scope.accountingPeriodId,settings_snapshot_id:settings.id,settings_snapshot_hash:settings.hash,policy_id:approvalTrace.snapshot_id,policy_hash:approvalTrace.snapshot_hash,stages:{DRAFT:{role:'AP_PREPARER',permission:'GL.JE.CREATE'},SUBMIT:{role:'AP_PREPARER',permission:'GL.JE.SUBMIT'},REVIEW:{role:'AP_REVIEWER',permission:'GL.JE.REVIEW'},APPROVE:{role:'CONTROLLER',permission:'GL.JE.APPROVE'},POST:{role:'GL_POSTER',permission:'GL.JE.POST'}}};
const risk={risk_level:'MEDIUM',policy_rule_id:'RISK_POLICY_V1',materiality_threshold:'50.0000',approval_threshold:'500.0000',confidence_floor:.9,threshold_comparison:'AT_OR_ABOVE_MATERIALITY'};
const line=(line_number,side,account_code,amount='100.0000')=>({line_number,side,account_code,account_class:side==='DEBIT'?'EXPENSE':'LIABILITY',account_type:side==='DEBIT'?'OPERATING_EXPENSE':'ACCOUNTS_PAYABLE',amount,currency:'USD',project_ref:null,property_ref:null,member_ref:null,cost_code_ref:null,dimension_requirements:[],source_document_id:id(4),source_document_line_id:id(5),source_line_hash:hash(2)});
const delta=(statement='INCOME_STATEMENT')=>({statement,cash_flow_classification:'NONE',accounting_period_id:scope.accountingPeriodId,account_code:'610000',account_class:'EXPENSE',direction:'INCREASE',amount:'100.0000',currency:'USD',project_ref:null,property_ref:null,member_ref:null,cost_code_ref:null,source_document_line_id:id(5)});
const accountPolicy=(account_code,account_class,account_type,overrides={})=>({account_code,account_class,account_type,normal_balance:['ASSET','EXPENSE'].includes(account_class)?'DEBIT':'CREDIT',contra:false,report_statement:['ASSET','LIABILITY','EQUITY'].includes(account_class)?'BALANCE_SHEET':'INCOME_STATEMENT',cash_flow_classification:'NONE',required_dimensions:[],optional_dimensions:[],effective_from:'2026-01-01',effective_to:null,settings_snapshot_id:settings.id,settings_snapshot_hash:settings.hash,...overrides});
const accounts=[accountPolicy('610000','EXPENSE','OPERATING_EXPENSE'),accountPolicy('620000','EXPENSE','OPERATING_EXPENSE'),accountPolicy('141000','EXPENSE','OPERATING_EXPENSE'),accountPolicy('211000','LIABILITY','ACCOUNTS_PAYABLE'),accountPolicy('220000','LIABILITY','ACCOUNTS_PAYABLE')];
const liabilityDelta=(account_code='211000')=>({...delta('BALANCE_SHEET'),account_code,account_class:'LIABILITY',direction:'INCREASE'});
const input=(overrides={})=>({ ...scope,source:source(),classification:'EXPENSE',ruleId:'EXPENSE_POLICY_V1',reason:'Approved policy classifies this complete admitted invoice as current-period expense.',confidence:.94,risk,requiredHumanFields:['controller_conclusion'],policyTraces:traces,workflowPolicy,approvedAccountPolicies:accounts,proposedJournal:{status:'SUGGESTED_ONLY',balanced:true,reversal_policy:'NONE',lines:[line(1,'DEBIT','610000'),line(2,'CREDIT','211000')]},expectedReportDeltas:[delta(),liabilityDelta()],...overrides});

test('accepts every closed source variant with common scope, date, lineage, and control fields',()=>{
  assert.deepEqual(AI_ACCOUNTING_SOURCE_TYPES,Object.keys(details));
  for(const type of AI_ACCOUNTING_SOURCE_TYPES)assert.equal(assertAiAccountingSourceV1(source(type),scope).source_type,type);
  for(const unsafe of [{vendor_ref:'VENDOR-7',source_type:'PAYMENT',source_detail:details.PAYMENT,raw_package:{}},{admission_status:'NOT_ADMITTED'},{duplicate_status:'POSSIBLE'},{completeness_status:'INCOMPLETE'},{company_code:''}]){
    if(Object.hasOwn(unsafe,'raw_package'))assert.throws(()=>assertAiAccountingSourceV1({...source('PAYMENT'),...unsafe},scope),error=>error.code==='AI_ACCOUNTING_SOURCE_INVALID');
  }
  assert.equal(assertAiAccountingSourceV1(source('INVOICE',{business_date:'2026-06-15'}),scope).business_date,'2026-06-15');
  for(const override of [{accounting_date:'2026-08-01'},{business_date:'2026-08-01'},{business_date:'2026-99-99'},{accounting_period_end:'2026-02-30'}])assert.throws(()=>assertAiAccountingSourceV1(source('INVOICE',override),scope),error=>error.code==='AI_ACCOUNTING_SOURCE_INVALID');
});

test('supports the complete required accounting classification vocabulary without granting actions',()=>{
  assert.deepEqual(AI_ACCOUNTING_CLASSIFICATIONS,['EXPENSE','CAPITALIZATION','PREPAID','ACCRUAL','PAYMENT','LOAN','REVENUE','DEPOSIT','INTERCOMPANY','REIMBURSEMENT','FIXED_ASSET','CONSTRUCTION_COST','PROPERTY_OPERATING_COST','TAX','CLOSING_COST','RECLASS','REVERSAL','BLOCKED']);
  const classificationSource={EXPENSE:'INVOICE',CAPITALIZATION:'INVOICE',PREPAID:'INVOICE',ACCRUAL:'INVOICE',PAYMENT:'PAYMENT',LOAN:'LOAN_TRANSACTION',REVENUE:'REVENUE',DEPOSIT:'DEPOSIT',INTERCOMPANY:'INTERCOMPANY',REIMBURSEMENT:'REIMBURSEMENT',FIXED_ASSET:'FIXED_ASSET_EVENT',CONSTRUCTION_COST:'CONSTRUCTION_COST',PROPERTY_OPERATING_COST:'PROPERTY_MANAGEMENT',TAX:'TAX_STATEMENT',CLOSING_COST:'CLOSING_SETTLEMENT',RECLASS:'MANUAL_JOURNAL',REVERSAL:'MANUAL_JOURNAL'};
  for(const classification of AI_ACCOUNTING_CLASSIFICATIONS.filter(value=>value!=='BLOCKED')){
    const packet=buildAiAccountingDecisionPacketFullV1(input({classification,source:source(classificationSource[classification])}));
    assert.equal(packet.classification,classification);assert.equal(packet.proposed_journal.status,'SUGGESTED_ONLY');assert.deepEqual(packet.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  }
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({classification:'LOAN'})),error=>error.code==='AI_ACCOUNTING_DECISION_POLICY_INVALID');
});

test('accepts balanced 2..N lines and exact monetary report deltas',()=>{
  const packet=buildAiAccountingDecisionPacketFullV1(input({proposedJournal:{status:'SUGGESTED_ONLY',balanced:true,reversal_policy:'NONE',lines:[line(1,'DEBIT','610000','60.0000'),line(2,'DEBIT','620000','40.0000'),line(3,'CREDIT','211000','100.0000')]},expectedReportDeltas:[{...delta(),amount:'60.0000'},{...delta(),account_code:'620000',amount:'40.0000'},liabilityDelta()]}));
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
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({source:source('INVOICE',{completeness_status:'INCOMPLETE'}),classification:'BLOCKED',proposedJournal:{status:'SUGGESTED_ONLY',balanced:false,reversal_policy:'NONE',lines:[]},expectedReportDeltas:null})),error=>error.code==='AI_ACCOUNTING_SUGGESTED_JOURNAL_INVALID');
});

test('risk must be backed by approved materiality and approval policy traces',()=>{
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({policyTraces:traces.filter(trace=>trace.policy_type!=='MATERIALITY')})),error=>error.code==='AI_ACCOUNTING_DECISION_POLICY_INVALID');
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({risk:{...risk,materiality_threshold:'hardcoded'}})),error=>error.code==='AI_ACCOUNTING_DECISION_POLICY_INVALID');
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({risk:{...risk,risk_level:'LOW',threshold_comparison:'BELOW_MATERIALITY'}})),error=>error.code==='AI_ACCOUNTING_DECISION_POLICY_INVALID');
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({policyTraces:traces.map((trace,index)=>index?trace:{...trace,entity_id:id(99)})})),error=>error.code==='AI_ACCOUNTING_DECISION_POLICY_INVALID');
});

test('workflow roles and formal GL permissions come from the exact approved workflow policy',()=>{
  const packet=buildAiAccountingDecisionPacketFullV1(input());
  assert.equal(packet.workflow_policy.stages.DRAFT.role,'AP_PREPARER');
  assert.equal(packet.workflow_policy.stages.APPROVE.role,'CONTROLLER');
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({workflowPolicy:{...workflowPolicy,policy_hash:hash(99)}})),error=>error.code==='AI_ACCOUNTING_DECISION_POLICY_INVALID');
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({workflowPolicy:{...workflowPolicy,stages:{...workflowPolicy.stages,POST:{role:'GL_POSTER',permission:'JOURNAL.POST'}}}})),error=>error.code==='AI_ACCOUNTING_DECISION_POLICY_INVALID');
});

test('classification-specific decisions require their approved policy family',()=>{
  for(const [classification,required] of [['PREPAID','REVERSAL'],['ACCRUAL','REVERSAL'],['INTERCOMPANY','INTERCOMPANY'],['TAX','TAX'],['CAPITALIZATION','DIMENSION']])assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({classification,policyTraces:traces.filter(trace=>trace.policy_type!==required)})),error=>error.code==='AI_ACCOUNTING_DECISION_POLICY_INVALID');
});

test('source semantics require tax and loan policy even when the selected classification is different',()=>{
  for(const classification of ['TAX','PREPAID','ACCRUAL']){
    assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({source:source('TAX_STATEMENT'),classification,policyTraces:traces.filter(trace=>trace.policy_type!=='TAX')})),error=>error.code==='AI_ACCOUNTING_DECISION_POLICY_INVALID');
  }
  for(const classification of ['LOAN','EXPENSE','PREPAID','CAPITALIZATION']){
    assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({source:source('LOAN_TRANSACTION'),classification,policyTraces:traces.filter(trace=>trace.policy_type!=='LOAN_CAPITALIZATION')})),error=>error.code==='AI_ACCOUNTING_DECISION_POLICY_INVALID');
  }
  const blocked=buildAiAccountingDecisionPacketFullV1(input({source:source('LOAN_TRANSACTION',{duplicate_status:'POSSIBLE'}),classification:'BLOCKED',policyTraces:traces.filter(trace=>trace.policy_type!=='LOAN_CAPITALIZATION'),proposedJournal:{status:'SUGGESTED_ONLY',balanced:false,reversal_policy:'NONE',lines:[]},expectedReportDeltas:[]}));
  assert.equal(blocked.status,'EXCEPTION');
});

test('expected report deltas must bind to an exact suggested Journal account and dimension',()=>{
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({expectedReportDeltas:[{...delta(),account_code:'999999'},liabilityDelta()]})),error=>error.code==='AI_ACCOUNTING_SUGGESTED_JOURNAL_INVALID');
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({expectedReportDeltas:[delta()]})),error=>error.code==='AI_ACCOUNTING_SUGGESTED_JOURNAL_INVALID');
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({expectedReportDeltas:[{...delta(),direction:'DECREASE'},liabilityDelta()]})),error=>error.code==='AI_ACCOUNTING_SUGGESTED_JOURNAL_INVALID');
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({approvedAccountPolicies:accounts.filter(policy=>policy.account_code!=='211000')})),error=>error.code==='AI_ACCOUNTING_SUGGESTED_JOURNAL_INVALID');
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({expectedReportDeltas:[delta(),liabilityDelta(),{...delta('CASH_FLOW'),cash_flow_classification:'OPERATING'}]})),error=>error.code==='AI_ACCOUNTING_SUGGESTED_JOURNAL_INVALID');
});

test('prepaid schedule and accrual reversal policies retain their exact supporting trace',()=>{
  const prepaid=buildAiAccountingDecisionPacketFullV1(input({classification:'PREPAID',reversalPolicy:'AMORTIZATION_SCHEDULE',proposedJournal:{status:'SUGGESTED_ONLY',balanced:true,reversal_policy:'AMORTIZATION_SCHEDULE',lines:[line(1,'DEBIT','141000'),line(2,'CREDIT','211000')]},expectedReportDeltas:[{...delta(),account_code:'141000'},liabilityDelta()],amortizationScheduleTrace:{schedule_id:id(40),schedule_hash:hash(9)}}));
  assert.equal(prepaid.amortization_schedule_trace.schedule_id,id(40));
  const accrual=buildAiAccountingDecisionPacketFullV1(input({classification:'ACCRUAL',reversalPolicy:'NEXT_OPEN_PERIOD',proposedJournal:{status:'SUGGESTED_ONLY',balanced:true,reversal_policy:'NEXT_OPEN_PERIOD',lines:[line(1,'DEBIT','610000'),line(2,'CREDIT','220000')]},expectedReportDeltas:[delta(),liabilityDelta('220000')]}));
  assert.equal(accrual.proposed_journal.reversal_policy,'NEXT_OPEN_PERIOD');
});

test('aggregates split lines, removes net-zero effects, and derives cash flow and contra direction from policy',()=>{
  const split=[line(1,'DEBIT','610000','60.0000'),line(2,'DEBIT','610000','40.0000'),line(3,'CREDIT','211000')];
  assert.deepEqual(deriveAiAccountingReportDeltas({source:source(),lines:split,approvedAccountPolicies:accounts}),[delta(),liabilityDelta()]);
  const net=[line(1,'DEBIT','610000'),{...line(2,'CREDIT','610000'),account_class:'EXPENSE',account_type:'OPERATING_EXPENSE'}];
  const netPacket=buildAiAccountingDecisionPacketFullV1(input({proposedJournal:{status:'SUGGESTED_ONLY',balanced:true,reversal_policy:'NONE',lines:net},expectedReportDeltas:[]}));
  assert.deepEqual(netPacket.expected_report_deltas,[]);
  const cashPolicy=accountPolicy('111000','ASSET','CASH',{cash_flow_classification:'OPERATING'}),paymentSource=source('PAYMENT',{cash_direction:'OUTFLOW'}),paymentLines=[line(1,'DEBIT','610000'),{...line(2,'CREDIT','111000'),account_class:'ASSET',account_type:'CASH'}];
  const paymentDeltas=[delta(),{...delta('BALANCE_SHEET'),account_code:'111000',account_class:'ASSET',direction:'DECREASE'},{...delta('CASH_FLOW'),account_code:'111000',account_class:'ASSET',direction:'DECREASE',cash_flow_classification:'OPERATING'}];
  assert.equal(buildAiAccountingDecisionPacketFullV1(input({source:paymentSource,classification:'PAYMENT',approvedAccountPolicies:[...accounts,cashPolicy],proposedJournal:{status:'SUGGESTED_ONLY',balanced:true,reversal_policy:'NONE',lines:paymentLines},expectedReportDeltas:paymentDeltas})).expected_report_deltas.length,3);
  const contraPolicy=accountPolicy('159000','ASSET','ACCUMULATED_DEPRECIATION',{normal_balance:'CREDIT',contra:true}),contraLine={...line(1,'DEBIT','159000'),account_class:'ASSET',account_type:'ACCUMULATED_DEPRECIATION'};
  assert.equal(deriveAiAccountingReportDeltas({source:source(),lines:[contraLine],approvedAccountPolicies:[contraPolicy]})[0].direction,'DECREASE');
});

test('required dimensions cannot be omitted and unapproved dimensions cannot be invented',()=>{
  const projectPolicy=accountPolicy('610000','EXPENSE','OPERATING_EXPENSE',{required_dimensions:['PROJECT']});
  assert.throws(()=>buildAiAccountingDecisionPacketFullV1(input({approvedAccountPolicies:[projectPolicy,...accounts.filter(policy=>policy.account_code!=='610000')]})),error=>error.code==='AI_ACCOUNTING_SUGGESTED_JOURNAL_INVALID');
});
