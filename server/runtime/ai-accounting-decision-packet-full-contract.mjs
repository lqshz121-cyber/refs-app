const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY=/^(0|[1-9]\d{0,15})\.\d{4}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const SOURCE_TYPES=Object.freeze(['INVOICE','PAYMENT','LOAN_TRANSACTION','REVENUE','DEPOSIT','INTERCOMPANY','REIMBURSEMENT']);
const CLASSIFICATIONS=Object.freeze(['EXPENSE','CAPITALIZATION','PREPAID','ACCRUAL','LOAN','REVENUE','DEPOSIT','INTERCOMPANY','REIMBURSEMENT','BLOCKED']);
const COMMON_SOURCE_KEYS=Object.freeze(['accounting_date','accounting_period_id','admission_status','amount','business_date','company_code','completeness_status','cost_code_ref','currency','duplicate_status','entity_id','exception_codes','member_ref','project_ref','property_ref','schema_version','source_detail','source_document_id','source_document_line_id','source_line_hash','source_payload_hash','source_type','tenant_id','vendor_ref']);
const DETAIL_KEYS=Object.freeze({
  INVOICE:['invoice_date','invoice_number','service_period_end','service_period_start'],
  PAYMENT:['bank_transaction_id','payee_ref','payment_date'],
  LOAN_TRANSACTION:['lender_ref','loan_ref','transaction_kind'],
  REVENUE:['customer_ref','performance_period_end','performance_period_start','revenue_kind'],
  DEPOSIT:['deposit_kind','lease_ref','tenant_ref'],
  INTERCOMPANY:['counterparty_company_code','counterparty_entity_id','intercompany_kind'],
  REIMBURSEMENT:['beneficiary_ref','original_source_document_id','reimbursement_kind']
});
const POLICY_TYPES=Object.freeze(['ACCOUNT','CLASSIFICATION','DIMENSION','MATERIALITY','APPROVAL','PERIOD_CLOSE','REPORT','REVERSAL','TAX','INTERCOMPANY']);
const LINE_KEYS=Object.freeze(['account_class','account_code','account_type','amount','cost_code_ref','currency','dimension_requirements','line_number','member_ref','project_ref','property_ref','side','source_document_id','source_document_line_id','source_line_hash']);
const DELTA_KEYS=Object.freeze(['account_class','account_code','accounting_period_id','amount','cost_code_ref','currency','direction','member_ref','project_ref','property_ref','source_document_line_id','statement']);
const TRACE_KEYS=Object.freeze(['policy_type','rule_id','snapshot_hash','snapshot_id','version']);

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const text=(value,max=256)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const nullableText=value=>value===null||text(value);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
const units=value=>{const [whole,fraction]=value.split('.');return BigInt(whole)*10000n+BigInt(fraction);};
const sum=(rows,side)=>rows.filter(row=>row.side===side).reduce((total,row)=>total+units(row.amount),0n);

function validDetail(source){
  const keys=DETAIL_KEYS[source.source_type];
  if(!keys||!exact(source.source_detail,keys))return false;
  const detail=source.source_detail;
  if(source.source_type==='INVOICE')return text(detail.invoice_number)&&DATE.test(detail.invoice_date||'')&&(detail.service_period_start===null||DATE.test(detail.service_period_start||''))&&(detail.service_period_end===null||DATE.test(detail.service_period_end||''));
  if(source.source_type==='PAYMENT')return UUID.test(detail.bank_transaction_id||'')&&text(detail.payee_ref)&&DATE.test(detail.payment_date||'');
  if(source.source_type==='LOAN_TRANSACTION')return text(detail.lender_ref)&&text(detail.loan_ref)&&['DRAW','INTEREST','FEE','ESCROW','REPAYMENT'].includes(detail.transaction_kind);
  if(source.source_type==='REVENUE')return text(detail.customer_ref)&&text(detail.revenue_kind)&&(detail.performance_period_start===null||DATE.test(detail.performance_period_start||''))&&(detail.performance_period_end===null||DATE.test(detail.performance_period_end||''));
  if(source.source_type==='DEPOSIT')return text(detail.deposit_kind)&&nullableText(detail.lease_ref)&&nullableText(detail.tenant_ref);
  if(source.source_type==='INTERCOMPANY')return text(detail.counterparty_company_code,64)&&UUID.test(detail.counterparty_entity_id||'')&&text(detail.intercompany_kind);
  return text(detail.beneficiary_ref)&&UUID.test(detail.original_source_document_id||'')&&text(detail.reimbursement_kind);
}

