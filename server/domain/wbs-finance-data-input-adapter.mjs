import {canonicalWbsHash,mapObservedWbsFields,normalizeWbsReadonlyRecord,withReadonlyReceiptVersion} from './wbs-readonly-ingestion.mjs';

// These are inbound data-input profiles, not reconstructed WBS modules. MOCK
// supplies the same receipt shape that a future read-only WBS/MCP adapter must
// supply; neither path has WBS UI, WBS operations, WBS write capability, or
// authority to create, approve, or post a journal entry directly.
export const WBS_FINANCE_DATA_INPUT_PROFILES=Object.freeze({
  CONSTRUCTION_LOAN_DRAW:Object.freeze({
    source_type:'BANK_TRANSACTION_JE',source_business_type:'CONSTRUCTION_LOAN_DRAW',
    direction:'INFLOW',journal_template:'DR_CASH_CR_CONSTRUCTION_LOAN_PAYABLE',
    draft_mapping_type:'WBS_CONSTRUCTION_LOAN_DRAW',status:'MOCK_VERTICAL_CONTRACT'
  })
});

const text=value=>value==null?'':String(value).trim();
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const required=(value,code,label)=>{const result=text(value);if(!result)fail(code,`${label} is required`);return result;};
const decimal=value=>Number.isFinite(Number(value))?Number(Number(value).toFixed(4)):null;

// Test/development-only replacement for the future WBS/MCP provider.  It
// returns exactly the typed Bank Journal pull envelope consumed by the
// read-only ingestion service; there is deliberately no mutation method.
export function createMockConstructionLoanDrawSourceAdapter({records,route='mock://wbs/bank-journal/construction-loan-draw'}={}){
  if(!Array.isArray(records)||records.length===0)fail('WBS_MOCK_LOAN_DRAW_RECORDS_REQUIRED','Mock Construction Loan Draw records are required');
  const frozenRecords=records.map(record=>Object.freeze({...record,source_type:'BANK_TRANSACTION_JE',source_business_type:'CONSTRUCTION_LOAN_DRAW'}));
  return Object.freeze({
    provider_mode:'MOCK',read_only:true,
    async fetchBankJournalSearch(selection={}){
      const companyCode=text(selection.companyCode).toUpperCase(),currency=text(selection.currency).toUpperCase(),bankAccountRef=text(selection.bankAccountRef);
      if(!companyCode||!currency||!bankAccountRef)fail('WBS_BANK_JOURNAL_SELECTION_REQUIRED','Mock adapter requires the standard Bank Journal selector');
      const payload={records:frozenRecords};
      return {payload,response_hash:canonicalWbsHash(payload),route,retrieved_at:'2026-08-05T00:00:00.000Z',selection:{source_context:{company_code:companyCode,currency,bank_account_ref:bankAccountRef}}};
    }
  });
}

export function normalizeMockConstructionLoanDraw(record={}){
  const canonical=withReadonlyReceiptVersion('BANK_TRANSACTION_JE',{
    ...record,source_type:'BANK_TRANSACTION_JE',source_business_type:'CONSTRUCTION_LOAN_DRAW'
  });
  const normalized=normalizeWbsReadonlyRecord(mapObservedWbsFields('BANK_TRANSACTION_JE',canonical));
  if(!normalized.ok)fail(normalized.exception_code,'Construction Loan Draw cannot pass WBS source admission');
  if(normalized.normalized.line.direction!=='INFLOW')fail('WBS_LOAN_DRAW_DIRECTION_INVALID','Construction Loan Draw requires a positive bank inflow');
  for(const [value,label] of [[canonical.loan_id,'loan_id'],[canonical.bank_account_ref,'bank_account_ref'],[canonical.company_code,'company_code']])required(value,'WBS_LOAN_DRAW_REQUIRED_FIELD_MISSING',label);
  return Object.freeze({source_type:'BANK_TRANSACTION_JE',vertical:'CONSTRUCTION_LOAN_DRAW',canonical,normalized:normalized.normalized});
}

