import {reviewInvoiceSourceSupport} from './ai-invoice-source-support-review.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAiInvoiceSourceSupportReviewService({sourceSupportReader}={}){
  if(typeof sourceSupportReader!=='function')throw new Error('AI_INVOICE_SOURCE_SUPPORT_READER_REQUIRED');
  return Object.freeze({
    async analyze({tenantId,entityId,accountingPeriodId,limit=1000}){
      if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error('AI_INVOICE_SOURCE_SUPPORT_REQUEST_INVALID');
      const rows=await sourceSupportReader({tenantId,entityId,accountingPeriodId,limit});
      if(!Array.isArray(rows)||rows.length>=limit)throw new Error('AI_INVOICE_SOURCE_SUPPORT_POPULATION_INCOMPLETE');
      return reviewInvoiceSourceSupport(rows,{entityId,accountingPeriodId});
    }
  });
}
