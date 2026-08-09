import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {buildAutoReconciliationReviewRequest,buildStandardDraftRequest,buildWbsInboundPersistencePlan,createWbsInboundDataAdapter,createWbsInboundDataAdapterWithKeyring,createWbsInboundOrchestrator,evaluateWbsAutoReconciliationEligibility,validatePostedJournalTrace,validateWbsAutoRecG11PostedTrace,WBS_AUTOREC_OBSERVED_CONTRACT,WbsInboundDataError} from '../runtime/wbs-inbound-data-adapter.mjs';

const guid='11111111-1111-4111-8111-111111111111';
const snapshot=()=>{const value={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:'22222222-2222-4222-8222-222222222222',captured_at:'2026-08-05T10:00:00.000Z',environment:'SANDBOX',source_system:'WBS',dictionary_version:'WBS-DICT-2026-08-05',views:[
  {name:'BGDATA.payable',company_key:'COMPANY-A',rows:[{apGuId:guid,currency:'USD',amount:'100.0000',invoice_date:'2026-08-01',posting_date:'2026-08-01',direction:'DEBIT',bank_account_ref:'BANK-OP'}]},
  {name:'BGDATA.bank_transaction',company_key:'COMPANY-A',rows:[{cashOrBankBookId:'BANK-1',bank_account_ref:'BANK-OP',currency:'USD',amount:'-100.0000',transaction_date:'2026-08-02',posting_date:'2026-08-02',direction:'CREDIT',source:'AUTOC',come_from:'Auto Payment'}]},
  {name:'BGDATA.autoc_detail',company_key:'COMPANY-A',rows:[{pdGuId:'33333333-3333-4333-8333-333333333333',pbGuId:'44444444-4444-4444-8444-444444444444',currency:'USD',amount:'100.0000',payment_date:'2026-08-02',posting_date:'2026-08-02',vendor_ref:'VEN-1',project_ref:'PROJ-1',cost_code_ref:'COST-1',description:'masked'}]}
]};value.views=value.views.map(view=>({...view,content_hash:canonicalRequestHash(view.rows)}));return {...value,package_hash:canonicalRequestHash(value)};};
const reader=value=>({readOnly:true,readSnapshot:async()=>structuredClone(value)});
const productionSnapshot=()=>{
  const pair=generateKeyPairSync('ed25519'),base=snapshot(),keyId='wbs-prod-test-1',ids={'BGDATA.payable':'apGuId','BGDATA.bank_transaction':'cashOrBankBookId','BGDATA.autoc_detail':'pdGuId'};
  const value={...base,schema_version:'WBS_READONLY_SNAPSHOT_V2',environment:'PRODUCTION',delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',extract_started_at:'2026-08-05T10:00:00.000Z',extract_completed_at:'2026-08-05T10:00:00.000Z',consistency:'COMPLETE',read_consistency:'REPEATABLE_READ_TRANSACTION',pagination:'PRIMARY_KEY_SEEK'},views:base.views.map(view=>({...view,row_count:view.rows.length,first_primary_key:view.rows[0][ids[view.name]],last_primary_key:view.rows.at(-1)[ids[view.name]]})),detached_signature:{key_id:keyId,algorithm:'Ed25519',value:''}};
  const {package_hash,detached_signature,...manifest}=value;value.package_hash=canonicalRequestHash(manifest);value.detached_signature.value=sign(null,Buffer.from(value.package_hash),pair.privateKey).toString('base64');
  return {value,publicKeys:{[keyId]:pair.publicKey.export({type:'spki',format:'pem'})}};
};

test('read-only snapshot adapter produces typed Raw/Normalized/Staging seams without a WBS write or Draft command',async()=>{
  const result=await createWbsInboundDataAdapter({snapshotReader:reader(snapshot())}).pull({selection:{company:'COMPANY-A'}});
  assert.deepEqual({raw:result.raw.length,normalized:result.normalized.length,staging:result.staging.length,exceptions:result.exceptions.length},{raw:3,normalized:3,staging:3,exceptions:0});
  assert.equal(result.admission.can_write_wbs,false);assert.equal(result.admission.can_create_draft,false);assert.equal(result.staging.find(item=>item.raw_trace.source_type==='BANK_TRANSACTION').raw_trace.source_record_id,'BANK-1');
});

test('incomplete receipt rows reach Exception rather than staging or a Draft request',async()=>{
  const value=snapshot();delete value.views[0].rows[0].invoice_date;value.views[0].content_hash=canonicalRequestHash(value.views[0].rows);delete value.package_hash;value.package_hash=canonicalRequestHash(value);
  const result=await createWbsInboundDataAdapter({snapshotReader:reader(value)}).pull();
  assert.equal(result.exceptions.length,1);assert.equal(result.exceptions[0].exception.code,'WBS_RECEIPT_FIELD_MISSING');assert.equal(result.staging.length,2);
});

test('WBS receipt amounts reject JavaScript coercions and noncanonical decimal precision before staging',async()=>{
  for(const invalidAmount of ['',true,'0x64','1e2','100.00001']){
    const value=snapshot();value.views[0].rows[0].amount=invalidAmount;value.views[0].content_hash=canonicalRequestHash(value.views[0].rows);delete value.package_hash;value.package_hash=canonicalRequestHash(value);
    const result=await createWbsInboundDataAdapter({snapshotReader:reader(value)}).pull();
    const payable=result.exceptions.find(item=>item.raw_trace.source_type==='PAYABLE');
    assert.equal(payable.exception.code,'WBS_RECEIPT_FIELD_MISSING');assert.equal(payable.raw_trace.amount,null);assert.equal(result.staging.some(item=>item.raw_trace.source_type==='PAYABLE'),false);
  }
});

test('production WBS snapshots require pinned detached-signature verification before any Raw or Staging preparation',async()=>{
  const {value,publicKeys}=productionSnapshot();
  const keyed=createWbsInboundDataAdapterWithKeyring({snapshotReader:reader(value),wbsPublicKeys:publicKeys}),verified=await keyed.pull();
  assert.equal(verified.raw.length,3);
  assert.throws(()=>keyed.prepare(value),error=>error.code==='WBS_SNAPSHOT_VERIFIED_PREPARATION_REQUIRED');
  await assert.rejects(()=>createWbsInboundDataAdapter({snapshotReader:reader(value)}).pull(),error=>error.code==='WBS_SNAPSHOT_SIGNATURE_VERIFIER_REQUIRED');
  const forged=structuredClone(value);forged.detached_signature.value='forged';
  await assert.rejects(()=>createWbsInboundDataAdapterWithKeyring({snapshotReader:reader(forged),wbsPublicKeys:publicKeys}).pull(),error=>error.code==='WBS_SNAPSHOT_SIGNATURE_INVALID');
});

test('an impossible WBS posting date is quarantined before staging or an accounting request',async()=>{
  const value=snapshot();value.views[0].rows[0].invoice_date='2026-02-30';value.views[0].rows[0].posting_date='2026-02-30';value.views[0].content_hash=canonicalRequestHash(value.views[0].rows);delete value.package_hash;value.package_hash=canonicalRequestHash(value);
  const result=await createWbsInboundDataAdapter({snapshotReader:reader(value)}).pull();
  assert.equal(result.staging.some(item=>item.raw_trace.source_type==='PAYABLE'),false);
  assert.equal(result.exceptions.find(item=>item.raw_trace.source_type==='PAYABLE').exception.code,'WBS_RECEIPT_FIELD_MISSING');
  assert.equal(result.admission.can_create_draft,false);assert.equal(result.admission.can_post,false);
});

test('a missing WBS posting date remains missing and cannot be derived from the business date',async()=>{
  const value=snapshot();delete value.views[1].rows[0].posting_date;value.views[1].content_hash=canonicalRequestHash(value.views[1].rows);delete value.package_hash;value.package_hash=canonicalRequestHash(value);
  const result=await createWbsInboundDataAdapter({snapshotReader:reader(value)}).pull();
  const bank=result.exceptions.find(item=>item.raw_trace.source_type==='BANK_TRANSACTION');
  assert.equal(bank.exception.code,'WBS_RECEIPT_FIELD_MISSING');
  assert.equal(bank.raw_trace.business_date,'2026-08-02');
  assert.equal(bank.raw_trace.accounting_date,null);
  assert.equal(result.staging.some(item=>item.raw_trace.source_type==='BANK_TRANSACTION'),false);
});

test('Draft and AutoRec requests are review-only seams with immutable source trace',async()=>{
  const result=await createWbsInboundDataAdapter({snapshotReader:reader(snapshot())}).pull();
  const payable=result.staging.find(item=>item.raw_trace.source_type==='PAYABLE').raw_trace;
  const bank=result.staging.find(item=>item.raw_trace.source_type==='BANK_TRANSACTION').raw_trace;
  const reviewedPayable={...payable,receipt_id:'receipt-pay',stage:'STAGING_REVIEWED',staging_item_id:'stg-pay',source_document_id:'doc-pay',raw_event_id:'raw-pay',bill_no:'BILL-1',project_ref:'PROJECT-1',project_code:'PJ-1',account_before:'291000',account_after:'291001',review_event_id:'review-pay'};
  const reviewedBank={...bank,receipt_id:'receipt-bank',stage:'STAGING_REVIEWED',staging_item_id:'stg-bank',source_document_id:'doc-bank',raw_event_id:'raw-bank',journal_no:'JE-1',payee_no:'PAYEE-1',account_before:'111000',account_after:'291001',review_event_id:'review-bank'};
  const autoRec=buildAutoReconciliationReviewRequest({bankStaging:reviewedBank,businessStaging:reviewedPayable});assert.equal(autoRec.status,'REVIEW_REQUIRED');assert.equal(autoRec.can_release,false);
  const matchingPolicy={policy_id:'policy-1',version:'1',mapping_id:'matching-map-1',mapping_version:'1',rule_id:'rule-1',rule_version:'1',bank_mapping_id:'bank-map-1',bank_mapping_version:'1',business_mapping_id:'pay-map-1',business_mapping_version:'1',status:'APPROVED',company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-OP',amount_tolerance:'0.0000',date_window_days:3,date_match_basis:'BUSINESS_AND_ACCOUNTING',receipt_id:'policy-receipt-1',receipt_ref:'object://receipt/policy-1',receipt_hash:'sha256:'+'f'.repeat(64)};
  const policyAutoRec=buildAutoReconciliationReviewRequest({bankStaging:{...reviewedBank,mapping_id:'bank-map-1',mapping_version:'1'},businessStaging:{...reviewedPayable,mapping_id:'pay-map-1',mapping_version:'1'},matchingPolicy,dateWindowDays:0,dateMatchBasis:'ACCOUNTING_ONLY',tolerance:999});
  assert.match(policyAutoRec.review_plan_id,/^sha256:[0-9a-f]{64}$/);assert.equal(policyAutoRec.trace.review_plan_id,policyAutoRec.review_plan_id);assert.match(policyAutoRec.allocation_edge_id,/^sha256:[0-9a-f]{64}$/);assert.match(policyAutoRec.proposal_allocation_edge_id,/^sha256:[0-9a-f]{64}$/);assert.equal(policyAutoRec.trace.matching_policy.rule_id,'rule-1');assert.deepEqual({allocated:policyAutoRec.allocated_amount,traceAllocated:policyAutoRec.trace.allocated_amount,window:policyAutoRec.date_window_days,basis:policyAutoRec.date_match_basis,difference:policyAutoRec.amount_difference},{allocated:100,traceAllocated:100,window:3,basis:'BUSINESS_AND_ACCOUNTING',difference:0});
  const draft=buildStandardDraftRequest({stagingItem:reviewedPayable,mapping:{mapping_id:'map-1',version:'4',status:'APPROVED',company_key:'COMPANY-A',currency:'USD'},journal:{period_id:'period-1',journal_number:'AUTO-1',company_key:'COMPANY-A',currency:'USD',accounting_date:'2026-08-01',lines:[{debit_amount:100,credit_amount:0},{debit_amount:0,credit_amount:100}]}});
  assert.equal(draft.kernel_method,'createAutoJournal');assert.equal(draft.can_dispatch,false);assert.equal(draft.can_post,false);
  const postedEvidence={source_system:'REFS_STANDARD_JE',status:'POSTED',journal_entry_id:'je-1',ledger_line_ids:['ll-1','ll-2'],review_audit_id:'audit-r',approval_audit_id:'audit-a',post_audit_id:'audit-p',source_trace:{...draft.trace}};
  const trace=validatePostedJournalTrace({draftRequest:draft,postedEvidence});
  assert.equal(trace.ok,true);assert.equal(trace.trace.raw_event_id,'raw-pay');assert.deepEqual({company:trace.trace.company_key,currency:trace.trace.currency,accountingDate:trace.trace.accounting_date},{company:'COMPANY-A',currency:'USD',accountingDate:'2026-08-01'});
  assert.throws(()=>validatePostedJournalTrace({draftRequest:draft,postedEvidence:{...postedEvidence,source_trace:{...draft.trace,currency:'CAD'}}}),error=>error.code==='WBS_POSTED_SOURCE_TRACE_MISMATCH');
});

test('G11 accepts only both posted AutoRec legs with exact source trace and per-member 291001 net zero',()=>{
  const scope={company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1'},review={request_type:'AUTOREC_REVIEW_REQUEST',status:'REVIEW_REQUIRED',...scope,allocated_amount:'100.0000',trace:{...scope,allocated_amount:'100.0000',bank_business_date:'2026-08-01',bank_accounting_date:'2026-08-01',business_business_date:'2026-08-01',business_accounting_date:'2026-08-01',bank_receipt_id:'receipt-bank',bank_receipt_ref:'object://receipt/bank',bank_receipt_hash:'sha256:'+'a'.repeat(64),business_receipt_id:'receipt-pay',business_receipt_ref:'object://receipt/pay',business_receipt_hash:'sha256:'+'b'.repeat(64),bank_raw_event_id:'raw-bank',business_raw_event_id:'raw-pay',bank_source_document_id:'doc-bank',business_source_document_id:'doc-pay',bank_source_record_id:'bank-1',bank_source_version:'v1',business_source_record_id:'pay-1',business_source_version:'v1',bank_staging_item_id:'stg-bank',business_staging_item_id:'stg-pay'}};
  const journal=(accounting_type,lines)=>({...scope,accounting_type,source_system:'REFS_STANDARD_JE',status:'POSTED',journal_entry_id:`je-${accounting_type}`,audit_event_id:`audit-${accounting_type}`,audit_event_type:'AUTO_JOURNAL_CREATED',source_trace:{...review.trace},ledger_lines:lines});
  const payable=journal('PAYABLE_INCUR',[{ledger_line_id:'pay-ap',account_code:'291001',member_ref:'VENDOR-1',debit_amount:0,credit_amount:100},{ledger_line_id:'pay-expense',account_code:'610000',member_ref:null,debit_amount:100,credit_amount:0}]);
  const autoc=journal('AUTOC',[{ledger_line_id:'auto-ap',account_code:'291001',member_ref:'VENDOR-1',debit_amount:100,credit_amount:0},{ledger_line_id:'auto-bank',account_code:'111000',member_ref:'BANK-1',debit_amount:0,credit_amount:100}]);
  const accepted=validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[payable,autoc]});
  assert.deepEqual({status:accepted.status,net:accepted.control_totals.ap_291001_member_nets['VENDOR-1'],transition:accepted.can_transition_case,post:accepted.can_post},{status:'POSTED_TRACE_VERIFIED',net:0,transition:false,post:false});
  const splitPayable={...payable,ledger_lines:[{ledger_line_id:'pay-ap-1',account_code:'291001',member_ref:'VENDOR-1',debit_amount:0,credit_amount:40},{ledger_line_id:'pay-ap-2',account_code:'291001',member_ref:'VENDOR-2',debit_amount:0,credit_amount:60},{...payable.ledger_lines[1],ledger_line_id:'pay-expense-split'}]};
  const splitAutoc={...autoc,ledger_lines:[{ledger_line_id:'auto-ap-1',account_code:'291001',member_ref:'VENDOR-1',debit_amount:40,credit_amount:0},{ledger_line_id:'auto-ap-2',account_code:'291001',member_ref:'VENDOR-2',debit_amount:60,credit_amount:0},{...autoc.ledger_lines[1],ledger_line_id:'auto-bank-split'}]};
  assert.equal(validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[splitPayable,splitAutoc]}).status,'POSTED_TRACE_VERIFIED');
  const policyBoundTrace={...review.trace,review_plan_id:'sha256:'+'c'.repeat(64),allocation_edge_id:'sha256:'+'d'.repeat(64),proposal_allocation_edge_id:'sha256:'+'e'.repeat(64),matching_policy:{policy_id:'policy-1',version:'1',status:'APPROVED',mapping_id:'mapping-1',mapping_version:'1',rule_id:'rule-1',rule_version:'1',bank_mapping_id:'bank-map-1',bank_mapping_version:'1',business_mapping_id:'pay-map-1',business_mapping_version:'1',date_match_basis:'BUSINESS_AND_ACCOUNTING',receipt_id:'policy-receipt-1',receipt_ref:'object://receipt/policy-1',receipt_hash:'sha256:'+'f'.repeat(64)}};
  const policyBoundReview={...review,review_plan_id:policyBoundTrace.review_plan_id,allocation_edge_id:policyBoundTrace.allocation_edge_id,proposal_allocation_edge_id:policyBoundTrace.proposal_allocation_edge_id,matching_policy:policyBoundTrace.matching_policy,trace:policyBoundTrace};
  const policyBoundPayable={...payable,source_trace:{...policyBoundTrace}};
  const policyBoundAutoc={...autoc,source_trace:{...policyBoundTrace}};
  assert.equal(validateWbsAutoRecG11PostedTrace({reviewRequest:policyBoundReview,postedJournals:[policyBoundPayable,policyBoundAutoc]}).status,'POSTED_TRACE_VERIFIED');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:policyBoundReview,postedJournals:[policyBoundPayable,{...policyBoundAutoc,source_trace:{...policyBoundTrace,allocation_edge_id:'sha256:'+'f'.repeat(64)}}]}),error=>error.code==='WBS_AUTOREC_G11_SOURCE_TRACE_MISMATCH');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:policyBoundReview,postedJournals:[policyBoundPayable,{...policyBoundAutoc,source_trace:{...policyBoundTrace,review_plan_id:'sha256:'+'f'.repeat(64)}}]}),error=>error.code==='WBS_AUTOREC_G11_SOURCE_TRACE_MISMATCH');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:{...policyBoundReview,allocation_edge_id:'sha256:'+'f'.repeat(64)},postedJournals:[policyBoundPayable,policyBoundAutoc]}),error=>error.code==='WBS_AUTOREC_G11_POLICY_TRACE_REQUIRED');
  const draftPolicyTrace={...policyBoundTrace,matching_policy:{...policyBoundTrace.matching_policy,status:'DRAFT'}};
  const draftPolicyReview={...policyBoundReview,matching_policy:draftPolicyTrace.matching_policy,trace:draftPolicyTrace};
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:draftPolicyReview,postedJournals:[{...policyBoundPayable,source_trace:draftPolicyTrace},{...policyBoundAutoc,source_trace:draftPolicyTrace}]}),error=>error.code==='WBS_AUTOREC_G11_POLICY_TRACE_REQUIRED');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[payable,{...autoc,journal_entry_id:payable.journal_entry_id}]}),error=>error.code==='WBS_AUTOREC_G11_JOURNAL_DUPLICATE');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[payable,{...autoc,audit_event_id:payable.audit_event_id}]}),error=>error.code==='WBS_AUTOREC_G11_JOURNAL_DUPLICATE');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[payable,{...autoc,ledger_lines:[{...autoc.ledger_lines[0],ledger_line_id:payable.ledger_lines[0].ledger_line_id},autoc.ledger_lines[1]]}]}),error=>error.code==='WBS_AUTOREC_G11_LEDGER_DUPLICATE');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[{...payable,ledger_lines:[{...payable.ledger_lines[0],ledger_line_id:''},payable.ledger_lines[1]]},autoc]}),error=>error.code==='WBS_AUTOREC_G11_LEDGER_DUPLICATE');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[{...payable,ledger_lines:[{...payable.ledger_lines[0],debit_amount:100,credit_amount:100},payable.ledger_lines[1]]},autoc]}),error=>error.code==='WBS_AUTOREC_G11_LEDGER_INVALID');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[{...payable,ledger_lines:[payable.ledger_lines[0],{...payable.ledger_lines[1],debit_amount:99}]},autoc]}),error=>error.code==='WBS_AUTOREC_G11_JOURNAL_UNBALANCED');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[payable,{...autoc,status:'DRAFT'}]}),error=>error.code==='WBS_AUTOREC_G11_POSTED_EVIDENCE_REQUIRED');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[payable,{...autoc,source_trace:{...review.trace,business_source_version:'v2'}}]}),error=>error.code==='WBS_AUTOREC_G11_SOURCE_TRACE_MISMATCH');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[payable,{...autoc,currency:'CAD'}]}),error=>error.code==='WBS_AUTOREC_G11_POSTED_EVIDENCE_REQUIRED');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:{...review,trace:{...review.trace,bank_receipt_hash:''}},postedJournals:[payable,autoc]}),error=>error.code==='WBS_AUTOREC_G11_TRACE_REQUIRED');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:{...review,allocated_amount:'99.0000'},postedJournals:[payable,autoc]}),error=>error.code==='WBS_AUTOREC_G11_TRACE_REQUIRED');
  const underAllocatedPayable={...payable,ledger_lines:[{...payable.ledger_lines[0],credit_amount:99},{...payable.ledger_lines[1],debit_amount:99}]};
  const underAllocatedAutoc={...autoc,ledger_lines:[{...autoc.ledger_lines[0],debit_amount:99},{...autoc.ledger_lines[1],credit_amount:99}]};
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[underAllocatedPayable,underAllocatedAutoc]}),error=>error.code==='WBS_AUTOREC_G11_ALLOCATION_AMOUNT_MISMATCH');
  const selfClearedPayable={...payable,ledger_lines:[{...payable.ledger_lines[0]},{ledger_line_id:'pay-ap-self-clear',account_code:'291001',member_ref:'VENDOR-1',debit_amount:100,credit_amount:0}]};
  const selfClearedAutoc={...autoc,ledger_lines:[{...autoc.ledger_lines[0]},{ledger_line_id:'auto-ap-self-clear',account_code:'291001',member_ref:'VENDOR-1',debit_amount:0,credit_amount:100}]};
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[selfClearedPayable,selfClearedAutoc]}),error=>error.code==='WBS_AUTOREC_G11_291001_LEG_REQUIRED');
  assert.throws(()=>validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[{...payable,ledger_lines:[{...payable.ledger_lines[0],credit_amount:99},{...payable.ledger_lines[1],debit_amount:99}]},autoc]}),error=>error.code==='WBS_AUTOREC_G11_291001_UNCLEARED');
});

