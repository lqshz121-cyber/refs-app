import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPersistedWbsInboundAutoRec,projectObservedWbsAutoRecControlEvidence,bindReceiptBackedWbsAutoRecControlEvidence,buildWbsObservedAutoRecStateHistory,wbsAutoRecObservedWorkflowContract,WbsInboundProjectionError} from '../runtime/wbs-inbound-autorec-projection.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';

const common={receipt_id:'receipt-1',receipt_ref:'object://wbs/receipt/1',receipt_hash:'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',entity_id:'entity-1',company_key:'COMPANY-A',currency:'USD',business_date:'2026-08-04',accounting_date:'2026-08-05',stage:'STAGING_REVIEWED'};
const bank={...common,source_type:'BANK_TRANSACTION',source_record_id:'bank-1',source_version:'v1',raw_event_id:'raw-bank',source_document_id:'doc-bank',staging_item_id:'stg-bank',bank_account_ref:'BANK-OP',amount:-100};
const payable={...common,source_type:'PAYABLE',source_record_id:'pay-1',source_version:'v1',raw_event_id:'raw-pay',source_document_id:'doc-pay',staging_item_id:'stg-pay',amount:100};
const mapping=row=>({mapping_id:`map-${row.source_record_id}`,version:'2',snapshot_hash:'sha256:'+(row.source_type==='BANK_TRANSACTION'?'b':'a').repeat(64),status:'APPROVED',source_type:row.source_type,entity_id:row.entity_id,company_key:row.company_key,currency:row.currency,bank_account_ref:'BANK-OP',effective_from:'2026-01-01T00:00:00.000Z',effective_to:null});
const companyControl={company_key:'COMPANY-A',user_ref:'USER-MASKED',completed_match_period:'M:06/2026',completed_release_period:'R:06/2026',completed_incur_period:'C:03/2025',quantity:10,amount:'100.0000',released_quantity:8,released_amount:'80.0000',incurred_quantity:6,incurred_amount:'60.0000',reconciliation_balance:'20.0000',new_balance:'40.0000',balance_date:'2026-08-05'};

test('observed WBS workflow is explicitly evidence-only and does not invent a canonical transition graph',()=>{
  const workflow=wbsAutoRecObservedWorkflowContract();
  assert.deepEqual(workflow.steps.map(item=>item.step),['COMPANY_SCREENING','DATA_PROCESSING_RELEASE','INCUR','INCURRED_LIST']);
  assert.equal(workflow.detail_kind_to_step.RELEASED_PAYMENT,'DATA_PROCESSING_RELEASE');
  assert.equal(workflow.detail_kind_to_step.INCURRED_PAYMENT,'INCURRED_LIST');
  assert.equal(workflow.canonical_wbs_transition_graph,'UNKNOWN');
  assert.deepEqual({transition:workflow.can_transition_refs,release:workflow.can_release,incur:workflow.can_incur,draft:workflow.can_create_draft,post:workflow.can_post},{transition:false,release:false,incur:false,draft:false,post:false});
});

