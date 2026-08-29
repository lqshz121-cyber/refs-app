import {detectManualJournalRisks} from './ai-manual-journal-risk.mjs';
import {safeAiEvidenceTree} from './ai-secret-safety.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const falseActions=value=>value&&value.can_create_draft===false&&value.can_review===false&&value.can_approve===false&&value.can_post===false;

export function createAiManualJournalRiskService({journalReader,policyReader,materializeWriter=null}={}){
  if(typeof journalReader!=='function'||typeof policyReader!=='function')throw new Error('Manual Journal risk service requires authoritative Journal and approved policy readers');
  const analyze=async({tenantId,entityId,currentAccountingPeriodId,limit=500})=>{
    if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(currentAccountingPeriodId||'')||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Object.assign(new Error('Manual Journal risk service scope is invalid'),{code:'AI_MANUAL_JOURNAL_SCOPE_INVALID'});
    const [journals,policy]=await Promise.all([journalReader({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId,limit}),policyReader({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId})]);
    if(!Array.isArray(journals)||!safeAiEvidenceTree(journals,{maxArrayLength:500})||!safeAiEvidenceTree(policy,{maxArrayLength:20})||journals.length>=limit)throw Object.assign(new Error('Manual Journal risk analysis cannot prove that the authoritative population is complete and safe.'),{code:'AI_MANUAL_JOURNAL_POPULATION_INCOMPLETE'});
    return detectManualJournalRisks(journals,{policy,entityId,currentAccountingPeriodId});
  };
  return Object.freeze({analyze,async analyzeAndMaterialize({tenantId,entityId,currentAccountingPeriodId,limit=500,idempotencyKey}){
    if(typeof materializeWriter!=='function')throw Object.assign(new Error('Manual Journal risk persistence is unavailable'),{code:'AI_MANUAL_JOURNAL_PERSISTENCE_UNAVAILABLE'});
    if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)throw Object.assign(new Error('Manual Journal risk materialization requires a stable idempotency key'),{code:'AI_MANUAL_JOURNAL_IDEMPOTENCY_INVALID'});
    const batch=await analyze({tenantId,entityId,currentAccountingPeriodId,limit});
    const receipt=await materializeWriter({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId,batch,idempotencyKey});
    if(!safeAiEvidenceTree(receipt,{maxArrayLength:100})||!falseActions(receipt))throw Object.assign(new Error('Manual Journal risk persistence returned unsafe or action-enabled evidence'),{code:'AI_MANUAL_JOURNAL_PERSISTENCE_INVALID'});
    return receipt;
  }});
}