test('observed WBS source, Come From, detail, relation, audit and forbidden-operation contract is exact and read-only',()=>{
  assert(WBS_AUTOREC_OBSERVED_CONTRACT.company_account_sources.includes('Auto Bank Reimbursement'));assert(WBS_AUTOREC_OBSERVED_CONTRACT.company_account_sources.includes('ROE'));
  assert(WBS_AUTOREC_OBSERVED_CONTRACT.company_account_come_from.includes('FINREPAYMENT'));assert(WBS_AUTOREC_OBSERVED_CONTRACT.company_account_come_from.includes('Yardi S.L'));
  assert.deepEqual(WBS_AUTOREC_OBSERVED_CONTRACT.bankbook_come_from,['Not Match','Construction Loan','Financing','Reversal','YARDI','YARDISL','No Need To Match']);
  for(const field of ['bank_source_record_id','memo','project_department','invoice_receipt_evidence','comments_log'])assert(WBS_AUTOREC_OBSERVED_CONTRACT.bank_row_fields.includes(field));
  for(const field of ['business_source_version','bill_no','journal_no','account_before','account_after','review_event_id'])assert(WBS_AUTOREC_OBSERVED_CONTRACT.source_relation_fields.includes(field));
  for(const operation of ['Create','Copy','Delete','Release','Incur','Revocation','Post','Post All','Cancel Post','Upload','Refresh'])assert(WBS_AUTOREC_OBSERVED_CONTRACT.forbidden_wbs_operations.includes(operation));
});

