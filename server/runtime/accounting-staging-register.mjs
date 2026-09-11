const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const nullableUuid=value=>value===null||uuid(value);
const text=(value,max=256)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const nullableText=(value,max=256)=>value===null||text(value,max);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const nullableTimestamp=value=>value===null||timestamp(value);
const money=value=>typeof value==='string'&&/^-?(0|[1-9]\d{0,15})\.\d{4}$/.test(value);
const nonnegative=value=>Number.isInteger(value)&&value>=0;
const sourceStatuses=new Set(['RECEIVED','VALIDATING','PENDING_MAPPING','PENDING_CODING','PENDING_REVIEW','READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED','RECONCILED','DUPLICATE','QUARANTINED','MAPPING_EXCEPTION','RULE_EXCEPTION','EXCLUDED','REJECTED','REVERSED']);
const exceptionStatuses=new Set(['OPEN','IN_REVIEW','RESOLVED','WAIVED']);
const severities=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);
const journalStatuses=new Set(['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED']);
const rowFlags=['can_assign','can_review','can_create_draft','can_post'];
const pageFlags=['can_import',...rowFlags];
const exceptionKeys=['exception_id','exception_code','status','severity','owner','version','created_at'];
const journalKeys=['journal_entry_id','journal_number','status','revision'];
const rowKeys=['staging_item_id','staging_version','status','assigned_to','reviewed_by','reviewed_at','created_at','updated_at','source_document_id','source_document_revision','source_system','source_module','source_record_id','source_version','document_type','document_no','accounting_date','currency','gross_amount','payload_hash','setting_snapshot_id','mapping_snapshot_id','rule_evaluation_id','ai_decision_id','exceptions','journal_evidence','action_flags'];
const pageKeys=['schema_version','entity_id','period_id','period_code','period_start','period_end','row_count','exception_count','ready_for_draft_count','draft_or_later_count','rows','action_flags'];
const falseFlags=(value,keys)=>exact(value,keys)&&keys.every(key=>value[key]===false);
export const validAccountingStagingSelection=({periodId})=>uuid(periodId);
export function validAccountingStagingRegister(value,{entityId,periodId}){
  if(!uuid(entityId)||!validAccountingStagingSelection({periodId})||!exact(value,pageKeys)||value.schema_version!=='ACCOUNTING_STAGING_REGISTER_V1'||value.entity_id!==entityId||value.period_id!==periodId||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.period_code||'')||!date(value.period_start)||!date(value.period_end)||value.period_start>value.period_end||value.period_start.slice(0,7)!==value.period_code||value.period_end.slice(0,7)!==value.period_code||!['row_count','exception_count','ready_for_draft_count','draft_or_later_count'].every(key=>nonnegative(value[key]))||!Array.isArray(value.rows)||value.row_count!==value.rows.length||!falseFlags(value.action_flags,pageFlags))return false;
  const ids=new Set();let exceptionCount=0,readyCount=0,progressedCount=0;
  for(const row of value.rows){
    if(!exact(row,rowKeys)||!uuid(row.staging_item_id)||ids.has(row.staging_item_id)||!nonnegative(row.staging_version)||!sourceStatuses.has(row.status)||!nullableText(row.assigned_to)||!nullableText(row.reviewed_by)||!nullableTimestamp(row.reviewed_at)||!timestamp(row.created_at)||!timestamp(row.updated_at)||!uuid(row.source_document_id)||!nonnegative(row.source_document_revision)||![row.source_system,row.source_module,row.source_record_id,row.source_version,row.document_type].every(item=>text(item))||!nullableText(row.document_no)||!date(row.accounting_date)||!/^[A-Z]{3}$/.test(row.currency||'')||!money(row.gross_amount)||!/^sha256:[0-9a-f]{64}$/.test(row.payload_hash||'')||![row.setting_snapshot_id,row.mapping_snapshot_id,row.rule_evaluation_id,row.ai_decision_id].every(nullableUuid)||!Array.isArray(row.exceptions)||!Array.isArray(row.journal_evidence)||!falseFlags(row.action_flags,rowFlags))return false;
    ids.add(row.staging_item_id);const exceptionIds=new Set();
    for(const item of row.exceptions){if(!exact(item,exceptionKeys)||!uuid(item.exception_id)||exceptionIds.has(item.exception_id)||!text(item.exception_code)||!exceptionStatuses.has(item.status)||!severities.has(item.severity)||!nullableText(item.owner)||!nonnegative(item.version)||!timestamp(item.created_at))return false;exceptionIds.add(item.exception_id);}
    const journalIds=new Set();for(const item of row.journal_evidence){if(!exact(item,journalKeys)||!uuid(item.journal_entry_id)||journalIds.has(item.journal_entry_id)||!text(item.journal_number)||!journalStatuses.has(item.status)||!nonnegative(item.revision))return false;journalIds.add(item.journal_entry_id);}
    exceptionCount+=row.exceptions.length;if(row.status==='READY_FOR_DRAFT')readyCount++;if(['DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED','RECONCILED'].includes(row.status))progressedCount++;
  }
  return exceptionCount===value.exception_count&&readyCount===value.ready_for_draft_count&&progressedCount===value.draft_or_later_count;
}
