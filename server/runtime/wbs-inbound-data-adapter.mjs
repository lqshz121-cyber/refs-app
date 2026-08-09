import {validateWbsSnapshotPackage,WbsSnapshotError} from './wbs-snapshot-package.mjs';
import {canonicalRequestHash} from './request-hash.mjs';
import {createWbsSnapshotSignatureVerifier} from './wbs-snapshot-signature.mjs';

// This adapter is the REFS-side seam for a future read-only WBS MCP provider.
// It neither exposes WBS business operations nor writes WBS. Persistence,
// review, Draft creation, approval and posting remain standard REFS commands.
const VIEW_TYPES=Object.freeze({
  'BGDATA.payable':'PAYABLE',
  'BGDATA.bank_transaction':'BANK_TRANSACTION',
  'BGDATA.autoc_detail':'AUTOREC_PAYMENT_DETAIL',
  'BGDATA.autoc_bank':'AUTOREC_CASE_CONTROL',
  'accounting.accounting_info':'LEDGER_EVIDENCE',
  'accounting.balance_cell':'CONTROL_EVIDENCE',
  'accounting.income_cell':'CONTROL_EVIDENCE'
});
const TRANSACTION_TYPES=new Set(['PAYABLE','BANK_TRANSACTION','AUTOREC_PAYMENT_DETAIL']);
export const WBS_AUTOREC_OBSERVED_CONTRACT=Object.freeze({
  company_account_sources:Object.freeze(['Auto Bank Reimbursement','Auto Payment','Auto Reimbursement','Contract Invoice','Reimbursement Invoice','Manually Importing','FAST','FASTER','GC','Internal Transfer','Income','Individual','Internal','Monthly','Payable','Reversal','ROE']),
  company_account_come_from:Object.freeze(['FAST','Work Order','FASTER','Contract Invoice','Reimbursement Invoice','Manually Importing','Internal Transfer','Sales Income','Sales2','Sales3','Dividend','Const Loan','FINDRAW','FINREPAYMENT','FINPAYINT','FINFEE','Auto Payment','Auto Reimbursement','Auto Bank Reimbursement','Multiplier','Collection funds','Internal payment process','Paid expenses','HOA','Yardi','Yardi S.L','CONSOLIDATE']),
  bankbook_come_from:Object.freeze(['Not Match','Construction Loan','Financing','Reversal','YARDI','YARDISL','No Need To Match']),
  bank_row_fields:Object.freeze(['bank_source_record_id','bank_source_version','transaction_date','posting_date','bank_account_ref','account_code','vendor','payee','memo','ref_no','deposit','payment','project_department','cost_code','brief_description','invoice_receipt_evidence','user_ref','reviewer','comments_log']),
  released_row_fields:Object.freeze(['released_date','incur_status']),
  incurred_row_fields:Object.freeze(['incurred_date','match_status']),
  source_relation_fields:Object.freeze(['bank_source_record_id','bank_source_version','business_source_record_id','business_source_version','bill_no','journal_no','direction','bank_account_ref','payee_no','project_ref','project_code','account_before','account_after','review_event_id','relation_type','relation_content_hash']),
  audit_log_fields:Object.freeze(['company_code','relation_content','content_field_changes','bill_no','relation_type','create_user','create_time']),
  forbidden_wbs_operations:Object.freeze(['Create','Copy','Delete','Release','Incur','Revocation','Post','Post All','Cancel Post','Upload','Refresh'])
});
const text=value=>value==null?'':String(value).trim();
// Monetary evidence must be canonical decimal data. Number('') and
// Number('0x64') are both valid JavaScript conversions, but neither is a
// trustworthy accounting amount from an external read receipt.
const amount=value=>{
  const candidate=typeof value==='number'?(Number.isFinite(value)?String(value):''):typeof value==='string'?value.trim():'';
  if(!/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(candidate))return null;
  const parsed=Number(candidate),scaled=parsed*10000;
  return Number.isFinite(parsed)&&Number.isSafeInteger(Math.round(scaled))?Number(parsed.toFixed(4)):null;
};
// A formatting-only check would admit impossible posting dates such as
// 2026-02-30 into staging. WBS dates are evidence, so an invalid calendar day
// must become an Exception before any review or accounting request.
const date=value=>{
  const candidate=text(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(candidate))return null;
  const parsed=new Date(`${candidate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===candidate?candidate:null;
};
const error=(code,message)=>Object.freeze({code,message});
const freeze=value=>Object.freeze(value);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class WbsInboundDataError extends Error {
  constructor(code,message){super(message);this.name='WbsInboundDataError';this.code=code;}
}

function fail(code,message){throw new WbsInboundDataError(code,message);}
function receiptFor(validated,view,row){
  return validated.receipts.find(receipt=>receipt.source_module===view.name&&receipt.source_record_id===String(row[view.name==='BGDATA.payable'?'apGuId':view.name==='BGDATA.bank_transaction'?'cashOrBankBookId':view.name==='BGDATA.autoc_detail'?'pdGuId':view.name==='BGDATA.autoc_bank'?'pbGuId':view.name==='accounting.accounting_info'?'accountingInfoId':'controlCellId']));
}
function requiredFields(type,row){
  const base=['currency','amount'];
  if(type==='PAYABLE')return [...base,'invoice_date','posting_date'];
  if(type==='BANK_TRANSACTION')return [...base,'transaction_date','posting_date','bank_account_ref'];
  return [...base,'payment_date','posting_date','pbGuId','vendor_ref','project_ref','cost_code_ref','description'];
}
function normalize(type,companyKey,row,receipt){
  const businessDate=date(row.invoice_date??row.transaction_date??row.payment_date??row.business_date);
  // A source transaction date is not accounting-date evidence. Keeping the
  // absent value null makes the existing staging gate emit an Exception
  // rather than silently deriving a posting date from the business date.
  const accountingDate=date(row.posting_date??row.accounting_date);
  const normalized={
    source_system:'WBS',source_type:type,company_key:companyKey,
    source_record_id:receipt.source_record_id,source_version:receipt.source_version,
    receipt_ref:receipt.payload_ref,receipt_hash:receipt.payload_hash,
    currency:text(row.currency).toUpperCase(),amount:amount(row.amount),
    business_date:businessDate,accounting_date:accountingDate,posting_date:accountingDate,
    direction:text(row.direction).toUpperCase()||null,source_label:text(row.source??row.source_name)||null,come_from:text(row.come_from??row.comeFrom)||null,
    bank_account_ref:text(row.bank_account_ref)||null,
    vendor_ref:text(row.vendor_ref)||null,project_ref:text(row.project_ref)||null,cost_code_ref:text(row.cost_code_ref)||null,
    description:text(row.description)||null,pb_guid:text(row.pbGuId)||null,
    external_trace:row.external_trace&&typeof row.external_trace==='object'?Object.freeze(structuredClone(row.external_trace)):null,
    can_use_trace_as_key:false,can_use_trace_as_state_authority:false,can_use_trace_as_posting_authority:false,
    upstream_mcp_tool:text(row.mcp_tool)||null,upstream_mcp_content_hash:text(row.mcp_content_sha256)||null,upstream_mcp_row_hash:text(row.mcp_row_hash)||null,upstream_mcp_captured_at:text(row.mcp_captured_at)||null,upstream_mcp_snapshot_token:text(row.mcp_snapshot_token)||null
  };
  return Object.freeze(normalized);
}
function stageFor(normalized,row){
  const missing=requiredFields(normalized.source_type,row).filter(field=>{
    const value=field==='amount'?normalized.amount:field==='currency'?normalized.currency:field==='invoice_date'||field==='transaction_date'||field==='payment_date'?normalized.business_date:field==='posting_date'?normalized.accounting_date:field==='pbGuId'?normalized.pb_guid:normalized[field];
    return value===null||value===undefined||text(value)==='';
  });
  if(normalized.amount===0)missing.push('nonzero_amount');
  if(!/^[A-Z]{3}$/.test(normalized.currency))missing.push('currency');
  if(!normalized.business_date||!normalized.accounting_date)missing.push('business_or_accounting_date');
  if(missing.length)return Object.freeze({stage:'EXCEPTION',exception:error('WBS_RECEIPT_FIELD_MISSING',`WBS ${normalized.source_type} receipt is missing ${[...new Set(missing)].join(', ')}`),raw_trace:normalized});
  return Object.freeze({stage:'STAGING_REVIEW_REQUIRED',can_allocate:false,can_create_draft:false,can_post:false,raw_trace:normalized});
}

export function createWbsInboundDataAdapter({snapshotReader,validateSnapshot=validateWbsSnapshotPackage,verifyProductionSnapshot=null}={}){
  if(!snapshotReader||snapshotReader.readOnly!==true||typeof snapshotReader.readSnapshot!=='function')throw new WbsInboundDataError('WBS_INBOUND_READER_INVALID','A read-only WBS snapshot reader is required');
  const prepareUnchecked=snapshot=>{
    let validated;try{validated=validateSnapshot(snapshot);}catch(cause){if(cause instanceof WbsSnapshotError)throw new WbsInboundDataError(cause.code,cause.message);throw cause;}
    const raw=[],normalized=[],staging=[],exceptions=[],controls=[];
    for(const view of snapshot.views){
      const sourceType=VIEW_TYPES[view.name];
      for(const row of view.rows){
        const receipt=receiptFor(validated,view,row);if(!receipt)fail('WBS_RECEIPT_MISSING','Validated snapshot row has no immutable receipt plan');
        const rawRecord=Object.freeze({receipt,row:structuredClone(row),source_type:sourceType});raw.push(rawRecord);
        if(!TRANSACTION_TYPES.has(sourceType)){controls.push(Object.freeze({source_type:sourceType,receipt,can_create_transaction:false,can_allocate:false,can_create_draft:false,can_post:false}));continue;}
        const canonical=normalize(sourceType,validated.company_key,row,receipt);normalized.push(canonical);
        const candidate=stageFor(canonical,row);if(candidate.stage==='EXCEPTION')exceptions.push(candidate);else staging.push(candidate);
      }
    }
    return Object.freeze({
      snapshot_id:validated.snapshot_id,company_key:validated.company_key,package_hash:validated.package_hash,
      mode:'WBS_READONLY_INBOUND_ADAPTER_V1',read_only:true,raw:Object.freeze(raw),normalized:Object.freeze(normalized),
      staging:Object.freeze(staging),exceptions:Object.freeze(exceptions),controls:Object.freeze(controls),
      admission:Object.freeze({can_write_wbs:false,can_allocate:false,can_create_draft:false,can_post:false,required_next_controls:['verify detached signature','persist_raw_normalized_staging','approved_mapping','staging_review','standard_refs_je_workflow']})
    });
  };
  const prepare=snapshot=>{
    if(text(snapshot?.environment)==='PRODUCTION')fail('WBS_SNAPSHOT_VERIFIED_PREPARATION_REQUIRED','Production WBS snapshots may be prepared only through the verified asynchronous preparation path.');
    return prepareUnchecked(snapshot);
  };
  const prepareVerified=async snapshot=>{
    if(text(snapshot?.environment)==='PRODUCTION'){
      if(typeof verifyProductionSnapshot!=='function')fail('WBS_SNAPSHOT_SIGNATURE_VERIFIER_REQUIRED','Production WBS snapshots require a configured pinned-key signature verifier before Raw, Normalized, or Staging preparation.');
      let verified=false;try{verified=await verifyProductionSnapshot(snapshot);}catch{verified=false;}
      if(verified!==true)fail('WBS_SNAPSHOT_SIGNATURE_INVALID','Production WBS snapshot detached-signature verification failed before any REFS inbound rows were prepared.');
    }
    return prepareUnchecked(snapshot);
  };
  return Object.freeze({
    mode:'WBS_READONLY_INBOUND_ADAPTER_V1',read_only:true,
    async pull({selection}={}){return prepareVerified(await snapshotReader.readSnapshot(selection));},
    prepare,
    prepareVerified
  });
}

// Production composition receives only a pinned WBS keyring, never a caller-
// selected verifier. Sandbox fixtures remain usable through the base adapter.
export function createWbsInboundDataAdapterWithKeyring({snapshotReader,wbsPublicKeys,validateSnapshot=validateWbsSnapshotPackage}={}){
  return createWbsInboundDataAdapter({snapshotReader,validateSnapshot,verifyProductionSnapshot:createWbsSnapshotSignatureVerifier({publicKeys:wbsPublicKeys})});
}

export function buildStandardDraftRequest({stagingItem,mapping,journal}={}){
  if(text(stagingItem?.stage)!=='STAGING_REVIEWED')fail('WBS_STAGING_REVIEW_REQUIRED','A reviewed persistent REFS staging item is required');
  for(const field of ['staging_item_id','source_document_id','raw_event_id','source_record_id','source_version','company_key','currency','accounting_date','source_type'])if(!text(stagingItem[field]))fail('WBS_STAGING_TRACE_REQUIRED',`Staging trace ${field} is required`);
  if(!/^[A-Z]{3}$/.test(text(stagingItem.currency))||!validIsoDate(stagingItem.accounting_date))fail('WBS_STAGING_TRACE_REQUIRED','Staging currency and accounting date must be canonical before a Draft request');
  if(text(mapping?.status)!=='APPROVED'||!text(mapping?.mapping_id)||!text(mapping?.version)||text(mapping?.company_key)!==text(stagingItem.company_key)||text(mapping?.currency)!==text(stagingItem.currency))fail('WBS_MAPPING_APPROVED_REQUIRED','An approved mapping with the exact source company and currency scope is required');
  if(!journal||!Array.isArray(journal.lines)||journal.lines.length<2||!text(journal.period_id)||!text(journal.journal_number)||text(journal.company_key)!==text(stagingItem.company_key)||text(journal.currency)!==text(stagingItem.currency)||text(journal.accounting_date)!==text(stagingItem.accounting_date))fail('WBS_DRAFT_REQUEST_SCOPE_INVALID','A standard Draft journal request must retain the exact source company, currency, and accounting date');
  const journalAmounts=journal.lines.map(line=>({debit:amount(line?.debit_amount),credit:amount(line?.credit_amount)}));
  if(journalAmounts.some(line=>line.debit===null||line.credit===null||line.debit<0||line.credit<0))fail('WBS_DRAFT_REQUEST_UNBALANCED','Draft request journal line amounts must be canonical nonnegative decimals');
  const debit=journalAmounts.reduce((sum,line)=>sum+line.debit,0),credit=journalAmounts.reduce((sum,line)=>sum+line.credit,0);
  if(Math.abs(debit-credit)>0.0001||debit<=0)fail('WBS_DRAFT_REQUEST_UNBALANCED','Draft request journal lines must be positive and balanced');
  return Object.freeze({
    request_type:'STANDARD_AUTO_JOURNAL_REQUEST',status:'READY_FOR_STANDARD_JE_COMMAND',
    can_dispatch:false,can_post:false,kernel_method:'createAutoJournal',
    staging_item_id:stagingItem.staging_item_id,company_key:stagingItem.company_key,currency:stagingItem.currency,accounting_date:stagingItem.accounting_date,period_id:journal.period_id,journal_number:journal.journal_number,description:journal.description??null,lines:structuredClone(journal.lines),
    mapping:{mapping_id:mapping.mapping_id,version:mapping.version,company_key:mapping.company_key,currency:mapping.currency},
    trace:{raw_event_id:stagingItem.raw_event_id,source_document_id:stagingItem.source_document_id,source_record_id:stagingItem.source_record_id,source_version:stagingItem.source_version,source_type:stagingItem.source_type,company_key:stagingItem.company_key,currency:stagingItem.currency,accounting_date:stagingItem.accounting_date}
  });
}

const validIsoDate=value=>{const candidate=date(value);if(!candidate)return false;return new Date(`${candidate}T00:00:00.000Z`).toISOString().slice(0,10)===candidate;};
const dayDistance=(left,right)=>Math.abs((new Date(`${left}T00:00:00.000Z`)-new Date(`${right}T00:00:00.000Z`))/86400000);
const eligibilityException=(side,row,code,message,missing=[])=>Object.freeze({stage:'EXCEPTION',block_scope:'SOURCE',side,source_record_id:text(row?.source_record_id)||null,code,message,missing:Object.freeze(missing),can_allocate:false,can_dispatch:false,can_create_draft:false,can_post:false});

export function evaluateWbsAutoReconciliationEligibility({bankStaging,businessStaging,tolerance=0,dateWindowDays=3,dateMatchBasis='BUSINESS_AND_ACCOUNTING',matchingPolicy}={}){
  const exceptions=[];
  const dateBasis=text(dateMatchBasis).toUpperCase();
  const commonRequired=['receipt_id','receipt_ref','receipt_hash','raw_event_id','source_document_id','staging_item_id','source_record_id','source_version','company_key','currency','amount','business_date','accounting_date','bank_account_ref','direction','account_before','account_after','review_event_id'];
  for(const [side,row] of [['BANK_SIDE',bankStaging],['BUSINESS_SIDE',businessStaging]]){
    const required=side==='BANK_SIDE'?[...commonRequired,'journal_no','payee_no']:[...commonRequired,'bill_no','project_ref','project_code'];
    const missing=required.filter(field=>field==='amount'?amount(row?.amount)===null||amount(row?.amount)===0:text(row?.[field])==='');
    if(text(row?.stage)!=='STAGING_REVIEWED')missing.push('STAGING_REVIEWED');
    if(!/^sha256:[0-9a-f]{64}$/.test(text(row?.receipt_hash)))missing.push('receipt_hash');
    if(!/^[A-Z]{3}$/.test(text(row?.currency)))missing.push('currency');
    if(!['DEBIT','CREDIT'].includes(text(row?.direction).toUpperCase()))missing.push('direction');
    if(!validIsoDate(row?.business_date)||!validIsoDate(row?.accounting_date))missing.push('business_or_accounting_date');
    if(text(row?.upstream_mcp_tool)&&!text(row?.upstream_mcp_snapshot_token))missing.push('upstream_mcp_snapshot_token');
    if(missing.length)exceptions.push(eligibilityException(side,row,'WBS_AUTOREC_ELIGIBILITY_TRACE_REQUIRED','Auto Reconciliation eligibility requires immutable receipt, source, staging, direction, account, amount, and date trace',[...new Set(missing)]));
  }
  if(exceptions.length)return Object.freeze({status:'BLOCKED',candidates:Object.freeze([]),exceptions:Object.freeze(exceptions),can_allocate:false,can_dispatch:false,can_create_draft:false,can_post:false});
  if(bankStaging.source_type!=='BANK_TRANSACTION'||!['PAYABLE','AUTOREC_PAYMENT_DETAIL'].includes(businessStaging.source_type))exceptions.push(eligibilityException('PAIR',businessStaging,'WBS_AUTOREC_SOURCE_TYPE_INVALID','Auto Reconciliation requires one Bank Transaction and one business-side source'));
  if(text(bankStaging.company_key)!==text(businessStaging.company_key)||text(bankStaging.currency)!==text(businessStaging.currency))exceptions.push(eligibilityException('PAIR',businessStaging,'WBS_AUTOREC_SCOPE_MISMATCH','Auto Reconciliation sources must share exact company and currency'));
  if(text(bankStaging.direction).toUpperCase()===text(businessStaging.direction).toUpperCase())exceptions.push(eligibilityException('PAIR',businessStaging,'WBS_AUTOREC_DIRECTION_MISMATCH','Bank and business evidence must have opposite directions'));
  if(text(bankStaging.bank_account_ref)!==text(businessStaging.bank_account_ref))exceptions.push(eligibilityException('PAIR',businessStaging,'WBS_AUTOREC_BANK_ACCOUNT_MISMATCH','Bank and business evidence must reference the exact same bank account'));
  const difference=Math.abs(Math.abs(amount(bankStaging.amount))-Math.abs(amount(businessStaging.amount)));
  // An approved provider policy owns the matching windows and tolerances. Do
  // not pre-filter with UI/caller values: that could block a valid policy
  // match or make its audit record disagree with the presented candidate.
  if(matchingPolicy===undefined){
    const businessDateMatches=validIsoDate(bankStaging?.business_date)&&validIsoDate(businessStaging?.business_date)&&dayDistance(bankStaging.business_date,businessStaging.business_date)<=Number(dateWindowDays);
    const accountingDateMatches=validIsoDate(bankStaging?.accounting_date)&&validIsoDate(businessStaging?.accounting_date)&&dayDistance(bankStaging.accounting_date,businessStaging.accounting_date)<=Number(dateWindowDays);
    const datesMatch=dateBasis==='BUSINESS_ONLY'?businessDateMatches:dateBasis==='ACCOUNTING_ONLY'?accountingDateMatches:dateBasis==='BUSINESS_AND_ACCOUNTING'&&businessDateMatches&&accountingDateMatches;
    if(!Number.isSafeInteger(Number(dateWindowDays))||Number(dateWindowDays)<0||!datesMatch)exceptions.push(eligibilityException('PAIR',businessStaging,'WBS_AUTOREC_DATE_WINDOW_MISMATCH','Bank and business dates exceed the approved review window for the selected date-match basis'));
    if(!Number.isFinite(Number(tolerance))||Number(tolerance)<0||difference>Number(tolerance))exceptions.push(eligibilityException('PAIR',businessStaging,'WBS_AUTOREC_AMOUNT_MISMATCH','Auto Reconciliation source amounts exceed the approved capacity'));
  }
  if(exceptions.length)return Object.freeze({status:'BLOCKED',candidates:Object.freeze([]),exceptions:Object.freeze(exceptions),can_allocate:false,can_dispatch:false,can_create_draft:false,can_post:false});
  // A caller may choose a generic local-fixture proposal, but any supplied
  // provider matching policy is mandatory evidence and must bind the exact
  // pair before it can reach the review/G11 trace.
  const policyPlan=matchingPolicy===undefined?null:buildReceiptBoundWbsAutoReconciliationReviewPlan({bankRows:[bankStaging],businessRows:[businessStaging],matchingPolicy});
  if(policyPlan&&policyPlan.status==='BLOCKED')return Object.freeze({status:'BLOCKED',candidates:Object.freeze([]),exceptions:policyPlan.exceptions,can_allocate:false,can_dispatch:false,can_create_draft:false,can_post:false});
  const policyEdge=policyPlan?.allocation_plan[0]??null;
  if(policyPlan&&!policyEdge)return Object.freeze({status:'BLOCKED',candidates:Object.freeze([]),exceptions:freeze([eligibilityException('PAIR',businessStaging,'WBS_AUTOREC_POLICY_EDGE_REQUIRED','The approved matching policy did not yield one immutable review edge.')]),can_allocate:false,can_dispatch:false,can_create_draft:false,can_post:false});
  const effectiveDateBasis=policyPlan?.control_totals.date_match_basis??dateBasis,effectiveDateWindow=policyPlan?.control_totals.date_window_days??Number(dateWindowDays),effectiveDifference=policyPlan?.control_totals.difference??difference;
  const allocatedAmount=policyEdge?.amount??Number(Math.min(Math.abs(amount(bankStaging.amount)),Math.abs(amount(businessStaging.amount))).toFixed(4));
  const candidate=Object.freeze({request_type:'AUTOREC_REVIEW_REQUEST',status:'REVIEW_REQUIRED',can_allocate:false,can_release:false,can_dispatch:false,can_create_draft:false,can_post:false,bank_source_record_id:bankStaging.source_record_id,business_source_record_id:businessStaging.source_record_id,company_key:bankStaging.company_key,bank_account_ref:bankStaging.bank_account_ref,currency:bankStaging.currency,allocated_amount:allocatedAmount,amount_difference:effectiveDifference,date_window_days:effectiveDateWindow,date_match_basis:effectiveDateBasis,review_plan_id:policyPlan?.review_plan_id??null,allocation_edge_id:policyEdge?.allocation_edge_id??null,proposal_allocation_edge_id:policyEdge?.proposal_allocation_edge_id??null,matching_policy:policyPlan?.matching_policy??null,trace:Object.freeze({company_key:bankStaging.company_key,currency:bankStaging.currency,bank_account_ref:bankStaging.bank_account_ref,allocated_amount:allocatedAmount,date_match_basis:effectiveDateBasis,review_plan_id:policyPlan?.review_plan_id??null,bank_business_date:bankStaging.business_date,bank_accounting_date:bankStaging.accounting_date,business_business_date:businessStaging.business_date,business_accounting_date:businessStaging.accounting_date,bank_receipt_id:bankStaging.receipt_id,bank_receipt_ref:bankStaging.receipt_ref,bank_receipt_hash:bankStaging.receipt_hash,business_receipt_id:businessStaging.receipt_id,business_receipt_ref:businessStaging.receipt_ref,business_receipt_hash:businessStaging.receipt_hash,bank_provider_snapshot_token:text(bankStaging.upstream_mcp_snapshot_token)||null,business_provider_snapshot_token:text(businessStaging.upstream_mcp_snapshot_token)||null,bank_raw_event_id:bankStaging.raw_event_id,business_raw_event_id:businessStaging.raw_event_id,bank_source_document_id:bankStaging.source_document_id,business_source_document_id:businessStaging.source_document_id,bank_source_record_id:bankStaging.source_record_id,bank_source_version:bankStaging.source_version,business_source_record_id:businessStaging.source_record_id,business_source_version:businessStaging.source_version,bank_staging_item_id:bankStaging.staging_item_id,business_staging_item_id:businessStaging.staging_item_id,bill_no:businessStaging.bill_no,journal_no:bankStaging.journal_no,payee_no:bankStaging.payee_no,project_ref:businessStaging.project_ref,project_code:businessStaging.project_code,bank_account_before:bankStaging.account_before,bank_account_after:bankStaging.account_after,business_account_before:businessStaging.account_before,business_account_after:businessStaging.account_after,bank_review_event_id:bankStaging.review_event_id,business_review_event_id:businessStaging.review_event_id,allocation_edge_id:policyEdge?.allocation_edge_id??null,proposal_allocation_edge_id:policyEdge?.proposal_allocation_edge_id??null,matching_policy:policyPlan?.matching_policy??null})});
  return Object.freeze({status:'REVIEW_REQUIRED',candidates:Object.freeze([candidate]),exceptions:Object.freeze([]),can_allocate:false,can_dispatch:false,can_create_draft:false,can_post:false});
}

export function buildAutoReconciliationReviewRequest(args={}){
  const evaluated=evaluateWbsAutoReconciliationEligibility(args);
  if(!evaluated.candidates.length){const first=evaluated.exceptions[0];fail(first?.code||'WBS_AUTOREC_ELIGIBILITY_BLOCKED',first?.message||'Auto Reconciliation eligibility is blocked');}
  return evaluated.candidates[0];
}

// A deterministic, read-only proposal for a reviewer. It is intentionally not
// an allocation command: the authoritative kernel must still enforce source
// reservations, versioning, SoD, release, and posting. Keeping proposal and
// command separate prevents a UI or import job from silently consuming value.
export function buildWbsAutoReconciliationReviewPlan({bankRows,businessRows,tolerance=0,dateWindowDays=3,dateMatchBasis='BUSINESS_AND_ACCOUNTING'}={}){
  if(!Array.isArray(bankRows)||!Array.isArray(businessRows)||bankRows.length===0||businessRows.length===0)fail('WBS_AUTOREC_PLAN_ROWS_REQUIRED','At least one bank row and one business row are required.');
  const toleranceValue=amount(tolerance),dateWindow=Number(dateWindowDays);
  const dateBasis=text(dateMatchBasis).toUpperCase();
  if(toleranceValue===null||toleranceValue<0||!Number.isSafeInteger(dateWindow)||dateWindow<0||!['BUSINESS_ONLY','ACCOUNTING_ONLY','BUSINESS_AND_ACCOUNTING'].includes(dateBasis))fail('WBS_AUTOREC_PLAN_OPTIONS_INVALID','Auto Reconciliation tolerance, date window, or date-match basis is invalid.');
  const exceptions=[],required=['receipt_id','receipt_ref','receipt_hash','raw_event_id','source_document_id','staging_item_id','source_record_id','source_version','company_key','currency','amount','business_date','accounting_date','bank_account_ref','direction','review_event_id'];
  const inspect=(side,row,allowed)=>{
    const missing=required.filter(field=>field==='amount'?amount(row?.amount)===null||amount(row?.amount)===0:text(row?.[field])==='');
    if(text(row?.stage)!=='STAGING_REVIEWED')missing.push('STAGING_REVIEWED');
    if(!/^sha256:[0-9a-f]{64}$/.test(text(row?.receipt_hash)))missing.push('receipt_hash');
    if(!/^[A-Z]{3}$/.test(text(row?.currency)))missing.push('currency');
    if(!validIsoDate(row?.business_date)||!validIsoDate(row?.accounting_date))missing.push('business_or_accounting_date');
    if(!allowed.includes(text(row?.source_type)))missing.push('source_type');
    if(!['DEBIT','CREDIT'].includes(text(row?.direction).toUpperCase()))missing.push('direction');
    if(missing.length)exceptions.push(eligibilityException(side,row,'WBS_AUTOREC_PLAN_TRACE_REQUIRED','Every proposed match requires reviewed, immutable and fully scoped REFS staging evidence.',[...new Set(missing)]));
  };
  bankRows.forEach(row=>inspect('BANK_SIDE',row,['BANK_TRANSACTION']));
  businessRows.forEach(row=>inspect('BUSINESS_SIDE',row,['PAYABLE','AUTOREC_PAYMENT_DETAIL']));
  if(exceptions.length)return freeze({status:'BLOCKED',allocation_plan:freeze([]),exceptions:freeze(exceptions),controls:freeze({can_allocate:false,can_release:false,can_post:false})});
  // A review proposal must never inflate a source capacity by receiving the
  // same current source twice, nor pick two versions of one source. The
  // authoritative reservation command repeats this check under locks; doing
  // it here keeps an import/UI projection from presenting a misleading plan.
  for(const [side,rows] of [['BANK_SIDE',bankRows],['BUSINESS_SIDE',businessRows]]){
    const versionsBySource=new Map();
    for(const row of rows){
      const source=`${text(row.source_type)}:${text(row.source_record_id)}`;
      const version=text(row.source_version);
      const versions=versionsBySource.get(source)??new Set();
      versions.add(version);versionsBySource.set(source,versions);
    }
    for(const [source,versions] of versionsBySource){
      const occurrences=rows.filter(row=>`${text(row.source_type)}:${text(row.source_record_id)}`===source);
      if(occurrences.length>1)exceptions.push(eligibilityException(side,occurrences[0],'WBS_AUTOREC_PLAN_SOURCE_DUPLICATE','A source record may appear only once in a review plan.',[source]));
      if(versions.size>1)exceptions.push(eligibilityException(side,occurrences[0],'WBS_AUTOREC_PLAN_SOURCE_VERSION_AMBIGUOUS','A review plan may not combine multiple versions of one source record.',[source]));
    }
  }
  if(exceptions.length)return freeze({status:'BLOCKED',allocation_plan:freeze([]),exceptions:freeze(exceptions),controls:freeze({can_allocate:false,can_release:false,can_post:false})});
  const all=[...bankRows,...businessRows],anchor=bankRows[0],bankDirection=text(anchor.direction).toUpperCase();
  for(const row of all){
    if(text(row.company_key)!==text(anchor.company_key)||text(row.currency)!==text(anchor.currency)||text(row.bank_account_ref)!==text(anchor.bank_account_ref))exceptions.push(eligibilityException('PAIR',row,'WBS_AUTOREC_PLAN_SCOPE_MISMATCH','All proposed rows require one exact company, currency, and bank account.'));
  }
  if(bankRows.some(row=>text(row.direction).toUpperCase()!==bankDirection)||businessRows.some(row=>text(row.direction).toUpperCase()===bankDirection))exceptions.push(eligibilityException('PAIR',null,'WBS_AUTOREC_PLAN_DIRECTION_MISMATCH','Bank rows must have one direction and business rows must have the opposite direction.'));
  const dateMatches=(bank,business)=>{
    const businessMatches=dayDistance(bank.business_date,business.business_date)<=dateWindow;
    const accountingMatches=dayDistance(bank.accounting_date,business.accounting_date)<=dateWindow;
    return dateBasis==='BUSINESS_ONLY'?businessMatches:dateBasis==='ACCOUNTING_ONLY'?accountingMatches:businessMatches&&accountingMatches;
  };
  for(const bank of bankRows)for(const business of businessRows)if(!dateMatches(bank,business))exceptions.push(eligibilityException('PAIR',business,'WBS_AUTOREC_PLAN_DATE_WINDOW_MISMATCH','Proposed bank and business rows exceed the approved date window for the selected date-match basis.'));
  if(exceptions.length)return freeze({status:'BLOCKED',allocation_plan:freeze([]),exceptions:freeze(exceptions),controls:freeze({can_allocate:false,can_release:false,can_post:false})});
  // Source record IDs are provider-scoped rather than globally unique.  In
  // particular, a PAYABLE and an AUTOREC_PAYMENT_DETAIL may legitimately use
  // the same display-shaped ID.  Sorting by the complete immutable source
  // identity makes a review proposal stable across page and replay ordering.
  const compareSourceIdentity=(left,right)=>{
    const leftKey=[text(left.row.source_type),text(left.row.source_record_id),text(left.row.source_version)].join('\u0000');
    const rightKey=[text(right.row.source_type),text(right.row.source_record_id),text(right.row.source_version)].join('\u0000');
    return leftKey.localeCompare(rightKey);
  };
  const remaining=rows=>rows.map(row=>({row,remaining:Math.abs(amount(row.amount))})).sort(compareSourceIdentity);
  const banks=remaining(bankRows),businesses=remaining(businessRows),allocation=[];
  for(const bank of banks)for(const business of businesses){
    if(bank.remaining<=toleranceValue||business.remaining<=toleranceValue)continue;
    const allocated=Number(Math.min(bank.remaining,business.remaining).toFixed(4));
    bank.remaining=Number((bank.remaining-allocated).toFixed(4));business.remaining=Number((business.remaining-allocated).toFixed(4));
    // This is a proposal identity, never an allocation command identity.  It
    // lets a later reservation service prove precisely which immutable source
    // versions, receipts, amount and matching basis a reviewer inspected.
    const edgeTrace={
      algorithm:'WBS_AUTOREC_READONLY_PROPOSAL_V1',date_match_basis:dateBasis,
      bank_source_type:text(bank.row.source_type),bank_source_record_id:text(bank.row.source_record_id),bank_source_version:text(bank.row.source_version),bank_receipt_hash:text(bank.row.receipt_hash),
      business_source_type:text(business.row.source_type),business_source_record_id:text(business.row.source_record_id),business_source_version:text(business.row.source_version),business_receipt_hash:text(business.row.receipt_hash),
      amount:allocated,currency:text(anchor.currency)
    };
    allocation.push(freeze({allocation_edge_id:canonicalRequestHash(edgeTrace),bank_source_type:edgeTrace.bank_source_type,bank_source_record_id:bank.row.source_record_id,bank_source_version:bank.row.source_version,business_source_type:edgeTrace.business_source_type,business_source_record_id:business.row.source_record_id,business_source_version:business.row.source_version,amount:allocated,currency:anchor.currency,date_match_basis:dateBasis,bank_receipt_hash:bank.row.receipt_hash,business_receipt_hash:business.row.receipt_hash,can_allocate:false,can_release:false,can_post:false}));
  }
  const bankTotal=Number(banks.reduce((sum,item)=>sum+Math.abs(amount(item.row.amount)),0).toFixed(4));
  const businessTotal=Number(businesses.reduce((sum,item)=>sum+Math.abs(amount(item.row.amount)),0).toFixed(4));
  const allocatedTotal=Number(allocation.reduce((sum,item)=>sum+item.amount,0).toFixed(4));
  const bankRemaining=Number(banks.reduce((sum,item)=>sum+item.remaining,0).toFixed(4)),businessRemaining=Number(businesses.reduce((sum,item)=>sum+item.remaining,0).toFixed(4));
  const difference=Number(Math.abs(bankTotal-businessTotal).toFixed(4)),balanced=difference<=toleranceValue;
  const trace=allocation.map(item=>({allocation_edge_id:item.allocation_edge_id,date_match_basis:item.date_match_basis,bank_source_type:item.bank_source_type,bank_source_record_id:item.bank_source_record_id,bank_source_version:item.bank_source_version,business_source_type:item.business_source_type,business_source_record_id:item.business_source_record_id,business_source_version:item.business_source_version,bank_receipt_hash:item.bank_receipt_hash,business_receipt_hash:item.business_receipt_hash}));
  return freeze({review_plan_id:canonicalRequestHash({company_key:anchor.company_key,currency:anchor.currency,bank_account_ref:anchor.bank_account_ref,tolerance:toleranceValue,date_window_days:dateWindow,date_match_basis:dateBasis,trace}),status:balanced?'REVIEW_REQUIRED':'PARTIAL_REVIEW_REQUIRED',allocation_plan:freeze(allocation),exceptions:freeze([]),control_totals:freeze({company_key:anchor.company_key,currency:anchor.currency,bank_account_ref:anchor.bank_account_ref,bank_total:bankTotal,business_total:businessTotal,allocated_total:allocatedTotal,bank_unallocated:bankRemaining,business_unallocated:businessRemaining,difference,tolerance:toleranceValue,date_window_days:dateWindow,date_match_basis:dateBasis,balanced}),trace:freeze(trace),controls:freeze({can_allocate:false,can_release:false,can_post:false,required_next_controls:freeze(['authoritative source reservation','human Auto Reconciliation review','standard REFS release/incur workflow'])})});
}

// The generic builder above is intentionally useful for local golden fixtures.
// A provider-backed plan must instead get tolerance and date window from one
// approved, receipt-bound REFS matching rule; callers cannot widen a rule by
// passing UI parameters.
export function buildReceiptBoundWbsAutoReconciliationReviewPlan({bankRows,businessRows,matchingPolicy}={}){
  const anchor=Array.isArray(bankRows)&&bankRows.length?bankRows[0]:null;
  const invalid=()=>freeze({status:'BLOCKED',allocation_plan:freeze([]),exceptions:freeze([eligibilityException('PAIR',anchor,'WBS_AUTOREC_MATCHING_POLICY_REQUIRED','A single approved, receipt-bound matching policy is required before a provider-backed Auto Reconciliation review plan.')]),controls:freeze({can_allocate:false,can_release:false,can_post:false})});
  if(!anchor||!Array.isArray(businessRows)||!businessRows.length||!matchingPolicy||typeof matchingPolicy!=='object')return invalid();
  const tolerance=amount(matchingPolicy.amount_tolerance);
  const window=Number(matchingPolicy.date_window_days);
  const receiptHash=text(matchingPolicy.receipt_hash);
  const dateMatchBasis=text(matchingPolicy.date_match_basis).toUpperCase();
  const required=['policy_id','version','mapping_id','mapping_version','rule_id','rule_version','bank_mapping_id','bank_mapping_version','business_mapping_id','business_mapping_version','company_key','currency','bank_account_ref','receipt_id','receipt_ref','receipt_hash','date_match_basis'];
  const missing=required.filter(field=>text(matchingPolicy[field])==='');
  const mismatched=text(matchingPolicy.status)!=='APPROVED'||text(matchingPolicy.company_key)!==text(anchor.company_key)||text(matchingPolicy.currency)!==text(anchor.currency)||text(matchingPolicy.bank_account_ref)!==text(anchor.bank_account_ref)||!/^sha256:[0-9a-f]{64}$/.test(receiptHash)||tolerance===null||tolerance<0||!Number.isSafeInteger(window)||window<0||!['BUSINESS_ONLY','ACCOUNTING_ONLY','BUSINESS_AND_ACCOUNTING'].includes(dateMatchBasis);
  if(missing.length||mismatched)return invalid();
  const mappingFor=row=>row?.mapping&&typeof row.mapping==='object'?row.mapping:row;
  const mappingMismatch=[...bankRows].some(row=>text(mappingFor(row).mapping_id)!==text(matchingPolicy.bank_mapping_id)||text(mappingFor(row).mapping_version)!==text(matchingPolicy.bank_mapping_version))||[...businessRows].some(row=>text(mappingFor(row).mapping_id)!==text(matchingPolicy.business_mapping_id)||text(mappingFor(row).mapping_version)!==text(matchingPolicy.business_mapping_version));
  if(mappingMismatch)return freeze({status:'BLOCKED',allocation_plan:freeze([]),exceptions:freeze([eligibilityException('PAIR',anchor,'WBS_AUTOREC_MATCHING_POLICY_MAPPING_MISMATCH','Each provider-backed Auto Reconciliation source must carry the exact approved mapping version named by the matching policy.')]),controls:freeze({can_allocate:false,can_release:false,can_post:false})});
  const plan=buildWbsAutoReconciliationReviewPlan({bankRows,businessRows,tolerance,dateWindowDays:window,dateMatchBasis});
  if(plan.status==='BLOCKED')return plan;
  const policyTrace=freeze({policy_id:text(matchingPolicy.policy_id),version:text(matchingPolicy.version),status:'APPROVED',mapping_id:text(matchingPolicy.mapping_id),mapping_version:text(matchingPolicy.mapping_version),rule_id:text(matchingPolicy.rule_id),rule_version:text(matchingPolicy.rule_version),bank_mapping_id:text(matchingPolicy.bank_mapping_id),bank_mapping_version:text(matchingPolicy.bank_mapping_version),business_mapping_id:text(matchingPolicy.business_mapping_id),business_mapping_version:text(matchingPolicy.business_mapping_version),date_match_basis:dateMatchBasis,receipt_id:text(matchingPolicy.receipt_id),receipt_ref:text(matchingPolicy.receipt_ref),receipt_hash:receiptHash});
  // A generic proposal edge is deliberately policy-agnostic for local
  // fixtures.  Once provider-backed, the edge itself must bind the approved
  // rule/mapping receipt: a later policy revision cannot silently reuse a
  // reviewer-visible edge as though it had been assessed under the new rule.
  const allocationPlan=freeze(plan.allocation_plan.map(edge=>freeze({...edge,proposal_allocation_edge_id:edge.allocation_edge_id,allocation_edge_id:canonicalRequestHash({proposal_allocation_edge_id:edge.allocation_edge_id,matching_policy:policyTrace}),matching_policy:policyTrace})));
  const trace=freeze(plan.trace.map((item,index)=>freeze({...item,proposal_allocation_edge_id:item.allocation_edge_id,allocation_edge_id:allocationPlan[index].allocation_edge_id,matching_policy:policyTrace})));
  return freeze({...plan,review_plan_id:canonicalRequestHash({review_plan_id:plan.review_plan_id,matching_policy:policyTrace}),allocation_plan:allocationPlan,trace,matching_policy:policyTrace,control_totals:freeze({...plan.control_totals,tolerance}),controls:freeze({...plan.controls,matching_policy_required:true})});
}

// The integrated kernel currently persists immutable snapshot receipts through
// recordWbsSnapshot, but has no Raw→Normalized→Staging writer. Build both
// sides explicitly: the supported receipt command and the intentionally
// non-dispatchable ingestion request that a future kernel command must accept.
export function buildWbsInboundPersistencePlan({snapshot,prepared,tenantId,entityId,idempotencyKey,importBatchId}={}){
  let validated;try{validated=validateWbsSnapshotPackage(snapshot);}catch(cause){if(cause instanceof WbsSnapshotError)fail(cause.code,cause.message);throw cause;}
  if(!UUID.test(text(tenantId))||!UUID.test(text(entityId))||!UUID.test(text(importBatchId)))fail('WBS_INBOUND_SCOPE_INVALID','Tenant, entity and import batch identifiers must be UUIDs');
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,255}$/.test(text(idempotencyKey)))fail('WBS_INBOUND_IDEMPOTENCY_REQUIRED','A stable WBS inbound idempotency key is required');
  if(!prepared||prepared.snapshot_id!==validated.snapshot_id||prepared.package_hash!==validated.package_hash||!Array.isArray(prepared.raw)||!Array.isArray(prepared.normalized)||!Array.isArray(prepared.staging)||!Array.isArray(prepared.exceptions))fail('WBS_INBOUND_PREPARED_TRACE_INVALID','Prepared WBS adapter output does not bind the supplied immutable snapshot');
  const traceRows=[...prepared.staging,...prepared.exceptions].map(row=>row.raw_trace).filter(Boolean);
  if(traceRows.length!==prepared.normalized.length||traceRows.some(row=>!text(row.receipt_ref)||!text(row.receipt_hash)||!text(row.source_record_id)||!text(row.source_version)))fail('WBS_INBOUND_TRACE_REQUIRED','Every normalized WBS row requires immutable receipt and source-version trace');
  const ingress=Object.freeze({
    tenant_id:tenantId,entity_id:entityId,import_batch_id:importBatchId,snapshot_id:validated.snapshot_id,package_hash:validated.package_hash,
    receipt_count:validated.receipt_count,raw_count:prepared.raw.length,normalized_count:prepared.normalized.length,staging_count:prepared.staging.length,exception_count:prepared.exceptions.length,
    trace_rows:Object.freeze(traceRows.map(row=>Object.freeze({source_type:row.source_type,source_record_id:row.source_record_id,source_version:row.source_version,receipt_ref:row.receipt_ref,receipt_hash:row.receipt_hash})))
  });
  const planFingerprint=canonicalRequestHash({ingress,idempotency_key:idempotencyKey});
  return Object.freeze({
    request_type:'WBS_INBOUND_PERSISTENCE_PLAN_V1',status:'BLOCKED_ON_RAW_NORMALIZED_STAGING_COMMAND',can_dispatch:false,can_create_draft:false,can_post:false,
    idempotency_key:idempotencyKey,plan_fingerprint:planFingerprint,ingress,
    receipt_persistence:Object.freeze({kernel_method:'recordWbsSnapshot',supported:true,request:{tenantId,entityId,snapshot,idempotencyKey}}),
    raw_normalized_staging_persistence:Object.freeze({supported:false,code:'WBS_RAW_NORMALIZED_STAGING_PERSISTENCE_UNAVAILABLE',required_command:'persistWbsInboundRows',required_fields:['tenant_id','entity_id','import_batch_id','receipt_ref','receipt_hash','source_record_id','source_version','raw','normalized','staging_or_exception','idempotency_key']}),
    required_next_controls:Object.freeze(['persist receipt with recordWbsSnapshot','implement and authorize atomic raw/normalized/staging persistence','staging review','approved mapping','standard JE command'])
  });
}

const succeeded=value=>value!==null&&value!==undefined&&value.ok!==false&&value.status!=='FAILED';

// The kernel implementation is injected so this adapter never owns SQL or a
// posting command.  It can move to persistent staging only after the exact
// immutable snapshot receipt command succeeds.  Results are memoized by the
// caller's stable idempotency key and the server-independent plan fingerprint.
export function createWbsInboundOrchestrator({adapter,kernel}={}){
  if(!adapter||typeof adapter.prepareVerified!=='function')throw new WbsInboundDataError('WBS_INBOUND_ADAPTER_INVALID','A WBS inbound adapter with verified preparation is required');
  const replay=new Map();
  return Object.freeze({
    mode:'WBS_INBOUND_ORCHESTRATOR_V1',read_only:true,
    async persist({snapshot,prepared=null,tenantId,entityId,importBatchId,idempotencyKey}={}){
      if(!kernel||typeof kernel.recordWbsSnapshot!=='function'||typeof kernel.persistWbsInboundRows!=='function')fail('WBS_INBOUND_KERNEL_PERSISTENCE_UNAVAILABLE','Kernel must provide recordWbsSnapshot and persistWbsInboundRows before WBS inbound persistence can start');
      const verifiedPrepared=await adapter.prepareVerified(snapshot);
      if(prepared&&canonicalRequestHash(prepared)!==canonicalRequestHash(verifiedPrepared))fail('WBS_INBOUND_PREPARED_TRACE_INVALID','Caller-provided WBS preparation differs from the receipt/signature-verified preparation.');
      const canonicalPrepared=verifiedPrepared;
      const plan=buildWbsInboundPersistencePlan({snapshot,prepared:canonicalPrepared,tenantId,entityId,importBatchId,idempotencyKey});
      const existing=replay.get(idempotencyKey);
      if(existing){
        if(existing.plan_fingerprint!==plan.plan_fingerprint)fail('WBS_INBOUND_IDEMPOTENCY_CONFLICT','Idempotency key was already used for a different immutable WBS inbound plan');
        return existing.promise;
      }
      const promise=(async()=>{
        let receiptResult;
        try{receiptResult=await kernel.recordWbsSnapshot(plan.receipt_persistence.request);}catch{fail('WBS_INBOUND_RECEIPT_PERSISTENCE_FAILED','Immutable WBS receipt persistence failed');}
        if(!succeeded(receiptResult))fail('WBS_INBOUND_RECEIPT_PERSISTENCE_FAILED','Immutable WBS receipt persistence did not succeed');
        const rowRequest=Object.freeze({tenantId,entityId,importBatchId,idempotencyKey,planFingerprint:plan.plan_fingerprint,receiptTrace:plan.ingress.trace_rows,raw:canonicalPrepared.raw,normalized:canonicalPrepared.normalized,staging:canonicalPrepared.staging,exceptions:canonicalPrepared.exceptions});
        let rowResult;
        try{rowResult=await kernel.persistWbsInboundRows(rowRequest);}catch{fail('WBS_INBOUND_ROW_PERSISTENCE_FAILED','WBS Raw, Normalized and Staging persistence failed');}
        if(!succeeded(rowResult))fail('WBS_INBOUND_ROW_PERSISTENCE_FAILED','WBS Raw, Normalized and Staging persistence did not succeed');
        return Object.freeze({status:'PERSISTED_STAGING_REVIEW_REQUIRED',can_dispatch_draft:false,can_dispatch_autorec:false,can_post:false,plan_fingerprint:plan.plan_fingerprint,receipt_persistence:receiptResult,row_persistence:rowResult,trace:plan.ingress});
      })();
      replay.set(idempotencyKey,Object.freeze({plan_fingerprint:plan.plan_fingerprint,promise}));
      return promise;
    }
  });
}

export function validatePostedJournalTrace({draftRequest,postedEvidence}={}){
  if(text(draftRequest?.status)!=='READY_FOR_STANDARD_JE_COMMAND')fail('WBS_DRAFT_REQUEST_REQUIRED','A standard Draft request is required');
  if(text(postedEvidence?.source_system)!=='REFS_STANDARD_JE'||text(postedEvidence?.status)!=='POSTED')fail('WBS_POSTED_EVIDENCE_REQUIRED','A POSTED standard REFS journal receipt is required');
  for(const field of ['journal_entry_id','review_audit_id','approval_audit_id','post_audit_id'])if(!text(postedEvidence?.[field]))fail('WBS_POSTED_EVIDENCE_REQUIRED',`Posted evidence ${field} is required`);
  if(!Array.isArray(postedEvidence.ledger_line_ids)||postedEvidence.ledger_line_ids.length<2)fail('WBS_POSTED_EVIDENCE_REQUIRED','Posted evidence ledger_line_ids are required');
  const traceFields=['raw_event_id','source_document_id','source_record_id','source_version','source_type','company_key','currency','accounting_date'];
  if(!postedEvidence.source_trace||traceFields.some(field=>text(postedEvidence.source_trace[field])!==text(draftRequest.trace?.[field])))fail('WBS_POSTED_SOURCE_TRACE_MISMATCH','Posted journal evidence must retain the exact reviewed WBS Draft source trace.');
  return Object.freeze({ok:true,can_post:false,trace:{...draftRequest.trace,journal_entry_id:postedEvidence.journal_entry_id,ledger_line_ids:[...postedEvidence.ledger_line_ids],audit_ids:[postedEvidence.review_audit_id,postedEvidence.approval_audit_id,postedEvidence.post_audit_id]}});
}

// This is an evidence verifier, not an AutoRec transition. A WBS observed
// match cannot make a REFS case INCURRED: the authoritative kernel must first
// post both standard JE legs and supply their immutable ledger/audit trace.
export function validateWbsAutoRecG11PostedTrace({reviewRequest,postedJournals}={}){
  if(text(reviewRequest?.request_type)!=='AUTOREC_REVIEW_REQUEST'||text(reviewRequest?.status)!=='REVIEW_REQUIRED')fail('WBS_AUTOREC_G11_REVIEW_REQUIRED','A read-only reviewed AutoRec request is required.');
  const expected=reviewRequest.trace;
  const traceFields=['company_key','currency','bank_account_ref','bank_business_date','bank_accounting_date','business_business_date','business_accounting_date','bank_receipt_id','bank_receipt_ref','bank_receipt_hash','business_receipt_id','business_receipt_ref','business_receipt_hash','bank_raw_event_id','business_raw_event_id','bank_source_document_id','business_source_document_id','bank_source_record_id','bank_source_version','business_source_record_id','business_source_version','bank_staging_item_id','business_staging_item_id'];
  const allocatedAmount=amount(expected?.allocated_amount);
  if(!expected||traceFields.some(field=>!text(expected[field]))||allocatedAmount===null||allocatedAmount<=0||amount(reviewRequest.allocated_amount)!==allocatedAmount||text(reviewRequest.company_key)!==text(expected.company_key)||text(reviewRequest.currency)!==text(expected.currency)||text(reviewRequest.bank_account_ref)!==text(expected.bank_account_ref)||!/^sha256:[0-9a-f]{64}$/.test(text(expected.bank_receipt_hash))||!/^sha256:[0-9a-f]{64}$/.test(text(expected.business_receipt_hash))||!validIsoDate(expected.bank_business_date)||!validIsoDate(expected.bank_accounting_date)||!validIsoDate(expected.business_business_date)||!validIsoDate(expected.business_accounting_date))fail('WBS_AUTOREC_G11_TRACE_REQUIRED','AutoRec review trace is incomplete or outside its exact company, currency, bank, allocation amount, and accounting-date scope.');
  const policyBound=expected.matching_policy!==null&&expected.matching_policy!==undefined||text(expected.allocation_edge_id)!==''||text(expected.proposal_allocation_edge_id)!=='';
  if(policyBound){
    const policy=expected.matching_policy,policyFields=['policy_id','version','status','mapping_id','mapping_version','rule_id','rule_version','bank_mapping_id','bank_mapping_version','business_mapping_id','business_mapping_version','date_match_basis','receipt_id','receipt_ref','receipt_hash'];
    const requestPolicyMismatch=text(reviewRequest.review_plan_id)!==text(expected.review_plan_id)||text(reviewRequest.allocation_edge_id)!==text(expected.allocation_edge_id)||text(reviewRequest.proposal_allocation_edge_id)!==text(expected.proposal_allocation_edge_id)||canonicalRequestHash(reviewRequest.matching_policy??{})!==canonicalRequestHash(policy);
    if(!policy||typeof policy!=='object'||text(policy.status)!=='APPROVED'||policyFields.some(field=>!text(policy[field]))||!/^sha256:[0-9a-f]{64}$/.test(text(expected.review_plan_id))||!/^sha256:[0-9a-f]{64}$/.test(text(expected.allocation_edge_id))||!/^sha256:[0-9a-f]{64}$/.test(text(expected.proposal_allocation_edge_id))||requestPolicyMismatch)fail('WBS_AUTOREC_G11_POLICY_TRACE_REQUIRED','A policy-bound AutoRec review must carry one complete approved matching-policy receipt and immutable review-plan and edge identities.');
  }
  const snapshotTokensPresent=text(expected.bank_provider_snapshot_token)||text(expected.business_provider_snapshot_token);
  if(snapshotTokensPresent&&(!text(expected.bank_provider_snapshot_token)||!text(expected.business_provider_snapshot_token)||text(expected.bank_provider_snapshot_token)!==text(expected.business_provider_snapshot_token)))fail('WBS_AUTOREC_G11_SNAPSHOT_TOKEN_MISMATCH','WBS MCP-backed AutoRec evidence requires one exact provider snapshot token for both source legs.');
  if(!Array.isArray(postedJournals)||postedJournals.length!==2)fail('WBS_AUTOREC_G11_JOURNAL_COUNT_INVALID','Exactly one PAYABLE_INCUR and one AUTOC posted journal are required.');
  const types=new Set(['PAYABLE_INCUR','AUTOC']),byType=new Map(),journalIds=new Set(),auditIds=new Set(),ledgerLineIds=new Set();
  for(const journal of postedJournals){
    const type=text(journal?.accounting_type);
    if(!types.has(type)||byType.has(type))fail('WBS_AUTOREC_G11_JOURNAL_TYPE_INVALID','Posted journals must contain one PAYABLE_INCUR and one AUTOC leg.');
    if(text(journal?.source_system)!=='REFS_STANDARD_JE'||text(journal?.status)!=='POSTED'||!text(journal?.journal_entry_id)||!text(journal?.audit_event_id)||text(journal?.audit_event_type)!=='AUTO_JOURNAL_CREATED'||!Array.isArray(journal?.ledger_lines)||journal.ledger_lines.length<2||text(journal?.company_key)!==text(expected.company_key)||text(journal?.currency)!==text(expected.currency)||text(journal?.bank_account_ref)!==text(expected.bank_account_ref))fail('WBS_AUTOREC_G11_POSTED_EVIDENCE_REQUIRED','Each AutoRec journal leg requires posted REFS, audit, ledger, company, currency, and bank-scope evidence.');
    if(journalIds.has(text(journal.journal_entry_id))||auditIds.has(text(journal.audit_event_id)))fail('WBS_AUTOREC_G11_JOURNAL_DUPLICATE','PAYABLE_INCUR and AUTOC require distinct posted journals and distinct audit evidence.');
    const lineIds=journal.ledger_lines.map(line=>text(line?.ledger_line_id));
    if(lineIds.some(id=>!id)||new Set(lineIds).size!==lineIds.length||lineIds.some(id=>ledgerLineIds.has(id)))fail('WBS_AUTOREC_G11_LEDGER_DUPLICATE','Posted AutoRec journal legs require distinct immutable ledger line evidence.');
    let totalDebit=0,totalCredit=0;
    for(const line of journal.ledger_lines){
      const debit=amount(line?.debit_amount),credit=amount(line?.credit_amount);
      if(!text(line?.account_code)||debit===null||credit===null||debit<0||credit<0||(debit===0&&credit===0)||(debit!==0&&credit!==0))fail('WBS_AUTOREC_G11_LEDGER_INVALID','Each posted ledger line needs an account and one-sided nonzero debit or credit amount.');
      totalDebit+=debit;totalCredit+=credit;
    }
    if(Math.abs(totalDebit-totalCredit)>0.0001)fail('WBS_AUTOREC_G11_JOURNAL_UNBALANCED','Each posted AutoRec journal leg must balance before it can satisfy G11 trace evidence.');
    const policyTraceMismatch=policyBound&&(
      text(journal.source_trace?.review_plan_id)!==text(expected.review_plan_id)||
      text(journal.source_trace?.allocation_edge_id)!==text(expected.allocation_edge_id)||
      text(journal.source_trace?.proposal_allocation_edge_id)!==text(expected.proposal_allocation_edge_id)||
      canonicalRequestHash(journal.source_trace?.matching_policy??{})!==canonicalRequestHash(expected.matching_policy)
    );
    if(!journal.source_trace||traceFields.some(field=>text(journal.source_trace[field])!==text(expected[field]))||policyTraceMismatch||(snapshotTokensPresent&&(text(journal.source_trace.bank_provider_snapshot_token)!==text(expected.bank_provider_snapshot_token)||text(journal.source_trace.business_provider_snapshot_token)!==text(expected.business_provider_snapshot_token))))fail('WBS_AUTOREC_G11_SOURCE_TRACE_MISMATCH','Posted journal source trace must exactly match the reviewed AutoRec pair.');
    journalIds.add(text(journal.journal_entry_id));auditIds.add(text(journal.audit_event_id));lineIds.forEach(id=>ledgerLineIds.add(id));byType.set(type,journal);
  }
  const apByMember=new Map(),apByJournal=new Map([...byType.keys()].map(type=>[type,new Map()]));
  for(const [accountingType,journal] of byType.entries())for(const line of journal.ledger_lines){
    if(text(line?.account_code)!=='291001')continue;
    const member=text(line?.member_ref),debit=amount(line?.debit_amount),credit=amount(line?.credit_amount);
    if(!member||debit===null||credit===null||debit<0||credit<0||(debit!==0&&credit!==0))fail('WBS_AUTOREC_G11_291001_INVALID','291001 ledger evidence requires one-sided nonnegative amounts and a member.');
    const leg=apByJournal.get(accountingType);
    leg.set(member,Number(((leg.get(member)??0)+debit-credit).toFixed(4)));
    apByMember.set(member,Number(((apByMember.get(member)??0)+debit-credit).toFixed(4)));
  }
  const payableAp=apByJournal.get('PAYABLE_INCUR'),autocAp=apByJournal.get('AUTOC');
  if(payableAp.size===0||autocAp.size===0||[...payableAp.entries()].some(([member,net])=>Math.abs(net)<=0.0001||!autocAp.has(member)||Math.abs((autocAp.get(member)??0))<=0.0001)||[...autocAp.keys()].some(member=>!payableAp.has(member)))fail('WBS_AUTOREC_G11_291001_LEG_REQUIRED','PAYABLE_INCUR and AUTOC must each carry matching nonzero 291001 member clearing evidence.');
  if(apByMember.size===0||[...apByMember.values()].some(net=>Math.abs(net)>0.0001))fail('WBS_AUTOREC_G11_291001_UNCLEARED','Every 291001 member must net to zero across PAYABLE_INCUR and AUTOC.');
  const payableClearing=[...payableAp.values()].reduce((sum,net)=>sum+Math.abs(net),0),autocClearing=[...autocAp.values()].reduce((sum,net)=>sum+Math.abs(net),0);
  if(Math.abs(payableClearing-allocatedAmount)>0.0001||Math.abs(autocClearing-allocatedAmount)>0.0001)fail('WBS_AUTOREC_G11_ALLOCATION_AMOUNT_MISMATCH','Each posted 291001 clearing leg must total the immutable reviewed allocation amount.');
  return Object.freeze({ok:true,status:'POSTED_TRACE_VERIFIED',journals:Object.freeze([...byType.entries()].sort(([left],[right])=>left.localeCompare(right)).map(([accounting_type,journal])=>Object.freeze({accounting_type,journal_entry_id:text(journal.journal_entry_id),audit_event_id:text(journal.audit_event_id),ledger_line_ids:Object.freeze(journal.ledger_lines.map(line=>text(line.ledger_line_id)).filter(Boolean))}))),control_totals:Object.freeze({ap_291001_member_nets:Object.freeze(Object.fromEntries([...apByMember.entries()].sort(([left],[right])=>left.localeCompare(right))))}),trace:Object.freeze(structuredClone(expected)),can_transition_case:false,can_create_draft:false,can_post:false});
}
