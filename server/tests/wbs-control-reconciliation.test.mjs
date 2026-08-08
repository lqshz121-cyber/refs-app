import test from 'node:test';
import assert from 'node:assert/strict';
import {createWbsControlReconciliationReadComposition,reconcileWbsControlEvidence,WbsControlReconciliationError} from '../runtime/wbs-control-reconciliation.mjs';
import {createPostgresWbsControlReconciliationReader} from '../runtime/wbs-control-reconciliation-postgres-reader.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';

const metricHash=rows=>canonicalRequestHash([...rows].map(row=>({metric_key:row.metric_key,amount:Number(Number(row.amount).toFixed(4))})).sort((left,right)=>left.metric_key.localeCompare(right.metric_key)));
const receipt=(id,scope,metrics)=>({hash:'sha256:'+id.repeat(64).slice(0,64),metrics_hash:metricHash(metrics),ref:`object://receipt/${id}`,version:'v1',scope,signature_verified:true,manifest_hash:'sha256:'+`${id}f`.repeat(64).slice(0,64),key_id:'wbs-control-test',algorithm:'Ed25519'});
const costScope={tenant_id:'tenant-a',entity_id:'entity-a',company_key:'COMPANY-A',period:'2026-08',currency:'USD'};
const costMetricKeys=Array.from({length:14},(_,index)=>`COST_METRIC_${String(index+1).padStart(2,'0')}`);
const costMapping={status:'APPROVED',mapping_type:'WBS_COST_GL_CONTROL_RECONCILIATION',mapping_id:'map-cost',version:'4',scope:costScope,metric_keys:costMetricKeys};
const costMetrics=costMetricKeys.map((metric_key,index)=>({metric_key,amount:(index+1)*25}));
const costArgs={sourceType:'COST_GENERAL_LEDGER',scope:costScope,sourceReceipt:receipt('a',costScope,costMetrics),targetReceipt:receipt('b',costScope,costMetrics),approvedMapping:costMapping,sourceMetrics:costMetrics,targetMetrics:costMetrics};

test('Cost GL reconciles only exact receipt-bound approved metrics and has forward/reverse trace',()=>{
  const result=reconcileWbsControlEvidence(costArgs);
  assert.deepEqual({status:result.status,count:result.control_totals.metric_count,diff:result.control_totals.difference_total,draft:result.can_create_draft,post:result.can_post},{status:'RECONCILED',count:14,diff:0,draft:false,post:false});
  assert.equal(result.comparisons[0].forward_trace.mapping_id,'map-cost');assert.equal(result.comparisons[0].reverse_trace.target_receipt_version,'v1');
});

test('Control differences remain evidence-only and Property needs its exact mapping and date/bank scope',()=>{
  const changedMetrics=costMetrics.map(row=>row.metric_key==='COST_METRIC_01'?{...row,amount:26}:row);
  const difference=reconcileWbsControlEvidence({...costArgs,targetReceipt:receipt('b',costScope,changedMetrics),targetMetrics:changedMetrics});
  assert.equal(difference.status,'DIFFERENCE');assert.equal(difference.control_totals.difference_total,1);assert.equal(difference.can_allocate,false);
  const propertyScope={tenant_id:'tenant-a',entity_id:'entity-a',company_key:'COMPANY-A',property_ref:'PROPERTY-A',period_start:'2026-08-01',period_end:'2026-08-31',currency:'USD',bank_account_ref:'BANK-1'};
  const propertyMetrics=[{metric_key:'PROPERTY_VALUE',amount:10}];
  const property={sourceType:'PROPERTY_COMPARISON',scope:propertyScope,sourceReceipt:receipt('c',propertyScope,propertyMetrics),targetReceipt:receipt('d',propertyScope,propertyMetrics),approvedMapping:{status:'APPROVED',mapping_type:'WBS_PROPERTY_CONTROL_RECONCILIATION',mapping_id:'map-property',version:'1',scope:propertyScope,metric_keys:['PROPERTY_VALUE']},sourceMetrics:propertyMetrics,targetMetrics:propertyMetrics};
  assert.equal(reconcileWbsControlEvidence(property).status,'RECONCILED');
  assert.throws(()=>reconcileWbsControlEvidence({...property,approvedMapping:{...property.approvedMapping,scope:{...propertyScope,bank_account_ref:'BANK-2'}}}),error=>error instanceof WbsControlReconciliationError&&error.code==='WBS_CONTROL_MAPPING_REQUIRED');
  assert.throws(()=>reconcileWbsControlEvidence({...property,scope:{...propertyScope,property_ref:''}}),error=>error instanceof WbsControlReconciliationError&&error.code==='WBS_CONTROL_SCOPE_REQUIRED');
});