test('receipt-backed WBS state observations retain history without authorizing a REFS transition',()=>{
  const released={detail_kind:'RELEASED_PAYMENT',company_key:'COMPANY-A',receipt_id:'receipt-release',receipt_ref:'object://wbs/release',receipt_hash:'sha256:'+'a'.repeat(64),source_record_id:'pd-1',source_version:'v1',observed_at:'2026-08-09T09:00:00Z'};
  const incurred={detail_kind:'INCURRED_PAYMENT',company_key:'COMPANY-A',receipt_id:'receipt-incurred',receipt_ref:'object://wbs/incurred',receipt_hash:'sha256:'+'b'.repeat(64),source_record_id:'pd-1',source_version:'v2',observed_at:'2026-08-09T10:00:00Z',bank_source_record_id:'bank-1',bank_source_version:'v2',bank_source_receipt_id:'bank-receipt',bank_source_receipt_ref:'object://wbs/bank',bank_source_receipt_hash:'sha256:'+'c'.repeat(64),autoc_payable_long_id:'autoc-1',match_status:'MATCHED',transaction_date:'2026-08-08',posting_date:'2026-08-09',bank_account_code:'100100',ref_no:'REF-1',memo:'External memo',direction:'CREDIT',amount:'100.0000',project_department:'PROJECT',cost_code:'COST',invoice_receipt_evidence:'attachment-evidence',user_ref:'MASKED',reviewer:'REVIEWER',comments_log:'review-log',vendor:'VENDOR'};
  const persistedRows=[
    {company_key:'COMPANY-A',source_record_id:'pd-1',source_version:'v1',receipt_id:'receipt-release',receipt_ref:'object://wbs/release',receipt_hash:'sha256:'+'a'.repeat(64)},
    {company_key:'COMPANY-A',source_record_id:'pd-1',source_version:'v2',receipt_id:'receipt-incurred',receipt_ref:'object://wbs/incurred',receipt_hash:'sha256:'+'b'.repeat(64)}
  ];
  const history=buildWbsObservedAutoRecStateHistory({observations:[incurred,released],persistedRows});
  assert.equal(history.exceptions.length,0);assert.equal(history.histories.length,1);
  const item=history.histories[0];
  assert.deepEqual(item.observations.map(event=>event.observed_state),['RELEASED','INCURRED']);
  assert.equal(item.observations[1].previous_observed_state,'RELEASED');assert.equal(item.observations[1].observed_change,true);
  assert.equal(item.canonical_wbs_transition_graph,'UNKNOWN');assert.equal(item.can_transition_state,false);assert.equal(item.can_post,false);
  assert.deepEqual(history.observed_transitions,[{from_state:'RELEASED',to_state:'INCURRED',observed_transition_count:1,observed_source_count:1,receipt_hashes:['sha256:'+'b'.repeat(64)],semantics:'OBSERVED_UNVERIFIED',canonical_wbs_transition_graph:'UNKNOWN',can_transition_state:false,can_release:false,can_incur:false,can_reverse:false,can_post:false}]);
  const ambiguous=buildWbsObservedAutoRecStateHistory({observations:[released,{...incurred,observed_at:'2026-08-09T09:00:00Z'}],persistedRows});
  assert.equal(ambiguous.histories.length,0);assert.equal(ambiguous.exceptions[0].code,'WBS_AUTOREC_STATE_OBSERVATION_ORDER_AMBIGUOUS');
  const missingReceipt=buildWbsObservedAutoRecStateHistory({observations:[released],persistedRows:[]});
  assert.equal(missingReceipt.histories.length,0);assert.equal(missingReceipt.exceptions[0].code,'WBS_AUTOREC_RECEIPT_MISSING');
});

test('WBS state history never merges a reused source record id across company or entity scope',()=>{
  const base={detail_kind:'RELEASED_PAYMENT',receipt_id:'receipt-a',receipt_ref:'object://wbs/a',receipt_hash:'sha256:'+'a'.repeat(64),source_record_id:'reused-detail',source_version:'v1',observed_at:'2026-08-09T09:00:00Z'};
  const companyA={...base,tenant_id:'tenant-1',entity_id:'entity-1',company_key:'COMPANY-A'};
  const companyB={...base,tenant_id:'tenant-1',entity_id:'entity-1',company_key:'COMPANY-B',receipt_id:'receipt-b',receipt_ref:'object://wbs/b',receipt_hash:'sha256:'+'b'.repeat(64),observed_at:'2026-08-09T10:00:00Z'};
  const otherEntity={...base,tenant_id:'tenant-1',entity_id:'entity-2',company_key:'COMPANY-A',receipt_id:'receipt-c',receipt_ref:'object://wbs/c',receipt_hash:'sha256:'+'c'.repeat(64),observed_at:'2026-08-09T11:00:00Z'};
  const history=buildWbsObservedAutoRecStateHistory({observations:[companyA,companyB,otherEntity],persistedRows:[companyA,companyB,otherEntity]});
  assert.equal(history.exceptions.length,0);assert.equal(history.histories.length,3);
  assert.deepEqual(history.histories.map(item=>[item.tenant_id,item.entity_id,item.company_key,item.source_record_id]).sort(),[['tenant-1','entity-1','COMPANY-A','reused-detail'],['tenant-1','entity-1','COMPANY-B','reused-detail'],['tenant-1','entity-2','COMPANY-A','reused-detail']]);
  assert(history.histories.every(item=>item.observations.length===1&&item.forward_trace.company_key===item.company_key));
});

test('projects reviewed persisted bank and business rows into read-only AutoRec candidates with complete trace',()=>{
  const result=projectPersistedWbsInboundAutoRec({rows:[bank,payable],mappings:[mapping(bank),mapping(payable)]});
  assert.deepEqual({candidates:result.candidates.length,exceptions:result.exceptions.length,dispatch:result.controls.can_dispatch,post:result.controls.can_post},{candidates:2,exceptions:0,dispatch:false,post:false});
  const candidate=result.candidates.find(row=>row.side==='BANK_SIDE'),payableCandidate=result.candidates.find(row=>row.side==='BUSINESS_SIDE');assert.equal(candidate.trace.receipt_hash,bank.receipt_hash);assert.equal(candidate.trace.raw_event_id,'raw-bank');assert.equal(candidate.trace.mapping_snapshot_hash,mapping(bank).snapshot_hash);assert.equal(candidate.mapping.mapping_id,'map-bank-1');assert.equal(candidate.can_allocate,false);assert.deepEqual({bank:payableCandidate.bank_account_ref,mapping:payableCandidate.mapping.bank_account_ref,trace:payableCandidate.trace.mapping_bank_account_ref,effective:payableCandidate.trace.mapping_effective_from},{bank:'BANK-OP',mapping:'BANK-OP',trace:'BANK-OP',effective:'2026-01-01T00:00:00.000Z'});
});

