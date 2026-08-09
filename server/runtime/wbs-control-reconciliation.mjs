// WBS reports are control evidence, never transaction producers. This pure
// REFS-side verifier compares only receipt-bound, approved, scoped metrics and
// deliberately exposes no Draft, AutoRec allocation, or posting capability.
import {canonicalRequestHash} from './request-hash.mjs';

const text=value=>value==null?'':String(value).trim();
// Metric inputs are canonical decimals. Treat a missing field as missing,
// rather than allowing JavaScript's Number('')/Number(null) coercion to turn
// it into a false zero control total.
const decimal=value=>{
  const candidate=typeof value==='number'?(Number.isFinite(value)?String(value):''):typeof value==='string'?value.trim():'';
  if(!/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(candidate))return null;
  const parsed=Number(candidate),scaled=parsed*10000;
  return Number.isFinite(parsed)&&Number.isSafeInteger(Math.round(scaled))?Number(parsed.toFixed(4)):null;
};
const freeze=value=>Object.freeze(value);
const validDate=value=>{const normalized=text(value);return /^\d{4}-\d{2}-\d{2}$/.test(normalized)&&new Date(`${normalized}T00:00:00.000Z`).toISOString().slice(0,10)===normalized;};
const validPeriod=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(text(value));
const validCurrency=value=>/^[A-Z]{3}$/.test(text(value));

