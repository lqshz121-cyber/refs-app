const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^sha256:[0-9a-f]{64}$/;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,fields)=>plain(value)&&Object.keys(value).sort().join('|')===fields.slice().sort().join('|');
const text=(value,max)=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&!Number.isNaN(Date.parse(value));
const reasonCode=value=>value===null||typeof value==='string'&&/^[A-Z][A-Z0-9_]{2,127}$/.test(value);
const type=value=>['IMPORT','EXPORT'].includes(value);
const status=value=>['SUCCEEDED','FAILED','PARTIAL'].includes(value);
const jobKeys=['schema_version','job_id','tenant_id','entity_id','job_type','source_kind','period_id','status','record_count','content_hash','source_version','failure_code','completed_at','created_at'];
export const validImportExportHistorySelection=({jobType='ALL',afterCompletedAt=null,afterJobId=null,limit=25}={})=>(jobType==='ALL'||type(jobType))&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100&&(afterCompletedAt===null&&afterJobId===null||timestamp(afterCompletedAt)&&UUID.test(afterJobId));
export const validImportExportHistoryRow=value=>exact(value,jobKeys)&&value.schema_version==='IMPORT_EXPORT_HISTORY_JOB_V1'&&UUID.test(value.job_id||'')&&UUID.test(value.tenant_id||'')&&UUID.test(value.entity_id||'')&&type(value.job_type)&&text(value.source_kind,80)&&UUID.test(value.period_id||'')&&status(value.status)&&Number.isSafeInteger(value.record_count)&&value.record_count>=0&&HASH.test(value.content_hash||'')&&/^[1-9]\d*$/.test(value.source_version||'')&&reasonCode(value.failure_code)&&timestamp(value.completed_at)&&timestamp(value.created_at)&&((value.status==='SUCCEEDED')===(value.failure_code===null));
export const validImportExportHistoryPage=(value,{tenantId,entityId,jobType='ALL',afterCompletedAt=null,afterJobId=null,limit=25}={})=>{
 if(!exact(value,['schema_version','tenant_id','entity_id','job_type','limit','after_completed_at','after_job_id','next_cursor','rows','action_flags'])||value.schema_version!=='IMPORT_EXPORT_HISTORY_PAGE_V1'||value.tenant_id!==tenantId||value.entity_id!==entityId||value.job_type!==jobType||value.limit!==limit||value.after_completed_at!==afterCompletedAt||value.after_job_id!==afterJobId)return false;
 if(value.next_cursor!==null&&(!exact(value.next_cursor,['completed_at','job_id'])||!timestamp(value.next_cursor.completed_at)||!UUID.test(value.next_cursor.job_id)))return false;
 if(!Array.isArray(value.rows)||value.rows.length>limit||!value.rows.every(validImportExportHistoryRow)||new Set(value.rows.map(row=>row.job_id)).size!==value.rows.length)return false;
 for(let i=1;i<value.rows.length;i++){const prev=value.rows[i-1],row=value.rows[i];if(`${prev.completed_at}\u0000${prev.job_id}`<`${row.completed_at}\u0000${row.job_id}`)return false;}
 if(!exact(value.action_flags,['can_import','can_export','can_post'])||Object.values(value.action_flags).some(flag=>flag!==false))return false;
 return value.next_cursor===null&&value.rows.length<limit||value.rows.length===limit&&value.next_cursor?.completed_at===value.rows.at(-1).completed_at&&value.next_cursor?.job_id===value.rows.at(-1).job_id;
};
