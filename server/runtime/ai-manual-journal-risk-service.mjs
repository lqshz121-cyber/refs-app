import {detectManualJournalRisks} from './ai-manual-journal-risk.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAiManualJournalRiskService({journalReader,policyReader,materializeWriter=null}={}){
  if(typeof journalReader!=='function'||typeof policyReader!=='function')throw new Error('Manual Journal risk service requires authoritative Journal and approved policy readers');
  const analyze=async({tenantId,entityId,currentAccountingPeriodId,limit=500})=>{
    if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(currentAccountingPeriodId||'')||!Number.isInteger(limit)||limit<1||limit>500)throw Object.assign(new Error('Manual Journal risk service scope is invalid'),{code:'AI_MANUAL_JOURNAL_SCOPE_INVALID'});
    const [journals,policy]=await Promise.all([journalReader({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId,limit}),policyReader({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId})]);
    return detectManualJournalRisks(journals,{policy,currentAccountingPeriodId});
  };
  return Object.freeze({analyze,async analyzeAndMaterialize({tenantId,entityId,currentAccountingPeriodId,limit=500,idempotencyKey}){
    if(typeof materializeWriter!=='function')throw Object.assign(new Error('Manual Journal risk persistence is unavailable'),{code:'AI_MANUAL_JOURNAL_PERSISTENCE_UNAVAILABLE'});
    if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)throw Object.assign(new Error('Manual Journal risk materialization requires a stable idempotency key'),{code:'AI_MANUAL_JOURNAL_IDEMPOTENCY_INVALID'});
    const batch=await analyze({tenantId,entityId,currentAccountingPeriodId,limit});
    return materializeWriter({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId,batch,idempotencyKey});
  }});
}