test('AutoRec Detail projection requires the exact receipt-bound case relation and its mapped bank account',()=>{
  const detail={...payable,source_type:'AUTOREC_PAYMENT_DETAIL',source_record_id:'pd-1',source_version:'v2',raw_event_id:'raw-pd',source_document_id:'doc-pd',staging_item_id:'stg-pd'};
  const binding={relation_id:'relation-1',relation_type:'DETAIL_TO_CASE',pd_guid:'pd-1',pb_guid:'pb-1',bank_account_ref:'BANK-OP',relation_receipt_hash:'sha256:'+'b'.repeat(64),detail_content_hash:'sha256:'+'c'.repeat(64),case_control_content_hash:'sha256:'+'d'.repeat(64),policy_id:'detail-case-policy',policy_version:'1',policy_snapshot_hash:'sha256:'+'e'.repeat(64),provider_snapshot_token_hash:'sha256:'+'f'.repeat(64)};
  const external_trace={auto_rec_case_binding:binding},accepted=projectPersistedWbsInboundAutoRec({rows:[{...detail,external_trace,external_trace_hash:canonicalRequestHash(external_trace)}],mappings:[mapping(detail)]});
  assert.equal(accepted.candidates.length,1);assert.equal(accepted.candidates[0].auto_rec_case_binding.pb_guid,'pb-1');assert.equal(accepted.candidates[0].trace.auto_rec_case_binding.bank_account_ref,'BANK-OP');assert.equal(accepted.candidates[0].can_post,false);
  const missing=projectPersistedWbsInboundAutoRec({rows:[detail],mappings:[mapping(detail)]});
  assert.equal(missing.candidates.length,0);assert.equal(missing.exceptions[0].code,'WBS_AUTOREC_DETAIL_CASE_BINDING_REQUIRED');
  const mismatchTrace={auto_rec_case_binding:{...binding,bank_account_ref:'BANK-OTHER'}},mismatch=projectPersistedWbsInboundAutoRec({rows:[{...detail,external_trace:mismatchTrace,external_trace_hash:canonicalRequestHash(mismatchTrace)}],mappings:[mapping(detail)]});
  assert.equal(mismatch.candidates.length,0);assert.equal(mismatch.exceptions[0].code,'WBS_AUTOREC_DETAIL_CASE_BINDING_REQUIRED');
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

test('a persisted AutoRec candidate requires the immutable snapshot of its approved mapping',()=>{
  const missingSnapshot=projectPersistedWbsInboundAutoRec({rows:[bank],mappings:[{...mapping(bank),snapshot_hash:''}]});
  assert.equal(missingSnapshot.candidates.length,0);assert.equal(missingSnapshot.exceptions[0].code,'WBS_AUTOREC_MAPPING_MISSING');
  const forgedSnapshot=projectPersistedWbsInboundAutoRec({rows:[bank],mappings:[{...mapping(bank),snapshot_hash:'sha256:forged'}]});
  assert.equal(forgedSnapshot.candidates.length,0);assert.equal(forgedSnapshot.exceptions[0].code,'WBS_AUTOREC_MAPPING_MISSING');
  const missingBankScope=projectPersistedWbsInboundAutoRec({rows:[payable],mappings:[{...mapping(payable),bank_account_ref:''}]});
  assert.equal(missingBankScope.candidates.length,0);assert.equal(missingBankScope.exceptions[0].code,'WBS_AUTOREC_MAPPING_MISSING');
  const notEffective=projectPersistedWbsInboundAutoRec({rows:[payable],mappings:[{...mapping(payable),effective_from:'2027-01-01T00:00:00.000Z'}]});
  assert.equal(notEffective.candidates.length,0);assert.equal(notEffective.exceptions[0].code,'WBS_AUTOREC_MAPPING_NOT_EFFECTIVE');
});

test('a closed-period source retains its one effective retired mapping for forward and reverse trace',()=>{
  const historical={...payable,accounting_date:'2025-12-15',business_date:'2025-12-15'};
  const retired={...mapping(historical),status:'RETIRED',effective_from:'2025-01-01T00:00:00.000Z',effective_to:'2026-01-01T00:00:00.000Z'};
  const result=projectPersistedWbsInboundAutoRec({rows:[historical],mappings:[retired]});
  assert.equal(result.exceptions.length,0);assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].mapping.mapping_id,retired.mapping_id);
  assert.equal(result.candidates[0].trace.mapping_effective_to,'2026-01-01T00:00:00.000Z');
});

