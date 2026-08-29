import {isStrictCalendarDate} from './ai-calendar-date.mjs';
import {safeAiEvidenceTree} from './ai-secret-safety.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const MONEY4=/^(0|[1-9]\d*)\.\d{4}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const POLICY_FIELDS=['frequency_ratio_threshold_basis_points','minimum_excess_invoice_count','minimum_history_periods','policy_version','schema_version','setting_snapshot_hash','setting_snapshot_id'];
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const nullableText=(value,max)=>value===null||text(value,max);
const validDate=value=>DATE.test(value||'')&&isStrictCalendarDate(value);
const units=value=>BigInt(value.replace('.',''));
const money=value=>`${value/10000n}.${String(value%10000n).padStart(4,'0')}`;
const medianCount=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]*2:sorted[middle-1]+sorted[middle];};
const contextKey=row=>[row.entity_id,row.vendor_ref.trim().toUpperCase(),row.currency,row.project_ref??'ENTITY_ONLY',row.property_ref??'ENTITY_ONLY',row.cost_category_ref??'UNCLASSIFIED'].join('|');
const validRow=row=>row&&typeof row==='object'&&!Array.isArray(row)&&safeAiEvidenceTree(row,{maxArrayLength:500})&&UUID.test(row.source_document_id||'')&&UUID.test(row.source_document_line_id||'')&&SHA256.test(row.source_payload_hash||'')&&SHA256.test(row.source_line_hash||'')&&UUID.test(row.entity_id||'')&&UUID.test(row.accounting_period_id||'')&&text(row.vendor_ref,200)&&text(row.vendor_name,200)&&/^[A-Z]{3}$/.test(row.currency||'')&&MONEY4.test(row.amount||'')&&row.amount!=='0.0000'&&validDate(row.invoice_date)&&nullableText(row.project_ref,128)&&nullableText(row.property_ref,128)&&nullableText(row.cost_category_ref,128)&&row.source_admission_status==='ADMITTED'&&row.signature_verified===true;
const validPolicy=policy=>policy&&safeAiEvidenceTree(policy,{maxArrayLength:20})&&JSON.stringify(Object.keys(policy).sort())===JSON.stringify(POLICY_FIELDS)&&policy.schema_version==='AI_VENDOR_INVOICE_FREQUENCY_ANOMALY_POLICY_V1'&&UUID.test(policy.setting_snapshot_id||'')&&SHA256.test(policy.setting_snapshot_hash||'')&&Number.isSafeInteger(policy.policy_version)&&policy.policy_version>=1&&Number.isSafeInteger(policy.minimum_history_periods)&&policy.minimum_history_periods>=3&&policy.minimum_history_periods<=24&&Number.isSafeInteger(policy.frequency_ratio_threshold_basis_points)&&policy.frequency_ratio_threshold_basis_points>=20000&&policy.frequency_ratio_threshold_basis_points<=100000&&Number.isSafeInteger(policy.minimum_excess_invoice_count)&&policy.minimum_excess_invoice_count>=2&&policy.minimum_excess_invoice_count<=100;

export function detectVendorInvoiceFrequencyAnomalies(rows,{policy,currentAccountingPeriodId}={}){
  if(!Array.isArray(rows)||rows.length>500||!UUID.test(currentAccountingPeriodId||''))throw Object.assign(new Error('Vendor frequency analysis requires a current period and at most 500 retained invoice rows.'),{code:'AI_VENDOR_FREQUENCY_SCOPE_INVALID'});
  if(!validPolicy(policy))throw Object.assign(new Error('Vendor frequency analysis requires approved threshold policy evidence.'),{code:'AI_VENDOR_FREQUENCY_POLICY_REQUIRED'});
  if(rows.some(row=>!validRow(row)))throw Object.assign(new Error('Vendor frequency analysis accepts only complete admitted signed invoice evidence.'),{code:'AI_VENDOR_FREQUENCY_SOURCE_INVALID'});
  if(new Set(rows.map(row=>row.source_document_line_id)).size!==rows.length||new Set(rows.map(row=>row.source_line_hash)).size!==rows.length)throw Object.assign(new Error('Vendor frequency analysis requires unique retained invoice-line evidence.'),{code:'AI_VENDOR_FREQUENCY_SOURCE_DUPLICATE'});
  const grouped=new Map();
  for(const row of rows){const key=contextKey(row);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);}
  const findings=[];
  for(const group of grouped.values()){
    const current=group.filter(row=>row.accounting_period_id===currentAccountingPeriodId);if(current.length===0)continue;
    const historyByPeriod=new Map();for(const row of group){if(row.accounting_period_id===currentAccountingPeriodId)continue;historyByPeriod.set(row.accounting_period_id,(historyByPeriod.get(row.accounting_period_id)||0)+1);}
    if(historyByPeriod.size<policy.minimum_history_periods)continue;
    const baselineTwice=medianCount([...historyByPeriod.values()]),currentTwice=current.length*2,excessTwice=currentTwice-baselineTwice;
    if(excessTwice<policy.minimum_excess_invoice_count*2||currentTwice*10000<baselineTwice*policy.frequency_ratio_threshold_basis_points)continue;
    const ratioBasisPoints=Math.floor(currentTwice*10000/baselineTwice),total=money(current.reduce((sum,row)=>sum+units(row.amount),0n)),currentSourceTrace=current.map(row=>Object.freeze({source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,source_payload_hash:row.source_payload_hash,source_line_hash:row.source_line_hash})).sort((a,b)=>a.source_document_line_id.localeCompare(b.source_document_line_id));
    const representative=current[0];
    findings.push(Object.freeze({schema_version:'AI_VENDOR_INVOICE_FREQUENCY_ANOMALY_FINDING_V1',finding_type:'VENDOR_INVOICE_FREQUENCY_SPIKE',risk_level:ratioBasisPoints>=50000?'HIGH':'MEDIUM',rule_id:'AI_VENDOR_HISTORICAL_FREQUENCY_SPIKE_V1',entity_id:representative.entity_id,accounting_period_id:currentAccountingPeriodId,vendor_ref:representative.vendor_ref,vendor_name:representative.vendor_name,currency:representative.currency,project_ref:representative.project_ref,property_ref:representative.property_ref,cost_category_ref:representative.cost_category_ref,current_invoice_count:current.length,baseline_median_invoice_count:baselineTwice/2,excess_invoice_count:excessTwice/2,frequency_ratio_basis_points:ratioBasisPoints,current_total_amount:total,history_period_count:historyByPeriod.size,current_source_trace:Object.freeze(currentSourceTrace),reason:`The vendor submitted ${current.length} invoices in the current period versus a historical median of ${(baselineTwice/2).toFixed(1)} for the same accounting context.`,suggested_action:'Review for split invoices, duplicate billing, changed service volume, approval-limit avoidance, and source completeness before any accounting action.',confidence:Math.min(0.99,0.78+historyByPeriod.size*0.02),owner_role:'CONTROLLER_REVIEW',due_basis:'BEFORE_PERIOD_CLOSE',policy_evidence:Object.freeze({...policy}),action_flags:ACTIONS}));
  }
  return Object.freeze({schema_version:'AI_VENDOR_INVOICE_FREQUENCY_ANOMALY_BATCH_V1',current_accounting_period_id:currentAccountingPeriodId,scanned_line_count:rows.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
