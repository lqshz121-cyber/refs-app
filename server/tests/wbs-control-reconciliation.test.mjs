import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileWbsControlEvidence,WbsControlReconciliationError} from '../runtime/wbs-control-reconciliation.mjs';

const receipt=(id)=>({hash:'sha256:'+id.repeat(64).slice(0,64),ref:`object://receipt/${id}`,version:'v1'});
const costScope={company_key:'COMPANY-A',period:'2026-08',currency:'USD'};
const costMapping={status:'APPROVED',mapping_type:'WBS_COST_GL_CONTROL_RECONCILIATION',mapping_id:'map-cost',version:'4',scope:costScope,metric_keys:['ACTUAL_COST','ACCRUAL']};
const costArgs={sourceType:'COST_GENERAL_LEDGER',scope:costScope,sourceReceipt:receipt('a'),targetReceipt:receipt('b'),approvedMapping:costMapping,sourceMetrics:[{metric_key:'ACTUAL_COST',amount:'100.0000'},{metric_key:'ACCRUAL',amount:'25.0000'}],targetMetrics:[{metric_key:'ACTUAL_COST',amount:'100.0000'},{metric_key:'ACCRUAL',amount:'25.0000'}]};

test('Cost GL reconciles only exact receipt-bound approved metrics and has forward/reverse trace',()=>{
  const result=reconcileWbsControlEvidence(costArgs);
  assert.deepEqual({status:result.status,count:result.control_totals.metric_count,diff:result.control_totals.difference_total,draft:result.can_create_draft,post:result.can_post},{status:'RECONCILED',count:2,diff:0,draft:false,post:false});
  assert.equal(result.comparisons[0].forward_trace.mapping_id,'map-cost');assert.equal(result.comparisons[0].reverse_trace.target_receipt_version,'v1');
});

test('Control differences remain evidence-only and Property needs its exact mapping and date/bank scope',()=>{
  const difference=reconcileWbsControlEvidence({...costArgs,targetMetrics:[{metric_key:'ACTUAL_COST',amount:'101.0000'},{metric_key:'ACCRUAL',amount:'25.0000'}]});
  assert.equal(difference.status,'DIFFERENCE');assert.equal(difference.control_totals.difference_total,1);assert.equal(difference.can_allocate,false);
  const propertyScope={company_key:'COMPANY-A',period_start:'2026-08-01',period_end:'2026-08-31',currency:'USD',bank_account_ref:'BANK-1'};
  const property={sourceType:'PROPERTY_COMPARISON',scope:propertyScope,sourceReceipt:receipt('c'),targetReceipt:receipt('d'),approvedMapping:{status:'APPROVED',mapping_type:'WBS_PROPERTY_CONTROL_RECONCILIATION',mapping_id:'map-property',version:'1',scope:propertyScope,metric_keys:['PROPERTY_VALUE']},sourceMetrics:[{metric_key:'PROPERTY_VALUE',amount:10}],targetMetrics:[{metric_key:'PROPERTY_VALUE',amount:10}]};
  assert.equal(reconcileWbsControlEvidence(property).status,'RECONCILED');
  assert.throws(()=>reconcileWbsControlEvidence({...property,approvedMapping:{...property.approvedMapping,scope:{...propertyScope,bank_account_ref:'BANK-2'}}}),error=>error instanceof WbsControlReconciliationError&&error.code==='WBS_CONTROL_MAPPING_REQUIRED');
});

test('missing receipt, incomplete metric mapping, and invalid Property periods fail closed before any transaction path',()=>{
  assert.throws(()=>reconcileWbsControlEvidence({...costArgs,sourceReceipt:{}}),error=>error.code==='WBS_CONTROL_RECEIPT_REQUIRED');
  assert.throws(()=>reconcileWbsControlEvidence({...costArgs,approvedMapping:{...costMapping,metric_keys:['ACTUAL_COST']}}),error=>error.code==='WBS_CONTROL_MAPPING_INCOMPLETE');
  assert.throws(()=>reconcileWbsControlEvidence({sourceType:'PROPERTY_COMPARISON',scope:{company_key:'C',period_start:'2026-08-31',period_end:'2026-08-01',currency:'USD',bank_account_ref:'B'}}),error=>error.code==='WBS_PROPERTY_PERIOD_INVALID');
});
