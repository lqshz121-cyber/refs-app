import {detectCwipPostCompletionFindings} from './ai-cwip-post-completion-review.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAiCwipPostCompletionReviewService({postedCwipReader}={}){
  if(typeof postedCwipReader!=='function')throw new TypeError('AI post-completion CWIP service requires one read-only posted-ledger evidence reader.');
  return Object.freeze({
    async analyze({tenantId,entityId,accountingPeriodId,limit=500}={}){
      if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Object.assign(new Error('AI post-completion CWIP service scope is invalid.'),{code:'AI_CWIP_POST_COMPLETION_SCOPE_INVALID'});
      const rows=await postedCwipReader({tenantId,entityId,accountingPeriodId,limit});
      if(!Array.isArray(rows))throw Object.assign(new Error('AI post-completion CWIP reader returned an invalid population.'),{code:'AI_CWIP_POST_COMPLETION_SOURCE_INVALID'});
      if(rows.length===limit)throw Object.assign(new Error('AI post-completion CWIP population may be truncated at the bounded read limit.'),{code:'AI_CWIP_POST_COMPLETION_POPULATION_INCOMPLETE'});
      return detectCwipPostCompletionFindings(rows,{entityId,currentAccountingPeriodId:accountingPeriodId});
    }
  });
}
