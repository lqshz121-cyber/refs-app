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
const text=value=>value==null?'':String(value).trim();
const amount=value=>Number.isFinite(Number(value))?Number(Number(value).toFixed(4)):null;
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value))?text(value):null;
const error=(code,message)=>Object.freeze({code,message});
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
  if(type==='PAYABLE')return [...base,'invoice_date'];
  if(type==='BANK_TRANSACTION')return [...base,'transaction_date','bank_account_ref'];
  return [...base,'payment_date','pbGuId','vendor_ref','project_ref','cost_code_ref','description'];
}
function normalize(type,companyKey,row,receipt){
  const businessDate=date(row.invoice_date??row.transaction_date??row.payment_date??row.business_date);
  const accountingDate=date(row.posting_date??row.accounting_date)??businessDate;
  const normalized={
    source_system:'WBS',source_type:type,company_key:companyKey,
    source_record_id:receipt.source_record_id,source_version:receipt.source_version,
    receipt_ref:receipt.payload_ref,receipt_hash:receipt.payload_hash,
    currency:text(row.currency).toUpperCase(),amount:amount(row.amount),
    business_date:businessDate,accounting_date:accountingDate,
    bank_account_ref:text(row.bank_account_ref)||null,
    vendor_ref:text(row.vendor_ref)||null,project_ref:text(row.project_ref)||null,cost_code_ref:text(row.cost_code_ref)||null,
    description:text(row.description)||null,pb_guid:text(row.pbGuId)||null
  };
  return Object.freeze(normalized);
}
function stageFor(normalized,row){
  const missing=requiredFields(normalized.source_type,row).filter(field=>{
    const value=field==='amount'?normalized.amount:field==='currency'?normalized.currency:field==='invoice_date'||field==='transaction_date'||field==='payment_date'?normalized.business_date:field==='pbGuId'?normalized.pb_guid:normalized[field];
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
  for(const field of ['staging_item_id','source_document_id','raw_event_id','source_record_id','source_version'])if(!text(stagingItem[field]))fail('WBS_STAGING_TRACE_REQUIRED',`Staging trace ${field} is required`);
  if(text(mapping?.status)!=='APPROVED'||!text(mapping?.mapping_id)||!text(mapping?.version))fail('WBS_MAPPING_APPROVED_REQUIRED','An approved versioned mapping is required');
  if(!journal||!Array.isArray(journal.lines)||journal.lines.length<2||!text(journal.period_id)||!text(journal.journal_number))fail('WBS_DRAFT_REQUEST_INVALID','A complete standard Draft journal request is required');
  const debit=journal.lines.reduce((sum,line)=>sum+(amount(line.debit_amount)||0),0),credit=journal.lines.reduce((sum,line)=>sum+(amount(line.credit_amount)||0),0);
  if(Math.abs(debit-credit)>0.0001||debit<=0)fail('WBS_DRAFT_REQUEST_UNBALANCED','Draft request journal lines must be positive and balanced');
  return Object.freeze({
    request_type:'STANDARD_AUTO_JOURNAL_REQUEST',status:'READY_FOR_STANDARD_JE_COMMAND',
    can_dispatch:false,can_post:false,kernel_method:'createAutoJournal',
    staging_item_id:stagingItem.staging_item_id,period_id:journal.period_id,journal_number:journal.journal_number,description:journal.description??null,lines:structuredClone(journal.lines),
    mapping:{mapping_id:mapping.mapping_id,version:mapping.version},
    trace:{raw_event_id:stagingItem.raw_event_id,source_document_id:stagingItem.source_document_id,source_record_id:stagingItem.source_record_id,source_version:stagingItem.source_version}
  });
}

export function buildAutoReconciliationReviewRequest({bankStaging,businessStaging,tolerance=0}={}){
  for(const candidate of [bankStaging,businessStaging])if(text(candidate?.stage)!=='STAGING_REVIEWED'||!text(candidate?.source_record_id)||!text(candidate?.currency)||amount(candidate?.amount)===null)fail('WBS_AUTOREC_STAGING_REQUIRED','Reviewed persistent staging evidence is required for Auto Reconciliation review');
  if(bankStaging.source_type!=='BANK_TRANSACTION'||!['PAYABLE','AUTOREC_PAYMENT_DETAIL'].includes(businessStaging.source_type))fail('WBS_AUTOREC_SOURCE_TYPE_INVALID','Auto Reconciliation requires one Bank Transaction and one business-side source');
  if(text(bankStaging.company_key)!==text(businessStaging.company_key)||text(bankStaging.currency)!==text(businessStaging.currency))fail('WBS_AUTOREC_SCOPE_MISMATCH','Auto Reconciliation sources must share company and currency');
  const difference=Math.abs(Math.abs(amount(bankStaging.amount))-Math.abs(amount(businessStaging.amount)));
  if(!Number.isFinite(Number(tolerance))||Number(tolerance)<0||difference>Number(tolerance))fail('WBS_AUTOREC_AMOUNT_MISMATCH','Auto Reconciliation source amounts exceed the approved tolerance');
  return Object.freeze({request_type:'AUTOREC_REVIEW_REQUEST',status:'REVIEW_REQUIRED',can_allocate:false,can_release:false,can_create_draft:false,can_post:false,bank_source_record_id:bankStaging.source_record_id,business_source_record_id:businessStaging.source_record_id,currency:bankStaging.currency,amount_difference:difference,trace:{bank_raw_event_id:bankStaging.raw_event_id,business_raw_event_id:businessStaging.raw_event_id}});
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

export function validatePostedJournalTrace({draftRequest,postedEvidence}={}){
  if(text(draftRequest?.status)!=='READY_FOR_STANDARD_JE_COMMAND')fail('WBS_DRAFT_REQUEST_REQUIRED','A standard Draft request is required');
  if(text(postedEvidence?.source_system)!=='REFS_STANDARD_JE'||text(postedEvidence?.status)!=='POSTED')fail('WBS_POSTED_EVIDENCE_REQUIRED','A POSTED standard REFS journal receipt is required');
  for(const field of ['journal_entry_id','review_audit_id','approval_audit_id','post_audit_id'])if(!text(postedEvidence?.[field]))fail('WBS_POSTED_EVIDENCE_REQUIRED',`Posted evidence ${field} is required`);
  if(!Array.isArray(postedEvidence.ledger_line_ids)||postedEvidence.ledger_line_ids.length<2)fail('WBS_POSTED_EVIDENCE_REQUIRED','Posted evidence ledger_line_ids are required');
  return Object.freeze({ok:true,can_post:false,trace:{...draftRequest.trace,journal_entry_id:postedEvidence.journal_entry_id,ledger_line_ids:[...postedEvidence.ledger_line_ids],audit_ids:[postedEvidence.review_audit_id,postedEvidence.approval_audit_id,postedEvidence.post_audit_id]}});
}