test('missing receipt, incomplete metric mapping, and invalid Property periods fail closed before any transaction path',()=>{
  assert.throws(()=>reconcileWbsControlEvidence({...costArgs,sourceReceipt:{}}),error=>error.code==='WBS_CONTROL_RECEIPT_REQUIRED');
  const partialMetrics=costMetrics.slice(0,13);
  assert.throws(()=>reconcileWbsControlEvidence({...costArgs,sourceReceipt:receipt('a',costScope,partialMetrics),targetReceipt:receipt('b',costScope,partialMetrics),approvedMapping:{...costMapping,metric_keys:costMetricKeys.slice(0,13)},sourceMetrics:partialMetrics,targetMetrics:partialMetrics}),error=>error.code==='WBS_CONTROL_MAPPING_INCOMPLETE');
  assert.throws(()=>reconcileWbsControlEvidence({sourceType:'PROPERTY_COMPARISON',scope:{tenant_id:'tenant-c',entity_id:'entity-c',company_key:'C',property_ref:'PROPERTY-C',period_start:'2026-08-31',period_end:'2026-08-01',currency:'USD',bank_account_ref:'B'}}),error=>error.code==='WBS_PROPERTY_PERIOD_INVALID');
});

test('blank report metric values never coerce to zero for Cost GL or Property controls',()=>{
  const propertyScope={tenant_id:'tenant-a',entity_id:'entity-a',company_key:'COMPANY-A',property_ref:'PROPERTY-A',period_start:'2026-08-01',period_end:'2026-08-31',currency:'USD',bank_account_ref:'BANK-1'};
  const propertyMetrics=[{metric_key:'PROPERTY_VALUE',amount:10}];
  const propertyArgs={sourceType:'PROPERTY_COMPARISON',scope:propertyScope,sourceReceipt:receipt('c',propertyScope,propertyMetrics),targetReceipt:receipt('d',propertyScope,propertyMetrics),approvedMapping:{status:'APPROVED',mapping_type:'WBS_PROPERTY_CONTROL_RECONCILIATION',mapping_id:'map-property',version:'1',scope:propertyScope,metric_keys:['PROPERTY_VALUE']},sourceMetrics:propertyMetrics,targetMetrics:propertyMetrics};
  for(const args of [costArgs,propertyArgs])for(const invalidAmount of ['', '  ', null, true, '0x10']){
    assert.throws(()=>reconcileWbsControlEvidence({...args,sourceMetrics:[{...args.sourceMetrics[0],amount:invalidAmount},...args.sourceMetrics.slice(1)]}),error=>error.code==='WBS_CONTROL_METRICS_INVALID');
  }
});

test('control receipts cannot be replayed across company, period, or currency scope',()=>{
  assert.throws(()=>reconcileWbsControlEvidence({...costArgs,sourceReceipt:receipt('a',{...costScope,period:'2026-07'},costMetrics)}),error=>error.code==='WBS_CONTROL_RECEIPT_SCOPE_MISMATCH');
  assert.throws(()=>reconcileWbsControlEvidence({...costArgs,targetReceipt:receipt('b',{...costScope,company_key:'COMPANY-B'},costMetrics)}),error=>error.code==='WBS_CONTROL_RECEIPT_SCOPE_MISMATCH');
  assert.throws(()=>reconcileWbsControlEvidence({...costArgs,sourceReceipt:receipt('a',{},costMetrics)}),error=>error.code==='WBS_CONTROL_RECEIPT_SCOPE_REQUIRED');
  assert.throws(()=>reconcileWbsControlEvidence({...costArgs,scope:{...costScope,period:'2026-13'}}),error=>error.code==='WBS_COST_GL_PERIOD_INVALID');
  assert.throws(()=>reconcileWbsControlEvidence({...costArgs,scope:{...costScope,currency:'usd'}}),error=>error.code==='WBS_CONTROL_CURRENCY_INVALID');
});

test('control metrics cannot be substituted after a receipt has been captured',()=>{
  const altered=costMetrics.map(row=>row.metric_key==='COST_METRIC_02'?{...row,amount:51}:row);
  assert.throws(()=>reconcileWbsControlEvidence({...costArgs,sourceMetrics:altered}),error=>error.code==='WBS_CONTROL_RECEIPT_METRICS_MISMATCH');
});

