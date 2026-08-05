import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPersistedWbsInboundAutoRec,WbsInboundProjectionError} from '../runtime/wbs-inbound-autorec-projection.mjs';

const common={receipt_id:'receipt-1',receipt_ref:'object://wbs/receipt/1',receipt_hash:'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',entity_id:'entity-1',company_key:'COMPANY-A',currency:'USD',business_date:'2026-08-04',accounting_date:'2026-08-05',stage:'STAGING_REVIEWED'};
const bank={...common,source_type:'BANK_TRANSACTION',source_record_id:'bank-1',source_version:'v1',raw_event_id:'raw-bank',source_document_id:'doc-bank',staging_item_id:'stg-bank',bank_account_ref:'BANK-OP',amount:-100};
const payable={...common,source_type:'PAYABLE',source_record_id:'pay-1',source_version:'v1',raw_event_id:'raw-pay',source_document_id:'doc-pay',staging_item_id:'stg-pay',amount:100};
const mapping=row=>({mapping_id:`map-${row.source_record_id}`,version:'2',status:'APPROVED',source_type:row.source_type,entity_id:row.entity_id,company_key:row.company_key,currency:row.currency,...(row.source_type==='BANK_TRANSACTION'?{bank_account_ref:row.bank_account_ref}:{})});

test('projects reviewed persisted bank and business rows into read-only AutoRec candidates with complete trace',()=>{
  const result=projectPersistedWbsInboundAutoRec({rows:[bank,payable],mappings:[mapping(bank),mapping(payable)]});
  assert.deepEqual({candidates:result.candidates.length,exceptions:result.exceptions.length,dispatch:result.controls.can_dispatch,post:result.controls.can_post},{candidates:2,exceptions:0,dispatch:false,post:false});
  const candidate=result.candidates.find(row=>row.side==='BANK_SIDE');assert.equal(candidate.trace.receipt_hash,bank.receipt_hash);assert.equal(candidate.trace.raw_event_id,'raw-bank');assert.equal(candidate.mapping.mapping_id,'map-bank-1');assert.equal(candidate.can_allocate,false);
});

test('persisted exceptions and incomplete source, receipt, mapping, or scope facts stay blocked',()=>{
  const missingReceipt={...bank,receipt_ref:''},missingDate={...payable,business_date:''},persisted={...payable,stage:'EXCEPTION',exception_code:'WBS_RECEIPT_FIELD_MISSING'};
  const result=projectPersistedWbsInboundAutoRec({rows:[missingReceipt,missingDate,persisted,{...bank,company_key:'COMPANY-B'}],mappings:[mapping(bank),mapping(payable)]});
  assert.equal(result.candidates.length,0);assert.deepEqual(result.exceptions.map(row=>row.code),['WBS_AUTOREC_TRACE_REQUIRED','WBS_AUTOREC_TRACE_REQUIRED','WBS_RECEIPT_FIELD_MISSING','WBS_AUTOREC_MAPPING_MISSING']);assert(result.exceptions.every(row=>row.can_dispatch===false&&row.can_post===false));
});

test('ambiguous mappings and non-reviewed or non-transaction rows cannot produce AutoRec candidates',()=>{
  const ambiguous=projectPersistedWbsInboundAutoRec({rows:[bank],mappings:[mapping(bank),{...mapping(bank),mapping_id:'map-bank-duplicate'}]});assert.equal(ambiguous.exceptions[0].code,'WBS_AUTOREC_MAPPING_AMBIGUOUS');
  const blocked=projectPersistedWbsInboundAutoRec({rows:[{...bank,stage:'STAGING_REVIEW_REQUIRED'},{...payable,source_type:'CONTROL_EVIDENCE'}],mappings:[mapping(bank),mapping(payable)]});assert.deepEqual(blocked.exceptions.map(row=>row.code),['WBS_AUTOREC_STAGING_REVIEW_REQUIRED','WBS_AUTOREC_SOURCE_TYPE_INVALID']);
  assert.throws(()=>projectPersistedWbsInboundAutoRec({rows:{}}),error=>error instanceof WbsInboundProjectionError&&error.code==='WBS_AUTOREC_PROJECTION_ROWS_REQUIRED');
});
