import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildConstructionLoanDrawDraftRequest,createMockConstructionLoanDrawSourceAdapter,normalizeMockConstructionLoanDraw,validateConstructionLoanDrawPostedEvidence} from '../domain/wbs-finance-data-input-adapter.mjs';
import {WbsReadonlyIngestionService} from '../domain/wbs-readonly-ingestion.mjs';

const matrix=JSON.parse(await readFile(new URL('../../contracts/wbs-finance-data-input-coverage-v1.json',import.meta.url),'utf8'));
const source={company_code:'WBAI',bank_transaction_id:'BANK-LOAN-001',source_version:'loan-v1',business_date:'2026-08-01',transaction_date:'2026-08-01',accounting_date:'2026-08-01',currency:'USD',gross_amount:'125000.0000',amount:'125000.0000',ref_no:'LOAN-DRAW-001',bank_account_ref:'BANK-OPERATING-1',loan_id:'LOAN-42',description:'Construction draw'};
const staging={stage:'STAGING',raw_event_id:'raw-loan-1',source_document_id:'src-loan-1',source_document_line_id:'line-loan-1',staging_item_id:'stg-loan-1'};
const mapping={mapping_id:'map-loan-1',mapping_type:'WBS_CONSTRUCTION_LOAN_DRAW',status:'APPROVED',version:'7',debit_account_ref:'101100',credit_account_ref:'220500'};

test('data-input matrix reserves Property Tax scope and declares every source role',()=>{
  assert.equal(matrix.provider_status,'REAL_WBS_PROVIDER_DEFERRED');
  assert.equal(matrix.data_inputs.find(row=>row.input_name.includes('Construction Loan Draw')).selected,true);
  assert.match(matrix.policy,/does not reconstruct any WBS business module/);
  const property=matrix.data_inputs.find(row=>row.source_type==='PROPERTY_COMPARISON');
  assert.equal(property.status,'RESERVED_PROPERTY_TAX_OWNER');
  assert.deepEqual(property.forbidden,['source_document','allocation','Draft JE','Post']);
});

test('mock Construction Loan Draw follows the receipt-shaped Bank Journal admission into a Draft request, not a JE',()=>{
  const vertical=normalizeMockConstructionLoanDraw(source);
  assert.equal(vertical.normalized.source_type,'BANK_TRANSACTION_JE');
  assert.equal(vertical.normalized.line.direction,'INFLOW');
  const request=buildConstructionLoanDrawDraftRequest({vertical,stagingReceipt:staging,mapping});
  assert.deepEqual({status:request.request_status,draft:request.can_create_draft_request,je:request.can_create_journal_entry,post:request.can_post,template:request.journal_template},{status:'READY_FOR_STANDARD_DRAFT',draft:true,je:false,post:false,template:'DR_CASH_CR_CONSTRUCTION_LOAN_PAYABLE'});
  assert.deepEqual(request.lines.map(({side,account_ref,amount})=>({side,account_ref,amount})),[{side:'DEBIT',account_ref:'101100',amount:125000},{side:'CREDIT',account_ref:'220500',amount:125000}]);
});

test('mock adapter exercises the same read-only receipt hash and Staging seam as a future WBS/MCP adapter',async()=>{
  let persisted;
  const adapter=createMockConstructionLoanDrawSourceAdapter({records:[source]});
  const service=new WbsReadonlyIngestionService({
    repository:{persist:async value=>(persisted=value,{stage:'STAGING',raw_event_id:'raw-loan-1',source_document_id:'src-loan-1',source_document_line_id:'line-loan-1',staging_item_id:'stg-loan-1'})},
    receiptStore:{store:async({responseHash})=>({payloadRef:`evidence://mock/loan/${responseHash}`,responseHash,storageVersion:'mock-v1',retrievedAt:'2026-08-05T00:00:00.000Z'})}
  });
  const receipt=await service.pullBankJournalAndIngest({sourceAdapter:adapter,selection:{companyCode:'WBAI',currency:'USD',bankAccountRef:'BANK-OPERATING-1'},tenantId:'tenant-1',entityId:'entity-1',batchId:'loan-draw-001'});
  assert.deepEqual({accepted:receipt.accepted,role:receipt.admission.role,draft:receipt.admission.can_create_draft,post:receipt.admission.can_post},{accepted:1,role:'TRANSACTION_PRODUCER',draft:false,post:false});
  assert.equal(persisted.record.bank_transaction_id,'BANK-LOAN-001');
  assert.equal(persisted.record.source_business_type,'CONSTRUCTION_LOAN_DRAW');
  assert.equal(adapter.read_only,true);
});

test('Construction Loan Draw fails closed before Draft request on outflow, missing staging, or unapproved mapping',()=>{
  assert.throws(()=>normalizeMockConstructionLoanDraw({...source,gross_amount:'-1.0000'}),{code:'WBS_LOAN_DRAW_DIRECTION_INVALID'});
  const vertical=normalizeMockConstructionLoanDraw(source);
  assert.throws(()=>buildConstructionLoanDrawDraftRequest({vertical,stagingReceipt:{...staging,raw_event_id:''},mapping}),{code:'WBS_LOAN_DRAW_STAGING_REQUIRED'});
  assert.throws(()=>buildConstructionLoanDrawDraftRequest({vertical,stagingReceipt:staging,mapping:{...mapping,status:'DRAFT'}}),{code:'WBS_LOAN_DRAW_MAPPING_REQUIRED'});
});

test('only full standard JE Review/Approve/Post evidence closes the Loan Draw trace',()=>{
  const request=buildConstructionLoanDrawDraftRequest({vertical:normalizeMockConstructionLoanDraw(source),stagingReceipt:staging,mapping});
  const evidence={source_system:'REFS_STANDARD_JE',status:'POSTED',journal_entry_id:'je-loan-1',ledger_debit_line_id:'ledger-d-1',ledger_credit_line_id:'ledger-c-1',review_audit_id:'audit-review-1',approval_audit_id:'audit-approve-1',post_audit_id:'audit-post-1',currency:'USD',amount:'125000.0000',lines:[{side:'DEBIT',account_ref:'101100',amount:125000},{side:'CREDIT',account_ref:'220500',amount:125000}]};
  const closed=validateConstructionLoanDrawPostedEvidence({draftRequest:request,journalEvidence:evidence});
  assert.equal(closed.ok,true);assert.equal(closed.can_post,false);assert.equal(closed.trace.journal_entry_id,'je-loan-1');
  assert.throws(()=>validateConstructionLoanDrawPostedEvidence({draftRequest:request,journalEvidence:{...evidence,status:'APPROVED'}}),{code:'WBS_LOAN_DRAW_POSTED_EVIDENCE_REQUIRED'});
  assert.throws(()=>validateConstructionLoanDrawPostedEvidence({draftRequest:request,journalEvidence:{...evidence,lines:[evidence.lines[0]]}}),{code:'WBS_LOAN_DRAW_POSTED_EVIDENCE_MISMATCH'});
});
