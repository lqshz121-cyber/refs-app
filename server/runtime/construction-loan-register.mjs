const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const money=value=>typeof value==='string'&&/^-?(0|[1-9]\d{0,15})\.\d{4}$/.test(value);
const ids=value=>Array.isArray(value)&&new Set(value).size===value.length&&value.every(uuid);
const rowKeys=['loan_ref','lender_ref','currency','account_code','account_name','opening_balance','period_draws','period_repayments','closing_balance','source_binding_status','mapping_snapshot_id','mapping_version','mapping_snapshot_hash','journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids','source_document_line_ids'];
const blockedKeys=['ledger_line_id','journal_entry_id','journal_line_id','journal_number','journal_date','currency','account_code','debit_amount','credit_amount','source_binding_status','source_document_ids','source_document_line_ids'];
const pageKeys=['schema_version','entity_id','period_id','period_code','period_start','period_end','rows','blocked_lines','exact_ledger_line_count','blocked_ledger_line_count','action_flags'];
const flagKeys=['can_create_loan','can_record_draw','can_record_repayment','can_post'];
const blockedStatuses=new Set(['BLOCKED_LEDGER_LINEAGE','BLOCKED_SOURCE_LINK_REQUIRED','BLOCKED_NON_LOAN_SOURCE','BLOCKED_LOAN_SOURCE_LINE_REQUIRED','BLOCKED_LOAN_REFERENCE_AMBIGUOUS','BLOCKED_LENDER_REFERENCE_AMBIGUOUS']);
export const validConstructionLoanRegisterSelection=({periodId})=>uuid(periodId);
export function validConstructionLoanRegister(value,{entityId,periodId}){
  if(!uuid(entityId)||!validConstructionLoanRegisterSelection({periodId})||!exact(value,pageKeys)||value.schema_version!=='CONSTRUCTION_LOAN_REGISTER_V1'||value.entity_id!==entityId||value.period_id!==periodId||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.period_code||'')||!date(value.period_start)||!date(value.period_end)||value.period_start>value.period_end||value.period_start.slice(0,7)!==value.period_code||value.period_end.slice(0,7)!==value.period_code||!Array.isArray(value.rows)||!Array.isArray(value.blocked_lines)||!Number.isInteger(value.exact_ledger_line_count)||value.exact_ledger_line_count<0||!Number.isInteger(value.blocked_ledger_line_count)||value.blocked_ledger_line_count<0||!exact(value.action_flags,flagKeys)||flagKeys.some(key=>value.action_flags[key]!==false))return false;
  const keys=new Set();let exactLines=0;
  for(const row of value.rows){
    if(!exact(row,rowKeys)||![row.loan_ref,row.lender_ref,row.account_code,row.account_name].every(item=>typeof item==='string'&&item.trim())||!/^[A-Z]{3}$/.test(row.currency||'')||!['opening_balance','period_draws','period_repayments','closing_balance'].every(field=>money(row[field]))||row.source_binding_status!=='EXACT_POSTED_LOAN_SOURCE'||!uuid(row.mapping_snapshot_id)||!/^[1-9]\d{0,18}$/.test(row.mapping_version||'')||!/^sha256:[0-9a-f]{64}$/.test(row.mapping_snapshot_hash||'')||!['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids','source_document_line_ids'].every(field=>ids(row[field])&&row[field].length>0)||row.journal_line_ids.length!==row.ledger_line_ids.length)return false;
    const key=[row.loan_ref,row.lender_ref,row.currency,row.account_code].join('|');if(keys.has(key))return false;keys.add(key);exactLines+=row.ledger_line_ids.length;
  }
  if(exactLines!==value.exact_ledger_line_count||value.blocked_lines.length!==value.blocked_ledger_line_count)return false;
  const blockedIds=new Set();
  for(const row of value.blocked_lines){
    if(!exact(row,blockedKeys)||![row.ledger_line_id,row.journal_entry_id,row.journal_line_id].every(uuid)||blockedIds.has(row.ledger_line_id)||typeof row.journal_number!=='string'||!row.journal_number.trim()||!date(row.journal_date)||!/^[A-Z]{3}$/.test(row.currency||'')||typeof row.account_code!=='string'||!row.account_code.trim()||!money(row.debit_amount)||!money(row.credit_amount)||!blockedStatuses.has(row.source_binding_status)||!ids(row.source_document_ids)||!ids(row.source_document_line_ids))return false;
    blockedIds.add(row.ledger_line_id);
  }
  return true;
}