export class WbsControlReconciliationError extends Error {
  constructor(code,message){super(message);this.name='WbsControlReconciliationError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsControlReconciliationError(code,message);};
const exactScope=(left,right,keys)=>keys.every(key=>text(left?.[key])===text(right?.[key]));
const sourceFor=type=>type==='COST_GENERAL_LEDGER'?'WBS_COST_GL_CONTROL_RECONCILIATION':'WBS_PROPERTY_CONTROL_RECONCILIATION';
const COST_GENERAL_LEDGER_METRIC_COUNT=14;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const scopeKeysFor=sourceType=>sourceType==='COST_GENERAL_LEDGER'?['tenant_id','entity_id','company_key','period','currency']:['tenant_id','entity_id','company_key','property_ref','period_start','period_end','currency','bank_account_ref'];

function validateReceipt(receipt,label,scope,scopeKeys){
  if(!receipt||typeof receipt!=='object'||!/^sha256:[0-9a-f]{64}$/.test(text(receipt.hash))||!/^sha256:[0-9a-f]{64}$/.test(text(receipt.metrics_hash))||!text(receipt.ref)||!text(receipt.version))fail('WBS_CONTROL_RECEIPT_REQUIRED',`${label} requires immutable receipt hash, metrics hash, reference, and version.`);
  if(!receipt.scope||typeof receipt.scope!=='object'||!scopeKeys.every(key=>text(receipt.scope[key])))fail('WBS_CONTROL_RECEIPT_SCOPE_REQUIRED',`${label} receipt requires the complete reconciliation scope.`);
  if(!exactScope(receipt.scope,scope,scopeKeys))fail('WBS_CONTROL_RECEIPT_SCOPE_MISMATCH',`${label} receipt scope must exactly match the reconciliation scope.`);
  return freeze({hash:text(receipt.hash),metrics_hash:text(receipt.metrics_hash),ref:text(receipt.ref),version:text(receipt.version),scope:freeze(Object.fromEntries(scopeKeys.map(key=>[key,text(receipt.scope[key])])))});
}
function metricMap(rows,label){
  if(!Array.isArray(rows)||rows.length===0)fail('WBS_CONTROL_METRICS_REQUIRED',`${label} control metrics are required.`);
  const result=new Map();
  for(const row of rows){const key=text(row?.metric_key),value=decimal(row?.amount);if(!/^[A-Z][A-Z0-9_]{1,95}$/.test(key)||value===null||result.has(key))fail('WBS_CONTROL_METRICS_INVALID',`${label} control metrics need unique keys and four-decimal amounts.`);result.set(key,value);}
  return result;
}
function metricsFingerprint(metrics){return canonicalRequestHash([...metrics.entries()].sort(([left],[right])=>left.localeCompare(right)).map(([metric_key,amount])=>({metric_key,amount})));}

export function reconcileWbsControlEvidence({sourceType,scope,sourceReceipt,targetReceipt,approvedMapping,sourceMetrics,targetMetrics}={}){
  if(!['COST_GENERAL_LEDGER','PROPERTY_COMPARISON'].includes(sourceType))fail('WBS_CONTROL_SOURCE_TYPE_INVALID','Only Cost General Ledger and Property Comparison control sources are supported.');
  const scopeKeys=scopeKeysFor(sourceType);
  if(!scope||!scopeKeys.every(key=>text(scope[key])))fail('WBS_CONTROL_SCOPE_REQUIRED','Control reconciliation requires the complete source scope.');
  const canonicalScope=freeze(Object.fromEntries(scopeKeys.map(key=>[key,text(scope[key])])));
  if(!validCurrency(canonicalScope.currency))fail('WBS_CONTROL_CURRENCY_INVALID','Control reconciliation requires an ISO uppercase currency code.');
  if(sourceType==='COST_GENERAL_LEDGER'&&!validPeriod(canonicalScope.period))fail('WBS_COST_GL_PERIOD_INVALID','Cost General Ledger requires an accounting period in YYYY-MM format.');
  if(sourceType==='PROPERTY_COMPARISON'&&(!validDate(canonicalScope.period_start)||!validDate(canonicalScope.period_end)||canonicalScope.period_start>canonicalScope.period_end))fail('WBS_PROPERTY_PERIOD_INVALID','Property Comparison requires a valid inclusive date range.');
  const source=validateReceipt(sourceReceipt,'WBS source',canonicalScope,scopeKeys),target=validateReceipt(targetReceipt,'REFS target',canonicalScope,scopeKeys);
  if(!approvedMapping||text(approvedMapping.status)!=='APPROVED'||text(approvedMapping.mapping_type)!==sourceFor(sourceType)||!text(approvedMapping.mapping_id)||!text(approvedMapping.version)||!exactScope(approvedMapping.scope,canonicalScope,scopeKeys))fail('WBS_CONTROL_MAPPING_REQUIRED','A single approved control-reconciliation mapping with exact scope is required.');
  const sourceByKey=metricMap(sourceMetrics,'WBS source'),targetByKey=metricMap(targetMetrics,'REFS target');
  if(source.metrics_hash!==metricsFingerprint(sourceByKey)||target.metrics_hash!==metricsFingerprint(targetByKey))fail('WBS_CONTROL_RECEIPT_METRICS_MISMATCH','Control metrics must exactly match the immutable receipt metric fingerprint.');
  const expected=Array.isArray(approvedMapping.metric_keys)?approvedMapping.metric_keys.map(text):[];
  if((sourceType==='COST_GENERAL_LEDGER'&&expected.length!==COST_GENERAL_LEDGER_METRIC_COUNT)||!expected.length||new Set(expected).size!==expected.length||expected.some(key=>!sourceByKey.has(key)||!targetByKey.has(key))||sourceByKey.size!==expected.length||targetByKey.size!==expected.length)fail('WBS_CONTROL_MAPPING_INCOMPLETE','Approved mapping must name every and only source and target control metric. Cost General Ledger requires exactly fourteen approved metrics.');
  const comparisons=expected.sort().map(metricKey=>{
    const sourceAmount=sourceByKey.get(metricKey),targetAmount=targetByKey.get(metricKey),difference=Number((targetAmount-sourceAmount).toFixed(4));
    return freeze({metric_key:metricKey,source_amount:sourceAmount,target_amount:targetAmount,difference,matched:difference===0,forward_trace:freeze({source_receipt_hash:source.hash,source_receipt_version:source.version,mapping_id:text(approvedMapping.mapping_id),mapping_version:text(approvedMapping.version)}),reverse_trace:freeze({target_receipt_hash:target.hash,target_receipt_version:target.version,mapping_id:text(approvedMapping.mapping_id),mapping_version:text(approvedMapping.version)})});
  });
  const differenceCount=comparisons.filter(row=>!row.matched).length;
  // Cost GL / Property metric sets can mix balances, flows, and counts. The
  // aggregate is diagnostic only: reconciliation status is determined by each
  // approved metric's exact four-decimal difference, never by an offsetting
  // aggregate total.
  return freeze({source_type:sourceType,status:differenceCount===0?'RECONCILED':'DIFFERENCE',scope:canonicalScope,comparisons:freeze(comparisons),control_totals:freeze({metric_count:comparisons.length,difference_count:differenceCount,source_total:Number(comparisons.reduce((sum,row)=>sum+row.source_amount,0).toFixed(4)),target_total:Number(comparisons.reduce((sum,row)=>sum+row.target_amount,0).toFixed(4)),difference_total:Number(comparisons.reduce((sum,row)=>sum+row.difference,0).toFixed(4)),aggregate_semantics:'DIAGNOSTIC_ONLY',aggregate_can_prove_reconciled:false,reconciliation_basis:'EXACT_PER_APPROVED_METRIC'}),receipt_trace:freeze({source,target}),mapping_trace:freeze({mapping_id:text(approvedMapping.mapping_id),version:text(approvedMapping.version),mapping_type:text(approvedMapping.mapping_type)}),can_create_transaction:false,can_allocate:false,can_create_draft:false,can_post:false});
}

const blocked=(code,replayed=false)=>freeze({status:'BLOCKED',code,replayed,comparisons:freeze([]),can_create_transaction:false,can_allocate:false,can_create_draft:false,can_post:false});
const controlSelection=input=>{
  const sourceType=text(input?.sourceType),tenantId=text(input?.tenantId),entityId=text(input?.entityId),replayKey=text(input?.replayKey),scope=input?.scope,keys=scopeKeysFor(sourceType);
  if(!['COST_GENERAL_LEDGER','PROPERTY_COMPARISON'].includes(sourceType)||!tenantId||!entityId||!replayKey||!plain(scope)||!keys.every(key=>text(scope[key])))return null;
  const canonicalScope=freeze(Object.fromEntries(keys.map(key=>[key,text(scope[key])])));
  if(canonicalScope.tenant_id!==tenantId||canonicalScope.entity_id!==entityId)return null;
  return freeze({sourceType,tenantId,entityId,replayKey,scope:canonicalScope});
};
const snapshotScoped=(snapshot,selection,{source=false}={})=>plain(snapshot)&&text(snapshot.tenant_id)===selection.tenantId&&text(snapshot.entity_id)===selection.entityId&&(!source||text(snapshot.source_type)===selection.sourceType)&&exactScope(snapshot.scope,selection.scope,scopeKeysFor(selection.sourceType));
const snapshotTrace=(snapshot,label)=>{
  const snapshotId=text(snapshot?.snapshot_id);if(!snapshotId)fail('WBS_CONTROL_READ_TRACE_REQUIRED',`${label} requires its persisted immutable snapshot id.`);
  return freeze({snapshot_id:snapshotId,receipt_hash:text(snapshot.receipt?.hash),receipt_ref:text(snapshot.receipt?.ref),receipt_version:text(snapshot.receipt?.version)});
};
const signedWbsSourceTrace=snapshot=>{
  const trace=snapshotTrace(snapshot,'WBS control snapshot'),receipt=snapshot?.receipt;
  if(receipt?.signature_verified!==true||!/^sha256:[0-9a-f]{64}$/.test(text(receipt?.manifest_hash))||!text(receipt?.key_id)||text(receipt?.algorithm)!=='Ed25519')fail('WBS_CONTROL_SOURCE_SIGNATURE_REQUIRED','WBS control snapshot requires a persisted verified Ed25519 receipt manifest.');
  return freeze({...trace,receipt_manifest_hash:text(receipt.manifest_hash),receipt_key_id:text(receipt.key_id),receipt_algorithm:text(receipt.algorithm)});
};

// Read composition only. It requires the kernel to supply already-persisted,
// immutable receipt-backed source and REFS target metric snapshots. The WBS
// boundary never calls a provider or mutates accounting state from this path.
export function createWbsControlReconciliationReadComposition({repository}={}){
  const replays=new Map();
  return freeze({
    async read(input={}){
      const selection=controlSelection(input);if(!selection)return blocked('WBS_CONTROL_READ_SELECTION_INVALID');
      const requestHash=canonicalRequestHash({source_type:selection.sourceType,tenant_id:selection.tenantId,entity_id:selection.entityId,scope:selection.scope});
      const prior=replays.get(selection.replayKey);if(prior){if(prior.request_hash!==requestHash)return blocked('WBS_CONTROL_READ_REPLAY_CONFLICT',true);return freeze({...prior.result,replayed:true});}
      const methods=['readPersistedWbsControlSnapshot','readPersistedRefsControlMetricSnapshot','readApprovedWbsControlReconciliationMapping'];
      if(!repository||methods.some(name=>typeof repository[name]!=='function'))return blocked('WBS_CONTROL_READ_CAPABILITY_UNAVAILABLE');
      let source,target,mapping;
      try{[source,target,mapping]=await Promise.all(methods.map(name=>repository[name]({source_type:selection.sourceType,tenant_id:selection.tenantId,entity_id:selection.entityId,scope:selection.scope,read_only:true})));}catch{return blocked('WBS_CONTROL_READ_FAILED');}
      if(!snapshotScoped(source,selection,{source:true})||!snapshotScoped(target,selection)||!plain(mapping)||text(mapping.tenant_id)!==selection.tenantId||text(mapping.entity_id)!==selection.entityId||!exactScope(mapping.scope,selection.scope,scopeKeysFor(selection.sourceType)))return blocked('WBS_CONTROL_READ_SCOPE_INVALID');
      let reconciliation,sourceTrace,targetTrace;
      try{reconciliation=reconcileWbsControlEvidence({sourceType:selection.sourceType,scope:selection.scope,sourceReceipt:source.receipt,targetReceipt:target.receipt,approvedMapping:mapping,sourceMetrics:source.metrics,targetMetrics:target.metrics});sourceTrace=signedWbsSourceTrace(source);targetTrace=snapshotTrace(target,'REFS metric snapshot');}catch(error){return blocked(error?.code||'WBS_CONTROL_EVIDENCE_INVALID');}
      const trace=freeze({forward_trace:freeze({wbs_control_snapshot:sourceTrace,mapping_id:reconciliation.mapping_trace.mapping_id,mapping_version:reconciliation.mapping_trace.version,refs_metric_snapshot:targetTrace}),reverse_trace:freeze({refs_metric_snapshot:targetTrace,mapping_id:reconciliation.mapping_trace.mapping_id,mapping_version:reconciliation.mapping_trace.version,wbs_control_snapshot:sourceTrace})});
      const result=freeze({status:reconciliation.status==='RECONCILED'?'READ_ONLY_CONTROL_RECONCILED':'READ_ONLY_CONTROL_DIFFERENCE',request_hash:requestHash,replayed:false,reconciliation,trace,can_create_transaction:false,can_allocate:false,can_create_draft:false,can_post:false});
      replays.set(selection.replayKey,freeze({request_hash:requestHash,result}));return result;
    }
  });
}