test('control reconciliation reads only exact persisted WBS/REFS evidence and approved mappings',async()=>{
  const source={snapshot_id:'wbs-control-cost-1',tenant_id:'tenant-a',entity_id:'entity-a',source_type:'COST_GENERAL_LEDGER',scope:costScope,receipt:costArgs.sourceReceipt,metrics:costMetrics};
  const target={snapshot_id:'refs-metric-cost-1',tenant_id:'tenant-a',entity_id:'entity-a',scope:costScope,receipt:costArgs.targetReceipt,metrics:costMetrics};
  const mapping={...costMapping,tenant_id:'tenant-a',entity_id:'entity-a'};
  const repository={readPersistedWbsControlSnapshot:async()=>source,readPersistedRefsControlMetricSnapshot:async()=>target,readApprovedWbsControlReconciliationMapping:async()=>mapping};
  const reader=createWbsControlReconciliationReadComposition({repository});
  const input={sourceType:'COST_GENERAL_LEDGER',tenantId:'tenant-a',entityId:'entity-a',scope:costScope,replayKey:'control-read-1'};
  const accepted=await reader.read(input);assert.equal(accepted.status,'READ_ONLY_CONTROL_RECONCILED');assert.equal(accepted.reconciliation.status,'RECONCILED');assert.equal(accepted.trace.forward_trace.wbs_control_snapshot.snapshot_id,'wbs-control-cost-1');assert.equal(accepted.trace.reverse_trace.refs_metric_snapshot.snapshot_id,'refs-metric-cost-1');assert.equal(accepted.can_post,false);
  assert.equal(accepted.trace.forward_trace.wbs_control_snapshot.receipt_algorithm,'Ed25519');
  assert.equal((await reader.read(input)).replayed,true);
  assert.equal((await reader.read({...input,scope:{...costScope,period:'2026-07'}})).code,'WBS_CONTROL_READ_REPLAY_CONFLICT');
  assert.equal((await createWbsControlReconciliationReadComposition({}).read(input)).code,'WBS_CONTROL_READ_CAPABILITY_UNAVAILABLE');
  const leaked=createWbsControlReconciliationReadComposition({repository:{...repository,readPersistedWbsControlSnapshot:async()=>({...source,scope:{...costScope,company_key:'OTHER'}})}});
  const blocked=await leaked.read({...input,replayKey:'control-read-2'});assert.equal(blocked.code,'WBS_CONTROL_READ_SCOPE_INVALID');assert.equal(blocked.can_create_draft,false);
  const traceMissing=createWbsControlReconciliationReadComposition({repository:{...repository,readPersistedRefsControlMetricSnapshot:async()=>({...target,snapshot_id:''})}});
  assert.equal((await traceMissing.read({...input,replayKey:'control-read-3'})).code,'WBS_CONTROL_READ_TRACE_REQUIRED');
  const unsigned=createWbsControlReconciliationReadComposition({repository:{...repository,readPersistedWbsControlSnapshot:async()=>({...source,receipt:{...source.receipt,signature_verified:false}})}});
  assert.equal((await unsigned.read({...input,replayKey:'control-read-unsigned'})).code,'WBS_CONTROL_SOURCE_SIGNATURE_REQUIRED');
  const changedMetrics=costMetrics.map(row=>row.metric_key==='COST_METRIC_01'?{...row,amount:26}:row);
  const differenceReader=createWbsControlReconciliationReadComposition({repository:{...repository,readPersistedRefsControlMetricSnapshot:async()=>({...target,receipt:receipt('b',costScope,changedMetrics),metrics:changedMetrics})}});
  const difference=await differenceReader.read({...input,replayKey:'control-read-4'});assert.equal(difference.status,'READ_ONLY_CONTROL_DIFFERENCE');assert.equal(difference.reconciliation.status,'DIFFERENCE');assert.equal(difference.can_create_draft,false);
});

test('Postgres control reader exposes only the three read-only kernel capabilities',async()=>{
  const source={snapshot_id:'wbs-control-cost-1',tenant_id:'tenant-a',entity_id:'entity-a',source_type:'COST_GENERAL_LEDGER',scope:costScope,receipt:costArgs.sourceReceipt,metrics:costMetrics};
  const target={snapshot_id:'refs-metric-cost-1',tenant_id:'tenant-a',entity_id:'entity-a',scope:costScope,receipt:costArgs.targetReceipt,metrics:costMetrics};
  const mapping={...costMapping,tenant_id:'tenant-a',entity_id:'entity-a'};
  const calls=[];const kernel={readPersistedWbsControlSnapshot:async input=>(calls.push(input),source),readPersistedRefsControlMetricSnapshot:async input=>(calls.push(input),target),readApprovedWbsControlReconciliationMapping:async input=>(calls.push(input),mapping)};
  const input={sourceType:'COST_GENERAL_LEDGER',tenantId:'tenant-a',entityId:'entity-a',scope:costScope,replayKey:'pg-control-1'};
  const accepted=await createPostgresWbsControlReconciliationReader({kernel}).read(input);assert.equal(accepted.status,'READ_ONLY_CONTROL_RECONCILED');assert.equal(calls.length,3);assert.ok(calls.every(call=>call.read_only===true));
  assert.equal((await createPostgresWbsControlReconciliationReader({kernel:{}}).read(input)).code,'WBS_CONTROL_READ_CAPABILITY_UNAVAILABLE');
});
