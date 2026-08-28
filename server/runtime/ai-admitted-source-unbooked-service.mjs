import {createAiAdmittedSourceUnbookedService,hashAiAdmittedSourceBookingEvidence} from './ai-admitted-source-unbooked.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^(0|[1-9]\d{0,15})\.\d{4}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const ROW_KEYS=Object.freeze(['accounting_date','accounting_period_id','admission_hash','admission_id','amount','ap_document_ids','business_date','company_code','currency','entity_id','exception_codes','journal_entry_ids','ledger_line_ids','queried_at','retained_outcome','source_document_id','source_document_line_id','source_line_hash','source_payload_hash','source_status','tenant_id','vendor_ref']);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const validDate=value=>{if(!DATE.test(value||''))return false;const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;};
const nullable=(value,validator)=>value===null||validator(value);

function validRow(row,scope){
  const idArrays=[row.ap_document_ids,row.journal_entry_ids,row.ledger_line_ids],codes=row.exception_codes;
  return exact(row,ROW_KEYS)&&row.tenant_id===scope.tenantId&&row.entity_id===scope.entityId&&row.accounting_period_id===scope.currentAccountingPeriodId
    &&[row.tenant_id,row.entity_id,row.accounting_period_id,row.admission_id,row.source_document_id,row.source_document_line_id].every(value=>UUID.test(value||''))
    &&[row.admission_hash,row.source_payload_hash,row.source_line_hash].every(value=>SHA.test(value||''))&&text(row.company_code,64)
    &&nullable(row.vendor_ref,value=>text(value,200))&&nullable(row.business_date,validDate)&&validDate(row.accounting_date)&&/^[A-Z]{3}$/.test(row.currency||'')&&MONEY.test(row.amount||'')&&row.amount!=='0.0000'
    &&typeof row.queried_at==='string'&&!Number.isNaN(Date.parse(row.queried_at))&&new Date(row.queried_at).toISOString()===row.queried_at
    &&idArrays.every(value=>Array.isArray(value)&&value.length<=500&&value.every(id=>UUID.test(id||''))&&new Set(value).size===value.length)
    &&['STAGING_REVIEW_REQUIRED','EXCEPTION_REVIEW_REQUIRED'].includes(row.retained_outcome)&&['QUARANTINED','PENDING_REVIEW','READY_FOR_DRAFT'].includes(row.source_status)
    &&Array.isArray(codes)&&new Set(codes).size===codes.length&&codes.every(code=>typeof code==='string'&&/^[A-Z][A-Z0-9_]{2,127}$/.test(code));
}

