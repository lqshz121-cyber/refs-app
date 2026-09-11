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
const positive=value=>Number.isInteger(value)&&value>0;
const exceptionStatuses=new Set(['OPEN','IN_REVIEW','RESOLVED','WAIVED']);
const severities=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);
const sourceStatuses=new Set(['RECEIVED','VALIDATING','PENDING_MAPPING','PENDING_CODING','PENDING_REVIEW','READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED','RECONCILED','DUPLICATE','QUARANTINED','MAPPING_EXCEPTION','RULE_EXCEPTION','EXCLUDED','REJECTED','REVERSED']);
const mappingStatuses=new Set(['DRAFT','APPROVED','RETIRED']);
const flags=['can_assign','can_review','can_resolve','can_waive','can_create_draft','can_post'];
const rowKeys=['exception_id','exception_version','exception_code','status','severity','owner','reason','created_at','resolved_by','resolved_at','resolution','source_document_id','source_document_revision','source_system','source_module','source_record_id','source_version','document_type','document_no','accounting_date','currency','gross_amount','payload_hash','staging_item_id','staging_version','staging_status','mapping_snapshot_id','mapping_family','mapping_version','mapping_status','mapping_snapshot_hash','mapping_effective_from','mapping_effective_to','action_flags'];
const pageKeys=['schema_version','entity_id','period_id','period_code','period_start','period_end','row_count','open_count','in_review_count','resolved_count','waived_count','rows','action_flags'];
const falseFlags=value=>exact(value,flags)&&flags.every(key=>value[key]===false);
export const validMappingExceptionSelection=({periodId})=>uuid(periodId);
export function validMappingExceptionRegister(value,{entityId,periodId}){
  if(!uuid(entityId)||!validMappingExceptionSelection({periodId})||!exact(value,pageKeys)||value.schema_version!=='MAPPING_EXCEPTION_REGISTER_V1'||value.entity_id!==entityId||value.period_id!==periodId||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.period_code||'')||!date(value.period_start)||!date(value.period_end)||value.period_start>value.period_end||value.period_start.slice(0,7)!==value.period_code||value.period_end.slice(0,7)!==value.period_code||!['row_count','open_count','in_review_count','resolved_count','waived_count'].every(key=>nonnegative(value[key]))||!Array.isArray(value.rows)||value.row_count!==value.rows.length||!falseFlags(value.action_flags))return false;
  const ids=new Set(),counts={OPEN:0,IN_REVIEW:0,RESOLVED:0,WAIVED:0};
  for(const row of value.rows){
    const stageNull=row.staging_item_id===null&&row.staging_version===null&&row.staging_status===null;
    const stageFull=uuid(row.staging_item_id)&&nonnegative(row.staging_version)&&sourceStatuses.has(row.staging_status);
    const mappingNull=row.mapping_snapshot_id===null&&row.mapping_family===null&&row.mapping_version===null&&row.mapping_status===null&&row.mapping_snapshot_hash===null&&row.mapping_effective_from===null&&row.mapping_effective_to===null;
    const mappingFull=uuid(row.mapping_snapshot_id)&&text(row.mapping_family)&&positive(row.mapping_version)&&mappingStatuses.has(row.mapping_status)&&/^sha256:[0-9a-f]{64}$/.test(row.mapping_snapshot_hash||'')&&timestamp(row.mapping_effective_from)&&nullableTimestamp(row.mapping_effective_to);
    if(!exact(row,rowKeys)||!uuid(row.exception_id)||ids.has(row.exception_id)||!nonnegative(row.exception_version)||!text(row.exception_code)||!exceptionStatuses.has(row.status)||!severities.has(row.severity)||!nullableText(row.owner)||!text(row.reason,2000)||!timestamp(row.created_at)||!nullableText(row.resolved_by)||!nullableTimestamp(row.resolved_at)||!nullableText(row.resolution,2000)||!uuid(row.source_document_id)||!nonnegative(row.source_document_revision)||![row.source_system,row.source_module,row.source_record_id,row.source_version,row.document_type].every(item=>text(item))||!nullableText(row.document_no)||!date(row.accounting_date)||!/^[A-Z]{3}$/.test(row.currency||'')||!money(row.gross_amount)||!/^sha256:[0-9a-f]{64}$/.test(row.payload_hash||'')||!(stageNull||stageFull)||!(mappingNull||mappingFull)||row.mapping_snapshot_id!==null&&row.staging_item_id===null||!falseFlags(row.action_flags))return false;
    if(row.status==='RESOLVED'&&(!text(row.resolved_by)||!timestamp(row.resolved_at)))return false;
    ids.add(row.exception_id);counts[row.status]++;
  }
  return counts.OPEN===value.open_count&&counts.IN_REVIEW===value.in_review_count&&counts.RESOLVED===value.resolved_count&&counts.WAIVED===value.waived_count;
}