export function buildConstructionLoanDrawDraftRequest({vertical,stagingReceipt,mapping}={}){
  if(!vertical||vertical.vertical!=='CONSTRUCTION_LOAN_DRAW')fail('WBS_LOAN_DRAW_INPUT_INVALID','Construction Loan Draw data-input evidence is required');
  const stage=required(stagingReceipt?.stage,'WBS_LOAN_DRAW_STAGING_REQUIRED','staging stage');
  if(stage!=='STAGING')fail('WBS_LOAN_DRAW_STAGING_REQUIRED','Construction Loan Draw must first enter REFS Staging');
  const rawEventId=required(stagingReceipt?.raw_event_id,'WBS_LOAN_DRAW_STAGING_REQUIRED','raw_event_id');
  const sourceDocumentId=required(stagingReceipt?.source_document_id,'WBS_LOAN_DRAW_STAGING_REQUIRED','source_document_id');
  const sourceLineId=required(stagingReceipt?.source_document_line_id,'WBS_LOAN_DRAW_STAGING_REQUIRED','source_document_line_id');
  const stagingItemId=required(stagingReceipt?.staging_item_id,'WBS_LOAN_DRAW_STAGING_REQUIRED','staging_item_id');
  if(text(mapping?.mapping_type)!=='WBS_CONSTRUCTION_LOAN_DRAW'||text(mapping?.status)!=='APPROVED')fail('WBS_LOAN_DRAW_MAPPING_REQUIRED','An approved Construction Loan Draw mapping is required');
  const debitAccount=required(mapping?.debit_account_ref,'WBS_LOAN_DRAW_MAPPING_REQUIRED','debit_account_ref');
  const creditAccount=required(mapping?.credit_account_ref,'WBS_LOAN_DRAW_MAPPING_REQUIRED','credit_account_ref');
  const amount=decimal(vertical.normalized.gross_amount);
  if(amount==null||amount<=0)fail('WBS_LOAN_DRAW_AMOUNT_INVALID','Construction Loan Draw amount must be a positive inflow');
  return Object.freeze({
    request_type:'STANDARD_DRAFT_JE_REQUEST',request_status:'READY_FOR_STANDARD_DRAFT',
    source_system:'WBS',source_type:'BANK_TRANSACTION_JE',source_business_type:'CONSTRUCTION_LOAN_DRAW',
    can_create_draft_request:true,can_create_journal_entry:false,can_post:false,
    currency:vertical.normalized.currency,amount,accounting_date:vertical.normalized.accounting_date,
    journal_template:'DR_CASH_CR_CONSTRUCTION_LOAN_PAYABLE',
    lines:[
      {side:'DEBIT',account_ref:debitAccount,amount,bank_account_ref:vertical.normalized.line.bank_account_ref},
      {side:'CREDIT',account_ref:creditAccount,amount,loan_id:vertical.canonical.loan_id}
    ],
    mapping:{mapping_id:required(mapping.mapping_id,'WBS_LOAN_DRAW_MAPPING_REQUIRED','mapping_id'),version:required(mapping.version,'WBS_LOAN_DRAW_MAPPING_REQUIRED','mapping version')},
    trace:{raw_event_id:rawEventId,source_document_id:sourceDocumentId,source_document_line_id:sourceLineId,staging_item_id:stagingItemId,receipt_source_record_id:vertical.normalized.source_record_id,receipt_source_version:vertical.normalized.source_version}
  });
}

// This only validates evidence returned by the standard REFS JE workflow. It
// cannot manufacture a posted entry, ledger line, review, approval or audit.
export function validateConstructionLoanDrawPostedEvidence({draftRequest,journalEvidence}={}){
  if(text(draftRequest?.request_status)!=='READY_FOR_STANDARD_DRAFT')fail('WBS_LOAN_DRAW_DRAFT_REQUEST_REQUIRED','A valid Draft request is required');
  if(text(journalEvidence?.source_system)!=='REFS_STANDARD_JE'||text(journalEvidence?.status)!=='POSTED')fail('WBS_LOAN_DRAW_POSTED_EVIDENCE_REQUIRED','A POSTED standard REFS journal is required');
  for(const key of ['journal_entry_id','ledger_debit_line_id','ledger_credit_line_id','review_audit_id','approval_audit_id','post_audit_id'])required(journalEvidence?.[key],'WBS_LOAN_DRAW_POSTED_EVIDENCE_REQUIRED',key);
  if(text(journalEvidence.currency).toUpperCase()!==text(draftRequest.currency).toUpperCase()||decimal(journalEvidence.amount)!==draftRequest.amount)fail('WBS_LOAN_DRAW_POSTED_EVIDENCE_MISMATCH','Posted journal amount or currency does not match the immutable source request');
  const lines=Array.isArray(journalEvidence.lines)?journalEvidence.lines:[];
  const expected=draftRequest.lines;
  if(lines.length!==2||!expected.every(line=>lines.some(candidate=>text(candidate.side)===line.side&&text(candidate.account_ref)===line.account_ref&&decimal(candidate.amount)===line.amount)))fail('WBS_LOAN_DRAW_POSTED_EVIDENCE_MISMATCH','Posted journal lines do not match the approved mapping');
  return Object.freeze({ok:true,vertical:'CONSTRUCTION_LOAN_DRAW',can_create_transaction:false,can_post:false,
    report_control:{accounting_date:draftRequest.accounting_date,currency:draftRequest.currency,draw_amount:draftRequest.amount},
    trace:{...draftRequest.trace,mapping_id:draftRequest.mapping.mapping_id,journal_entry_id:journalEvidence.journal_entry_id,ledger_line_ids:[journalEvidence.ledger_debit_line_id,journalEvidence.ledger_credit_line_id],audit_ids:[journalEvidence.review_audit_id,journalEvidence.approval_audit_id,journalEvidence.post_audit_id]}
  });
}
