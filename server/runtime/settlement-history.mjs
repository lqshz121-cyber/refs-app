const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const revision=v=>typeof v==='string'&&/^(0|[1-9]\d{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export const validSettlementHistorySelection=({settlementKind,afterId=null,limit=50})=>['AP_PAYMENT','AR_RECEIPT'].includes(settlementKind)&&(afterId===null||uuid(afterId))&&Number.isInteger(limit)&&limit>=1&&limit<=100;
export function validSettlementHistory(value,{entityId,businessDocumentId,settlementKind,afterId=null,limit=50}){
  if(!validSettlementHistorySelection({settlementKind,afterId,limit})||!exact(value,['schema_version','entity_id','business_document_id','settlement_kind','after_id','limit','rows','next_id'])||value.schema_version!=='DOCUMENT_SETTLEMENT_HISTORY_V1'||value.entity_id!==entityId||value.business_document_id!==businessDocumentId||value.settlement_kind!==settlementKind||value.after_id!==afterId||value.limit!==limit||!Array.isArray(value.rows)||value.rows.length>limit)return false;
  let previous=null;const ids=new Set(afterId?[afterId]:[]);
  for(const row of value.rows){
    if(!exact(row,['payment_occurrence_id','business_document_id','settlement_kind','amount','currency','accounting_date','period_id','period_code','status','revision','created_at','draft_journal_entry_id','posted_journal_entry_id','journal_number','journal_status','journal_revision'])||!uuid(row.payment_occurrence_id)||ids.has(row.payment_occurrence_id)||row.business_document_id!==businessDocumentId||row.settlement_kind!==settlementKind||typeof row.amount!=='string'||!/^(0|[1-9]\d{0,15})\.\d{4}$/.test(row.amount)||!/[1-9]/.test(row.amount)||typeof row.currency!=='string'||!/^[A-Z]{3}$/.test(row.currency)||!date(row.accounting_date)||!uuid(row.period_id)||row.period_code!==row.accounting_date.slice(0,7)||!['DRAFT','PENDING_POST','POSTED','REVERSAL_PENDING','REVERSED'].includes(row.status)||!revision(row.revision)||typeof row.created_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row.created_at)||!Number.isFinite(Date.parse(row.created_at))||new Date(row.created_at).toISOString().slice(0,19)!==row.created_at.slice(0,19))return false;
    if(![row.draft_journal_entry_id,row.posted_journal_entry_id].every(v=>v===null||uuid(v)))return false;
    const linked=row.posted_journal_entry_id!==null||row.draft_journal_entry_id!==null;
    if(linked?typeof row.journal_number!=='string'||!row.journal_number.trim()||!['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED'].includes(row.journal_status)||!revision(row.journal_revision):row.journal_number!==null||row.journal_status!==null||row.journal_revision!==null)return false;
    const order=row.created_at+'|'+row.payment_occurrence_id;if(previous!==null&&order>=previous)return false;previous=order;ids.add(row.payment_occurrence_id);
  }
  return value.next_id===null||value.rows.length===limit&&value.next_id===value.rows.at(-1).payment_occurrence_id;
}
