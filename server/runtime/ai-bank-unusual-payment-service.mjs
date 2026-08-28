import {detectUnusualBankPayments} from './ai-bank-unusual-payment.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAiBankUnusualPaymentService({sourceReader,policyReader}={}){
  if(typeof sourceReader!=='function'||typeof policyReader!=='function')throw new Error('Unusual bank-payment service requires authoritative signed bank and approved policy readers');
  return Object.freeze({
    async analyze({tenantId,entityId,currentAccountingPeriodId,limit=500}){
      if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(currentAccountingPeriodId||'')||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Object.assign(new Error('Unusual bank-payment service scope is invalid'),{code:'AI_BANK_UNUSUAL_PAYMENT_SCOPE_INVALID'});
      const [rows,policy]=await Promise.all([sourceReader({tenantId,entityId,currentAccountingPeriodId,limit}),policyReader({tenantId,entityId,currentAccountingPeriodId})]);
      if(!Array.isArray(rows)||rows.length>=limit)throw Object.assign(new Error('The bounded bank-payment source read cannot prove population completeness.'),{code:'AI_BANK_UNUSUAL_PAYMENT_POPULATION_INCOMPLETE'});
      return detectUnusualBankPayments(rows,{entityId,currentAccountingPeriodId,policy,limit});
    },
  });
}
