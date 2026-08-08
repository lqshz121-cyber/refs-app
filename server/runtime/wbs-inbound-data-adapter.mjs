import {validateWbsSnapshotPackage,WbsSnapshotError} from './wbs-snapshot-package.mjs';
import {canonicalRequestHash} from './request-hash.mjs';

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
const amount=value=>Number.isFinite(Number(value))?Number(Number(value).toFixed(4)):null;
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
    upstream_mcp_tool:text(row.mcp_tool)||null,upstream_mcp_content_hash:text(row.mcp_content_sha256)||null,upstream_mcp_row_hash:text(row.mcp_row_hash)||null,upstream_mcp_captured_at:text(row.mcp_captured_at)||null
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

export function createWbsInboundDataAdapter({snapshotReader,validateSnapshot=validateWbsSnapshotPackage}={}){
  if(!snapshotReader||snapshotReader.readOnly!==true||typeof snapshotReader.readSnapshot!=='function')throw new WbsInboundDataError('WBS_INBOUND_READER_INVALID','A read-only WBS snapshot reader is required');
  return Object.freeze({
    mode:'WBS_READONLY_INBOUND_ADAPTER_V1',read_only:true,
    async pull({selection}={}){return this.prepare(await snapshotReader.readSnapshot(selection));},
    prepare(snapshot){
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
        admission:Object.freeze({can_write_wbs:false,can_allocate:false,can_create_draft:false,can_post:false,required_next_controls:['persist_raw_normalized_staging','approved_mapping','staging_review','standard_refs_je_workflow']})
      });
    }
  });
}

