import {createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^(0|[1-9]\d{0,15})\.\d{4}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const SOURCE_KEYS=Object.freeze(['accounting_date','accounting_period_id','admission_hash','admission_id','admission_status','amount','business_date','company_code','currency','entity_id','schema_version','source_document_id','source_document_line_id','source_line_hash','source_payload_hash','source_type','tenant_id','vendor_ref']);
const LOOKUP_KEYS=Object.freeze(['accounting_period_id','ap_document_ids','ap_match_count','company_code','entity_id','journal_entry_ids','journal_match_count','ledger_line_ids','ledger_line_match_count','lookup_evidence_hash','lookup_status','queried_at','schema_version','source_document_id','source_document_line_id','source_line_hash','tenant_id']);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const stable=value=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`:JSON.stringify(value);
const digest=value=>`sha256:${createHash('sha256').update(stable(value)).digest('hex')}`;
const text=(value,max=256)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const validDate=value=>{if(!DATE.test(value||''))return false;const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;};
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
const uniqueIds=values=>Array.isArray(values)&&values.every(value=>UUID.test(value||''))&&new Set(values).size===values.length;

function validSource(source,scope){
  return exact(source,SOURCE_KEYS)&&source.schema_version==='ADMITTED_ACCOUNTING_SOURCE_V1'&&source.tenant_id===scope.tenantId&&source.entity_id===scope.entityId&&source.accounting_period_id===scope.accountingPeriodId&&source.source_document_id===scope.sourceDocumentId&&source.admission_status==='ADMITTED'&&source.source_type==='PAYABLE'&&UUID.test(source.tenant_id||'')&&UUID.test(source.entity_id||'')&&UUID.test(source.accounting_period_id||'')&&UUID.test(source.admission_id||'')&&SHA.test(source.admission_hash||'')&&UUID.test(source.source_document_id||'')&&UUID.test(source.source_document_line_id||'')&&SHA.test(source.source_payload_hash||'')&&SHA.test(source.source_line_hash||'')&&text(source.company_code,64)&&text(source.vendor_ref,200)&&validDate(source.business_date)&&validDate(source.accounting_date)&&/^[A-Z]{3}$/.test(source.currency||'')&&MONEY.test(source.amount||'')&&source.amount!=='0.0000';
}

function validLookup(lookup,source){
  const evidencePayload=lookup&&Object.fromEntries(Object.entries(lookup).filter(([key])=>key!=='lookup_evidence_hash'));
  if(!exact(lookup,LOOKUP_KEYS)||lookup.schema_version!=='ACCOUNTING_BOOKING_LOOKUP_V1'||lookup.tenant_id!==source.tenant_id||lookup.entity_id!==source.entity_id||lookup.company_code!==source.company_code||lookup.accounting_period_id!==source.accounting_period_id||lookup.source_document_id!==source.source_document_id||lookup.source_document_line_id!==source.source_document_line_id||lookup.source_line_hash!==source.source_line_hash||lookup.lookup_evidence_hash!==digest(evidencePayload)||!text(lookup.queried_at,80)||Number.isNaN(Date.parse(lookup.queried_at))||new Date(lookup.queried_at).toISOString()!==lookup.queried_at||!['COMPLETE','UNAVAILABLE','AMBIGUOUS'].includes(lookup.lookup_status))return false;
  if(lookup.lookup_status!=='COMPLETE')return lookup.ap_match_count===null&&lookup.journal_match_count===null&&lookup.ledger_line_match_count===null&&Array.isArray(lookup.ap_document_ids)&&lookup.ap_document_ids.length===0&&Array.isArray(lookup.journal_entry_ids)&&lookup.journal_entry_ids.length===0&&Array.isArray(lookup.ledger_line_ids)&&lookup.ledger_line_ids.length===0;
  return [lookup.ap_match_count,lookup.journal_match_count,lookup.ledger_line_match_count].every(value=>Number.isSafeInteger(value)&&value>=0)&&uniqueIds(lookup.ap_document_ids)&&uniqueIds(lookup.journal_entry_ids)&&uniqueIds(lookup.ledger_line_ids)&&lookup.ap_document_ids.length===lookup.ap_match_count&&lookup.journal_entry_ids.length===lookup.journal_match_count&&lookup.ledger_line_ids.length===lookup.ledger_line_match_count;
}

export const hashAiAdmittedSourceBookingEvidence=digest;

const blocked=(source,lookup)=>freeze({schema_version:'AI_ADMITTED_SOURCE_BOOKING_REVIEW_V1',status:'BLOCKED',finding:null,source_trace:{admission_id:source.admission_id,admission_hash:source.admission_hash,source_document_id:source.source_document_id,source_document_line_id:source.source_document_line_id,source_payload_hash:source.source_payload_hash,source_line_hash:source.source_line_hash},lookup_trace:{lookup_evidence_hash:lookup.lookup_evidence_hash,lookup_status:lookup.lookup_status},suggested_journal:null,action_flags:ACTIONS});

export function createAiAdmittedSourceUnbookedService({admittedSourceReader,accountingLookupReader}={}){
  if(typeof admittedSourceReader!=='function'||typeof accountingLookupReader!=='function')fail('AI_ADMITTED_SOURCE_UNBOOKED_READER_REQUIRED','Trusted admitted-source and accounting lookup readers are required.');
  return Object.freeze({analyze:async scope=>{
    if(!exact(scope,['accountingPeriodId','entityId','sourceDocumentId','tenantId'])||![scope.tenantId,scope.entityId,scope.accountingPeriodId,scope.sourceDocumentId].every(value=>UUID.test(value||'')))fail('AI_ADMITTED_SOURCE_UNBOOKED_SCOPE_INVALID','Exact tenant, entity, period, and source scope is required.');
    const source=await admittedSourceReader(scope);if(!validSource(source,scope))fail('AI_ADMITTED_SOURCE_UNBOOKED_SOURCE_INVALID','A server-read admitted Payable with closed source lineage is required.');
    const lookup=await accountingLookupReader({tenantId:scope.tenantId,entityId:scope.entityId,accountingPeriodId:scope.accountingPeriodId,sourceDocumentId:source.source_document_id,sourceDocumentLineId:source.source_document_line_id,sourceLineHash:source.source_line_hash});
    if(!validLookup(lookup,source))fail('AI_ADMITTED_SOURCE_UNBOOKED_LOOKUP_INVALID','Accounting lookup evidence is malformed, drifted, or caller asserted.');
    if(lookup.lookup_status!=='COMPLETE')return blocked(source,lookup);
    const absent=lookup.ap_match_count===0&&lookup.journal_match_count===0&&lookup.ledger_line_match_count===0;
    const finding=absent?freeze({schema_version:'AI_ADMITTED_SOURCE_UNBOOKED_FINDING_V1',finding_type:'ADMITTED_SOURCE_UNBOOKED',risk_level:'HIGH',rule_id:'ADMITTED_PAYABLE_WITH_ZERO_ACCOUNTING_MATCH_V1',confidence:1,owner_role:'CONTROLLER_REVIEW',due_basis:'BEFORE_PERIOD_CLOSE',tenant_id:source.tenant_id,entity_id:source.entity_id,company_code:source.company_code,accounting_period_id:source.accounting_period_id,vendor_ref:source.vendor_ref,business_date:source.business_date,accounting_date:source.accounting_date,currency:source.currency,amount:source.amount,reason:'An admitted Payable has no AP document, Journal, or ledger line in the exact accounting scope.',suggested_action:'A human accountant must compare the admitted source with AP and GL evidence before deciding whether a Draft Journal is appropriate.',required_human_fields:['booking_determination','accounting_treatment','source_support_review','owner','due_date'],source_trace:{admission_id:source.admission_id,admission_hash:source.admission_hash,source_document_id:source.source_document_id,source_document_line_id:source.source_document_line_id,source_payload_hash:source.source_payload_hash,source_line_hash:source.source_line_hash},lookup_trace:{lookup_evidence_hash:lookup.lookup_evidence_hash,lookup_status:'COMPLETE',ap_match_count:0,journal_match_count:0,ledger_line_match_count:0},suggested_journal:null,action_flags:ACTIONS}):null;
    return freeze({schema_version:'AI_ADMITTED_SOURCE_BOOKING_REVIEW_V1',status:absent?'FINDING':'BOOKING_PRESENT',finding,source_trace:{admission_id:source.admission_id,admission_hash:source.admission_hash,source_document_id:source.source_document_id,source_document_line_id:source.source_document_line_id,source_payload_hash:source.source_payload_hash,source_line_hash:source.source_line_hash},lookup_trace:{lookup_evidence_hash:lookup.lookup_evidence_hash,lookup_status:'COMPLETE'},suggested_journal:null,action_flags:ACTIONS});
  }});
}
