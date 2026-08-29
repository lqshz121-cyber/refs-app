import {isStrictCalendarDate} from './ai-calendar-date.mjs';
import {safeAiEvidenceTree} from './ai-secret-safety.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY4=/^(0|[1-9]\d*)\.\d{4}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const POLICY_KEYS=['minimum_absolute_delta','minimum_history_periods','policy_version','ratio_threshold_basis_points','schema_version','setting_snapshot_hash','setting_snapshot_id'];
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&JSON.stringify(Object.keys(value).sort())===JSON.stringify(keys);
const validDate=value=>DATE.test(value||'')&&isStrictCalendarDate(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const nullableText=(value,max)=>value===null||text(value,max);
const units=value=>BigInt(value.replace('.',''));
const money=value=>`${value/10000n}.${String(value%10000n).padStart(4,'0')}`;
const median=values=>{const sorted=[...values].sort((a,b)=>a<b?-1:a>b?1:0),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2n;};
const contextKey=row=>[row.entity_id,row.vendor_ref.trim().toUpperCase(),row.currency,row.project_ref??'ENTITY_ONLY',row.property_ref??'ENTITY_ONLY',row.cost_category_ref??'UNCLASSIFIED'].join('|');
function validRow(row){return row&&typeof row==='object'&&!Array.isArray(row)&&safeAiEvidenceTree(row,{maxArrayLength:500})&&UUID.test(row.source_document_id||'')&&UUID.test(row.source_document_line_id||'')&&SHA256.test(row.source_payload_hash||'')&&SHA256.test(row.source_line_hash||'')&&UUID.test(row.entity_id||'')&&UUID.test(row.accounting_period_id||'')&&text(row.vendor_ref,200)&&text(row.vendor_name,200)&&/^[A-Z]{3}$/.test(row.currency||'')&&MONEY4.test(row.amount||'')&&row.amount!=='0.0000'&&validDate(row.invoice_date)&&nullableText(row.project_ref,128)&&nullableText(row.property_ref,128)&&nullableText(row.cost_category_ref,128)&&row.source_admission_status==='ADMITTED'&&row.signature_verified===true;}
function validPolicy(policy){return exact(policy,POLICY_KEYS)&&safeAiEvidenceTree(policy,{maxArrayLength:20})&&policy.schema_version==='AI_VENDOR_INVOICE_AMOUNT_ANOMALY_POLICY_V1'&&UUID.test(policy.setting_snapshot_id||'')&&SHA256.test(policy.setting_snapshot_hash||'')&&Number.isSafeInteger(policy.policy_version)&&policy.policy_version>=1&&Number.isSafeInteger(policy.minimum_history_periods)&&policy.minimum_history_periods>=3&&policy.minimum_history_periods<=24&&Number.isSafeInteger(policy.ratio_threshold_basis_points)&&policy.ratio_threshold_basis_points>=15000&&policy.ratio_threshold_basis_points<=100000&&MONEY4.test(policy.minimum_absolute_delta||'');}

export function detectVendorInvoiceAmountAnomalies(rows,{policy,currentAccountingPeriodId}={}){
  if(!Array.isArray(rows)||rows.length>500||!UUID.test(currentAccountingPeriodId||''))throw Object.assign(new Error('Vendor anomaly analysis requires a current period and at most 500 retained invoice rows.'),{code:'AI_VENDOR_ANOMALY_SCOPE_INVALID'});
  if(!validPolicy(policy))throw Object.assign(new Error('Vendor anomaly analysis requires approved threshold policy evidence.'),{code:'AI_VENDOR_ANOMALY_POLICY_REQUIRED'});
  if(rows.some(row=>!validRow(row)))throw Object.assign(new Error('Vendor anomaly analysis accepts only complete admitted signed invoice evidence.'),{code:'AI_VENDOR_ANOMALY_SOURCE_INVALID'});
  if(new Set(rows.map(row=>row.source_document_line_id)).size!==rows.length||new Set(rows.map(row=>row.source_line_hash)).size!==rows.length)throw Object.assign(new Error('Vendor anomaly analysis requires unique retained invoice-line evidence.'),{code:'AI_VENDOR_ANOMALY_SOURCE_DUPLICATE'});
  const findings=[];
  for(const current of rows.filter(row=>row.accounting_period_id===currentAccountingPeriodId)){
    const history=rows.filter(row=>row.accounting_period_id!==currentAccountingPeriodId&&contextKey(row)===contextKey(current));
    const periods=new Set(history.map(row=>row.accounting_period_id));
    if(periods.size<policy.minimum_history_periods)continue;
    const baseline=median(history.map(row=>units(row.amount))),amount=units(current.amount),delta=amount-baseline;
    if(delta<=0n||delta<units(policy.minimum_absolute_delta)||amount*10000n<baseline*BigInt(policy.ratio_threshold_basis_points))continue;
    const ratioBps=Number(amount*10000n/baseline);
    findings.push(Object.freeze({schema_version:'AI_VENDOR_INVOICE_AMOUNT_ANOMALY_FINDING_V1',finding_type:'VENDOR_INVOICE_AMOUNT_SPIKE',risk_level:ratioBps>=50000?'HIGH':'MEDIUM',rule_id:'AI_VENDOR_HISTORICAL_AMOUNT_SPIKE_V1',source_document_id:current.source_document_id,source_document_line_id:current.source_document_line_id,source_payload_hash:current.source_payload_hash,source_line_hash:current.source_line_hash,entity_id:current.entity_id,accounting_period_id:current.accounting_period_id,vendor_ref:current.vendor_ref,vendor_name:current.vendor_name,currency:current.currency,current_amount:current.amount,baseline_median_amount:money(baseline),absolute_delta:money(delta),ratio_basis_points:ratioBps,history_period_count:periods.size,history_line_count:history.length,history_source_line_hashes:Object.freeze(history.map(row=>row.source_line_hash).sort()),project_ref:current.project_ref,property_ref:current.property_ref,cost_category_ref:current.cost_category_ref,reason:`The current invoice amount is ${(ratioBps/10000).toFixed(2)}x the median of ${periods.size} retained prior periods for the same vendor and accounting context.`,suggested_action:'Review the invoice, contract, quantity, rate, duplicate status, and coding before any accounting action.',confidence:Math.min(0.99,0.8+periods.size*0.02),owner_role:'CONTROLLER_REVIEW',due_basis:'BEFORE_PERIOD_CLOSE',policy_evidence:Object.freeze({schema_version:policy.schema_version,setting_snapshot_id:policy.setting_snapshot_id,setting_snapshot_hash:policy.setting_snapshot_hash,policy_version:policy.policy_version,minimum_history_periods:policy.minimum_history_periods,ratio_threshold_basis_points:policy.ratio_threshold_basis_points,minimum_absolute_delta:policy.minimum_absolute_delta}),action_flags:ACTIONS}));
  }
  return Object.freeze({schema_version:'AI_VENDOR_INVOICE_AMOUNT_ANOMALY_BATCH_V1',current_accounting_period_id:currentAccountingPeriodId,scanned_line_count:rows.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
