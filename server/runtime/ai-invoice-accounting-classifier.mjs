import {applyAiCapitalizationPolicy} from './ai-capitalization-policy.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY4=/^(0|[1-9]\d*)\.\d{4}$/;

const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const CLASSIFICATIONS=Object.freeze(['EXPENSE','PREPAID_AMORTIZATION','ACCRUAL_REVIEW','CAPITALIZATION_REVIEW','BLOCKED']);

const text=(value,max=500)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const nullableText=(value,max=500)=>value===null||text(value,max);
const date=value=>{if(typeof value!=='string'||!DATE.test(value))return false;const [year,month,day]=value.split('-').map(Number),parsed=new Date(Date.UTC(year,month-1,day));return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day;};
const nullableDate=value=>value===null||date(value);
const monthsSpanned=(start,end)=>{
  const a=new Date(`${start}T00:00:00Z`),b=new Date(`${end}T00:00:00Z`);
  return (b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth()+1;
};
const PREPAID_INDICATORS=Object.freeze([
  Object.freeze({category:'INSURANCE',pattern:/\b(?:insurance|premium|policy)\b/i}),
  Object.freeze({category:'SOFTWARE_SUBSCRIPTION',pattern:/\b(?:annual\s+software|software\s+subscription|saas\s+subscription)\b/i}),
  Object.freeze({category:'LICENSE',pattern:/\b(?:annual\s+licen[cs]e|licen[cs]e\s+renewal)\b/i}),
  Object.freeze({category:'LOAN_FEE',pattern:/\b(?:loan\s+fee|financing\s+fee|origination\s+fee)\b/i}),
  Object.freeze({category:'WARRANTY_OR_MAINTENANCE',pattern:/\b(?:extended\s+warranty|annual\s+maintenance|maintenance\s+contract)\b/i})
]);
// A property or real-estate tax assessment is a statutory obligation of the
// owner, not a vendor-supplied good or service purchased over a coverage
// window. It therefore cannot be proven from a PAYABLES description alone: the
// taxing jurisdiction, statement identity, assessed obligation basis and
// coverage dates only exist on a signed tax statement source that this runtime
// cannot yet read. Until that server-derived reader exists, any tax indicator
// fails closed so the generic multi-month coverage rule below can never present
// a statutory tax obligation as an ordinary prepaid asset.
const tokenSet=value=>new Set((typeof value==='string'?value.toLowerCase().match(/[a-z0-9]+/g):[])??[]);
const hasAny=(tokens,values)=>values.some(value=>tokens.has(value));
const hasAll=(tokens,values)=>values.every(value=>tokens.has(value));
const PROPERTY_TAX_SOURCE_TERMS=Object.freeze(['tax','taxes','levy','assessment','assessor','valuation','valorem','assessed','appraisal','appraisals','appraised','taxable','delinquent','certificate','millage','mill']);
const STRONG_PROPERTY_DOCUMENT_TERMS=Object.freeze(['notice','certificate','statement','bill','assessment','levy']);
const taxObligationIndicated=invoice=>{
  const descriptionTokens=tokenSet(invoice.description);
  // Without an authoritative document-type reader, text cannot safely decide
  // whether a property-tax-shaped source is the liability or a related service.
  // The description must carry the risk feature: a vendor name alone is never
  // sufficient, even when it contains "Property Tax" or "Tax Assessor".
  const ambiguousPropertyTaxSource=hasAny(descriptionTokens,PROPERTY_TAX_SOURCE_TERMS)||(descriptionTokens.has('value')&&hasAny(descriptionTokens,STRONG_PROPERTY_DOCUMENT_TERMS));
  const retainedPropertyRef=typeof invoice.property_ref==='string'&&invoice.property_ref.trim().length>0;
  const propertyContext=retainedPropertyRef||descriptionTokens.has('parcel')||descriptionTokens.has('property')||hasAll(descriptionTokens,['real','estate'])||hasAll(descriptionTokens,['ad','valorem'])||hasAll(descriptionTokens,['appraisal','district']);
  return ambiguousPropertyTaxSource&&propertyContext;
};

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
    text(value.vendor_ref??value.vendor_name,200)&&nullableText(value.invoice_no,128)&&date(value.invoice_date)&&date(value.accounting_date)&&
    /^[A-Z]{3}$/.test(value.currency||'')&&MONEY4.test(value.amount||'')&&value.amount!=='0.0000'&&
    nullableDate(value.service_period_start)&&nullableDate(value.service_period_end)&&
    nullableText(value.description,1000)&&nullableText(value.project_ref,128)&&nullableText(value.property_ref,128)&&nullableText(value.member_ref,128)&&nullableText(value.charge_code,128)&&(value.contract_id===undefined||nullableText(value.contract_id,128))&&(value.service_frequency===undefined||nullableText(value.service_frequency,128))&&
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

  // Ordering matters. This gate is evaluated before the approved capitalization
  // policy and before the generic multi-month coverage rule so that neither can
  // assign an accounting treatment, an account, or a suggested journal line to a
  // tax obligation that no retained source proves.
  if(taxObligationIndicated(invoice))return baseResult(invoice,'BLOCKED','The retained source contains property-tax, assessment, valuation, levy, assessed-value, or appraised-value evidence, but no authoritative document type proves whether it is a statutory obligation or a related service. Accounting treatment is blocked until a server-derived signed tax document identifies the source type, jurisdiction, obligation basis, and coverage.',1,['tax_statement_source_document','taxing_jurisdiction','tax_statement_identifier','tax_coverage_period','tax_obligation_basis'],'TAX_OBLIGATION_REQUIRES_TAX_STATEMENT_SOURCE');

  // Capital-nature project costs are governed by the approved capitalization
  // policy even when the vendor describes a multi-month work interval. A
  // construction invoice spanning several months is not, by that fact alone,
  // a prepaid asset. Evaluate the source-bound policy before the coverage rule
  // so eligible CWIP/fixed-asset costs cannot be silently misclassified.
  const policyDecision=applyAiCapitalizationPolicy({policy:capitalizationPolicy,amount:invoice.amount,currency:invoice.currency,chargeCode:invoice.charge_code,projectRef:invoice.project_ref,propertyRef:invoice.property_ref,memberRef:invoice.member_ref,accountingDate:invoice.accounting_date});
  if(policyDecision.status==='CAPITALIZATION_REVIEW')return baseResult(invoice,'CAPITALIZATION_REVIEW',policyDecision.reason,0.99,policyDecision.required_human_fields,policyDecision.selected_rule?.rule_id??'AI_CAPITALIZATION_POLICY_V1',policyDecision.policy_evidence);
  if(policyDecision.status==='POST_COMPLETION_REVIEW')return baseResult(invoice,'CAPITALIZATION_REVIEW',policyDecision.reason,1,policyDecision.required_human_fields,policyDecision.selected_rule?.rule_id??'AI_POST_COMPLETION_CAPITALIZATION_V1',policyDecision.policy_evidence);

  if(invoice.service_period_start&&monthsSpanned(invoice.service_period_start,invoice.service_period_end)>1){
    return baseResult(invoice,'PREPAID_AMORTIZATION','The retained invoice covers more than one calendar month and requires prepaid allocation review.',0.98,['prepaid_account','expense_account','amortization_start','amortization_method'],'AI_MULTI_PERIOD_PREPAID_V1',policyDecision.policy_evidence);
  }
  const coverageCategory=prepaidIndicator(invoice);
  if(coverageCategory&&invoice.service_period_start===null&&invoice.service_period_end===null){
    return baseResult(invoice,'BLOCKED',`${coverageCategory.replaceAll('_',' ')} indicators were retained, but no service or coverage period was proven. Expense or capitalization treatment is blocked pending source evidence.`,1,['coverage_source_document','service_period_start','service_period_end'],'AI_PREPAID_COVERAGE_REQUIRED_V1');
  }

  if(policyDecision.status==='POLICY_BLOCKED')return baseResult(invoice,'BLOCKED',policyDecision.reason,1,policyDecision.required_human_fields,policyDecision.selected_rule?.rule_id??'AI_CAPITALIZATION_POLICY_V1',policyDecision.policy_evidence);
  if(['EXPENSE_BY_POLICY','NOT_APPLICABLE'].includes(policyDecision.status)&&invoice.accounting_status==='NOT_RECORDED'&&invoice.service_period_end&&invoice.service_period_end<invoice.invoice_date){
    return baseResult(invoice,'ACCRUAL_REVIEW','The service period ended before the invoice date and no accounting record is retained.',0.95,['accrual_period','expense_account','liability_account','reversal_decision'],'AI_PRIOR_SERVICE_ACCRUAL_REVIEW_V1',policyDecision.policy_evidence);
  }
  if(policyDecision.status==='EXPENSE_BY_POLICY')return baseResult(invoice,'EXPENSE',policyDecision.reason,0.99,policyDecision.required_human_fields,policyDecision.selected_rule?.rule_id??'AI_CAPITALIZATION_POLICY_V1',policyDecision.policy_evidence);

  return baseResult(invoice,'EXPENSE','No retained multi-period coverage, capitalization basis, duplicate, or prior-period cutoff condition was found.',0.9,['expense_account','cost_center_or_member'],'AI_ORDINARY_EXPENSE_V1',policyDecision.policy_evidence);
}

export function classifyRetainedInvoiceBatch(rows,{capitalizationPolicy=null}={}){
  if(!Array.isArray(rows)||rows.length>10000)throw Object.assign(new Error('Invoice classification requires an array of at most 10000 retained rows.'),{code:'AI_INVOICE_CLASSIFICATION_SCOPE_INVALID'});
  const results=rows.map(row=>classifyRetainedInvoice(row,{capitalizationPolicy}));
  return Object.freeze({
    schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_BATCH_V1',
    row_count:results.length,
    results:Object.freeze(results),
    classification_counts:Object.freeze(Object.fromEntries(CLASSIFICATIONS.map(name=>[name,results.filter(row=>row.classification===name).length]))),
    action_flags:ACTIONS
  });
}