test('Payable source-detail and bank/AUTOC relations remain receipt-bound trace evidence, never candidate authority',()=>{
  const external_trace={payable_source_detail:{source:'PAYABLE',long_id:'relation-only',can_use_as_source_key:false},posting_date:'2026-08-05',bank_relation_ref:'bank-relation',autoc_relation_ref:'autoc-relation'};
  const external_trace_hash=canonicalRequestHash(external_trace),result=projectPersistedWbsInboundAutoRec({rows:[{...payable,external_trace,external_trace_hash}],mappings:[mapping(payable)]});
  const candidate=result.candidates[0];assert.deepEqual(candidate.external_relation_evidence,{fields:external_trace,trace_hash:external_trace_hash,can_use_as_source_key:false,can_match:false,can_transition:false,can_post:false});assert.equal(candidate.trace.external_relation_evidence.can_post,false);
  const substituted=projectPersistedWbsInboundAutoRec({rows:[{...payable,external_trace:{...external_trace,posting_date:'2026-08-06'},external_trace_hash}],mappings:[mapping(payable)]});
  assert.equal(substituted.candidates.length,0);assert.equal(substituted.exceptions[0].code,'WBS_AUTOREC_EXTERNAL_TRACE_MISMATCH');
  const unsafe=projectPersistedWbsInboundAutoRec({rows:[{...payable,external_trace:{...external_trace,token:'redacted'},external_trace_hash}],mappings:[mapping(payable)]});
  assert.equal(unsafe.candidates.length,0);assert.equal(unsafe.exceptions[0].code,'WBS_AUTOREC_EXTERNAL_TRACE_INVALID');
});

test('copies observed WBS M/R/C controls and JE detail only as fail-closed read-only evidence',()=>{
  const evidence=projectObservedWbsAutoRecControlEvidence({companyRows:[companyControl],detailRows:[{detail_kind:'JE_TRACE',company_key:'COMPANY-A',receipt_id:'receipt-1',receipt_ref:'object://wbs/receipt/1',receipt_hash:common.receipt_hash,source_record_id:'journal-1',source_version:'v1',posting_date:'2026-08-05',journal_no:'J-1',account_code:'291001',debit:'100.0000',credit:'100.0000',review_status:'REVIEWED',approval_status:'APPROVED',posting_status:'POSTED'}]});
  assert.equal(evidence.exceptions.length,0);assert.deepEqual(evidence.controls[0].completed_periods,{match:'2026-06',release:'2026-06',incur:'2025-03'});assert.equal(evidence.controls[0].released_amount,'80.0000');assert(evidence.forbidden_wbs_operations.includes('Delete'));assert.equal(evidence.details[0].observed_fields.account_code,'291001');assert.equal(evidence.can_post,false);
  const projected=projectPersistedWbsInboundAutoRec({rows:[bank,payable],mappings:[mapping(bank),mapping(payable)],companyControlRows:[companyControl]});assert.equal(projected.candidates.length,2);assert.equal(projected.control_evidence.controls.length,1);
});

test('invalid conservation, missing detail trace, or sensitive locators block all candidate projection',()=>{
  const invalid={...companyControl,released_amount:'101.0000'};
  const result=projectPersistedWbsInboundAutoRec({rows:[bank,payable],mappings:[mapping(bank),mapping(payable)],companyControlRows:[invalid]});assert.equal(result.candidates.length,0);assert.equal(result.exceptions[0].code,'WBS_AUTOREC_CONTROL_INVALID');
  const detail=projectObservedWbsAutoRecControlEvidence({companyRows:[companyControl],detailRows:[{detail_kind:'JE_TRACE',receipt_id:'receipt-1',receipt_ref:'object://wbs/receipt/1',receipt_hash:common.receipt_hash,source_record_id:'journal-1'}]});assert.equal(detail.exceptions[0].code,'WBS_AUTOREC_CONTROL_TRACE_REQUIRED');
  const unscoped=projectObservedWbsAutoRecControlEvidence({companyRows:[companyControl],detailRows:[{detail_kind:'RELEASED_PAYMENT',receipt_id:'receipt-1',receipt_ref:'object://wbs/receipt/1',receipt_hash:common.receipt_hash,source_record_id:'release-1',source_version:'v1'}]});assert.equal(unscoped.exceptions[0].code,'WBS_AUTOREC_CONTROL_TRACE_REQUIRED');
  const unsafe=projectObservedWbsAutoRecControlEvidence({companyRows:[{...companyControl,token:'redacted'}]});assert.equal(unsafe.exceptions[0].code,'WBS_AUTOREC_CONTROL_INPUT_INVALID');
});