function sourceFrom(row){
  return {schema_version:'ADMITTED_ACCOUNTING_SOURCE_V1',tenant_id:row.tenant_id,entity_id:row.entity_id,company_code:row.company_code,accounting_period_id:row.accounting_period_id,admission_id:row.admission_id,admission_hash:row.admission_hash,admission_status:'ADMITTED',source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,source_payload_hash:row.source_payload_hash,source_line_hash:row.source_line_hash,source_type:'PAYABLE',vendor_ref:row.vendor_ref,business_date:row.business_date,accounting_date:row.accounting_date,currency:row.currency,amount:row.amount};
}
function lookupFrom(row){
  const payload={schema_version:'ACCOUNTING_BOOKING_LOOKUP_V1',tenant_id:row.tenant_id,entity_id:row.entity_id,company_code:row.company_code,accounting_period_id:row.accounting_period_id,source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,source_line_hash:row.source_line_hash,lookup_status:'COMPLETE',queried_at:row.queried_at,ap_match_count:row.ap_document_ids.length,journal_match_count:row.journal_entry_ids.length,ledger_line_match_count:row.ledger_line_ids.length,ap_document_ids:[...row.ap_document_ids],journal_entry_ids:[...row.journal_entry_ids],ledger_line_ids:[...row.ledger_line_ids]};
  return {...payload,lookup_evidence_hash:hashAiAdmittedSourceBookingEvidence(payload)};
}
function blockedFindingFrom(row,lookup){
  return freeze({schema_version:'AI_ADMITTED_SOURCE_BLOCKED_FINDING_V1',finding_type:'BLOCKED_SOURCE_INCOMPLETE',risk_level:'HIGH',rule_id:'ADMITTED_PAYABLE_SOURCE_INCOMPLETE_V1',confidence:1,owner_role:'CONTROLLER_REVIEW',due_basis:'BEFORE_PERIOD_CLOSE',tenant_id:row.tenant_id,entity_id:row.entity_id,company_code:row.company_code,accounting_period_id:row.accounting_period_id,vendor_ref:row.vendor_ref,business_date:row.business_date,accounting_date:row.accounting_date,currency:row.currency,amount:row.amount,reason:'An admitted Payable has no accounting booking, but its retained source evidence is not ready for an unbooked accounting conclusion.',suggested_action:'A human accountant must resolve the retained source exceptions and verify the AP and GL lookup before deciding whether a Draft is appropriate.',required_human_fields:['source_exception_resolution','source_support_review','booking_determination','owner','due_date'],source_trace:{admission_id:row.admission_id,admission_hash:row.admission_hash,source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,source_payload_hash:row.source_payload_hash,source_line_hash:row.source_line_hash,retained_outcome:row.retained_outcome,exception_codes:[...row.exception_codes],source_status:row.source_status},lookup_trace:{lookup_evidence_hash:lookup.lookup_evidence_hash,lookup_status:'COMPLETE',ap_match_count:0,journal_match_count:0,ledger_line_match_count:0},suggested_journal:null,action_flags:ACTIONS});
}

export function createAiAdmittedSourceUnbookedAnalysisService({bookingEvidenceReader}={}){
  if(typeof bookingEvidenceReader!=='function')fail('AI_ADMITTED_SOURCE_UNBOOKED_READER_REQUIRED','A trusted server-side booking evidence reader is required.');
  return Object.freeze({async analyze({tenantId,entityId,currentAccountingPeriodId,limit=500}={}){
    if(![tenantId,entityId,currentAccountingPeriodId].every(value=>UUID.test(value||''))||!Number.isSafeInteger(limit)||limit<1||limit>500)fail('AI_ADMITTED_SOURCE_UNBOOKED_SCOPE_INVALID','Exact tenant, entity, period, and bounded population are required.');
    const rows=await bookingEvidenceReader({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId,limit});
    if(!Array.isArray(rows)||rows.length>=limit)fail('AI_ADMITTED_SOURCE_UNBOOKED_POPULATION_INCOMPLETE','The bounded admitted Payable read cannot prove population completeness.');
    const findings=[];
    for(const row of rows){
      if(!validRow(row,{tenantId,entityId,currentAccountingPeriodId}))fail('AI_ADMITTED_SOURCE_UNBOOKED_EVIDENCE_INVALID','Server booking evidence is malformed, unscoped, or incomplete.');
      const idArrays=[row.ap_document_ids,row.journal_entry_ids,row.ledger_line_ids],codes=row.exception_codes;
      const lookup=lookupFrom(row),absent=idArrays.every(value=>value.length===0),sourceBlocked=row.retained_outcome!=='STAGING_REVIEW_REQUIRED'||codes.length>0||row.source_status!=='READY_FOR_DRAFT';
      if(absent&&sourceBlocked){findings.push(blockedFindingFrom(row,lookup));continue;}
      if(sourceBlocked)continue;
      const source=sourceFrom(row),analyzer=createAiAdmittedSourceUnbookedService({admittedSourceReader:async()=>source,accountingLookupReader:async()=>lookup}),result=await analyzer.analyze({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId,sourceDocumentId:row.source_document_id});
      if(result.status==='FINDING')findings.push(result.finding);
    }
    return freeze({schema_version:'AI_ADMITTED_SOURCE_UNBOOKED_BATCH_V1',current_accounting_period_id:currentAccountingPeriodId,scanned_source_count:rows.length,finding_count:findings.length,findings,action_flags:ACTIONS});
  }});
}
