import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileWbsControlEvidence,WbsControlReconciliationError} from '../runtime/wbs-control-reconciliation.mjs';

const receipt=(id)=>({hash:'sha256:'+id.repeat(64).slice(0,64),ref:`object://receipt/${id}`,version:'v1'});
const costScope={tenant_id:'tenant-a',entity_id:'entity-a',company_key:'COMPANY-A',period:'2026-08',currency:'USD'};
const costMetricKeys=Array.from({length:14},(_,index)=>`COST_METRIC_${String(index+1).padStart(2,'0')}`);
const costMapping={status:'APPROVED',mapping_type:'WBS_COST_GL_CONTROL_RECONCILIATION',mapping_id:'map-cost',version:'4',scope:costScope,metric_keys:costMetricKeys};
const costMetrics=costMetricKeys.map((metric_key,index)=>({metric_key,amount:(index+1)*25}));
const costArgs={sourceType:'COST_GENERAL_LEDGER',scope:costScope,sourceReceipt:receipt('a'),targetReceipt:receipt('b'),approvedMapping:costMapping,sourceMetrics:costMetrics,targetMetrics:costMetrics};

test('Cost GL reconciles only exact receipt-bound approved metrics and has forward/reverse trace',()=>{
  const result=reconcileWbsControlEvidence(costArgs);
  assert.deepEqual({status:result.status,count:result.control_totals.metric_count,diff:result.control_totals.difference_total,draft:result.can_create_draft,post:result.can_post},{status:'RECONCILED',count:14,diff:0,draft:false,post:false});
  assert.equal(result.comparisons[0].forward_trace.mapping_id,'map-cost');assert.equal(result.comparisons[0].reverse_trace.target_receipt_version,'v1');
});

test('Control differences remain evidence-only and Property needs its exact mapping and date/bank scope',()=>{
  const difference=reconcileWbsControlEvidence({...costArgs,targetMetrics:costMetrics.map(row=>row.metric_key==='COST_METRIC_01'?{...row,amount:26}:row)});
  assert.equal(difference.status,'DIFFERENCE');assert.equal(difference.control_totals.difference_total,1);assert.equal(difference.can_allocate,false);
  const propertyScope={tenant_id:'tenant-a',entity_id:'entity-a',company_key:'COMPANY-A',property_ref:'PROPERTY-A',period_start:'2026-08-01',period_end:'2026-08-31',currency:'USD',bank_account_ref:'BANK-1'};
  const property={sourceType:'PROPERTY_COMPARISON',scope:propertyScope,sourceReceipt:receipt('c'),targetReceipt:receipt('d'),approvedMapping:{status:'APPROVED',mapping_type:'WBS_PROPERTY_CONTROL_RECONCILIATION',mapping_id:'map-property',version:'1',scope:propertyScope,metric_keys:['PROPERTY_VALUE']},sourceMetrics:[{metric_key:'PROPERTY_VALUE',amount:10}],targetMetrics:[{metric_key:'PROPERTY_VALUE',amount:10}]};
  assert.equal(reconcileWbsControlEvidence(property).status,'RECONCILED');
  assert.throws(()=>reconcileWbsControlEvidence({...property,approvedMapping:{...property.approvedMapping,scope:{...propertyScope,bank_account_ref:'BANK-2'}}}),error=>error instanceof WbsControlReconciliationError&&error.code==='WBS_CONTROL_MAPPING_REQUIRED');
  assert.throws(()=>reconcileWbsControlEvidence({...property,scope:{...propertyScope,property_ref:''}}),error=>error instanceof WbsControlReconciliationError&&error.code==='WBS_CONTROL_SCOPE_REQUIRED');
});

test('missing receipt, incomplete metric mapping, and invalid Property periods fail closed before any transaction path',()=>{
  assert.throws(()=>reconcileWbsControlEvidence({...costArgs,sourceReceipt:{}}),error=>error.code==='WBS_CONTROL_RECEIPT_REQUIRED');
  assert.throws(()=>reconcileWbsControlEvidence({...costArgs,approvedMapping:{...costMapping,metric_keys:costMetricKeys.slice(0,13)},sourceMetrics:costMetrics.slice(0,13),targetMetrics:costMetrics.slice(0,13)}),error=>error.code==='WBS_CONTROL_MAPPING_INCOMPLETE');
  assert.throws(()=>reconcileWbsControlEvidence({sourceType:'PROPERTY_COMPARISON',scope:{tenant_id:'tenant-c',entity_id:'entity-c',company_key:'C',property_ref:'PROPERTY-C',period_start:'2026-08-31',period_end:'2026-08-01',currency:'USD',bank_account_ref:'B'}}),error=>error.code==='WBS_PROPERTY_PERIOD_INVALID');
});