test('AutoRec eligibility fails line-scoped with zero candidates for missing trace and pair mismatches',()=>{
  const trace={receipt_id:'receipt',receipt_ref:'object://wbs/receipt',receipt_hash:'sha256:'+'a'.repeat(64),raw_event_id:'raw',source_document_id:'doc',staging_item_id:'stg',source_record_id:'source',source_version:'v1',company_key:'COMPANY-A',currency:'USD',amount:100,business_date:'2026-08-01',accounting_date:'2026-08-02',bank_account_ref:'BANK-OP',stage:'STAGING_REVIEWED',account_before:'291000',account_after:'291001',review_event_id:'review'};
  const bank={...trace,source_type:'BANK_TRANSACTION',source_record_id:'bank',direction:'CREDIT',journal_no:'JE-1',payee_no:'PAYEE-1'};
  const business={...trace,source_type:'PAYABLE',source_record_id:'payable',direction:'DEBIT',bill_no:'BILL-1',project_ref:'PROJECT-1',project_code:'PJ-1'};
  const accepted=evaluateWbsAutoReconciliationEligibility({bankStaging:bank,businessStaging:business});assert.equal(accepted.candidates.length,1);assert.equal(accepted.candidates[0].can_dispatch,false);assert.equal(accepted.candidates[0].trace.business_source_version,'v1');
  const mcpPair=evaluateWbsAutoReconciliationEligibility({bankStaging:{...bank,upstream_mcp_tool:'list_bank_transactions',upstream_mcp_snapshot_token:'snapshot-1'},businessStaging:{...business,upstream_mcp_tool:'list_payables',upstream_mcp_snapshot_token:'snapshot-1'}});
  assert.equal(mcpPair.candidates[0].trace.bank_provider_snapshot_token,'snapshot-1');assert.equal(mcpPair.candidates[0].trace.business_provider_snapshot_token,'snapshot-1');
  const businessOnly=evaluateWbsAutoReconciliationEligibility({bankStaging:{...bank,accounting_date:'2026-07-01'},businessStaging:{...business,business_date:'2026-08-02',accounting_date:'2026-08-20'},dateMatchBasis:'BUSINESS_ONLY'});
  assert.equal(businessOnly.status,'REVIEW_REQUIRED');assert.equal(businessOnly.candidates[0].trace.date_match_basis,'BUSINESS_ONLY');
  const unknownDateBasis=evaluateWbsAutoReconciliationEligibility({bankStaging:bank,businessStaging:business,dateMatchBasis:'POSTING_DATE_ONLY'});
  assert.equal(unknownDateBasis.status,'BLOCKED');assert.equal(unknownDateBasis.exceptions[0].code,'WBS_AUTOREC_DATE_WINDOW_MISMATCH');
  const missingToken=evaluateWbsAutoReconciliationEligibility({bankStaging:{...bank,upstream_mcp_tool:'list_bank_transactions'},businessStaging:{...business,upstream_mcp_tool:'list_payables',upstream_mcp_snapshot_token:'snapshot-1'}});
  assert.equal(missingToken.status,'BLOCKED');assert(missingToken.exceptions.some(item=>item.missing.includes('upstream_mcp_snapshot_token')));
  const cases=[
    [{...bank,receipt_id:''},business,'WBS_AUTOREC_ELIGIBILITY_TRACE_REQUIRED'],
    [bank,{...business,direction:'CREDIT'},'WBS_AUTOREC_DIRECTION_MISMATCH'],
    [bank,{...business,bank_account_ref:'BANK-OTHER'},'WBS_AUTOREC_BANK_ACCOUNT_MISMATCH'],
    [bank,{...business,business_date:'2026-08-20'},'WBS_AUTOREC_DATE_WINDOW_MISMATCH'],
    [bank,{...business,amount:101},'WBS_AUTOREC_AMOUNT_MISMATCH'],
    [bank,{...business,company_key:'COMPANY-B'},'WBS_AUTOREC_SCOPE_MISMATCH'],
    [bank,{...business,review_event_id:''},'WBS_AUTOREC_ELIGIBILITY_TRACE_REQUIRED']
  ];
  for(const [bankRow,businessRow,code] of cases){const result=evaluateWbsAutoReconciliationEligibility({bankStaging:bankRow,businessStaging:businessRow});assert.equal(result.candidates.length,0);assert(result.exceptions.some(item=>item.code===code));assert(result.exceptions.every(item=>item.block_scope==='SOURCE'&&item.can_allocate===false&&item.can_dispatch===false&&item.can_create_draft===false&&item.can_post===false));}
});

