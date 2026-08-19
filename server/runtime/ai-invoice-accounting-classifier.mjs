import {applyAiCapitalizationPolicy} from './ai-capitalization-policy.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY4=/^(0|[1-9]\d*)\.\d{4}$/;

const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const CLASSIFICATIONS=Object.freeze(['EXPENSE','PREPAID_AMORTIZATION','ACCRUAL_REVIEW','CAPITALIZATION_REVIEW','BLOCKED']);

const text=(value,max=500)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const nullableText=(value,max=500)=>value===null||text(value,max);
const date=value=>typeof value==='string'&&DATE.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const nullableDate=value=>value===null||date(value);
const monthsSpanned=(start,end)=>{
  const a=new Date(`${start}T00:00:00Z`),b=new Date(`${end}T00:00:00Z`);
  return (b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth()+1;
};
const PREPAID_INDICATORS=Object.freeze([
  Object.freeze({category:'INSURANCE',pattern:/\b(?:insurance|premium|policy)\b/i}),
  Object.freeze({category:'PROPERTY_TAX',pattern:/\b(?:property\s+tax|real\s+estate\s+tax)\b/i}),
  Object.freeze({category:'SOFTWARE_SUBSCRIPTION',pattern:/\b(?:annual\s+software|software\s+subscription|saas\s+subscription)\b/i}),
  Object.freeze({category:'LICENSE',pattern:/\b(?:annual\s+licen[cs]e|licen[cs]e\s+renewal)\b/i}),
  Object.freeze({category:'LOAN_FEE',pattern:/\b(?:loan\s+fee|financing\s+fee|origination\s+fee)\b/i}),
  Object.freeze({category:'WARRANTY_OR_MAINTENANCE',pattern:/\b(?:extended\s+warranty|annual\s+maintenance|maintenance\s+contract)\b/i})
]);
const prepaidIndicator=invoice=>{const haystack=[invoice.vendor_name,invoice.description,invoice.charge_code].filter(value=>typeof value==='string').join(' ');return PREPAID_INDICATORS.find(item=>item.pattern.test(haystack))?.category??null;};

function baseResult(invoice,classification,reason,confidence,requiredHumanFields=[],ruleId='AI_INVOICE_CLASSIFICATION_FAIL_CLOSED_V1',policyEvidence=null){
  return Object.freeze({
    schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2',
    source_document_id:invoice.source_document_id,
    source_document_line_id:invoice.source_document_line_id,
    source_payload_hash:invoice.source_payload_hash,
    source_line_hash:invoice.source_line_hash,
    classification,
    reason,
    confidence,
    required_human_fields:Object.freeze([...requiredHumanFields]),
    rule_id:ruleId,
    policy_evidence:policyEvidence,
    action_flags:ACTIONS
  });
}

function validEnvelope(value){
  return value&&typeof value==='object'&&!Array.isArray(value)&&
    UUID.test(value.source_document_id||'')&&UUID.test(value.source_document_line_id||'')&&
    SHA256.test(value.source_payload_hash||'')&&SHA256.test(value.source_line_hash||'')&&
    UUID.test(value.entity_id||'')&&UUID.test(value.accounting_period_id||'')&&
    text(value.vendor_name,200)&&nullableText(value.invoice_no,128)&&date(value.invoice_date)&&
    /^[A-Z]{3}$/.test(value.currency||'')&&MONEY4.test(value.amount||'')&&value.amount!=='0.0000'&&
    nullableDate(value.service_period_start)&&nullableDate(value.service_period_end)&&
    nullableText(value.description,1000)&&nullableText(value.project_ref,128)&&nullableText(value.property_ref,128)&&nullableText(value.charge_code,128)&&
    ['NONE','POSSIBLE','CONFIRMED'].includes(value.duplicate_status)&&
    ['NOT_RECORDED','DRAFT','POSTED'].includes(value.accounting_status)&&
    ['NONE','OPERATING','UNDER_CONSTRUCTION','IN_SERVICE'].includes(value.project_status)&&
    ['UNKNOWN','OPERATING_EXPENSE','HARD_COST','SOFT_COST','EQUIPMENT','REPAIR','INTEREST'].includes(value.cost_class)&&
    (value.asset_useful_life_months===null||(Number.isInteger(value.asset_useful_life_months)&&value.asset_useful_life_months>=1&&value.asset_useful_life_months<=600))&&
    (value.capitalization_threshold===null||MONEY4.test(value.capitalization_threshold));
}

export function classifyRetainedInvoice(invoice,{capitalizationPolicy=null}={}){
  if(!validEnvelope(invoice))return baseResult(invoice||{},'BLOCKED','Required retained invoice evidence is missing or invalid.',0,['source_evidence_correction']);
  if(invoice.duplicate_status!=='NONE')return baseResult(invoice,'BLOCKED','Possible or confirmed duplicate invoice requires AP review before accounting classification.',1,['duplicate_resolution'],'AI_DUPLICATE_INVOICE_BLOCK_V1');
  if((invoice.service_period_start===null)!==(invoice.service_period_end===null))return baseResult(invoice,'BLOCKED','A service period must include both start and end dates.',1,['service_period_start','service_period_end']);
  if(invoice.service_period_start&&invoice.service_period_end&&invoice.service_period_start>invoice.service_period_end)return baseResult(invoice,'BLOCKED','The retained service period is reversed.',1,['service_period_correction']);

  if(invoice.service_period_start&&monthsSpanned(invoice.service_period_start,invoice.service_period_end)>1){
    return baseResult(invoice,'PREPAID_AMORTIZATION','The retained invoice covers more than one calendar month and requires prepaid allocation review.',0.98,['prepaid_account','expense_account','amortization_start','amortization_method'],'AI_MULTI_PERIOD_PREPAID_V1');
  }
  const coverageCategory=prepaidIndicator(invoice);
  if(coverageCategory&&invoice.service_period_start===null&&invoice.service_period_end===null){
    return baseResult(invoice,'BLOCKED',`${coverageCategory.replaceAll('_',' ')} indicators were retained, but no service or coverage period was proven. Expense or capitalization treatment is blocked pending source evidence.`,1,['coverage_source_document','service_period_start','service_period_end'],'AI_PREPAID_COVERAGE_REQUIRED_V1');
  }

  const policyDecision=applyAiCapitalizationPolicy({policy:capitalizationPolicy,amount:invoice.amount,currency:invoice.currency,chargeCode:invoice.charge_code,projectRef:invoice.project_ref});
  if(policyDecision.status==='POLICY_BLOCKED')return baseResult(invoice,'BLOCKED',policyDecision.reason,1,policyDecision.required_human_fields,'AI_CAPITALIZATION_POLICY_V1',policyDecision.policy_evidence);
  if(['EXPENSE_BY_POLICY','NOT_APPLICABLE'].includes(policyDecision.status)&&invoice.accounting_status==='NOT_RECORDED'&&invoice.service_period_end&&invoice.service_period_end<invoice.invoice_date){
    return baseResult(invoice,'ACCRUAL_REVIEW','The service period ended before the invoice date and no accounting record is retained.',0.95,['accrual_period','expense_account','liability_account','reversal_decision'],'AI_PRIOR_SERVICE_ACCRUAL_REVIEW_V1',policyDecision.policy_evidence);
  }
  if(policyDecision.status==='CAPITALIZATION_REVIEW')return baseResult(invoice,'CAPITALIZATION_REVIEW',policyDecision.reason,0.99,policyDecision.required_human_fields,'AI_CAPITALIZATION_POLICY_V1',policyDecision.policy_evidence);
  if(policyDecision.status==='POST_COMPLETION_REVIEW')return baseResult(invoice,'CAPITALIZATION_REVIEW',policyDecision.reason,1,policyDecision.required_human_fields,'AI_POST_COMPLETION_CAPITALIZATION_V1',policyDecision.policy_evidence);
  if(policyDecision.status==='EXPENSE_BY_POLICY')return baseResult(invoice,'EXPENSE',policyDecision.reason,0.99,policyDecision.required_human_fields,'AI_CAPITALIZATION_POLICY_V1',policyDecision.policy_evidence);

  return baseResult(invoice,'EXPENSE','No retained multi-period coverage, capitalization basis, duplicate, or prior-period cutoff condition was found.',0.9,['expense_account','cost_center_or_member'],'AI_ORDINARY_EXPENSE_V1',policyDecision.policy_evidence);
}

export function classifyRetainedInvoiceBatch(rows,{capitalizationPolicy=null}={}){
  if(!Array.isArray(rows)||rows.length>500)throw Object.assign(new Error('Invoice classification requires an array of at most 500 retained rows.'),{code:'AI_INVOICE_CLASSIFICATION_SCOPE_INVALID'});
  const results=rows.map(row=>classifyRetainedInvoice(row,{capitalizationPolicy}));
  return Object.freeze({
    schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_BATCH_V1',
    row_count:results.length,
    results:Object.freeze(results),
    classification_counts:Object.freeze(Object.fromEntries(CLASSIFICATIONS.map(name=>[name,results.filter(row=>row.classification===name).length]))),
    action_flags:ACTIONS
  });
}
