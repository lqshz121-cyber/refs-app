const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const revision=value=>typeof value==='string'&&/^(0|[1-9]\d{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const optionalUuid=value=>value===null||uuid(value);
const optionalRevision=value=>value===null||revision(value);
const optionalText=value=>value===null||typeof value==='string'&&value.trim().length>0;
const rowKeys=['payment_occurrence_id','payment_revision','business_document_id','bill_number','vendor_ref','vendor_name','bill_status','bill_revision','amount','currency','accounting_date','payment_status','created_at','source_document_id','journal_entry_id','journal_number','journal_status','journal_revision','journal_line_id','ledger_line_id','bank_match_id','bank_match_status','bank_match_revision','draft_audit_event_id','posted_audit_event_id'];
const pageKeys=['schema_version','entity_id','period_id','period_code','after_id','limit','rows','next_id','action_flags'];
const flagKeys=['can_initiate_payment','can_approve','can_void','can_release'];
export const validBillPaymentRegisterSelection=({periodId,afterId=null,limit=50})=>uuid(periodId)&&(afterId===null||uuid(afterId))&&Number.isInteger(limit)&&limit>=1&&limit<=100;
export function validBillPaymentRegister(value,{entityId,periodId,afterId=null,limit=50}){
  if(!validBillPaymentRegisterSelection({periodId,afterId,limit})||!exact(value,pageKeys)||value.schema_version!=='BILL_PAYMENT_REGISTER_V1'||value.entity_id!==entityId||value.period_id!==periodId||typeof value.period_code!=='string'||!value.period_code.trim()||value.after_id!==afterId||value.limit!==limit||!Array.isArray(value.rows)||value.rows.length>limit||!exact(value.action_flags,flagKeys)||flagKeys.some(key=>value.action_flags[key]!==false))return false;
  let previous=null;const seen=new Set(afterId?[afterId]:[]);
  for(const row of value.rows){
    if(!exact(row,rowKeys)||!uuid(row.payment_occurrence_id)||seen.has(row.payment_occurrence_id)||!revision(row.payment_revision)||!uuid(row.business_document_id)||![row.bill_number,row.vendor_ref,row.vendor_name].every(v=>typeof v==='string'&&v.trim())||!['DRAFT','PENDING_POST','APPROVED','OPEN','PARTIALLY_PAID','PAID','VOID','REVERSED'].includes(row.bill_status)||!revision(row.bill_revision)||typeof row.amount!=='string'||!/^(0|[1-9]\d{0,15})\.\d{4}$/.test(row.amount)||!/[1-9]/.test(row.amount)||typeof row.currency!=='string'||!/^[A-Z]{3}$/.test(row.currency)||!date(row.accounting_date)||!['DRAFT','PENDING_POST','POSTED','REVERSAL_PENDING','REVERSED'].includes(row.payment_status)||typeof row.created_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row.created_at)||!Number.isFinite(Date.parse(row.created_at)))return false;
    if(![row.source_document_id,row.journal_entry_id,row.journal_line_id,row.ledger_line_id,row.bank_match_id,row.draft_audit_event_id,row.posted_audit_event_id].every(optionalUuid)||!optionalText(row.journal_number)||!optionalText(row.journal_status)||!optionalRevision(row.journal_revision)||!optionalText(row.bank_match_status)||!optionalRevision(row.bank_match_revision))return false;
    const journalLinked=row.journal_entry_id!==null;
    if(journalLinked!==[row.journal_number,row.journal_status,row.journal_revision].every(v=>v!==null)||row.journal_status!==null&&!['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED'].includes(row.journal_status))return false;
    const bankLinked=row.bank_match_id!==null;
    if(bankLinked!==[row.journal_line_id,row.ledger_line_id,row.bank_match_status,row.bank_match_revision].every(v=>v!==null)||row.bank_match_status!==null&&row.bank_match_status!=='ACTIVE')return false;
    if(row.payment_status==='POSTED'&&row.posted_audit_event_id===null)return false;
    const order=row.created_at+'|'+row.payment_occurrence_id;if(previous!==null&&order>=previous)return false;previous=order;seen.add(row.payment_occurrence_id);
  }
  return value.next_id===null||value.rows.length===limit&&value.next_id===value.rows.at(-1).payment_occurrence_id;
}
