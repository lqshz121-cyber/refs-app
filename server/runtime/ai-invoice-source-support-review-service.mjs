import {reviewInvoiceSourceSupport} from './ai-invoice-source-support-review.mjs';

export function createAiInvoiceSourceSupportReviewService({sourceSupportReader}={}){
  if(typeof sourceSupportReader!=='function')throw new Error('AI_INVOICE_SOURCE_SUPPORT_READER_REQUIRED');
  return Object.freeze({
    async analyze({tenantId,entityId,accountingPeriodId,limit=1000}){
      if(!tenantId||!entityId||!accountingPeriodId||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error('AI_INVOICE_SOURCE_SUPPORT_REQUEST_INVALID');
      const rows=await sourceSupportReader({tenantId,entityId,accountingPeriodId,limit});
      return reviewInvoiceSourceSupport(rows,{entityId,accountingPeriodId});
    }
  });
}
