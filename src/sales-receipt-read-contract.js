const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const revision=v=>typeof v==='string'&&/^(0|[1-9]\d{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const text=(v,max)=>typeof v==='string'&&v===v.trim()&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
export const validSalesReceiptSelection=({periodId,afterId=null,limit=50})=>uuid(periodId)&&(afterId===null||uuid(afterId))&&Number.isInteger(limit)&&limit>=1&&limit<=100;
export function validSalesReceiptRecord(r){
  return exact(r,['sales_receipt_id','period_id','receipt_number','customer_ref','customer_name','bank_member_ref','cash_account_code','category_account_code','accounting_date','currency','amount','description','status','revision','journal_entry_id','journal_number','journal_status','journal_revision','created_at','posted_at'])
    &&uuid(r.sales_receipt_id)&&uuid(r.period_id)&&uuid(r.journal_entry_id)
    &&['receipt_number','customer_ref','bank_member_ref','journal_number'].every(k=>text(r[k],128))
    &&text(r.customer_name,Infinity)&&text(r.cash_account_code,64)&&text(r.category_account_code,64)&&r.cash_account_code!==r.category_account_code
    &&date(r.accounting_date)&&typeof r.currency==='string'&&/^[A-Z]{3}$/.test(r.currency)
    &&typeof r.amount==='string'&&/^(0|[1-9]\d{0,15})\.\d{4}$/.test(r.amount)&&/[1-9]/.test(r.amount)
    &&text(r.description,2000)&&r.description.length>=8&&revision(r.revision)&&revision(r.journal_revision)
    &&['DRAFT','POSTED'].includes(r.status)&&['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED'].includes(r.journal_status)
    &&(r.status==='POSTED')===(r.journal_status==='POSTED')&&timestamp(r.created_at)
    &&(r.status==='POSTED'?timestamp(r.posted_at):r.posted_at===null);
}
export const validSalesReceiptDetail=(v,{entityId,receiptId})=>exact(v,['schema_version','entity_id','record'])&&v.schema_version==='SALES_RECEIPT_DETAIL_V1'&&v.entity_id===entityId&&validSalesReceiptRecord(v.record)&&v.record.sales_receipt_id===receiptId;
export function validSalesReceiptPage(v,{entityId,periodId,afterId=null,limit=50}){
  if(!validSalesReceiptSelection({periodId,afterId,limit})||!exact(v,['schema_version','entity_id','period_id','after_id','limit','rows','next_id'])||v.schema_version!=='SALES_RECEIPT_PAGE_V1'||v.entity_id!==entityId||v.period_id!==periodId||v.after_id!==afterId||v.limit!==limit||!Array.isArray(v.rows)||v.rows.length>limit)return false;
  let previous=afterId;
  for(const r of v.rows){if(!validSalesReceiptRecord(r)||r.period_id!==periodId||previous!==null&&r.sales_receipt_id<=previous)return false;previous=r.sales_receipt_id;}
  return v.next_id===null||v.rows.length===limit&&uuid(v.next_id)&&v.next_id===previous;
}