test('a released WBS detail is retained as observed state, never a REFS transition authority',()=>{
  const released={detail_kind:'RELEASED_PAYMENT',company_key:'COMPANY-A',receipt_id:'receipt-release',receipt_ref:'object://wbs/receipt/release',receipt_hash:common.receipt_hash,source_record_id:'released-detail-1',source_version:'v1',posting_date:'2026-08-05',payment:'100.0000',reviewer:'Reviewer A',pd_status:'R',pd_match_status:'Match'};
  const evidence=projectObservedWbsAutoRecControlEvidence({companyRows:[companyControl],detailRows:[released]});
  assert.equal(evidence.exceptions.length,0);
  assert.equal(evidence.observed_workflow.contract,'WBS_AUTOREC_OBSERVED_WORKFLOW_V1');
  assert.deepEqual({state:evidence.details[0].observed_state,authority:evidence.details[0].state_authority,transition:evidence.details[0].can_transition_state,post:evidence.details[0].can_post},{state:'RELEASED',authority:'WBS_OBSERVED_EVIDENCE_ONLY',transition:false,post:false});
  assert.equal(evidence.details[0].observed_workflow_step,'DATA_PROCESSING_RELEASE');
  assert.deepEqual(evidence.details[0].observed_status_codes,{detail_status:'R',match_status:'Match',semantics:'UNVERIFIED_SOURCE_CODE'});
  const unsafeStatus=projectObservedWbsAutoRecControlEvidence({companyRows:[companyControl],detailRows:[{...released,pd_status:'R\u0001'}]});
  assert.equal(unsafeStatus.exceptions[0].code,'WBS_AUTOREC_STATUS_CODE_INVALID');
});

test('WBS accounting-log labels are receipt-bound audit trace, never a REFS workflow instruction',()=>{
  const log={detail_kind:'ACCOUNTING_AUDIT_LOG',company_key:'COMPANY-A',receipt_id:'receipt-log',receipt_ref:'object://wbs/receipt/log',receipt_hash:common.receipt_hash,source_record_id:'accounting-log-1',source_version:'v1',external_event_id:'event-1',operation_type:'Delete',observed_at:'2026-08-10T09:30:00.000Z'};
  const evidence=projectObservedWbsAutoRecControlEvidence({companyRows:[companyControl],detailRows:[log]});
  assert.equal(evidence.exceptions.length,0);
  assert.deepEqual(evidence.details[0].retained_audit_trace,{external_event_id:'event-1',operation_type:'Delete',observed_at:'2026-08-10T09:30:00.000Z',event_authority:'WBS_OBSERVED_EVIDENCE_ONLY',can_transition_state:false,can_create_draft:false,can_approve:false,can_post:false});
  assert.equal(evidence.details[0].observed_state,null);
  const incomplete=projectObservedWbsAutoRecControlEvidence({companyRows:[companyControl],detailRows:[{...log,observed_at:'2026-08-10'}]});
  assert.equal(incomplete.exceptions[0].code,'WBS_AUTOREC_AUDIT_TRACE_REQUIRED');
});

test('signed WBS amounts preserve direction and absolute capacity, while a bad company control blocks only that company',()=>{
  const observed={...companyControl,company_key:'COMPANY-B',amount:'-298741.5900',released_amount:'0.0000',incurred_amount:'-141059.8100',reconciliation_balance:'-157681.7800',new_balance:'-157681.7800'};
  const signed=projectObservedWbsAutoRecControlEvidence({companyRows:[observed]});assert.equal(signed.exceptions.length,0);assert.equal(signed.controls[0].incurred_amount,'-141059.8100');
  const other={...payable,company_key:'COMPANY-C',source_record_id:'pay-c',raw_event_id:'raw-c',source_document_id:'doc-c',staging_item_id:'stg-c'};
  const missingDate={...companyControl,balance_date:''};
  const scoped=projectPersistedWbsInboundAutoRec({rows:[payable,other],mappings:[mapping(payable),mapping(other)],companyControlRows:[missingDate,{...companyControl,company_key:'COMPANY-C'}]});
  assert.equal(scoped.candidates.length,1);assert.equal(scoped.candidates[0].company_key,'COMPANY-C');assert(scoped.exceptions.some(item=>item.code==='WBS_AUTOREC_CONTROL_SCOPE_BLOCKED'&&item.company_key==='COMPANY-A'));
});

