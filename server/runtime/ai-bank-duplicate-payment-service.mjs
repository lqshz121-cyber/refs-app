import {detectDuplicateBankPayments} from './ai-bank-duplicate-payment.mjs';
import {safeAiEvidenceTree} from './ai-secret-safety.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const falseActions=value=>value&&value.can_create_draft===false&&value.can_review===false&&value.can_approve===false&&value.can_post===false;

export function createAiBankDuplicatePaymentService({sourceReader,materializeWriter=null}={}){
  if(typeof sourceReader!=='function')throw new Error('Bank duplicate-payment service requires an authoritative signed bank source reader');
  const analyze=async({tenantId,entityId,currentAccountingPeriodId,limit=500})=>{
    if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(currentAccountingPeriodId||'')||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Object.assign(new Error('Bank duplicate-payment service scope is invalid'),{code:'AI_BANK_DUPLICATE_PAYMENT_SCOPE_INVALID'});
    const rows=await sourceReader({tenantId,entityId,currentAccountingPeriodId,limit});
    if(!Array.isArray(rows)||!safeAiEvidenceTree(rows,{maxArrayLength:500})||rows.length>=limit)throw Object.assign(new Error('Bank duplicate-payment analysis cannot prove that the authoritative population is complete and safe.'),{code:'AI_BANK_DUPLICATE_PAYMENT_POPULATION_INCOMPLETE'});
    return detectDuplicateBankPayments(rows,{entityId,currentAccountingPeriodId});
  };
  return Object.freeze({
    analyze,
    async analyzeAndMaterialize({tenantId,entityId,currentAccountingPeriodId,limit=500,idempotencyKey}){
      if(typeof materializeWriter!=='function')throw Object.assign(new Error('Bank duplicate-payment persistence is unavailable'),{code:'AI_BANK_DUPLICATE_PAYMENT_PERSISTENCE_UNAVAILABLE'});
      if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)throw Object.assign(new Error('Bank duplicate-payment materialization requires a stable idempotency key'),{code:'AI_BANK_DUPLICATE_PAYMENT_IDEMPOTENCY_INVALID'});
      const batch=await analyze({tenantId,entityId,currentAccountingPeriodId,limit});
      const receipt=await materializeWriter({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId,batch,idempotencyKey});
      if(!safeAiEvidenceTree(receipt,{maxArrayLength:500})||!falseActions(receipt))throw Object.assign(new Error('Bank duplicate-payment persistence returned unsafe or action-enabled evidence'),{code:'AI_BANK_DUPLICATE_PAYMENT_PERSISTENCE_INVALID'});
      return receipt;
    },
  });
}
