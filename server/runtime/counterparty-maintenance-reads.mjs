const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v,max=Infinity,min=1)=>typeof v==='string'&&v===v.trim()&&[...v].length>=min&&[...v].length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const revision=v=>Number.isSafeInteger(v)&&v>=0;
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
export const validCounterpartyDetailSelection=({kind,memberRef})=>['VENDOR','CUSTOMER'].includes(kind)&&text(memberRef,128);
export const validCounterpartyChangesSelection=({kind,status='PENDING',memberRef=null,afterId=null,limit=25})=>
 ['VENDOR','CUSTOMER'].includes(kind)&&['PENDING','APPROVED','REJECTED','ALL'].includes(status)
 &&(memberRef===null||text(memberRef,128))&&(afterId===null||uuid(afterId))&&Number.isInteger(limit)&&limit>=1&&limit<=100;
export function validCounterpartyDetail(v,{entityId,kind,memberRef}){
 return validCounterpartyDetailSelection({kind,memberRef})&&exact(v,['schema_version','entity_id','kind','member_ref','display_name','active','revision'])
  &&v.schema_version==='COUNTERPARTY_DETAIL_V1'&&v.entity_id===entityId&&v.kind===kind&&v.member_ref===memberRef
  &&text(v.display_name)&&typeof v.active==='boolean'&&revision(v.revision);
}
const state=(v,before=false)=>exact(v,['display_name','active',...(before?['revision']:[])])&&text(v.display_name,before?Infinity:256)
 &&typeof v.active==='boolean'&&(!before||revision(v.revision));
export function validCounterpartyChangesPage(v,{entityId,kind,status='PENDING',memberRef=null,afterId=null,limit=25}){
 if(!validCounterpartyChangesSelection({kind,status,memberRef,afterId,limit})||!exact(v,['schema_version','entity_id','kind','status','member_ref','after_id','limit','rows','next_change_id'])
  ||v.schema_version!=='COUNTERPARTY_CHANGES_V1'||v.entity_id!==entityId||v.kind!==kind||v.status!==status||v.member_ref!==memberRef||v.after_id!==afterId||v.limit!==limit||!Array.isArray(v.rows)||v.rows.length>limit)return false;
 const seen=new Set();
 for(const row of v.rows){
  if(!exact(row,['counterparty_change_id','member_ref','kind','change_type','expected_member_revision','before_state','desired_state','reason','proposed_by','created_at','status','revision','reviewed_by','review_reason','reviewed_at'])
   ||!uuid(row.counterparty_change_id)||seen.has(row.counterparty_change_id)||row.counterparty_change_id===afterId||!text(row.member_ref,128)||row.kind!==kind||memberRef!==null&&row.member_ref!==memberRef
   ||!['CREATE','UPDATE'].includes(row.change_type)||!revision(row.expected_member_revision)||!state(row.desired_state)||!text(row.reason,2000,8)||!text(row.proposed_by)||!timestamp(row.created_at)
   ||!['PENDING','APPROVED','REJECTED'].includes(row.status)||status!=='ALL'&&row.status!==status)return false;
  seen.add(row.counterparty_change_id);
  if(row.change_type==='CREATE'){
   if(row.before_state!==null||row.expected_member_revision!==0||row.desired_state.active!==true)return false;
  }else if(!state(row.before_state,true)||row.before_state.revision!==row.expected_member_revision)return false;
  if(row.status==='PENDING'){
   if(row.revision!==0||row.reviewed_by!==null||row.review_reason!==null||row.reviewed_at!==null)return false;
  }else if(row.revision!==1||!text(row.reviewed_by)||row.reviewed_by===row.proposed_by||!text(row.review_reason,2000,8)||!timestamp(row.reviewed_at)||Date.parse(row.reviewed_at)<Date.parse(row.created_at))return false;
 }
 return v.next_change_id===null||v.rows.length===limit&&v.next_change_id===v.rows.at(-1)?.counterparty_change_id;
}