test('persistence plan binds receipt/raw/normalized/staging trace and idempotency to the actual snapshot command seam',async()=>{
  const value=snapshot(),prepared=await createWbsInboundDataAdapter({snapshotReader:reader(value)}).pull();
  const plan=buildWbsInboundPersistencePlan({snapshot:value,prepared,tenantId:'55555555-5555-4555-8555-555555555555',entityId:'66666666-6666-4666-8666-666666666666',importBatchId:'77777777-7777-4777-8777-777777777777',idempotencyKey:'wbs-inbound-20260805-company-a-0001'});
  assert.equal(plan.receipt_persistence.kernel_method,'recordWbsSnapshot');assert.equal(plan.receipt_persistence.supported,true);assert.equal(plan.raw_normalized_staging_persistence.supported,false);assert.equal(plan.raw_normalized_staging_persistence.code,'WBS_RAW_NORMALIZED_STAGING_PERSISTENCE_UNAVAILABLE');assert.equal(plan.ingress.trace_rows.length,3);assert.equal(plan.can_dispatch,false);
  assert.throws(()=>buildWbsInboundPersistencePlan({snapshot:value,prepared,tenantId:'bad',entityId:'66666666-6666-4666-8666-666666666666',importBatchId:'77777777-7777-4777-8777-777777777777',idempotencyKey:'short'}),error=>error.code==='WBS_INBOUND_SCOPE_INVALID');
  assert.throws(()=>buildWbsInboundPersistencePlan({snapshot:value,prepared:{...prepared,package_hash:'sha256:forged'},tenantId:'55555555-5555-4555-8555-555555555555',entityId:'66666666-6666-4666-8666-666666666666',importBatchId:'77777777-7777-4777-8777-777777777777',idempotencyKey:'wbs-inbound-20260805-company-a-0001'}),error=>error.code==='WBS_INBOUND_PREPARED_TRACE_INVALID');
});

