// WBS reports are control evidence, never transaction producers. This pure
// REFS-side verifier compares only receipt-bound, approved, scoped metrics and
// deliberately exposes no Draft, AutoRec allocation, or posting capability.
const text=value=>value==null?'':String(value).trim();
const decimal=value=>Number.isFinite(Number(value))?Number(Number(value).toFixed(4)):null;
const freeze=value=>Object.freeze(value);
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value))&&new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10)===value;

export class WbsControlReconciliationError extends Error {
  constructor(code,message){super(message);this.name='WbsControlReconciliationError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsControlReconciliationError(code,message);};
const exactScope=(left,right,keys)=>keys.every(key=>text(left?.[key])===text(right?.[key]));
const sourceFor=type=>type==='COST_GENERAL_LEDGER'?'WBS_COST_GL_CONTROL_RECONCILIATION':'WBS_PROPERTY_CONTROL_RECONCILIATION';
const COST_GENERAL_LEDGER_METRIC_COUNT=14;

function validateReceipt(receipt,label){
  if(!receipt||typeof receipt!=='object'||!/^sha256:[0-9a-f]{64}$/.test(text(receipt.hash))||!text(receipt.ref)||!text(receipt.version))fail('WBS_CONTROL_RECEIPT_REQUIRED',`${label} requires immutable receipt hash, reference, and version.`);
  return freeze({hash:text(receipt.hash),ref:text(receipt.ref),version:text(receipt.version)});
}
function metricMap(rows,label){
  if(!Array.isArray(rows)||rows.length===0)fail('WBS_CONTROL_METRICS_REQUIRED',`${label} control metrics are required.`);
  const result=new Map();
  for(const row of rows){const key=text(row?.metric_key),value=decimal(row?.amount);if(!/^[A-Z][A-Z0-9_]{1,95}$/.test(key)||value===null||result.has(key))fail('WBS_CONTROL_METRICS_INVALID',`${label} control metrics need unique keys and four-decimal amounts.`);result.set(key,value);}
  return result;
}

export function reconcileWbsControlEvidence({sourceType,scope,sourceReceipt,targetReceipt,approvedMapping,sourceMetrics,targetMetrics}={}){
  if(!['COST_GENERAL_LEDGER','PROPERTY_COMPARISON'].includes(sourceType))fail('WBS_CONTROL_SOURCE_TYPE_INVALID','Only Cost General Ledger and Property Comparison control sources are supported.');
  const scopeKeys=sourceType==='COST_GENERAL_LEDGER'?['company_key','period','currency']:['company_key','period_start','period_end','currency','bank_account_ref'];
  if(!scope||!scopeKeys.every(key=>text(scope[key])))fail('WBS_CONTROL_SCOPE_REQUIRED','Control reconciliation requires the complete source scope.');
  if(sourceType==='PROPERTY_COMPARISON'&&(!validDate(scope.period_start)||!validDate(scope.period_end)||scope.period_start>scope.period_end))fail('WBS_PROPERTY_PERIOD_INVALID','Property Comparison requires a valid inclusive date range.');
  const source=validateReceipt(sourceReceipt,'WBS source'),target=validateReceipt(targetReceipt,'REFS target');
  if(!approvedMapping||text(approvedMapping.status)!=='APPROVED'||text(approvedMapping.mapping_type)!==sourceFor(sourceType)||!text(approvedMapping.mapping_id)||!text(approvedMapping.version)||!exactScope(approvedMapping.scope,scope,scopeKeys))fail('WBS_CONTROL_MAPPING_REQUIRED','A single approved control-reconciliation mapping with exact scope is required.');
  const sourceByKey=metricMap(sourceMetrics,'WBS source'),targetByKey=metricMap(targetMetrics,'REFS target');
  const expected=Array.isArray(approvedMapping.metric_keys)?approvedMapping.metric_keys.map(text):[];
  if((sourceType==='COST_GENERAL_LEDGER'&&expected.length!==COST_GENERAL_LEDGER_METRIC_COUNT)||!expected.length||new Set(expected).size!==expected.length||expected.some(key=>!sourceByKey.has(key)||!targetByKey.has(key))||sourceByKey.size!==expected.length||targetByKey.size!==expected.length)fail('WBS_CONTROL_MAPPING_INCOMPLETE','Approved mapping must name every and only source and target control metric. Cost General Ledger requires exactly fourteen approved metrics.');
  const comparisons=expected.sort().map(metricKey=>{
    const sourceAmount=sourceByKey.get(metricKey),targetAmount=targetByKey.get(metricKey),difference=Number((targetAmount-sourceAmount).toFixed(4));
    return freeze({metric_key:metricKey,source_amount:sourceAmount,target_amount:targetAmount,difference,matched:difference===0,forward_trace:freeze({source_receipt_hash:source.hash,source_receipt_version:source.version,mapping_id:text(approvedMapping.mapping_id),mapping_version:text(approvedMapping.version)}),reverse_trace:freeze({target_receipt_hash:target.hash,target_receipt_version:target.version,mapping_id:text(approvedMapping.mapping_id),mapping_version:text(approvedMapping.version)})});
  });
  const differenceCount=comparisons.filter(row=>!row.matched).length;
  return freeze({source_type:sourceType,status:differenceCount===0?'RECONCILED':'DIFFERENCE',scope:freeze(Object.fromEntries(scopeKeys.map(key=>[key,text(scope[key])]))),comparisons:freeze(comparisons),control_totals:freeze({metric_count:comparisons.length,difference_count:differenceCount,source_total:Number(comparisons.reduce((sum,row)=>sum+row.source_amount,0).toFixed(4)),target_total:Number(comparisons.reduce((sum,row)=>sum+row.target_amount,0).toFixed(4)),difference_total:Number(comparisons.reduce((sum,row)=>sum+row.difference,0).toFixed(4))}),receipt_trace:freeze({source,target}),mapping_trace:freeze({mapping_id:text(approvedMapping.mapping_id),version:text(approvedMapping.version),mapping_type:text(approvedMapping.mapping_type)}),can_create_transaction:false,can_allocate:false,can_create_draft:false,can_post:false});
}
