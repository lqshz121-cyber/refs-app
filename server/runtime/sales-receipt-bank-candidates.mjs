const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
const revision=v=>typeof v==='string'&&/^(0|[1-9]\d{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const money=v=>typeof v==='string'&&/^(0|[1-9]\d{0,15})\.\d{4}$/.test(v)&&BigInt(v.replace('.',''))>0n;
const fields=['sales_receipt_id','receipt_revision','receipt_number','period_id','customer_ref','customer_name','bank_member_ref','cash_account_code','accounting_date','currency','amount','journal_entry_id','journal_revision','journal_line_id','ledger_line_id','date_delta_days'];
export function validSalesReceiptBankCandidates(v,{entityId,bankSourceId,afterId=null,limit=50}){
 if(!uuid(entityId)||!uuid(bankSourceId)||afterId!==null&&!uuid(afterId)||!Number.isInteger(limit)||limit<1||limit>100||!exact(v,['schema_version','entity_id','bank_source_id','bank_revision','after_id','limit','rows','next_id'])||v.schema_version!=='SALES_RECEIPT_BANK_CANDIDATES_V1'||v.entity_id!==entityId||v.bank_source_id!==bankSourceId||!revision(v.bank_revision)||v.after_id!==afterId||v.limit!==limit||!Array.isArray(v.rows)||v.rows.length>limit)return false;
 let previous=afterId;const journals=new Set(),ledgers=new Set();
 for(const row of v.rows){
  if(!exact(row,fields)||!['sales_receipt_id','period_id','journal_entry_id','journal_line_id','ledger_line_id'].every(k=>uuid(row[k]))||!revision(row.receipt_revision)||!revision(row.journal_revision)||!text(row.receipt_number,128)||!text(row.customer_ref,128)||!text(row.customer_name,Infinity)||!text(row.bank_member_ref,128)||!text(row.cash_account_code,64)||!date(row.accounting_date)||!/^[A-Z]{3}$/.test(row.currency)||!money(row.amount)||!Number.isInteger(row.date_delta_days)||Math.abs(row.date_delta_days)>31||previous!==null&&row.sales_receipt_id<=previous||journals.has(row.journal_entry_id)||ledgers.has(row.ledger_line_id))return false;
  previous=row.sales_receipt_id;journals.add(row.journal_entry_id);ledgers.add(row.ledger_line_id);
 }
 return v.next_id===null||v.rows.length===limit&&v.next_id===previous;
}
