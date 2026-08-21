import {detectBankPayeeVendorMismatches} from './ai-bank-payee-vendor-mismatch.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAiBankPayeeVendorMismatchService({matchedPaymentReader,policyReader}={}){
  if(typeof matchedPaymentReader!=='function'||typeof policyReader!=='function')throw new TypeError('AI bank payee/vendor service requires read-only evidence and policy readers.');
  return Object.freeze({
    async analyze({tenantId,entityId,accountingPeriodId,limit=500}={}){
      if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Object.assign(new Error('AI bank payee/vendor service scope is invalid.'),{code:'AI_BANK_PAYEE_VENDOR_SCOPE_INVALID'});
      const [rows,policy]=await Promise.all([matchedPaymentReader({tenantId,entityId,accountingPeriodId,limit}),policyReader({tenantId,entityId,accountingPeriodId})]);
      return detectBankPayeeVendorMismatches(rows,{policy,currentAccountingPeriodId:accountingPeriodId});
    }
  });
}
