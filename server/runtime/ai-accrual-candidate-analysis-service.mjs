// Read-only composition of the retained-source adapter and deterministic
// candidate rule.  Persistence, assignment, JE generation, model prompting,
// review and posting remain outside this service.

import {AiAccrualCandidateError,evaluateAiAccrualCandidate} from './ai-accrual-candidate-evaluator.mjs';
import {adaptRetainedWbsPayableForAiAccrual,classifyRetainedWbsPayableForAiAccrual} from './ai-accrual-retained-source-adapter.mjs';

const text=value=>typeof value==='string'?value.trim():'';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERIOD=/^\d{4}-\d{2}$/;
const scope=value=>value&&typeof value==='object'&&!Array.isArray(value)&&UUID.test(text(value.tenantId))&&UUID.test(text(value.entityId))&&UUID.test(text(value.currentPeriodId))&&/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(text(value.companyCode))&&PERIOD.test(text(value.currentPeriodKey))&&Number.isSafeInteger(value.currentPeriodOrdinal)&&value.currentPeriodOrdinal>=0;
const fail=(code,message)=>{throw new AiAccrualCandidateError(code,message);};

export function createAiAccrualCandidateAnalysisService({retainedHistoryReader,currentSourceReader,postedSourceReader}={}){
  if(typeof retainedHistoryReader!=='function'||typeof currentSourceReader!=='function'||typeof postedSourceReader!=='function')throw new AiAccrualCandidateError('ACCRUAL_ANALYSIS_READER_REQUIRED','Accrual analysis requires retained history, current-source, and posted-source readers.');
  return Object.freeze({async analyze(input={}){
    if(!scope(input))fail('ACCRUAL_SCOPE_INVALID','Accrual analysis requires authoritative tenant, entity, and current accounting-period scope.');
    const request=Object.freeze({tenantId:text(input.tenantId),entityId:text(input.entityId),companyCode:text(input.companyCode),currentPeriodId:text(input.currentPeriodId),currentPeriodKey:text(input.currentPeriodKey),currentPeriodOrdinal:input.currentPeriodOrdinal});
    const rawHistory=await retainedHistoryReader(request);
    if(!Array.isArray(rawHistory)||rawHistory.length>1000)fail('ACCRUAL_HISTORY_INVALID','Retained accrual history is unavailable or exceeds the bounded analysis limit.');
    // Explicitly-null accrual dimensions are a legal retained Payables shape,
    // not malformed evidence. Keep them out of this narrow AI analysis rather
    // than letting one non-accrual line reject a whole historical window.
    const classifications=rawHistory.map(row=>classifyRetainedWbsPayableForAiAccrual(row,{expectedEntityId:request.entityId,expectedCompanyCode:request.companyCode}));
    const eligibleHistory=rawHistory.filter((_,index)=>classifications[index]==='ELIGIBLE');
    const history=eligibleHistory.map(adaptRetainedWbsPayableForAiAccrual);
    const byObligation=new Map();
    for(const item of history){const items=byObligation.get(item.recurring_obligation_id)||[];items.push(item);byObligation.set(item.recurring_obligation_id,items);}
    const candidates=[];
    for(const [obligationId,evidence] of [...byObligation.entries()].sort(([a],[b])=>a.localeCompare(b))){
      const sourceIds=await currentSourceReader({...request,recurringObligationId:obligationId});
      const postedIds=await postedSourceReader({...request,recurringObligationId:obligationId});
      const result=evaluateAiAccrualCandidate({...request,priorEvidence:evidence,currentPeriodSourceDocumentIds:sourceIds,postedCurrentSourceDocumentIds:postedIds});
      if(result.status==='ACCRUAL_CANDIDATE_REVIEW_REQUIRED')candidates.push(result);
    }
    return Object.freeze({status:'AI_ACCRUAL_ANALYSIS_COMPLETE',entity_id:request.entityId,accounting_period_id:request.currentPeriodId,excluded_explicit_non_accrual_evidence_count:rawHistory.length-eligibleHistory.length,candidates:Object.freeze(candidates),can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  }});
}
