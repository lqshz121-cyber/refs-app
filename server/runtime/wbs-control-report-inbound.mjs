// A future WBS report provider may use the existing read-only control-total
// envelope, but a generic total is not enough to reconcile Cost GL or
// Property Comparison. This adapter turns only a verified, report-scoped
// metric envelope into the exact evidence shape consumed by the REFS control
// reconciler. It intentionally has no transaction, allocation, Draft, or
// posting capability.
import {canonicalRequestHash} from './request-hash.mjs';
import {validateWbsReadEnvelope} from './wbs-readonly-mcp.mjs';

const text=value=>value==null?'':String(value).trim();
const decimal=value=>{
  // Provider monetary evidence must arrive as canonical decimal text.  A JSON
  // number has already crossed a binary floating-point boundary before this
  // adapter can verify its receipt/hash relationship.
  const candidate=typeof value==='string'?value.trim():'';
  if(!/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(candidate))return null;
  const negative=candidate.startsWith('-'),unsigned=negative?candidate.slice(1):candidate;
  const [whole,fraction='']=unsigned.split('.');
  const scaled=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
  const absolute=negative?-scaled:scaled;
  return `${negative?'-':''}${absolute/10000n}.${String(absolute%10000n).padStart(4,'0')}`;
};
const isHash=value=>/^sha256:[0-9a-f]{64}$/.test(text(value));
const isCurrency=value=>/^[A-Z]{3}$/.test(text(value));
const isPeriod=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(text(value));
const isDate=value=>{const candidate=text(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(candidate))return false;const parsed=new Date(`${candidate}T00:00:00.000Z`);return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===candidate;};
const freeze=value=>Object.freeze(value);
const reportKind=sourceType=>sourceType==='COST_GENERAL_LEDGER'?'COST_GENERAL_LEDGER':sourceType==='PROPERTY_COMPARISON'?'PROPERTY_COMPARISON':null;
const requiredScope=sourceType=>sourceType==='COST_GENERAL_LEDGER'?['tenant_id','entity_id','company_key','period','currency']:['tenant_id','entity_id','company_key','property_ref','period_start','period_end','currency','bank_account_ref'];
const metricsHash=metrics=>canonicalRequestHash([...metrics].sort((left,right)=>left.metric_key.localeCompare(right.metric_key)));

export class WbsControlReportInboundError extends Error {
  constructor(code,message){super(message);this.name='WbsControlReportInboundError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsControlReportInboundError(code,message);};

function verifiedReceipt(receipt,contentHash){
  if(!receipt||receipt.signature_verified!==true||text(receipt.algorithm)!=='Ed25519'||!text(receipt.key_id)||!text(receipt.ref)||!text(receipt.version)||!isHash(receipt.manifest_hash)||text(receipt.hash)!==`sha256:${contentHash}`)fail('WBS_CONTROL_REPORT_RECEIPT_REQUIRED','A verified Ed25519 receipt bound to the exact WBS control-report content hash is required.');
  return freeze({hash:text(receipt.hash),ref:text(receipt.ref),version:text(receipt.version),signature_verified:true,manifest_hash:text(receipt.manifest_hash),key_id:text(receipt.key_id),algorithm:'Ed25519'});
}

function canonicalScope(sourceType,scope,{tenantId,entityId}){
  const keys=requiredScope(sourceType), value={tenant_id:text(tenantId),entity_id:text(entityId),company_key:text(scope?.company),currency:text(scope?.currency).toUpperCase(),period:text(scope?.period),property_ref:text(scope?.property_ref),period_start:text(scope?.period_start),period_end:text(scope?.period_end),bank_account_ref:text(scope?.bank_account_ref)};
  if(keys.some(key=>!value[key])||!isCurrency(value.currency))fail('WBS_CONTROL_REPORT_SCOPE_REQUIRED','The WBS control report requires complete authenticated tenant/entity and provider report scope.');
  if(sourceType==='COST_GENERAL_LEDGER'&&!isPeriod(value.period))fail('WBS_CONTROL_REPORT_SCOPE_REQUIRED','Cost General Ledger requires a YYYY-MM provider accounting period.');
  if(sourceType==='PROPERTY_COMPARISON'&&(!isDate(value.period_start)||!isDate(value.period_end)||value.period_start>value.period_end))fail('WBS_CONTROL_REPORT_SCOPE_REQUIRED','Property Comparison requires an inclusive valid provider date range.');
  return freeze(Object.fromEntries(keys.map(key=>[key,value[key]])));
}

function canonicalMetrics(rows,sourceType){
  if(!Array.isArray(rows)||rows.length===0)fail('WBS_CONTROL_REPORT_METRICS_REQUIRED','Control report metric rows are required.');
  const seen=new Set(),metrics=[];
  for(const row of rows){
    const metricKey=text(row?.metric_key),amount=decimal(row?.amount);
    if(!/^[A-Z][A-Z0-9_]{1,95}$/.test(metricKey)||amount===null||seen.has(metricKey))fail('WBS_CONTROL_REPORT_METRICS_INVALID','Control report metrics require unique keys and canonical four-decimal amounts.');
    seen.add(metricKey);metrics.push(freeze({metric_key:metricKey,amount}));
  }
  if(sourceType==='COST_GENERAL_LEDGER'&&metrics.length!==14)fail('WBS_COST_GL_METRIC_CARDINALITY_REQUIRED','Cost General Ledger requires exactly fourteen provider-defined metrics.');
  return freeze(metrics);
}

// `list_control_totals` is deliberately treated as insufficient unless the
// provider explicitly identifies which report it produced and supplies its
// metric rows and formula/version. That keeps an unrelated dashboard total
// from being relabeled as Cost GL or Property evidence.
export function buildWbsControlReportEvidence({sourceType,envelope,receipt,tenantId,entityId}={}){
  const kind=reportKind(sourceType);if(!kind)fail('WBS_CONTROL_REPORT_SOURCE_TYPE_INVALID','Only Cost General Ledger and Property Comparison reports are supported.');
  const accepted=validateWbsReadEnvelope({toolName:'list_control_totals',envelope});
  if(text(accepted.scope?.report_type)!==kind||!text(accepted.source?.report_formula_id)||!text(accepted.source?.report_formula_version))fail('WBS_CONTROL_REPORT_IDENTITY_REQUIRED','The provider must declare the report type and immutable report formula identity.');
  const scope=canonicalScope(sourceType,accepted.scope,{tenantId,entityId});
  const metricRows=canonicalMetrics(accepted.rows,sourceType);
  const receiptTrace=verifiedReceipt(receipt,accepted.content_sha256);
  const computedMetricsHash=metricsHash(metricRows);
  return freeze({
    source_type:sourceType,scope,metrics:metricRows,
    source_receipt:freeze({...receiptTrace,metrics_hash:computedMetricsHash,scope}),
    provider_report:freeze({report_type:kind,formula_id:text(accepted.source.report_formula_id),formula_version:text(accepted.source.report_formula_version),captured_at:accepted.captured_at,content_hash:`sha256:${accepted.content_sha256}`}),
    can_create_transaction:false,can_allocate:false,can_create_draft:false,can_post:false
  });
}