test('orchestrator persists receipt before typed rows, blocks Draft/AutoRec dispatch, and replays one stable result',async()=>{
  const value=snapshot(),adapter=createWbsInboundDataAdapter({snapshotReader:reader(value)}),calls=[];
  const kernel={recordWbsSnapshot:async request=>(calls.push(['receipt',request]),{ok:true,receipt_id:'receipt-1'}),persistWbsInboundRows:async request=>(calls.push(['rows',request]),{ok:true,raw_event_ids:['raw-1'],staging_item_ids:['stg-1']})};
  const service=createWbsInboundOrchestrator({adapter,kernel});
  const input={snapshot:value,tenantId:'55555555-5555-4555-8555-555555555555',entityId:'66666666-6666-4666-8666-666666666666',importBatchId:'77777777-7777-4777-8777-777777777777',idempotencyKey:'wbs-inbound-20260805-company-a-0001'};
  const first=await service.persist(input),replay=await service.persist(input);
  assert.strictEqual(first,replay);assert.deepEqual(calls.map(([kind])=>kind),['receipt','rows']);assert.equal(calls[1][1].receiptTrace.length,3);assert.deepEqual({draft:first.can_dispatch_draft,autorec:first.can_dispatch_autorec,post:first.can_post},{draft:false,autorec:false,post:false});
  await assert.rejects(()=>service.persist({...input,importBatchId:'88888888-8888-4888-8888-888888888888'}),error=>error.code==='WBS_INBOUND_IDEMPOTENCY_CONFLICT');assert.equal(calls.length,2);
  const untrusted=structuredClone(await adapter.pull()),untrustedService=createWbsInboundOrchestrator({adapter,kernel});untrusted.raw[0].row.amount='999.0000';
  await assert.rejects(()=>untrustedService.persist({...input,idempotencyKey:'wbs-inbound-20260805-company-a-0002',prepared:untrusted}),error=>error.code==='WBS_INBOUND_PREPARED_TRACE_INVALID');
});

