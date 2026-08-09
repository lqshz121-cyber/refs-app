import test from 'node:test';
import assert from 'node:assert/strict';
import {createWbsAutoRecG11ReadVerifier,createWbsInboundAutoRecReadComposition} from '../runtime/wbs-inbound-autorec-read-composition.mjs';

const scope={tenantId:'t1',entityId:'e1',companyKey:'COMPANY-A',sourceRecordIds:['bank-1','pay-1','control-1'],replayKey:'read-1'};
const receipt={receipt_id:'r1',receipt_ref:'object://wbs/r1',receipt_hash:'sha256:'+'a'.repeat(64)};
const bank={...receipt,tenant_id:'t1',entity_id:'e1',company_key:'COMPANY-A',source_record_id:'bank-1',source_version:'v1',source_type:'BANK_TRANSACTION',stage:'STAGING_REVIEWED',raw_event_id:'raw-b',source_document_id:'doc-b',staging_item_id:'stg-b',currency:'USD',amount:-100,business_date:'2026-08-01',accounting_date:'2026-08-01',direction:'CREDIT',review_event_id:'review-bank',bank_account_ref:'BANK-1'};
const payable={...receipt,tenant_id:'t1',entity_id:'e1',company_key:'COMPANY-A',source_record_id:'pay-1',source_version:'v1',source_type:'PAYABLE',stage:'STAGING_REVIEWED',raw_event_id:'raw-p',source_document_id:'doc-p',staging_item_id:'stg-p',currency:'USD',amount:100,business_date:'2026-08-01',accounting_date:'2026-08-01',direction:'DEBIT',review_event_id:'review-pay'};
const control={...receipt,tenant_id:'t1',entity_id:'e1',company_key:'COMPANY-A',source_record_id:'control-1',source_version:'v1',user_ref:'MASKED',completed_match_period:'M:08/2026',completed_release_period:'R:08/2026',completed_incur_period:'C:08/2026',quantity:1,released_quantity:0,incurred_quantity:0,amount:'100.0000',released_amount:'0.0000',incurred_amount:'0.0000',reconciliation_balance:'100.0000',new_balance:'100.0000',balance_date:'2026-08-01'};
const map=row=>({mapping_id:`map-${row.source_record_id}`,version:'1',snapshot_hash:'sha256:'+(row.source_type==='BANK_TRANSACTION'?'b':'a').repeat(64),status:'APPROVED',source_type:row.source_type,entity_id:'e1',company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',effective_from:'2026-01-01T00:00:00.000Z',effective_to:null});
const policy={policy_id:'policy-1',version:'1',mapping_id:'policy-1',mapping_version:'1',policy_snapshot_hash:'sha256:'+'c'.repeat(64),status:'APPROVED',entity_id:'e1',company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',rule_id:'rule-1',rule_version:'1',bank_mapping_id:'map-bank-1',bank_mapping_version:'1',bank_mapping_snapshot_hash:'sha256:'+'b'.repeat(64),business_mapping_id:'map-pay-1',business_mapping_version:'1',business_mapping_snapshot_hash:'sha256:'+'a'.repeat(64),amount_tolerance:'0.0000',date_window_days:'3',date_match_basis:'BUSINESS_AND_ACCOUNTING'};
const observedState={tenant_id:'t1',entity_id:'e1',company_key:'COMPANY-A',source_record_id:'pay-1',source_version:'v1',receipt_id:'r1',receipt_hash:'sha256:'+'a'.repeat(64),observed_at:'2026-08-01T00:00:00Z',observed_state:'RELEASED',observed_workflow_step:'DATA_PROCESSING_RELEASE'};
function repository({badScope=false,fail=false}={}){return {readPersistedWbsInboundRows:async()=>{if(fail)throw Error('unavailable');return badScope?[{...bank,company_key:'COMPANY-B'}]:[bank,payable]},readPersistedWbsControlRows:async()=>({companyRows:[control],detailRows:[],persistedRows:[control]}),readApprovedWbsAutoRecMappings:async()=>[map(bank),map(payable)],readApprovedWbsAutoRecMatchingPolicies:async()=>[],readWbsAutoRecObservedStateEvidence:async()=>[observedState]};}

test('composes only scoped persisted receipt-backed rows and returns stable replay',async()=>{
  const reader=createWbsInboundAutoRecReadComposition({repository:repository()});const first=await reader.read(scope);assert.equal(first.status,'READ_ONLY_PROJECTED');assert.equal(first.candidates.length,2);assert.equal(first.review_plans.length,0);assert.deepEqual({count:first.observed_state_evidence.length,state:first.observed_state_evidence[0].observed_state,release:first.observed_state_evidence[0].can_release},{count:1,state:'RELEASED',release:false});assert.equal(first.can_post,false);
  const replay=await reader.read(scope);assert.equal(replay.replayed,true);assert.equal(replay.request_hash,first.request_hash);
  const changed=await reader.read({...scope,companyKey:'COMPANY-B'});assert.equal(changed.code,'WBS_AUTOREC_READ_REPLAY_CONFLICT');assert.equal(changed.candidates.length,0);
});

test('an approved matching-policy snapshot alone can create a read-only proposal, never a dispatchable allocation',async()=>{
  const reader=createWbsInboundAutoRecReadComposition({repository:{...repository(),readApprovedWbsAutoRecMatchingPolicies:async()=>[policy]}});
  const result=await reader.read({...scope,replayKey:'policy-plan'});
  assert.equal(result.review_plans.length,1);assert.equal(result.review_plans[0].status,'REVIEW_REQUIRED');
  assert.deepEqual({allocated:result.review_plans[0].control_totals.allocated_total,allocate:result.review_plans[0].can_allocate,post:result.review_plans[0].can_post},{allocated:100,allocate:false,post:false});
});

test('missing capability, read failure, and tenant/entity/company/source leakage fail closed with zero candidates',async()=>{
  assert.equal((await createWbsInboundAutoRecReadComposition({}).read(scope)).code,'WBS_AUTOREC_READ_CAPABILITY_UNAVAILABLE');
  assert.equal((await createWbsInboundAutoRecReadComposition({repository:repository({fail:true})}).read(scope)).code,'WBS_AUTOREC_READ_FAILED');
  const scoped=await createWbsInboundAutoRecReadComposition({repository:repository({badScope:true})}).read(scope);assert.equal(scoped.code,'WBS_AUTOREC_READ_SCOPE_INVALID');assert.equal(scoped.candidates.length,0);
});

test('G11 read verifier accepts only scoped kernel-read posted evidence and keeps all accounting actions disabled',async()=>{
  const selection={tenantId:'t1',entityId:'e1',companyKey:'COMPANY-A',reviewCandidateId:'candidate-1',replayKey:'g11-1'};
  const g11Scope={company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1'},sourceTrace={...g11Scope,allocated_amount:'10.0000',bank_business_date:'2026-08-01',bank_accounting_date:'2026-08-01',business_business_date:'2026-08-01',business_accounting_date:'2026-08-01',bank_receipt_id:'r-bank',bank_receipt_ref:'object://receipt/bank',bank_receipt_hash:'sha256:'+'a'.repeat(64),business_receipt_id:'r-pay',business_receipt_ref:'object://receipt/pay',business_receipt_hash:'sha256:'+'b'.repeat(64),bank_raw_event_id:'raw-b',business_raw_event_id:'raw-p',bank_source_document_id:'doc-b',business_source_document_id:'doc-p',bank_source_record_id:'bank-1',bank_source_version:'v1',business_source_record_id:'pay-1',business_source_version:'v1',bank_staging_item_id:'stg-b',business_staging_item_id:'stg-p'};
  const review={tenant_id:'t1',entity_id:'e1',...g11Scope,allocated_amount:'10.0000',review_candidate_id:'candidate-1',request_type:'AUTOREC_REVIEW_REQUEST',status:'REVIEW_REQUIRED',trace:sourceTrace};
  const journal=(type,lines)=>({tenant_id:'t1',entity_id:'e1',...g11Scope,accounting_type:type,source_system:'REFS_STANDARD_JE',status:'POSTED',journal_entry_id:`je-${type}`,audit_event_id:`audit-${type}`,audit_event_type:'AUTO_JOURNAL_CREATED',source_trace:sourceTrace,ledger_lines:lines});
  const posted=[journal('PAYABLE_INCUR',[{ledger_line_id:'l1',account_code:'291001',member_ref:'V-1',debit_amount:0,credit_amount:10},{ledger_line_id:'l2',account_code:'610000',member_ref:null,debit_amount:10,credit_amount:0}]),journal('AUTOC',[{ledger_line_id:'l3',account_code:'291001',member_ref:'V-1',debit_amount:10,credit_amount:0},{ledger_line_id:'l4',account_code:'111000',member_ref:'B-1',debit_amount:0,credit_amount:10}])];
  const verifier=createWbsAutoRecG11ReadVerifier({repository:{readReviewedWbsAutoRecRequest:async()=>review,readPostedWbsAutoRecJournalEvidence:async()=>posted}});
  const accepted=await verifier.verify(selection);assert.deepEqual({status:accepted.status,net:accepted.verification.control_totals.ap_291001_member_nets['V-1'],dispatch:accepted.can_dispatch,post:accepted.can_post},{status:'G11_POSTED_TRACE_VERIFIED',net:0,dispatch:false,post:false});
  assert.equal((await verifier.verify(selection)).replayed,true);
  assert.equal((await createWbsAutoRecG11ReadVerifier({}).verify(selection)).code,'WBS_AUTOREC_G11_READ_CAPABILITY_UNAVAILABLE');
  const badScope=createWbsAutoRecG11ReadVerifier({repository:{readReviewedWbsAutoRecRequest:async()=>({...review,company_key:'OTHER'}),readPostedWbsAutoRecJournalEvidence:async()=>posted}});
  assert.equal((await badScope.verify(selection)).code,'WBS_AUTOREC_G11_READ_SCOPE_INVALID');
  const draft=createWbsAutoRecG11ReadVerifier({repository:{readReviewedWbsAutoRecRequest:async()=>review,readPostedWbsAutoRecJournalEvidence:async()=>[{...posted[0],status:'DRAFT'},posted[1]]}});
  assert.equal((await draft.verify(selection)).code,'WBS_AUTOREC_G11_POSTED_EVIDENCE_REQUIRED');
  const crossCurrency=createWbsAutoRecG11ReadVerifier({repository:{readReviewedWbsAutoRecRequest:async()=>review,readPostedWbsAutoRecJournalEvidence:async()=>[posted[0],{...posted[1],currency:'CAD'}]}});
  assert.equal((await crossCurrency.verify(selection)).code,'WBS_AUTOREC_G11_POSTED_EVIDENCE_REQUIRED');
  const underAllocated=createWbsAutoRecG11ReadVerifier({repository:{readReviewedWbsAutoRecRequest:async()=>review,readPostedWbsAutoRecJournalEvidence:async()=>[{...posted[0],ledger_lines:[{...posted[0].ledger_lines[0],credit_amount:9},{...posted[0].ledger_lines[1],debit_amount:9}]},{...posted[1],ledger_lines:[{...posted[1].ledger_lines[0],debit_amount:9},{...posted[1].ledger_lines[1],credit_amount:9}]}]}});
  assert.equal((await underAllocated.verify(selection)).code,'WBS_AUTOREC_G11_ALLOCATION_AMOUNT_MISMATCH');
});