export function buildStandardDraftRequest({stagingItem,mapping,journal}={}){
  if(text(stagingItem?.stage)!=='STAGING_REVIEWED')fail('WBS_STAGING_REVIEW_REQUIRED','A reviewed persistent REFS staging item is required');
  for(const field of ['staging_item_id','source_document_id','raw_event_id','source_record_id','source_version','company_key','currency','accounting_date','source_type'])if(!text(stagingItem[field]))fail('WBS_STAGING_TRACE_REQUIRED',`Staging trace ${field} is required`);
  if(!/^[A-Z]{3}$/.test(text(stagingItem.currency))||!validIsoDate(stagingItem.accounting_date))fail('WBS_STAGING_TRACE_REQUIRED','Staging currency and accounting date must be canonical before a Draft request');
  if(text(mapping?.status)!=='APPROVED'||!text(mapping?.mapping_id)||!text(mapping?.version)||text(mapping?.company_key)!==text(stagingItem.company_key)||text(mapping?.currency)!==text(stagingItem.currency))fail('WBS_MAPPING_APPROVED_REQUIRED','An approved mapping with the exact source company and currency scope is required');
  if(!journal||!Array.isArray(journal.lines)||journal.lines.length<2||!text(journal.period_id)||!text(journal.journal_number)||text(journal.company_key)!==text(stagingItem.company_key)||text(journal.currency)!==text(stagingItem.currency)||text(journal.accounting_date)!==text(stagingItem.accounting_date))fail('WBS_DRAFT_REQUEST_SCOPE_INVALID','A standard Draft journal request must retain the exact source company, currency, and accounting date');
  const debit=journal.lines.reduce((sum,line)=>sum+(amount(line.debit_amount)||0),0),credit=journal.lines.reduce((sum,line)=>sum+(amount(line.credit_amount)||0),0);
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

export function evaluateWbsAutoReconciliationEligibility({bankStaging,businessStaging,tolerance=0,dateWindowDays=3}={}){
  const exceptions=[];
  const commonRequired=['receipt_id','receipt_ref','receipt_hash','raw_event_id','source_document_id','staging_item_id','source_record_id','source_version','company_key','currency','amount','business_date','accounting_date','bank_account_ref','direction','account_before','account_after','review_event_id'];
  for(const [side,row] of [['BANK_SIDE',bankStaging],['BUSINESS_SIDE',businessStaging]]){
    const required=side==='BANK_SIDE'?[...commonRequired,'journal_no','payee_no']:[...commonRequired,'bill_no','project_ref','project_code'];
    const missing=required.filter(field=>field==='amount'?amount(row?.amount)===null||amount(row?.amount)===0:text(row?.[field])==='');
    if(text(row?.stage)!=='STAGING_REVIEWED')missing.push('STAGING_REVIEWED');
    if(!/^sha256:[0-9a-f]{64}$/.test(text(row?.receipt_hash)))missing.push('receipt_hash');
    if(!/^[A-Z]{3}$/.test(text(row?.currency)))missing.push('currency');
    if(!['DEBIT','CREDIT'].includes(text(row?.direction).toUpperCase()))missing.push('direction');
    if(!validIsoDate(row?.business_date)||!validIsoDate(row?.accounting_date))missing.push('business_or_accounting_date');
    if(missing.length)exceptions.push(eligibilityException(side,row,'WBS_AUTOREC_ELIGIBILITY_TRACE_REQUIRED','Auto Reconciliation eligibility requires immutable receipt, source, staging, direction, account, amount, and date trace',[...new Set(missing)]));
  }
  if(exceptions.length)return Object.freeze({status:'BLOCKED',candidates:Object.freeze([]),exceptions:Object.freeze(exceptions),can_allocate:false,can_dispatch:false,can_create_draft:false,can_post:false});
  if(bankStaging.source_type!=='BANK_TRANSACTION'||!['PAYABLE','AUTOREC_PAYMENT_DETAIL'].includes(businessStaging.source_type))exceptions.push(eligibilityException('PAIR',businessStaging,'WBS_AUTOREC_SOURCE_TYPE_INVALID','Auto Reconciliation requires one Bank Transaction and one business-side source'));
  if(text(bankStaging.company_key)!==text(businessStaging.company_key)||text(bankStaging.currency)!==text(businessStaging.currency))exceptions.push(eligibilityException('PAIR',businessStaging,'WBS_AUTOREC_SCOPE_MISMATCH','Auto Reconciliation sources must share exact company and currency'));
  if(text(bankStaging.direction).toUpperCase()===text(businessStaging.direction).toUpperCase())exceptions.push(eligibilityException('PAIR',businessStaging,'WBS_AUTOREC_DIRECTION_MISMATCH','Bank and business evidence must have opposite directions'));
  if(text(bankStaging.bank_account_ref)!==text(businessStaging.bank_account_ref))exceptions.push(eligibilityException('PAIR',businessStaging,'WBS_AUTOREC_BANK_ACCOUNT_MISMATCH','Bank and business evidence must reference the exact same bank account'));
  if(!Number.isSafeInteger(Number(dateWindowDays))||Number(dateWindowDays)<0||dayDistance(bankStaging.business_date,businessStaging.business_date)>Number(dateWindowDays)||dayDistance(bankStaging.accounting_date,businessStaging.accounting_date)>Number(dateWindowDays))exceptions.push(eligibilityException('PAIR',businessStaging,'WBS_AUTOREC_DATE_WINDOW_MISMATCH','Bank and business dates exceed the approved review window'));
  const difference=Math.abs(Math.abs(amount(bankStaging.amount))-Math.abs(amount(businessStaging.amount)));
  if(!Number.isFinite(Number(tolerance))||Number(tolerance)<0||difference>Number(tolerance))exceptions.push(eligibilityException('PAIR',businessStaging,'WBS_AUTOREC_AMOUNT_MISMATCH','Auto Reconciliation source amounts exceed the approved capacity'));
  if(exceptions.length)return Object.freeze({status:'BLOCKED',candidates:Object.freeze([]),exceptions:Object.freeze(exceptions),can_allocate:false,can_dispatch:false,can_create_draft:false,can_post:false});
  const candidate=Object.freeze({request_type:'AUTOREC_REVIEW_REQUEST',status:'REVIEW_REQUIRED',can_allocate:false,can_release:false,can_dispatch:false,can_create_draft:false,can_post:false,bank_source_record_id:bankStaging.source_record_id,business_source_record_id:businessStaging.source_record_id,company_key:bankStaging.company_key,bank_account_ref:bankStaging.bank_account_ref,currency:bankStaging.currency,amount_difference:difference,date_window_days:Number(dateWindowDays),trace:Object.freeze({bank_receipt_id:bankStaging.receipt_id,business_receipt_id:businessStaging.receipt_id,bank_raw_event_id:bankStaging.raw_event_id,business_raw_event_id:businessStaging.raw_event_id,bank_source_record_id:bankStaging.source_record_id,bank_source_version:bankStaging.source_version,business_source_record_id:businessStaging.source_record_id,business_source_version:businessStaging.source_version,bank_staging_item_id:bankStaging.staging_item_id,business_staging_item_id:businessStaging.staging_item_id,bill_no:businessStaging.bill_no,journal_no:bankStaging.journal_no,payee_no:bankStaging.payee_no,project_ref:businessStaging.project_ref,project_code:businessStaging.project_code,bank_account_before:bankStaging.account_before,bank_account_after:bankStaging.account_after,business_account_before:businessStaging.account_before,business_account_after:businessStaging.account_after,bank_review_event_id:bankStaging.review_event_id,business_review_event_id:businessStaging.review_event_id})});
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
export function buildWbsAutoReconciliationReviewPlan({bankRows,businessRows,tolerance=0,dateWindowDays=3}={}){
  if(!Array.isArray(bankRows)||!Array.isArray(businessRows)||bankRows.length===0||businessRows.length===0)fail('WBS_AUTOREC_PLAN_ROWS_REQUIRED','At least one bank row and one business row are required.');
  if(!Number.isFinite(Number(tolerance))||Number(tolerance)<0||!Number.isSafeInteger(Number(dateWindowDays))||Number(dateWindowDays)<0)fail('WBS_AUTOREC_PLAN_OPTIONS_INVALID','Auto Reconciliation tolerance and date window are invalid.');
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
  for(const bank of bankRows)for(const business of businessRows)if(dayDistance(bank.business_date,business.business_date)>Number(dateWindowDays)||dayDistance(bank.accounting_date,business.accounting_date)>Number(dateWindowDays))exceptions.push(eligibilityException('PAIR',business,'WBS_AUTOREC_PLAN_DATE_WINDOW_MISMATCH','Proposed bank and business rows exceed the approved date window.'));
  if(exceptions.length)return freeze({status:'BLOCKED',allocation_plan:freeze([]),exceptions:freeze(exceptions),controls:freeze({can_allocate:false,can_release:false,can_post:false})});
  const remaining=rows=>rows.map(row=>({row,remaining:Math.abs(amount(row.amount))})).sort((left,right)=>text(left.row.source_record_id).localeCompare(text(right.row.source_record_id)));
  const banks=remaining(bankRows),businesses=remaining(businessRows),allocation=[];
  for(const bank of banks)for(const business of businesses){
    if(bank.remaining<=Number(tolerance)||business.remaining<=Number(tolerance))continue;
    const allocated=Number(Math.min(bank.remaining,business.remaining).toFixed(4));
    bank.remaining=Number((bank.remaining-allocated).toFixed(4));business.remaining=Number((business.remaining-allocated).toFixed(4));
    allocation.push(freeze({bank_source_record_id:bank.row.source_record_id,bank_source_version:bank.row.source_version,business_source_record_id:business.row.source_record_id,business_source_version:business.row.source_version,amount:allocated,currency:anchor.currency,bank_receipt_hash:bank.row.receipt_hash,business_receipt_hash:business.row.receipt_hash,can_allocate:false,can_release:false,can_post:false}));
  }
  const bankTotal=Number(banks.reduce((sum,item)=>sum+Math.abs(amount(item.row.amount)),0).toFixed(4));
  const businessTotal=Number(businesses.reduce((sum,item)=>sum+Math.abs(amount(item.row.amount)),0).toFixed(4));
  const allocatedTotal=Number(allocation.reduce((sum,item)=>sum+item.amount,0).toFixed(4));
  const bankRemaining=Number(banks.reduce((sum,item)=>sum+item.remaining,0).toFixed(4)),businessRemaining=Number(businesses.reduce((sum,item)=>sum+item.remaining,0).toFixed(4));
  const difference=Number(Math.abs(bankTotal-businessTotal).toFixed(4)),balanced=difference<=Number(tolerance);
  const trace=allocation.map(item=>({bank_source_record_id:item.bank_source_record_id,bank_source_version:item.bank_source_version,business_source_record_id:item.business_source_record_id,business_source_version:item.business_source_version,bank_receipt_hash:item.bank_receipt_hash,business_receipt_hash:item.business_receipt_hash}));
  return freeze({review_plan_id:canonicalRequestHash({company_key:anchor.company_key,currency:anchor.currency,bank_account_ref:anchor.bank_account_ref,tolerance:Number(tolerance),date_window_days:Number(dateWindowDays),trace}),status:balanced?'REVIEW_REQUIRED':'PARTIAL_REVIEW_REQUIRED',allocation_plan:freeze(allocation),exceptions:freeze([]),control_totals:freeze({company_key:anchor.company_key,currency:anchor.currency,bank_account_ref:anchor.bank_account_ref,bank_total:bankTotal,business_total:businessTotal,allocated_total:allocatedTotal,bank_unallocated:bankRemaining,business_unallocated:businessRemaining,difference,tolerance:Number(tolerance),balanced}),trace:freeze(trace),controls:freeze({can_allocate:false,can_release:false,can_post:false,required_next_controls:freeze(['authoritative source reservation','human Auto Reconciliation review','standard REFS release/incur workflow'])})});
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
  const required=['policy_id','version','mapping_id','mapping_version','rule_id','rule_version','bank_mapping_id','bank_mapping_version','business_mapping_id','business_mapping_version','company_key','currency','bank_account_ref','receipt_id','receipt_ref','receipt_hash'];
  const missing=required.filter(field=>text(matchingPolicy[field])==='');
  const mismatched=text(matchingPolicy.status)!=='APPROVED'||text(matchingPolicy.company_key)!==text(anchor.company_key)||text(matchingPolicy.currency)!==text(anchor.currency)||text(matchingPolicy.bank_account_ref)!==text(anchor.bank_account_ref)||!/^sha256:[0-9a-f]{64}$/.test(receiptHash)||tolerance===null||tolerance<0||!Number.isSafeInteger(window)||window<0;
  if(missing.length||mismatched)return invalid();
  const mappingFor=row=>row?.mapping&&typeof row.mapping==='object'?row.mapping:row;
  const mappingMismatch=[...bankRows].some(row=>text(mappingFor(row).mapping_id)!==text(matchingPolicy.bank_mapping_id)||text(mappingFor(row).mapping_version)!==text(matchingPolicy.bank_mapping_version))||[...businessRows].some(row=>text(mappingFor(row).mapping_id)!==text(matchingPolicy.business_mapping_id)||text(mappingFor(row).mapping_version)!==text(matchingPolicy.business_mapping_version));
  if(mappingMismatch)return freeze({status:'BLOCKED',allocation_plan:freeze([]),exceptions:freeze([eligibilityException('PAIR',anchor,'WBS_AUTOREC_MATCHING_POLICY_MAPPING_MISMATCH','Each provider-backed Auto Reconciliation source must carry the exact approved mapping version named by the matching policy.')]),controls:freeze({can_allocate:false,can_release:false,can_post:false})});
  const plan=buildWbsAutoReconciliationReviewPlan({bankRows,businessRows,tolerance,dateWindowDays:window});
  if(plan.status==='BLOCKED')return plan;
  const policyTrace=freeze({policy_id:text(matchingPolicy.policy_id),version:text(matchingPolicy.version),mapping_id:text(matchingPolicy.mapping_id),mapping_version:text(matchingPolicy.mapping_version),rule_id:text(matchingPolicy.rule_id),rule_version:text(matchingPolicy.rule_version),bank_mapping_id:text(matchingPolicy.bank_mapping_id),bank_mapping_version:text(matchingPolicy.bank_mapping_version),business_mapping_id:text(matchingPolicy.business_mapping_id),business_mapping_version:text(matchingPolicy.business_mapping_version),receipt_id:text(matchingPolicy.receipt_id),receipt_ref:text(matchingPolicy.receipt_ref),receipt_hash:receiptHash});
  return freeze({...plan,review_plan_id:canonicalRequestHash({review_plan_id:plan.review_plan_id,matching_policy:policyTrace}),matching_policy:policyTrace,control_totals:freeze({...plan.control_totals,tolerance}),controls:freeze({...plan.controls,matching_policy_required:true})});
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
  if(!adapter||typeof adapter.prepare!=='function')throw new WbsInboundDataError('WBS_INBOUND_ADAPTER_INVALID','A WBS inbound adapter with prepare is required');
  const replay=new Map();
  return Object.freeze({
    mode:'WBS_INBOUND_ORCHESTRATOR_V1',read_only:true,
    async persist({snapshot,prepared=null,tenantId,entityId,importBatchId,idempotencyKey}={}){
      if(!kernel||typeof kernel.recordWbsSnapshot!=='function'||typeof kernel.persistWbsInboundRows!=='function')fail('WBS_INBOUND_KERNEL_PERSISTENCE_UNAVAILABLE','Kernel must provide recordWbsSnapshot and persistWbsInboundRows before WBS inbound persistence can start');
      const canonicalPrepared=prepared??adapter.prepare(snapshot);
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
  return Object.freeze({ok:true,can_post:false,trace:{...draftRequest.trace,journal_entry_id:postedEvidence.journal_entry_id,ledger_line_ids:[...postedEvidence.ledger_line_ids],audit_ids:[postedEvidence.review_audit_id,postedEvidence.approval_audit_id,postedEvidence.post_audit_id]}});
}

// This is an evidence verifier, not an AutoRec transition. A WBS observed
// match cannot make a REFS case INCURRED: the authoritative kernel must first
// post both standard JE legs and supply their immutable ledger/audit trace.
export function validateWbsAutoRecG11PostedTrace({reviewRequest,postedJournals}={}){
  if(text(reviewRequest?.request_type)!=='AUTOREC_REVIEW_REQUEST'||text(reviewRequest?.status)!=='REVIEW_REQUIRED')fail('WBS_AUTOREC_G11_REVIEW_REQUIRED','A read-only reviewed AutoRec request is required.');
  const expected=reviewRequest.trace;
  const traceFields=['bank_receipt_id','business_receipt_id','bank_raw_event_id','business_raw_event_id','bank_source_record_id','bank_source_version','business_source_record_id','business_source_version','bank_staging_item_id','business_staging_item_id'];
  if(!expected||traceFields.some(field=>!text(expected[field])))fail('WBS_AUTOREC_G11_TRACE_REQUIRED','AutoRec review trace is incomplete.');
  if(!Array.isArray(postedJournals)||postedJournals.length!==2)fail('WBS_AUTOREC_G11_JOURNAL_COUNT_INVALID','Exactly one PAYABLE_INCUR and one AUTOC posted journal are required.');
  const types=new Set(['PAYABLE_INCUR','AUTOC']),byType=new Map();
  for(const journal of postedJournals){
    const type=text(journal?.accounting_type);
    if(!types.has(type)||byType.has(type))fail('WBS_AUTOREC_G11_JOURNAL_TYPE_INVALID','Posted journals must contain one PAYABLE_INCUR and one AUTOC leg.');
    if(text(journal?.source_system)!=='REFS_STANDARD_JE'||text(journal?.status)!=='POSTED'||!text(journal?.journal_entry_id)||!text(journal?.audit_event_id)||text(journal?.audit_event_type)!=='AUTO_JOURNAL_CREATED'||!Array.isArray(journal?.ledger_lines)||journal.ledger_lines.length<2)fail('WBS_AUTOREC_G11_POSTED_EVIDENCE_REQUIRED','Each AutoRec journal leg requires posted REFS, audit, and ledger evidence.');
    if(!journal.source_trace||traceFields.some(field=>text(journal.source_trace[field])!==text(expected[field])))fail('WBS_AUTOREC_G11_SOURCE_TRACE_MISMATCH','Posted journal source trace must exactly match the reviewed AutoRec pair.');
    byType.set(type,journal);
  }
  const apByMember=new Map();
  for(const journal of byType.values())for(const line of journal.ledger_lines){
    if(text(line?.account_code)!=='291001')continue;
    const member=text(line?.member_ref),debit=amount(line?.debit_amount),credit=amount(line?.credit_amount);
    if(!member||debit===null||credit===null||debit<0||credit<0||(debit!==0&&credit!==0))fail('WBS_AUTOREC_G11_291001_INVALID','291001 ledger evidence requires one-sided nonnegative amounts and a member.');
    apByMember.set(member,Number(((apByMember.get(member)??0)+debit-credit).toFixed(4)));
  }
  if(apByMember.size===0||[...apByMember.values()].some(net=>Math.abs(net)>0.0001))fail('WBS_AUTOREC_G11_291001_UNCLEARED','Every 291001 member must net to zero across PAYABLE_INCUR and AUTOC.');
  return Object.freeze({ok:true,status:'POSTED_TRACE_VERIFIED',journals:Object.freeze([...byType.entries()].sort(([left],[right])=>left.localeCompare(right)).map(([accounting_type,journal])=>Object.freeze({accounting_type,journal_entry_id:text(journal.journal_entry_id),audit_event_id:text(journal.audit_event_id),ledger_line_ids:Object.freeze(journal.ledger_lines.map(line=>text(line.ledger_line_id)).filter(Boolean))}))),control_totals:Object.freeze({ap_291001_member_nets:Object.freeze(Object.fromEntries([...apByMember.entries()].sort(([left],[right])=>left.localeCompare(right))))}),trace:Object.freeze(structuredClone(expected)),can_transition_case:false,can_create_draft:false,can_post:false});
}
