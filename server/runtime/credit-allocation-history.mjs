const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const revision=v=>typeof v==='string'&&/^(0|[1-9]\d{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const text=v=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=128&&!/[\u0000-\u001f\u007f]/.test(v);
export const validCreditHistorySelection=({subjectKind,afterId=null,limit=50})=>['AP_VENDOR_CREDIT','AR_CREDIT_MEMO','AP_BILL','AR_INVOICE'].includes(subjectKind)&&(afterId===null||uuid(afterId))&&Number.isInteger(limit)&&limit>=1&&limit<=100;
export function validCreditHistory(v,{entityId,subjectId,subjectKind,afterId=null,limit=50}){
  if(!validCreditHistorySelection({subjectKind,afterId,limit})||!exact(v,['schema_version','entity_id','subject_id','subject_kind','after_id','limit','rows','next_id'])||v.schema_version!=='CREDIT_ALLOCATION_HISTORY_V1'||v.entity_id!==entityId||v.subject_id!==subjectId||v.subject_kind!==subjectKind||v.after_id!==afterId||v.limit!==limit||!Array.isArray(v.rows)||v.rows.length>limit)return false;
  const creditKind=['AP_VENDOR_CREDIT','AP_BILL'].includes(subjectKind)?'AP_VENDOR_CREDIT':'AR_CREDIT_MEMO';
  const credit=subjectKind===creditKind,ids=new Set(afterId?[afterId]:[]);let previous=null;
  for(const r of v.rows){
    if(!exact(r,['business_allocation_id','business_adjustment_id','adjustment_kind','credit_number','business_document_id','document_number','amount','currency','status','revision','created_at','reversed_by_allocation_id','journal_entry_id','journal_number','journal_status','journal_revision','journal_period_id'])
      ||![r.business_allocation_id,r.business_adjustment_id,r.business_document_id].every(uuid)||ids.has(r.business_allocation_id)
      ||r.adjustment_kind!==creditKind||(credit?r.business_adjustment_id:r.business_document_id)!==subjectId
      ||r.credit_number!==null&&!text(r.credit_number)||!text(r.document_number)||typeof r.amount!=='string'||!/^(0|[1-9]\d{0,15})\.\d{4}$/.test(r.amount)||!/[1-9]/.test(r.amount)
      ||typeof r.currency!=='string'||!/^[A-Z]{3}$/.test(r.currency)||!['PENDING','ACTIVE','REVERSED'].includes(r.status)||!revision(r.revision)
      ||r.reversed_by_allocation_id!==null&&!uuid(r.reversed_by_allocation_id)
      ||typeof r.created_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(r.created_at)||!Number.isFinite(Date.parse(r.created_at))||new Date(r.created_at).toISOString().slice(0,19)!==r.created_at.slice(0,19))return false;
    if(r.status==='PENDING'){
      if([r.journal_entry_id,r.journal_number,r.journal_status,r.journal_revision,r.journal_period_id].some(v=>v!==null))return false;
    }else if(!uuid(r.journal_entry_id)||!uuid(r.journal_period_id)||!text(r.journal_number)||r.journal_status!=='POSTED'||!revision(r.journal_revision))return false;
    const order=r.created_at+'|'+r.business_allocation_id;if(previous!==null&&order>=previous)return false;previous=order;ids.add(r.business_allocation_id);
  }
  return v.next_id===null||v.rows.length===limit&&v.next_id===v.rows.at(-1).business_allocation_id;
}
