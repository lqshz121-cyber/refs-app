import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPersistedWbsInboundAutoRec,projectObservedWbsAutoRecControlEvidence,WbsInboundProjectionError} from '../runtime/wbs-inbound-autorec-projection.mjs';

const common={receipt_id:'receipt-1',receipt_ref:'object://wbs/receipt/1',receipt_hash:'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',entity_id:'entity-1',company_key:'COMPANY-A',currency:'USD',business_date:'2026-08-04',accounting_date:'2026-08-05',stage:'STAGING_REVIEWED'};
const bank={...common,source_type:'BANK_TRANSACTION',source_record_id:'bank-1',source_version:'v1',raw_event_id:'raw-bank',source_document_id:'doc-bank',staging_item_id:'stg-bank',bank_account_ref:'BANK-OP',amount:-100};
const payable={...common,source_type:'PAYABLE',source_record_id:'pay-1',source_version:'v1',raw_event_id:'raw-pay',source_document_id:'doc-pay',staging_item_id:'stg-pay',amount:100};
const mapping=row=>({mapping_id:`map-${row.source_record_id}`,version:'2',status:'APPROVED',source_type:row.source_type,entity_id:row.entity_id,company_key:row.company_key,currency:row.currency,...(row.source_type==='BANK_TRANSACTION'?{bank_account_ref:row.bank_account_ref}:{})});
const companyControl={company_key:'COMPANY-A',user_ref:'USER-MASKED',completed_match_period:'2026-08',completed_release_period:'2026-08',completed_incur_period:'2026-08',quantity:10,amount:'100.0000',released_quantity:8,released_amount:'80.0000',incurred_quantity:6,incurred_amount:'60.0000',reconciliation_balance:'20.0000',new_balance:'40.0000',balance_date:'2026-08-05'};

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

test('copies observed WBS M/R/C controls and JE detail only as fail-closed read-only evidence',()=>{
  const evidence=projectObservedWbsAutoRecControlEvidence({companyRows:[companyControl],detailRows:[{detail_kind:'JE_TRACE',receipt_id:'receipt-1',receipt_ref:'object://wbs/receipt/1',receipt_hash:common.receipt_hash,source_record_id:'journal-1',source_version:'v1',posting_date:'2026-08-05',journal_no:'J-1',account_code:'291001',debit:'100.0000',credit:'100.0000',review_status:'REVIEWED',approval_status:'APPROVED',posting_status:'POSTED'}]});
  assert.equal(evidence.exceptions.length,0);assert.deepEqual(evidence.controls[0].completed_periods,{match:'2026-08',release:'2026-08',incur:'2026-08'});assert.equal(evidence.controls[0].released_amount,'80.0000');assert(evidence.forbidden_wbs_operations.includes('Delete'));assert.equal(evidence.details[0].observed_fields.account_code,'291001');assert.equal(evidence.can_post,false);
  const projected=projectPersistedWbsInboundAutoRec({rows:[bank,payable],mappings:[mapping(bank),mapping(payable)],companyControlRows:[companyControl]});assert.equal(projected.candidates.length,2);assert.equal(projected.control_evidence.controls.length,1);
});

test('invalid conservation, missing detail trace, or sensitive locators block all candidate projection',()=>{
  const invalid={...companyControl,released_amount:'101.0000'};
  const result=projectPersistedWbsInboundAutoRec({rows:[bank,payable],mappings:[mapping(bank),mapping(payable)],companyControlRows:[invalid]});assert.equal(result.candidates.length,0);assert.equal(result.exceptions[0].code,'WBS_AUTOREC_CONTROL_INVALID');
  const detail=projectObservedWbsAutoRecControlEvidence({companyRows:[companyControl],detailRows:[{detail_kind:'JE_TRACE',receipt_id:'receipt-1',receipt_ref:'object://wbs/receipt/1',receipt_hash:common.receipt_hash,source_record_id:'journal-1'}]});assert.equal(detail.exceptions[0].code,'WBS_AUTOREC_CONTROL_TRACE_REQUIRED');
  const unsafe=projectObservedWbsAutoRecControlEvidence({companyRows:[{...companyControl,token:'redacted'}]});assert.equal(unsafe.exceptions[0].code,'WBS_AUTOREC_CONTROL_INPUT_INVALID');
});
