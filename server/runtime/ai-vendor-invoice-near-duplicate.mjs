const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const MONEY4=/^(0|[1-9]\d*)\.\d{4}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const POLICY_KEYS=['maximum_absolute_amount_variance','maximum_amount_variance_basis_points','maximum_date_gap_days','policy_version','schema_version','setting_snapshot_hash','setting_snapshot_id'];
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&JSON.stringify(Object.keys(value).sort())===JSON.stringify(keys);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const nullableText=(value,max)=>value===null||text(value,max);
const date=value=>DATE.test(value||'')&&isStrictCalendarDate(value);
const units=value=>BigInt(value.replace('.',''));
const money=value=>`${value/10000n}.${String(value%10000n).padStart(4,'0')}`;
const normalizedInvoice=value=>value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
const context=row=>[row.entity_id,row.vendor_ref.trim().toUpperCase(),row.currency,row.project_ref??'ENTITY_ONLY',row.property_ref??'ENTITY_ONLY'].join('|');
const daysBetween=(left,right)=>Math.abs((Date.parse(`${left}T00:00:00Z`)-Date.parse(`${right}T00:00:00Z`))/86400000);
function validRow(row){return row&&typeof row==='object'&&!Array.isArray(row)&&UUID.test(row.source_document_id||'')&&UUID.test(row.source_document_line_id||'')&&SHA256.test(row.source_payload_hash||'')&&SHA256.test(row.source_line_hash||'')&&UUID.test(row.entity_id||'')&&UUID.test(row.accounting_period_id||'')&&text(row.vendor_ref,200)&&text(row.vendor_name,200)&&text(row.invoice_number,200)&&normalizedInvoice(row.invoice_number).length>=4&&/^[A-Z]{3}$/.test(row.currency||'')&&MONEY4.test(row.amount||'')&&row.amount!=='0.0000'&&date(row.invoice_date)&&nullableText(row.project_ref,128)&&nullableText(row.property_ref,128)&&row.source_admission_status==='ADMITTED'&&row.signature_verified===true;}
function validPolicy(policy){return exact(policy,POLICY_KEYS)&&policy.schema_version==='AI_VENDOR_INVOICE_NEAR_DUPLICATE_POLICY_V1'&&UUID.test(policy.setting_snapshot_id||'')&&SHA256.test(policy.setting_snapshot_hash||'')&&Number.isInteger(policy.policy_version)&&policy.policy_version>=1&&Number.isInteger(policy.maximum_date_gap_days)&&policy.maximum_date_gap_days>=0&&policy.maximum_date_gap_days<=31&&Number.isInteger(policy.maximum_amount_variance_basis_points)&&policy.maximum_amount_variance_basis_points>=0&&policy.maximum_amount_variance_basis_points<=1000&&MONEY4.test(policy.maximum_absolute_amount_variance||'');}

export function detectVendorInvoiceNearDuplicates(rows,{policy,currentAccountingPeriodId}={}){
  if(!Array.isArray(rows)||rows.length>500||!UUID.test(currentAccountingPeriodId||''))throw Object.assign(new Error('Near-duplicate analysis requires a current period and at most 500 retained invoice rows.'),{code:'AI_VENDOR_NEAR_DUPLICATE_SCOPE_INVALID'});
  if(!validPolicy(policy))throw Object.assign(new Error('Near-duplicate analysis requires approved policy evidence.'),{code:'AI_VENDOR_NEAR_DUPLICATE_POLICY_REQUIRED'});
  if(rows.some(row=>!validRow(row)))throw Object.assign(new Error('Near-duplicate analysis accepts only complete admitted signed invoice evidence.'),{code:'AI_VENDOR_NEAR_DUPLICATE_SOURCE_INVALID'});
  if(new Set(rows.map(row=>row.source_document_line_id)).size!==rows.length)throw Object.assign(new Error('Near-duplicate analysis requires unique retained invoice-line identities.'),{code:'AI_VENDOR_NEAR_DUPLICATE_SOURCE_DUPLICATE'});
  const sorted=[...rows].sort((a,b)=>a.source_document_line_id.localeCompare(b.source_document_line_id)),findings=[];
  for(let leftIndex=0;leftIndex<sorted.length;leftIndex++)for(let rightIndex=leftIndex+1;rightIndex<sorted.length;rightIndex++){
    const left=sorted[leftIndex],right=sorted[rightIndex];
    if(left.source_document_line_id===right.source_document_line_id||left.source_document_id===right.source_document_id||context(left)!==context(right)||![left.accounting_period_id,right.accounting_period_id].includes(currentAccountingPeriodId))continue;
    const leftNumber=normalizedInvoice(left.invoice_number),rightNumber=normalizedInvoice(right.invoice_number);
    if(leftNumber!==rightNumber||left.invoice_number.trim().toUpperCase()===right.invoice_number.trim().toUpperCase())continue;
    const leftAmount=units(left.amount),rightAmount=units(right.amount),amountVariance=leftAmount>rightAmount?leftAmount-rightAmount:rightAmount-leftAmount,larger=leftAmount>rightAmount?leftAmount:rightAmount;
    const varianceBasisPoints=Number(amountVariance*10000n/larger),dateGapDays=daysBetween(left.invoice_date,right.invoice_date);
    if(dateGapDays>policy.maximum_date_gap_days||amountVariance>units(policy.maximum_absolute_amount_variance)||varianceBasisPoints>policy.maximum_amount_variance_basis_points)continue;
    const sourceTrace=[left,right].map(row=>Object.freeze({source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,source_payload_hash:row.source_payload_hash,source_line_hash:row.source_line_hash,accounting_period_id:row.accounting_period_id,invoice_number:row.invoice_number,invoice_date:row.invoice_date,amount:row.amount}));
    findings.push(Object.freeze({schema_version:'AI_VENDOR_INVOICE_NEAR_DUPLICATE_FINDING_V1',finding_type:'VENDOR_INVOICE_NEAR_DUPLICATE',risk_level:amountVariance===0n?'HIGH':'MEDIUM',rule_id:'AI_VENDOR_INVOICE_NORMALIZED_ID_AMOUNT_DATE_V1',entity_id:left.entity_id,accounting_period_ids:Object.freeze([...new Set([left.accounting_period_id,right.accounting_period_id])].sort()),vendor_ref:left.vendor_ref,vendor_name:left.vendor_name,currency:left.currency,project_ref:left.project_ref,property_ref:left.property_ref,normalized_invoice_number:leftNumber,amount_variance:money(amountVariance),amount_variance_basis_points:varianceBasisPoints,date_gap_days:dateGapDays,reason:'Two separately retained vendor invoices have the same normalized invoice number and materially similar amount and date.',suggested_action:'Compare both signed source documents, receiving evidence, approvals, and payment status before accepting, paying, reversing, or creating any journal action.',confidence:amountVariance===0n&&dateGapDays<=1?0.97:0.88,owner_role:'CONTROLLER_REVIEW',due_basis:'BEFORE_PAYMENT_OR_PERIOD_CLOSE',required_human_fields:Object.freeze(['duplicate_determination','source_document_comparison','goods_or_services_received','payment_status','resolution_reason']),source_trace:Object.freeze(sourceTrace),policy_evidence:Object.freeze({...policy}),action_flags:ACTIONS}));
  }
  return Object.freeze({schema_version:'AI_VENDOR_INVOICE_NEAR_DUPLICATE_BATCH_V1',current_accounting_period_id:currentAccountingPeriodId,scanned_line_count:rows.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
import {isStrictCalendarDate} from './ai-calendar-date.mjs';
