const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^(0|[1-9]\d{0,17})\.\d{4}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const KEYS=Object.freeze(['accounting_period_id','amount','business_date','charge_code','currency','description','entity_id','lease_ref','party_ref','project_ref','property_ref','source_document_id','source_document_line_id','source_line_hash','source_payload_hash','unit_ref']);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const nullable=(value,max)=>value===null||text(value,max);
const date=value=>typeof value==='string'&&DATE.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const rules=Object.freeze([
  Object.freeze({classification:'RENT_REVENUE',pattern:/\b(?:rent|base\s+rent|monthly\s+rent)\b/i,risk_level:'LOW',accounting:'RENT_REVENUE_OR_RECEIVABLE',fields:['revenue_account','tenant_receivable_or_cash_match']}),
  Object.freeze({classification:'LATE_FEE_REVENUE',pattern:/\b(?:late\s+fee|late\s+charge)\b/i,risk_level:'LOW',accounting:'LATE_FEE_REVENUE_OR_RECEIVABLE',fields:['late_fee_revenue_account','collectibility']}),
  Object.freeze({classification:'CONCESSION',pattern:/\b(?:concession|rent\s+credit|free\s+rent|move[- ]in\s+special)\b/i,risk_level:'MEDIUM',accounting:'CONTRA_REVENUE_OR_LEASE_INCENTIVE_REVIEW',fields:['concession_policy','contra_revenue_or_lease_incentive_account','lease_term']}),
  Object.freeze({classification:'BAD_DEBT',pattern:/\b(?:bad\s+debt|write[- ]off|uncollectible|credit\s+loss)\b/i,risk_level:'HIGH',accounting:'BAD_DEBT_OR_CREDIT_LOSS_ALLOWANCE_REVIEW',fields:['collection_evidence','writeoff_approval','allowance_or_direct_writeoff_policy']}),
  Object.freeze({classification:'SECURITY_DEPOSIT',pattern:/\b(?:security\s+deposit|tenant\s+deposit|damage\s+deposit)\b/i,risk_level:'HIGH',accounting:'SECURITY_DEPOSIT_LIABILITY',fields:['deposit_liability_account','restricted_cash_account','deposit_disposition']}),
  Object.freeze({classification:'EXPENSE_REIMBURSEMENT',pattern:/\b(?:reimbursement|utility\s+recovery|cam\s+recovery|expense\s+recovery)\b/i,risk_level:'MEDIUM',accounting:'REIMBURSEMENT_REVENUE_OR_EXPENSE_OFFSET_REVIEW',fields:['gross_or_net_policy','recovery_account','underlying_expense_trace']}),
  Object.freeze({classification:'REPAIR_MAINTENANCE',pattern:/\b(?:repair|maintenance|plumbing|electrical|turnover|make[- ]ready)\b/i,risk_level:'MEDIUM',accounting:'REPAIR_EXPENSE_OR_CAPITALIZATION_REVIEW',fields:['expense_or_capital_policy','work_order','project_or_property_coding']})
]);

function valid(row){return row&&typeof row==='object'&&!Array.isArray(row)&&JSON.stringify(Object.keys(row).sort())===JSON.stringify([...KEYS].sort())&&UUID.test(row.source_document_id||'')&&UUID.test(row.source_document_line_id||'')&&SHA.test(row.source_payload_hash||'')&&SHA.test(row.source_line_hash||'')&&UUID.test(row.entity_id||'')&&UUID.test(row.accounting_period_id||'')&&date(row.business_date)&&text(row.charge_code,128)&&text(row.description,1000)&&MONEY.test(row.amount||'')&&row.amount!=='0.0000'&&/^[A-Z]{3}$/.test(row.currency||'')&&nullable(row.property_ref,128)&&nullable(row.project_ref,128)&&nullable(row.unit_ref,128)&&nullable(row.lease_ref,128)&&nullable(row.party_ref,200);}
const result=(row,{classification,risk_level='HIGH',rule_id,accounting,reason,action,fields})=>Object.freeze({schema_version:'AI_PROPERTY_MANAGEMENT_CHARGE_FINDING_V1',finding_type:'PROPERTY_MANAGEMENT_ACCOUNTING_REVIEW',risk_level,rule_id,source_document_id:row?.source_document_id??null,source_document_line_id:row?.source_document_line_id??null,source_payload_hash:row?.source_payload_hash??null,source_line_hash:row?.source_line_hash??null,entity_id:row?.entity_id??null,accounting_period_id:row?.accounting_period_id??null,classification,accounting_treatment:accounting,amount:row?.amount??null,currency:row?.currency??null,property_ref:row?.property_ref??null,unit_ref:row?.unit_ref??null,lease_ref:row?.lease_ref??null,reason,suggested_action:action,confidence:classification==='BLOCKED'?1:0.98,required_human_fields:Object.freeze(fields),action_flags:ACTIONS});

