import {createAiAdmittedSourceUnbookedService,hashAiAdmittedSourceBookingEvidence} from './ai-admitted-source-unbooked.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const ROW_KEYS=Object.freeze(['accounting_date','accounting_period_id','admission_hash','admission_id','amount','ap_document_ids','business_date','company_code','currency','entity_id','journal_entry_ids','ledger_line_ids','queried_at','source_document_id','source_document_line_id','source_line_hash','source_payload_hash','tenant_id','vendor_ref']);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};

function sourceFrom(row){
  return {schema_version:'ADMITTED_ACCOUNTING_SOURCE_V1',tenant_id:row.tenant_id,entity_id:row.entity_id,company_code:row.company_code,accounting_period_id:row.accounting_period_id,admission_id:row.admission_id,admission_hash:row.admission_hash,admission_status:'ADMITTED',source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,source_payload_hash:row.source_payload_hash,source_line_hash:row.source_line_hash,source_type:'PAYABLE',vendor_ref:row.vendor_ref,business_date:row.business_date,accounting_date:row.accounting_date,currency:row.currency,amount:row.amount};
}
function lookupFrom(row){
  const payload={schema_version:'ACCOUNTING_BOOKING_LOOKUP_V1',tenant_id:row.tenant_id,entity_id:row.entity_id,company_code:row.company_code,accounting_period_id:row.accounting_period_id,source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,source_line_hash:row.source_line_hash,lookup_status:'COMPLETE',queried_at:row.queried_at,ap_match_count:row.ap_document_ids.length,journal_match_count:row.journal_entry_ids.length,ledger_line_match_count:row.ledger_line_ids.length,ap_document_ids:[...row.ap_document_ids],journal_entry_ids:[...row.journal_entry_ids],ledger_line_ids:[...row.ledger_line_ids]};
  return {...payload,lookup_evidence_hash:hashAiAdmittedSourceBookingEvidence(payload)};
}

export function createAiAdmittedSourceUnbookedAnalysisService({bookingEvidenceReader}={}){
  if(typeof bookingEvidenceReader!=='function')fail('AI_ADMITTED_SOURCE_UNBOOKED_READER_REQUIRED','A trusted server-side booking evidence reader is required.');
  return Object.freeze({async analyze({tenantId,entityId,currentAccountingPeriodId,limit=500}={}){
    if(![tenantId,entityId,currentAccountingPeriodId].every(value=>UUID.test(value||''))||!Number.isSafeInteger(limit)||limit<1||limit>500)fail('AI_ADMITTED_SOURCE_UNBOOKED_SCOPE_INVALID','Exact tenant, entity, period, and bounded population are required.');
    const rows=await bookingEvidenceReader({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId,limit});
    if(!Array.isArray(rows)||rows.length>=limit)fail('AI_ADMITTED_SOURCE_UNBOOKED_POPULATION_INCOMPLETE','The bounded admitted Payable read cannot prove population completeness.');
    const findings=[];
    for(const row of rows){
      if(!exact(row,ROW_KEYS)||row.tenant_id!==tenantId||row.entity_id!==entityId||row.accounting_period_id!==currentAccountingPeriodId||![row.ap_document_ids,row.journal_entry_ids,row.ledger_line_ids].every(value=>Array.isArray(value)&&value.length<=500))fail('AI_ADMITTED_SOURCE_UNBOOKED_EVIDENCE_INVALID','Server booking evidence is malformed, unscoped, or incomplete.');
      const source=sourceFrom(row),lookup=lookupFrom(row),analyzer=createAiAdmittedSourceUnbookedService({admittedSourceReader:async()=>source,accountingLookupReader:async()=>lookup}),result=await analyzer.analyze({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId,sourceDocumentId:row.source_document_id});
      if(result.status==='FINDING')findings.push(result.finding);
    }
    return freeze({schema_version:'AI_ADMITTED_SOURCE_UNBOOKED_BATCH_V1',current_accounting_period_id:currentAccountingPeriodId,scanned_source_count:rows.length,finding_count:findings.length,findings,action_flags:ACTIONS});
  }});
}