export function assertAiAccountingSourceV1(source,{tenantId,entityId,accountingPeriodId}={}){
  if(!exact(source,COMMON_SOURCE_KEYS)||source.schema_version!=='AI_ACCOUNTING_SOURCE_V1'||source.tenant_id!==tenantId||source.entity_id!==entityId||source.accounting_period_id!==accountingPeriodId||!SOURCE_TYPES.includes(source.source_type)||!UUID.test(source.tenant_id||'')||!UUID.test(source.entity_id||'')||!UUID.test(source.accounting_period_id||'')||!UUID.test(source.source_document_id||'')||!UUID.test(source.source_document_line_id||'')||!SHA.test(source.source_payload_hash||'')||!SHA.test(source.source_line_hash||'')||!text(source.company_code,64)||!DATE.test(source.business_date||'')||!DATE.test(source.accounting_date||'')||!/^[A-Z]{3}$/.test(source.currency||'')||!MONEY.test(source.amount||'')||source.amount==='0.0000'||!['COMPLETE','INCOMPLETE'].includes(source.completeness_status)||!['NONE','POSSIBLE','CONFIRMED'].includes(source.duplicate_status)||!['ADMITTED','NOT_ADMITTED','QUARANTINED','REJECTED'].includes(source.admission_status)||!Array.isArray(source.exception_codes)||source.exception_codes.some(code=>!text(code,80))||![source.project_ref,source.property_ref,source.vendor_ref,source.member_ref,source.cost_code_ref].every(nullableText)||!validDetail(source))fail('AI_ACCOUNTING_SOURCE_INVALID','A closed, admitted, source-bound accounting event is required.');
  return source;
}

function validTrace(trace){return exact(trace,TRACE_KEYS)&&POLICY_TYPES.includes(trace.policy_type)&&UUID.test(trace.snapshot_id||'')&&Number.isSafeInteger(trace.version)&&trace.version>0&&SHA.test(trace.snapshot_hash||'')&&text(trace.rule_id,128);}
function validRisk(risk){return exact(risk,['approval_threshold','confidence_floor','materiality_threshold','policy_rule_id','risk_level','threshold_comparison'])&&['LOW','MEDIUM','HIGH'].includes(risk.risk_level)&&text(risk.policy_rule_id,128)&&MONEY.test(risk.materiality_threshold||'')&&MONEY.test(risk.approval_threshold||'')&&typeof risk.confidence_floor==='number'&&risk.confidence_floor>=0&&risk.confidence_floor<=1&&['BELOW_MATERIALITY','AT_OR_ABOVE_MATERIALITY','AT_OR_ABOVE_APPROVAL','POLICY_BLOCKED'].includes(risk.threshold_comparison);}
function validLine(line,source,index){return exact(line,LINE_KEYS)&&line.line_number===index+1&&['DEBIT','CREDIT'].includes(line.side)&&text(line.account_code,64)&&['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'].includes(line.account_class)&&text(line.account_type,80)&&MONEY.test(line.amount||'')&&line.amount!=='0.0000'&&line.currency===source.currency&&Array.isArray(line.dimension_requirements)&&line.dimension_requirements.every(item=>text(item,64))&&[line.project_ref,line.property_ref,line.member_ref,line.cost_code_ref].every(nullableText)&&line.source_document_id===source.source_document_id&&line.source_document_line_id===source.source_document_line_id&&line.source_line_hash===source.source_line_hash;}
function validDelta(delta,source){return exact(delta,DELTA_KEYS)&&['BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW'].includes(delta.statement)&&['INCREASE','DECREASE'].includes(delta.direction)&&text(delta.account_code,64)&&['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'].includes(delta.account_class)&&delta.accounting_period_id===source.accounting_period_id&&MONEY.test(delta.amount||'')&&delta.amount!=='0.0000'&&delta.currency===source.currency&&[delta.project_ref,delta.property_ref,delta.member_ref,delta.cost_code_ref].every(nullableText)&&delta.source_document_line_id===source.source_document_line_id;}

