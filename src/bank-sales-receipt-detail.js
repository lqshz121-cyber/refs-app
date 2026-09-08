import {parseBankMatchSource} from './bank-match-source.js';
import {readSalesReceipt} from './sales-receipt-api.js';
import {readBusinessRecordJournal} from './business-record-detail.js';
const fail=()=>({ok:false,message:'The sales receipt no longer matches this bank evidence. Refresh the bank record and reopen its source.'});
export async function readBankSalesReceipt({config,row,fetcher=globalThis.fetch}={}){
 if(parseBankMatchSource(row)?.match_source_kind!=='SALES_RECEIPT'||!['ACTIVE','UNMATCHED'].includes(row.match_status))return fail();
 const result=await readSalesReceipt({config,receiptId:row.sales_receipt_id,fetcher});if(!result.ok)return result;
 const record=result.data.record;
 if(record.revision!==row.sales_receipt_revision||record.receipt_number!==row.sales_receipt_number||record.journal_entry_id!==row.journal_entry_id||record.status!=='POSTED'||record.journal_status!=='POSTED'||record.bank_member_ref!==row.bank_account_ref||record.currency!==row.currency||record.amount!==row.amount)return fail();
 return {ok:true,record};
}
export async function readBankSalesReceiptJournal({config,row,fetcher=globalThis.fetch}={}){
 const receipt=await readBankSalesReceipt({config,row,fetcher});if(!receipt.ok)return receipt;
 const result=await readBusinessRecordJournal({config,record:receipt.record,fetcher});if(!result.ok)return result;
 const lines=result.journal.lines.filter(line=>line.journal_line_id===row.journal_line_id&&line.ledger_line_id===row.ledger_line_id);
 if(lines.length!==1||lines[0].account_code!==receipt.record.cash_account_code||lines[0].member_ref!==row.bank_account_ref||lines[0].debit_amount!==row.amount||lines[0].credit_amount!=='0.0000')return fail();
 return {...result,record:receipt.record};
}