test('blank, noncanonical, or over-precision WBS controls never coerce to zero-valued evidence',()=>{
  for(const invalidValue of ['', '   ', null, true, '0x10', '1e2', '100.00001', '.5']){
    const result=projectObservedWbsAutoRecControlEvidence({companyRows:[{...companyControl,released_amount:invalidValue}]});
    assert.equal(result.controls.length,0);
    assert.equal(result.exceptions[0].code,'WBS_AUTOREC_CONTROL_INVALID');
  }
  const zero=projectObservedWbsAutoRecControlEvidence({companyRows:[{...companyControl,released_amount:'0.0000',released_quantity:0}]});
  assert.equal(zero.exceptions.length,0);
  assert.equal(zero.controls[0].released_amount,'0.0000');
});

test('unmatched ACH payment remains review-only until immutable bank trace and all assignments exist',()=>{
  const base={detail_kind:'NOT_MATCH_PAYMENT',company_key:'COMPANY-A',receipt_id:'receipt-1',receipt_ref:'object://wbs/receipt/1',receipt_hash:common.receipt_hash,source_record_id:'detail-1',source_version:'v1',bank_source_record_id:'bank-1',bank_source_version:'v1',transaction_date:'2026-08-04',posting_date:'2026-08-05',account_code:'100100',ref_no:'ACH-1',direction:'CREDIT',amount:'298741.5900',vendor:'Vendor A',project_department:'Project A',cost_code:'C-100',user_ref:'USER-MASKED',workflow_status:'READY_FOR_REVIEW',memo:'Read-only source memo',invoice_receipt_evidence:'source-evidence-1',reviewer:'Reviewer A',comments_log:'external trace'};
  const ready=projectObservedWbsAutoRecControlEvidence({companyRows:[companyControl],detailRows:[base]});assert.equal(ready.exceptions.length,0);assert.equal(ready.details[0].observed_fields.bank_source_record_id,'bank-1');assert.equal(ready.details[0].can_post,false);assert(ready.forbidden_wbs_operations.includes('Split Record'));
  assert.deepEqual({state:ready.details[0].observed_state,authority:ready.details[0].state_authority,transition:ready.details[0].can_transition_state},{state:'NOT_MATCHED',authority:'WBS_OBSERVED_EVIDENCE_ONLY',transition:false});
  const unassigned=projectObservedWbsAutoRecControlEvidence({companyRows:[companyControl],detailRows:[{...base,cost_code:'',workflow_status:'NO_WORKFLOW'}]});assert.equal(unassigned.exceptions[0].code,'WBS_AUTOREC_UNMATCHED_REVIEW_REQUIRED');
});

test('incurred payment retains bank-to-AUTOC relation and review evidence without granting accounting authority',()=>{
  const incurred={detail_kind:'INCURRED_PAYMENT',company_key:'COMPANY-A',receipt_id:'receipt-1',receipt_ref:'object://wbs/receipt/1',receipt_hash:common.receipt_hash,source_record_id:'incurred-detail-1',source_version:'v1',bank_source_record_id:'bank-1',bank_source_version:'v2',bank_source_receipt_id:'receipt-bank-1',bank_source_receipt_ref:'object://wbs/receipt/bank-1',bank_source_receipt_hash:'sha256:'+'e'.repeat(64),autoc_payable_long_id:'autoc-payable-1',match_status:'MATCHED',transaction_date:'2026-08-04',posting_date:'2026-08-05',clear_date:'2026-08-06',bank_account_code:'100100',vendor:'Vendor A',memo:'Read-only original memo',ref_no:'REF-1',direction:'CREDIT',amount:'100.0000',project_department:'Project A',cost_code:'C-100',brief_description:'Read-only source description',invoice_receipt_evidence:'view-count-1',user_ref:'USER-MASKED',reviewer:'Reviewer A',comments_log:'External review trace'};
  const evidence=projectObservedWbsAutoRecControlEvidence({companyRows:[companyControl],detailRows:[incurred]});assert.equal(evidence.exceptions.length,0);assert.equal(evidence.details[0].retained_relation.autoc_payable.long_id,'autoc-payable-1');assert.equal(evidence.details[0].retained_relation.can_post,false);assert.equal(evidence.details[0].can_dispatch,false);
  assert.equal(evidence.details[0].observed_state,'INCURRED');assert.equal(evidence.details[0].can_transition_state,false);
  assert.equal(evidence.details[0].observed_workflow_step,'INCURRED_LIST');
  const incompleteRow={...incurred,autoc_payable_long_id:'',reviewer:''};
  const incomplete=projectObservedWbsAutoRecControlEvidence({companyRows:[companyControl],detailRows:[incompleteRow]});assert.equal(incomplete.exceptions[0].code,'WBS_AUTOREC_INCURRED_RELATION_REQUIRED');
  const scoped=projectPersistedWbsInboundAutoRec({rows:[bank,payable],mappings:[mapping(bank),mapping(payable)],companyControlRows:[companyControl],detailControlRows:[incompleteRow]});assert.equal(scoped.candidates.length,1);assert.equal(scoped.candidates[0].source_record_id,'pay-1');
});