export function classifyPropertyManagementCharge(row){
  if(!valid(row))return result(row,{classification:'BLOCKED',rule_id:'AI_PROPERTY_MANAGEMENT_SOURCE_INVALID_V1',accounting:'UNDETERMINED',reason:'Property Management classification requires an exact source identity, period, date, charge code, amount, currency, and closed dimensions.',action:'Correct and retain the source evidence before selecting an accounting treatment.',fields:['source_evidence_correction']});
  if(row.property_ref===null)return result(row,{classification:'BLOCKED',rule_id:'AI_PROPERTY_MANAGEMENT_PROPERTY_REQUIRED_V1',accounting:'UNDETERMINED',reason:'The Property Management charge has no retained property identity.',action:'Resolve the authoritative property mapping before preparing any accounting entry.',fields:['property_mapping']});
  let matches=rules.filter(rule=>rule.pattern.test(`${row.charge_code} ${row.description}`));
  // "rent concession" necessarily contains the generic word "rent". An
  // explicit retained CONCESSION charge code resolves that linguistic overlap;
  // a RENT code paired with concession wording remains a true conflict.
  if(row.charge_code.trim().toUpperCase()==='CONCESSION'&&matches.some(rule=>rule.classification==='CONCESSION'))matches=matches.filter(rule=>rule.classification==='CONCESSION');
  if(matches.length!==1)return result(row,{classification:'BLOCKED',rule_id:'AI_PROPERTY_MANAGEMENT_NATURE_AMBIGUOUS_OR_UNSUPPORTED_V1',accounting:'UNDETERMINED',reason:matches.length?'The retained charge matches conflicting Property Management accounting treatments.':'The retained charge does not match a supported Property Management accounting treatment.',action:'Review the lease, resident activity, work order, and approved charge-code mapping.',fields:['charge_nature','charge_code_mapping','source_support']});
  const rule=matches[0];
  if(['RENT_REVENUE','LATE_FEE_REVENUE','CONCESSION','BAD_DEBT','SECURITY_DEPOSIT'].includes(rule.classification)&&(row.unit_ref===null||row.lease_ref===null||row.party_ref===null))return result(row,{classification:'BLOCKED',rule_id:'AI_PROPERTY_MANAGEMENT_TENANT_TRACE_REQUIRED_V1',accounting:'UNDETERMINED',reason:`${rule.classification.replaceAll('_',' ')} requires exact property, unit, lease, and tenant trace.`,action:'Resolve the missing unit, lease, or tenant identity before accounting treatment.',fields:['unit_ref','lease_ref','tenant_ref']});
  return result(row,{classification:rule.classification,risk_level:rule.risk_level,rule_id:`AI_PROPERTY_MANAGEMENT_${rule.classification}_V1`,accounting:rule.accounting,reason:`Retained Property Management evidence supports ${rule.classification.replaceAll('_',' ').toLowerCase()}; account selection and recognition remain subject to human review.`,action:'Reconcile the source charge to the lease, resident activity, cash or receivable, and posted GL before preparing a Draft Journal Entry.',fields:rule.fields});
}

export function classifyPropertyManagementChargeBatch(rows,{entityId,accountingPeriodId,limit=500}={}){
  if(!Array.isArray(rows)||rows.length>limit||!Number.isInteger(limit)||limit<1||limit>500||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||''))throw Object.assign(new Error('Property Management charge analysis requires one bounded entity and accounting period.'),{code:'AI_PROPERTY_MANAGEMENT_SCOPE_INVALID'});
  const findings=Object.freeze(rows.map(classifyPropertyManagementCharge));
  return Object.freeze({schema_version:'AI_PROPERTY_MANAGEMENT_CHARGE_REVIEW_BATCH_V1',current_accounting_period_id:accountingPeriodId,scanned_line_count:rows.length,finding_count:findings.length,findings,action_flags:ACTIONS});
}
