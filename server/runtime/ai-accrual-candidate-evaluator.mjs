// This deterministic gate intentionally produces a review candidate only. It
// has no repository, model, journal, or command dependency: callers must
// persist any future finding through a separately authorized transaction.

const text=value=>typeof value==='string'?value.trim():'';
const HASH=/^sha256:[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERIOD=/^\d{4}-\d{2}$/;
const freeze=value=>Object.freeze(value);

export class AiAccrualCandidateError extends Error {constructor(code,message){super(message);this.code=code;}}

const requiredEvidence=Object.freeze(['service_period_start','service_period_end','recurring_obligation_id','service_frequency','obligation_status','source_document_id','source_document_line_id','source_payload_hash','source_line_hash','entity_id','accounting_period_id','currency','amount']);

const validIsoDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value));
const validAmount=value=>typeof value==='string'&&/^-?\d+(?:\.\d{1,2})?$/.test(value)&&Number(value)>0;
const validEvidence=value=>value&&typeof value==='object'&&!Array.isArray(value)&&
  validIsoDate(value.service_period_start)&&validIsoDate(value.service_period_end)&&text(value.service_period_start)<=text(value.service_period_end)&&
  text(value.recurring_obligation_id).length>0&&text(value.recurring_obligation_id).length<=128&&
  text(value.service_frequency).length>0&&text(value.service_frequency).length<=32&&
  text(value.obligation_status).length>0&&text(value.obligation_status).length<=32&&
  UUID.test(text(value.source_document_id))&&UUID.test(text(value.source_document_line_id))&&
  HASH.test(text(value.source_payload_hash))&&HASH.test(text(value.source_line_hash))&&
  UUID.test(text(value.entity_id))&&UUID.test(text(value.accounting_period_id))&&
  /^[A-Z]{3}$/.test(text(value.currency))&&validAmount(value.amount)&&
  PERIOD.test(text(value.period_key))&&Number.isSafeInteger(value.period_ordinal)&&value.period_ordinal>=0&&value.closed===true;

const publicTrace=value=>freeze({
  source_document_id:text(value.source_document_id),source_document_line_id:text(value.source_document_line_id),
  source_payload_hash:text(value.source_payload_hash),source_line_hash:text(value.source_line_hash),
  accounting_period_id:text(value.accounting_period_id),period_key:text(value.period_key),
  service_period_start:text(value.service_period_start),service_period_end:text(value.service_period_end),
  recurring_obligation_id:text(value.recurring_obligation_id),service_frequency:text(value.service_frequency),
  obligation_status:text(value.obligation_status),currency:text(value.currency),amount:value.amount
});

const noCandidate=(reason,trace=[])=>freeze({status:'NO_ACCRUAL_CANDIDATE',reason,prior_source_trace:freeze(trace),can_create_draft:false,can_review:false,can_approve:false,can_post:false});

export function evaluateAiAccrualCandidate({entityId,currentPeriodId,currentPeriodKey,currentPeriodOrdinal,priorEvidence,currentPeriodSourceDocumentIds=[],postedCurrentSourceDocumentIds=[]}={}){
  if(!UUID.test(text(entityId))||!UUID.test(text(currentPeriodId))||!PERIOD.test(text(currentPeriodKey))||!Number.isSafeInteger(currentPeriodOrdinal)||currentPeriodOrdinal<0)throw new AiAccrualCandidateError('ACCRUAL_SCOPE_INVALID','Accrual candidate evaluation requires authoritative entity and current accounting-period scope');
  if(!Array.isArray(priorEvidence)||priorEvidence.length<3)throw new AiAccrualCandidateError('ACCRUAL_HISTORY_INSUFFICIENT','Accrual candidate evaluation requires at least three retained closed-period records');
  if(!Array.isArray(currentPeriodSourceDocumentIds)||!Array.isArray(postedCurrentSourceDocumentIds))throw new AiAccrualCandidateError('ACCRUAL_CURRENT_PERIOD_INVALID','Accrual candidate evaluation requires current source and posted-source observations');
  if(currentPeriodSourceDocumentIds.some(id=>!UUID.test(text(id)))||postedCurrentSourceDocumentIds.some(id=>!UUID.test(text(id))))throw new AiAccrualCandidateError('ACCRUAL_CURRENT_PERIOD_INVALID','Current source observations must contain only retained source-document identities');
  if(priorEvidence.some(item=>!validEvidence(item)))throw new AiAccrualCandidateError('ACCRUAL_EVIDENCE_INVALID','Accrual history has incomplete or untraceable retained evidence');
  const ordered=[...priorEvidence].sort((a,b)=>b.period_ordinal-a.period_ordinal);
  const latest=ordered.slice(0,3),obligationKey=text(latest[0].recurring_obligation_id),trace=latest.map(publicTrace);
  if(latest.some(item=>text(item.entity_id)!==text(entityId)||text(item.recurring_obligation_id)!==obligationKey))return noCandidate('HISTORICAL_OBLIGATION_NOT_EXACT',trace);
  if(latest.some((item,index)=>item.period_ordinal!==currentPeriodOrdinal-(index+1)))return noCandidate('HISTORICAL_PERIODS_NOT_CONSECUTIVE',trace);
  if(currentPeriodSourceDocumentIds.length>0)return noCandidate('CURRENT_PERIOD_RETAINED_SOURCE_EXISTS',trace);
  if(postedCurrentSourceDocumentIds.length>0)return noCandidate('CURRENT_PERIOD_POSTED_SOURCE_LINK_EXISTS',trace);
  return freeze({status:'ACCRUAL_CANDIDATE_REVIEW_REQUIRED',rule_id:'RECURRING_OBLIGATION_MISSING_CURRENT_PERIOD',entity_id:text(entityId),accounting_period_id:text(currentPeriodId),period_key:text(currentPeriodKey),recurring_obligation_id:obligationKey,service_frequency:text(latest[0].service_frequency),currency:text(latest[0].currency),historical_amounts:freeze(latest.map(item=>item.amount)),prior_source_trace:freeze(trace),required_human_fields:freeze(['owner','due_date','accrual_basis','account_mapping','member_trace','reversing_entry_decision']),can_create_draft:false,can_review:false,can_approve:false,can_post:false});
}

export {requiredEvidence as AI_ACCRUAL_CANDIDATE_REQUIRED_EVIDENCE};