test('receipt-backed control evidence accepts only exact persisted receipt, source version, and company scope',()=>{
  const control={...companyControl,receipt_id:'control-receipt',receipt_ref:'object://wbs/receipt/control',receipt_hash:'sha256:'+'b'.repeat(64),source_record_id:'control-a',source_version:'v1'};
  const detail={detail_kind:'INCURRED_PAYMENT',company_key:'COMPANY-A',receipt_id:'detail-receipt',receipt_ref:'object://wbs/receipt/detail',receipt_hash:'sha256:'+'c'.repeat(64),source_record_id:'detail-a',source_version:'v1',bank_source_record_id:'bank-1',bank_source_version:'v2',bank_source_receipt_id:'bank-receipt',bank_source_receipt_ref:'object://wbs/receipt/bank',bank_source_receipt_hash:'sha256:'+'e'.repeat(64),autoc_payable_long_id:'autoc-payable-1',match_status:'MATCHED',transaction_date:'2026-08-04',posting_date:'2026-08-05',bank_account_code:'100100',vendor:'Vendor A',memo:'Original memo',ref_no:'REF-1',direction:'CREDIT',amount:'100.0000',project_department:'Project A',cost_code:'C-100',invoice_receipt_evidence:'view-count-1',user_ref:'USER-MASKED',reviewer:'Reviewer A',comments_log:'External review trace'};
  const persisted=[control,detail,{...bank,source_record_id:'bank-1',source_version:'v2',receipt_id:'bank-receipt',receipt_ref:'object://wbs/receipt/bank',receipt_hash:'sha256:'+'e'.repeat(64)}];
  const accepted=bindReceiptBackedWbsAutoRecControlEvidence({companyRows:[control],detailRows:[detail],persistedRows:persisted});assert.equal(accepted.exceptions.length,0);assert.equal(accepted.controls[0].receipt_trace.source_record_id,'control-a');assert.equal(accepted.details[0].bank_relation_trace.source_version,'v2');
  const missing=bindReceiptBackedWbsAutoRecControlEvidence({companyRows:[{...control,source_record_id:'missing-control'}],detailRows:[],persistedRows:persisted});assert.equal(missing.exceptions[0].code,'WBS_AUTOREC_RECEIPT_MISSING');
  const changed=bindReceiptBackedWbsAutoRecControlEvidence({companyRows:[{...control,receipt_hash:'sha256:'+'d'.repeat(64)}],detailRows:[],persistedRows:persisted});assert.equal(changed.exceptions[0].code,'WBS_AUTOREC_RECEIPT_CHANGED');
  const malformedHash=bindReceiptBackedWbsAutoRecControlEvidence({companyRows:[{...control,receipt_hash:'not-a-hash'}],detailRows:[],persistedRows:persisted});assert.equal(malformedHash.exceptions[0].code,'WBS_AUTOREC_RECEIPT_HASH_INVALID');
  const stale=bindReceiptBackedWbsAutoRecControlEvidence({companyRows:[{...control,source_version:'v0'}],detailRows:[],persistedRows:persisted});assert.equal(stale.exceptions[0].code,'WBS_AUTOREC_RECEIPT_STALE');
  const crossCompany=bindReceiptBackedWbsAutoRecControlEvidence({companyRows:[{...control,company_key:'COMPANY-B'}],detailRows:[],persistedRows:persisted});assert.equal(crossCompany.exceptions[0].code,'WBS_AUTOREC_RECEIPT_SCOPE_MISMATCH');
  const crossSource={...detail,bank_source_record_id:'pay-1',bank_source_version:'v1'};
  const crossSourceResult=projectPersistedWbsInboundAutoRec({rows:[bank,payable],mappings:[mapping(bank),mapping(payable)],companyControlRows:[control],detailControlRows:[crossSource],persistedControlRows:persisted});assert.equal(crossSourceResult.candidates.length,1);assert.equal(crossSourceResult.candidates[0].source_record_id,'bank-1');
  const projection=projectPersistedWbsInboundAutoRec({rows:[bank,payable],mappings:[mapping(bank),mapping(payable)],companyControlRows:[control],persistedControlRows:persisted});assert.equal(projection.candidates.length,2);assert.equal(projection.control_evidence.evidence_type,'WBS_AUTOREC_RECEIPT_BACKED_CONTROL_EVIDENCE_V1');
  assert.equal(projection.candidates[0].company_control_trace.receipt_hash,control.receipt_hash);
  assert.equal(projection.candidates[0].trace.company_control_trace.control_snapshot_hash,projection.candidates[0].company_control_trace.control_snapshot_hash);
  assert.equal(projection.candidates[0].company_control_trace.can_release,false);
});

