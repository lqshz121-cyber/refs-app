import {validCreditUsageContext} from './native-refund-contract.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const text=(v,min,max)=>typeof v==='string'&&v===v.trim()&&v.length>=min&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const money=v=>typeof v==='string'&&/^(0|[1-9]\d{0,39})\.\d{4}$/.test(v);
const units=v=>BigInt(v.replace('.',''));
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function validCreditTargetSelection({action,query='',afterId=null,limit=50}){
  return ['AP_CREDIT_APPLY','AR_CREDIT_APPLY'].includes(action)&&text(query,0,128)&&(afterId===null||uuid(afterId))&&Number.isInteger(limit)&&limit>=1&&limit<=100;
}
export function validCreditTargets(v,selection){
  const {query='',afterId=null,limit=50}=selection;
  if(!validCreditTargetSelection(selection)||!exact(v,['schema_version','context','query','after_id','limit','rows','next_id'])
    ||v.schema_version!=='CREDIT_ALLOCATION_TARGETS_V1'||!validCreditUsageContext(v.context,selection)
    ||v.query!==query||v.after_id!==afterId||v.limit!==limit||!Array.isArray(v.rows)||v.rows.length>limit)return false;
  let previous=afterId;
  for(const r of v.rows){
    if(!exact(r,['business_document_id','document_number','counterparty_ref','currency','accounting_date','due_date','gross_amount','open_balance','pending_amount','available_amount','revision','status','period_id','journal_entry_id'])
      ||!uuid(r.business_document_id)||previous!==null&&r.business_document_id<=previous||!uuid(r.period_id)||!uuid(r.journal_entry_id)
      ||!text(r.document_number,1,128)||r.counterparty_ref!==v.context.credit.counterparty_ref||r.currency!==v.context.credit.currency
      ||!date(r.accounting_date)||r.due_date!==null&&!date(r.due_date)||!['APPROVED','OPEN','PARTIALLY_PAID'].includes(r.status)
      ||typeof r.revision!=='string'||!/^(0|[1-9]\d{0,18})$/.test(r.revision)||BigInt(r.revision)>9223372036854775807n
      ||![r.gross_amount,r.open_balance,r.pending_amount,r.available_amount].every(money))return false;
    if(units(r.gross_amount)<units(r.open_balance)||units(r.available_amount)<=0n||units(r.open_balance)-units(r.pending_amount)!==units(r.available_amount))return false;
    previous=r.business_document_id;
  }
  return v.next_id===null||v.rows.length===limit&&uuid(v.next_id)&&v.next_id===previous;
}