test('orchestrator fails closed without capability, after receipt failure, and after row persistence failure',async()=>{
  const value=snapshot(),adapter=createWbsInboundDataAdapter({snapshotReader:reader(value)}),input={snapshot:value,tenantId:'55555555-5555-4555-8555-555555555555',entityId:'66666666-6666-4666-8666-666666666666',importBatchId:'77777777-7777-4777-8777-777777777777',idempotencyKey:'wbs-inbound-20260805-company-a-0001'};
  const noCapability=createWbsInboundOrchestrator({adapter,kernel:{recordWbsSnapshot:async()=>({ok:true})}});await assert.rejects(()=>noCapability.persist(input),error=>error.code==='WBS_INBOUND_KERNEL_PERSISTENCE_UNAVAILABLE');
  let rows=0;const receiptFailure=createWbsInboundOrchestrator({adapter,kernel:{recordWbsSnapshot:async()=>({ok:false}),persistWbsInboundRows:async()=>{rows++;return {ok:true};}}});await assert.rejects(()=>receiptFailure.persist(input),error=>error.code==='WBS_INBOUND_RECEIPT_PERSISTENCE_FAILED');assert.equal(rows,0);
  let receiptCalls=0,rowCalls=0;const rowFailure=createWbsInboundOrchestrator({adapter,kernel:{recordWbsSnapshot:async()=>{receiptCalls++;return {ok:true};},persistWbsInboundRows:async()=>{rowCalls++;throw new Error('masked');}}});await assert.rejects(()=>rowFailure.persist(input),error=>error.code==='WBS_INBOUND_ROW_PERSISTENCE_FAILED');await assert.rejects(()=>rowFailure.persist(input),error=>error.code==='WBS_INBOUND_ROW_PERSISTENCE_FAILED');assert.deepEqual({receiptCalls,rowCalls},{receiptCalls:1,rowCalls:1});
});

