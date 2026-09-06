import {readSalesReceipt} from './sales-receipt-api.js';
export async function readSalesReceiptForWorkflow({config,record,fetcher=globalThis.fetch}={}){
 if(record?.period_id!==config?.periodId||record?.status!=='DRAFT'||record?.journal_status!=='DRAFT')return {ok:false,message:'This receipt is no longer a draft. Refresh its details.'};
 const result=await readSalesReceipt({config,receiptId:record.sales_receipt_id,fetcher});if(!result.ok)return result;
 const current=result.data.record;
 if(current.period_id!==record.period_id||current.status!=='DRAFT'||current.journal_status!=='DRAFT'||current.revision!==record.revision||current.journal_entry_id!==record.journal_entry_id||current.journal_revision!==record.journal_revision)return {ok:false,message:'This receipt or journal changed. Refresh its details before opening the draft workflow.'};
 return {ok:true,record:current};
}
