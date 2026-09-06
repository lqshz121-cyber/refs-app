const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const revision=v=>typeof v==='string'&&/^(0|[1-9]\d{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const text=(v,max)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const money=v=>typeof v==='string'&&/^(0|[1-9]\d{0,15})\.\d{4}$/.test(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export const validBusinessRecordKind=kind=>['AP_BILL','AR_INVOICE','AP_VENDOR_CREDIT','AR_CREDIT_MEMO'].includes(kind);
export function validBusinessRecord(v,{entityId,recordId,recordKind}){
  if(!validBusinessRecordKind(recordKind)||!exact(v,['schema_version','entity_id','record'])||v.schema_version!=='BUSINESS_RECORD_DETAIL_V1'||v.entity_id!==entityId)return false;
  const r=v.record,document=['AP_BILL','AR_INVOICE'].includes(recordKind);
  if(!exact(r,['record_id','record_kind','number','counterparty_ref','counterparty_name','currency','accounting_date','due_date','amount','open_balance','status','revision','description','source_document_id','journal_entry_id','journal_number','journal_status','journal_revision','period_id','created_at'])||r.record_id!==recordId||r.record_kind!==recordKind||!uuid(r.record_id)||!money(r.amount)||!/[1-9]/.test(r.amount)||!revision(r.revision)||typeof r.currency!=='string'||!/^[A-Z]{3}$/.test(r.currency)||!date(r.accounting_date)||r.due_date!==null&&!date(r.due_date)||r.source_document_id!==null&&!uuid(r.source_document_id)||r.description!==null&&(typeof r.description!=='string'||r.description.length>2000))return false;
  if(document){if(!text(r.number,128)||!text(r.counterparty_ref,128)||!text(r.counterparty_name,255)||!money(r.open_balance)||!['DRAFT','PENDING_POST','APPROVED','OPEN','PARTIALLY_PAID','PAID','VOID','REVERSED'].includes(r.status))return false;}
  else if(r.number!==null&&!text(r.number,128)||r.counterparty_ref!==null&&!text(r.counterparty_ref,128)||r.counterparty_name!==null||r.open_balance!==null||r.due_date!==null||r.source_document_id!==null||!uuid(r.period_id)||!['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED_PENDING_POST','POSTED','REJECTED','CANCELLED'].includes(r.status))return false;
  if(r.journal_entry_id===null){if([r.journal_number,r.journal_status,r.journal_revision].some(v=>v!==null)||document&&r.period_id!==null||!document&&r.status==='POSTED')return false;}
  else if(!uuid(r.journal_entry_id)||!uuid(r.period_id)||!text(r.journal_number,128)||!revision(r.journal_revision)||!['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED'].includes(r.journal_status)||!document&&r.status==='POSTED'&&r.journal_status!=='POSTED')return false;
  return typeof r.created_at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(r.created_at)&&Number.isFinite(Date.parse(r.created_at))&&new Date(r.created_at).toISOString().slice(0,19)===r.created_at.slice(0,19);
}
