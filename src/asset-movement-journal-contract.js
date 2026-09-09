const money=/^(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$/;
const units=value=>BigInt(value.replace('.',''));
// The journal detail API serializes node-pg timestamps as Date ISO strings (millisecond precision).
const samePostedInstant=(left,right)=>typeof left==='string'&&typeof right==='string'&&Number.isFinite(Date.parse(left))&&Date.parse(left)===Date.parse(right);

export function matchesAssetMovementJournal(journal,row){
 if(!journal||journal.status!=='POSTED'||journal.journal_type!==row.journal_type||!samePostedInstant(journal.posted_at,row.posted_at)||journal.currency!==row.currency||journal.journal_entry_id!==row.journal_entry_id||journal.journal_number!==row.journal_number||journal.journal_date!==row.journal_date||!Array.isArray(journal.lines)||journal.lines.length!==row.journal_ledger_line_count)return false;
 let debit=0n,credit=0n;
 for(const line of journal.lines){
  if(typeof line.debit_amount!=='string'||!money.test(line.debit_amount)||typeof line.credit_amount!=='string'||!money.test(line.credit_amount))return false;
  const d=units(line.debit_amount),c=units(line.credit_amount);if((d===0n)===(c===0n))return false;
  debit+=d;credit+=c;
 }
 if(debit!==units(row.journal_total_debit)||credit!==units(row.journal_total_credit))return false;
 const line=journal.lines.find(item=>item.journal_line_id===row.journal_line_id);
 return Boolean(line&&line.ledger_line_id===row.ledger_line_id&&line.account_code===row.account_code&&line.debit_amount===row.debit_amount&&line.credit_amount===row.credit_amount&&line.dimensions?.fixed_asset_register_evidence_id===row.fixed_asset_register_evidence_id&&(row.source_document_id===null||line.source_document_ids?.includes(row.source_document_id)));
}
