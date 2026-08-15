import assert from 'node:assert/strict';
import test from 'node:test';
import {AiAccrualCandidateError} from '../runtime/ai-accrual-candidate-evaluator.mjs';
import {adaptRetainedWbsPayableForAiAccrual,canonicalAiRecurringObligationId} from '../runtime/ai-accrual-retained-source-adapter.mjs';

const hash='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const base=overrides=>({entity_id:'ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',source_system:'WBS',source_module:'payable',document_type:'WBS_FINAL1_PAYABLE',source_status:'PENDING_REVIEW',source_document_id:'00000000-0000-4000-8000-000000000001',source_document_line_id:'10000000-0000-4000-8000-000000000001',accounting_period_id:'4e0b2744-2366-46d5-8b34-6ccf49deaabf',period_code:'2026-04',period_ordinal:24276,period_closed:true,payload_hash:hash,currency:'USD',amount:'1250.0000',party_ref:'VENDOR-17',external_dimension_refs:{schema_version:'WBS_FINAL1_RETAINED_SOURCE_LINE_V1',domain:'PAYABLES',accounting_period_resolution:'EXACT_PRIMARY_PERIOD',accounting_period_id:'4e0b2744-2366-46d5-8b34-6ccf49deaabf',raw_row_hash:hash,signed_service_period_start:'2026-04-01T00:00:00Z',signed_service_period_end:'2026-04-30',signed_recurring_obligation_id:null,signed_contract_id:'CONTRACT-9',signed_charge_code:'MAINT'},...overrides});

test('adapts only hash-bound Final-1 payable evidence and canonically derives the allowed fallback obligation key',()=>{
  const item=adaptRetainedWbsPayableForAiAccrual(base({external_dimension_refs:{...base().external_dimension_refs,signed_service_frequency:'MONTHLY',signed_obligation_status:'ACTIVE'}}));
  assert.equal(item.service_period_start,'2026-04-01');
  assert.equal(item.recurring_obligation_id,'contract:CONTRACT-9|vendor:VENDOR-17|charge:MAINT');
  assert.equal(item.source_payload_hash,hash);
  assert.equal(item.closed,true);
  assert.equal(canonicalAiRecurringObligationId({recurringObligationId:'WBS-OBL-9'}),'WBS-OBL-9');
});

test('refuses unresolved periods, mutable source states, missing obligation keys, and hash mismatches',()=>{
  const valid={...base(),external_dimension_refs:{...base().external_dimension_refs,signed_service_frequency:'MONTHLY',signed_obligation_status:'ACTIVE'}};
  for(const row of [
    {...valid,source_status:'READY_FOR_DRAFT'},
    {...valid,external_dimension_refs:{...valid.external_dimension_refs,accounting_period_resolution:'UNRESOLVED'}},
    {...valid,external_dimension_refs:{...valid.external_dimension_refs,raw_row_hash:'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'}},
    {...valid,party_ref:null,external_dimension_refs:{...valid.external_dimension_refs,signed_contract_id:null,signed_charge_code:null}}
  ])assert.throws(()=>adaptRetainedWbsPayableForAiAccrual(row),error=>error instanceof AiAccrualCandidateError);
});
