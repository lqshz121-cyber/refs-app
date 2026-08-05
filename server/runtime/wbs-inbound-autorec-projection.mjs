import {canonicalRequestHash} from './request-hash.mjs';

const TRANSACTION_TYPES=new Set(['BANK_TRANSACTION','PAYABLE','AUTOREC_PAYMENT_DETAIL']);
const text=value=>value==null?'':String(value).trim();
const decimal=value=>Number.isFinite(Number(value))?Number(Number(value).toFixed(4)):null;
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value));
const freeze=value=>Object.freeze(value);

export class WbsInboundProjectionError extends Error { constructor(code,message){super(message);this.name='WbsInboundProjectionError';this.code=code;} }
const exception=(row,code,message)=>freeze({stage:'EXCEPTION',code,message,source_record_id:text(row?.source_record_id)||null,raw_event_id:text(row?.raw_event_id)||null,staging_item_id:text(row?.staging_item_id)||null,can_dispatch:false,can_post:false});

function missingFields(row){
  const required=['receipt_id','receipt_ref','receipt_hash','raw_event_id','source_document_id','staging_item_id','source_record_id','source_version','entity_id','company_key','currency','amount','business_date','accounting_date','source_type'];
  const missing=required.filter(key=>key==='amount'?decimal(row?.amount)===null:text(row?.[key])==='');
  if(!/^[A-Z]{3}$/.test(text(row?.currency)))missing.push('currency');
  if(decimal(row?.amount)===0)missing.push('nonzero_amount');
  if(!validDate(row?.business_date)||!validDate(row?.accounting_date))missing.push('business_or_accounting_date');
  if(row?.source_type==='BANK_TRANSACTION'&&!text(row?.bank_account_ref))missing.push('bank_account_ref');
  return [...new Set(missing)];
}
function mappingFor(row,mappings){
  const matches=(mappings||[]).filter(mapping=>text(mapping?.status)==='APPROVED'&&text(mapping?.mapping_id)&&text(mapping?.version)&&text(mapping?.source_type)===text(row.source_type)&&text(mapping?.entity_id)===text(row.entity_id)&&text(mapping?.company_key)===text(row.company_key)&&text(mapping?.currency)===text(row.currency)&&(row.source_type!=='BANK_TRANSACTION'||text(mapping?.bank_account_ref)===text(row.bank_account_ref)));
  if(matches.length===0)return {error:exception(row,'WBS_AUTOREC_MAPPING_MISSING','No approved scoped mapping exists for this persisted WBS source')};
  if(matches.length!==1)return {error:exception(row,'WBS_AUTOREC_MAPPING_AMBIGUOUS','More than one approved scoped mapping exists for this persisted WBS source')};
  return {mapping:matches[0]};
}

// Read-only projection from a persisted staging/exception read model. It does
// not allocate, release, dispatch a Draft command, or post. The source rows
// must already carry the immutable receipt and Raw→Staging identifiers created
// by the atomic intake command.
export function projectPersistedWbsInboundAutoRec({rows,mappings=[]}={}){
  if(!Array.isArray(rows))throw new WbsInboundProjectionError('WBS_AUTOREC_PROJECTION_ROWS_REQUIRED','Persisted WBS inbound rows are required');
  if(!Array.isArray(mappings))throw new WbsInboundProjectionError('WBS_AUTOREC_PROJECTION_MAPPINGS_INVALID','Approved mapping read rows must be an array');
  const candidates=[],exceptions=[];
  for(const row of rows){
    if(!row||typeof row!=='object'){exceptions.push(exception(null,'WBS_AUTOREC_PERSISTED_ROW_INVALID','Persisted WBS inbound row is invalid'));continue;}
    if(text(row.stage)==='EXCEPTION'){exceptions.push(exception(row,text(row.exception_code)||'WBS_INBOUND_EXCEPTION',text(row.exception_message)||'Persisted inbound exception remains blocked'));continue;}
    if(text(row.stage)!=='STAGING_REVIEWED'){exceptions.push(exception(row,'WBS_AUTOREC_STAGING_REVIEW_REQUIRED','Persisted WBS source must be reviewed before Auto Reconciliation review'));continue;}
    if(!TRANSACTION_TYPES.has(text(row.source_type))){exceptions.push(exception(row,'WBS_AUTOREC_SOURCE_TYPE_INVALID','Persisted WBS source type cannot enter Auto Reconciliation'));continue;}
    const missing=missingFields(row);if(missing.length){exceptions.push(exception(row,'WBS_AUTOREC_TRACE_REQUIRED',`Persisted WBS source is missing ${missing.join(', ')}`));continue;}
    const resolution=mappingFor(row,mappings);if(resolution.error){exceptions.push(resolution.error);continue;}
    const side=row.source_type==='BANK_TRANSACTION'?'BANK_SIDE':'BUSINESS_SIDE';
    const trace=freeze({receipt_id:row.receipt_id,receipt_ref:row.receipt_ref,receipt_hash:row.receipt_hash,raw_event_id:row.raw_event_id,source_document_id:row.source_document_id,staging_item_id:row.staging_item_id,source_record_id:row.source_record_id,source_version:row.source_version,mapping_id:resolution.mapping.mapping_id,mapping_version:resolution.mapping.version});
    candidates.push(freeze({review_candidate_id:canonicalRequestHash({side,trace}),stage:'STAGING_REVIEWED',side,source_type:row.source_type,entity_id:row.entity_id,company_key:row.company_key,currency:row.currency,amount:decimal(row.amount),business_date:row.business_date,accounting_date:row.accounting_date,bank_account_ref:row.bank_account_ref??null,source_record_id:row.source_record_id,source_version:row.source_version,raw_event_id:row.raw_event_id,source_document_id:row.source_document_id,staging_item_id:row.staging_item_id,mapping:freeze({mapping_id:resolution.mapping.mapping_id,version:resolution.mapping.version}),trace,can_dispatch:false,can_allocate:false,can_release:false,can_create_draft:false,can_post:false}));
  }
  return freeze({projection:'WBS_PERSISTED_INBOUND_AUTOREC_REVIEW_V1',candidates:freeze(candidates),exceptions:freeze(exceptions),controls:freeze({candidate_count:candidates.length,exception_count:exceptions.length,can_dispatch:false,can_post:false}),required_next_controls:freeze(['human Auto Reconciliation review','separate authoritative allocation/release command','standard Draft JE workflow'])});
}