export function buildAiAccountingDecisionPacketFullV1({tenantId,entityId,accountingPeriodId,source,classification,ruleId,reason,confidence,risk,requiredHumanFields=[],policyTraces,proposedJournal,expectedReportDeltas,reversalPolicy='NONE',amortizationScheduleTrace=null}){
  assertAiAccountingSourceV1(source,{tenantId,entityId,accountingPeriodId});
  const policyTypes=Array.isArray(policyTraces)?policyTraces.map(trace=>trace?.policy_type):[];
  const requiredPolicyTypes=['ACCOUNT','CLASSIFICATION','MATERIALITY','APPROVAL','REPORT'];
  if(!CLASSIFICATIONS.includes(classification)||!text(ruleId,128)||!text(reason,4000)||typeof confidence!=='number'||confidence<0||confidence>1||!validRisk(risk)||!Array.isArray(requiredHumanFields)||requiredHumanFields.some(field=>!text(field,80))||!Array.isArray(policyTraces)||policyTraces.some(trace=>!validTrace(trace))||new Set(policyTypes).size!==policyTypes.length||requiredPolicyTypes.some(type=>!policyTypes.includes(type)))fail('AI_ACCOUNTING_DECISION_POLICY_INVALID','Classification and risk require exact approved policy evidence.');
  const exception=classification==='BLOCKED'||source.completeness_status!=='COMPLETE'||source.duplicate_status!=='NONE'||source.admission_status!=='ADMITTED'||source.exception_codes.length>0;
  const journalKeys=['balanced','lines','reversal_policy','status'];
  if(!exact(proposedJournal,journalKeys)||proposedJournal.status!=='SUGGESTED_ONLY'||!['NONE','NEXT_OPEN_PERIOD','AMORTIZATION_SCHEDULE','HUMAN_DECISION_REQUIRED'].includes(reversalPolicy)||proposedJournal.reversal_policy!==reversalPolicy||!Array.isArray(proposedJournal.lines))fail('AI_ACCOUNTING_SUGGESTED_JOURNAL_INVALID','Suggested Journal must be closed and grant no accounting authority.');
  const lines=proposedJournal.lines;
  if(exception){if(lines.length!==0||proposedJournal.balanced!==false||expectedReportDeltas.length!==0)fail('AI_ACCOUNTING_EXCEPTION_EFFECT_INVALID','Exceptions must contain zero Journal or report effects.');}
  else if(lines.length<2||lines.length>500||lines.some((line,index)=>!validLine(line,source,index))||sum(lines,'DEBIT')!==sum(lines,'CREDIT')||proposedJournal.balanced!==true||!Array.isArray(expectedReportDeltas)||expectedReportDeltas.length<1||expectedReportDeltas.some(delta=>!validDelta(delta,source)))fail('AI_ACCOUNTING_SUGGESTED_JOURNAL_INVALID','A 2..N line balanced, source-bound suggested Journal and exact report deltas are required.');
  if(reversalPolicy==='AMORTIZATION_SCHEDULE'&&(!exact(amortizationScheduleTrace,['schedule_hash','schedule_id'])||!UUID.test(amortizationScheduleTrace.schedule_id||'')||!SHA.test(amortizationScheduleTrace.schedule_hash||'')))fail('AI_ACCOUNTING_AMORTIZATION_TRACE_INVALID','Amortization requires an exact retained schedule trace.');
  if(reversalPolicy!=='AMORTIZATION_SCHEDULE'&&amortizationScheduleTrace!==null)fail('AI_ACCOUNTING_AMORTIZATION_TRACE_INVALID','Unexpected amortization schedule trace.');
  return freeze({schema_version:'AI_ACCOUNTING_DECISION_PACKET_V1',status:exception?'EXCEPTION':'READY_FOR_HUMAN_REVIEW',tenant_id:tenantId,entity_id:entityId,company_code:source.company_code,accounting_period_id:accountingPeriodId,accounting_date:source.accounting_date,source,classification,rule_id:ruleId,reason,confidence,risk,required_human_fields:[...requiredHumanFields],policy_traces:policyTraces.map(trace=>({...trace})),proposed_journal:{status:'SUGGESTED_ONLY',balanced:proposedJournal.balanced,reversal_policy:reversalPolicy,lines:lines.map(line=>({...line}))},expected_report_deltas:expectedReportDeltas.map(delta=>({...delta})),amortization_schedule_trace:amortizationScheduleTrace===null?null:{...amortizationScheduleTrace},trace:{source_to_decision:true,settings_to_decision:true,decision_to_draft:false,decision_to_posted_ledger:false,decision_to_report:false},action_flags:ACTIONS});
}

export const AI_ACCOUNTING_SOURCE_TYPES=SOURCE_TYPES;
export const AI_ACCOUNTING_CLASSIFICATIONS=CLASSIFICATIONS;