test('two receipt-backed M/R/C snapshots for one company block only that company candidates',()=>{
  const first={...companyControl,receipt_id:'control-a',receipt_ref:'object://wbs/receipt/control-a',receipt_hash:'sha256:'+'1'.repeat(64),source_record_id:'control-a',source_version:'v1'};
  const second={...companyControl,receipt_id:'control-b',receipt_ref:'object://wbs/receipt/control-b',receipt_hash:'sha256:'+'2'.repeat(64),source_record_id:'control-b',source_version:'v1'};
  const other={...payable,company_key:'COMPANY-B',source_record_id:'pay-b',raw_event_id:'raw-b',source_document_id:'doc-b',staging_item_id:'stg-b'};
  const result=projectPersistedWbsInboundAutoRec({rows:[bank,other],mappings:[mapping(bank),mapping(other)],companyControlRows:[first,second],persistedControlRows:[first,second]});
  assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].company_key,'COMPANY-B');
  assert(result.exceptions.some(item=>item.code==='WBS_AUTOREC_CONTROL_SNAPSHOT_AMBIGUOUS'&&item.company_key==='COMPANY-A'));
});

test('a changed immutable Company Screening receipt changes the candidate trace and replay identity',()=>{
  const first={...companyControl,receipt_id:'control-a',receipt_ref:'object://wbs/receipt/control-a',receipt_hash:'sha256:'+'3'.repeat(64),source_record_id:'control-a',source_version:'v1'};
  const next={...first,receipt_id:'control-b',receipt_ref:'object://wbs/receipt/control-b',receipt_hash:'sha256:'+'4'.repeat(64),source_record_id:'control-b',source_version:'v2',new_balance:'30.0000'};
  const initial=projectPersistedWbsInboundAutoRec({rows:[bank],mappings:[mapping(bank)],companyControlRows:[first],persistedControlRows:[first]}).candidates[0];
  const refreshed=projectPersistedWbsInboundAutoRec({rows:[bank],mappings:[mapping(bank)],companyControlRows:[next],persistedControlRows:[next]}).candidates[0];
  assert.notEqual(initial.review_candidate_id,refreshed.review_candidate_id);
  assert.notEqual(initial.company_control_trace.control_snapshot_hash,refreshed.company_control_trace.control_snapshot_hash);
  assert.equal(refreshed.trace.company_control_trace.receipt_hash,next.receipt_hash);
});

test('receipt binding rejects the same source/version when its persisted tenant or entity differs from the selected scope',()=>{
  const scope={tenant_id:'tenant-a',entity_id:'entity-a',company_key:'COMPANY-A'};
  const control={...companyControl,...scope,receipt_id:'scope-receipt',receipt_ref:'object://wbs/receipt/scope',receipt_hash:'sha256:'+'f'.repeat(64),source_record_id:'shared-control',source_version:'v1'};
  const wrongTenant={...control,tenant_id:'tenant-b'};
  const wrongEntity={...control,entity_id:'entity-b'};
  const accepted=bindReceiptBackedWbsAutoRecControlEvidence({companyRows:[control],detailRows:[],persistedRows:[control],scope});
  assert.equal(accepted.exceptions.length,0);assert.equal(accepted.controls[0].receipt_trace.tenant_id,'tenant-a');
  const tenantMismatch=bindReceiptBackedWbsAutoRecControlEvidence({companyRows:[control],detailRows:[],persistedRows:[wrongTenant],scope});
  const entityMismatch=bindReceiptBackedWbsAutoRecControlEvidence({companyRows:[control],detailRows:[],persistedRows:[wrongEntity],scope});
  assert.equal(tenantMismatch.exceptions[0].code,'WBS_AUTOREC_RECEIPT_SCOPE_MISMATCH');
  assert.equal(entityMismatch.exceptions[0].code,'WBS_AUTOREC_RECEIPT_SCOPE_MISMATCH');
});