test('adapter rejects a mutable reader, cross-currency AutoRec pair, and unbalanced Draft request',async()=>{
  assert.throws(()=>createWbsInboundDataAdapter({snapshotReader:{readSnapshot:async()=>snapshot()}}),error=>error instanceof WbsInboundDataError&&error.code==='WBS_INBOUND_READER_INVALID');
  const staged={receipt_id:'receipt',receipt_ref:'object://wbs/receipt',receipt_hash:'sha256:'+'a'.repeat(64),stage:'STAGING_REVIEWED',source_record_id:'one',source_version:'v',currency:'USD',amount:100,company_key:'C',raw_event_id:'raw',source_document_id:'doc',staging_item_id:'stg',business_date:'2026-08-01',accounting_date:'2026-08-01',bank_account_ref:'BANK',account_before:'291000',account_after:'291001',review_event_id:'review'};
  assert.throws(()=>buildAutoReconciliationReviewRequest({bankStaging:{...staged,source_type:'BANK_TRANSACTION',direction:'CREDIT',journal_no:'JE',payee_no:'PAYEE'},businessStaging:{...staged,source_type:'PAYABLE',direction:'DEBIT',currency:'CAD',bill_no:'BILL',project_ref:'PROJECT',project_code:'PJ'}}),error=>error.code==='WBS_AUTOREC_SCOPE_MISMATCH');
  const scopedStaging={...staged,source_type:'PAYABLE'};
  const scopedMapping={mapping_id:'m',version:'1',status:'APPROVED',company_key:'C',currency:'USD'};
  const scopedJournal={period_id:'p',journal_number:'j',company_key:'C',currency:'USD',accounting_date:'2026-08-01',lines:[{debit_amount:100,credit_amount:0},{debit_amount:0,credit_amount:99}]};
  assert.throws(()=>buildStandardDraftRequest({stagingItem:scopedStaging,mapping:scopedMapping,journal:scopedJournal}),error=>error.code==='WBS_DRAFT_REQUEST_UNBALANCED');
  assert.throws(()=>buildStandardDraftRequest({stagingItem:scopedStaging,mapping:scopedMapping,journal:{...scopedJournal,currency:'CAD'}}),error=>error.code==='WBS_DRAFT_REQUEST_SCOPE_INVALID');
});
