import {AI_ANALYSIS_FINDING_CATEGORIES} from './ai-accounting-skill-registry.mjs';
import {assertAiAnalysisExplanationResponse} from './ai-analysis-explanation-service.mjs';
import {safeAiEvidenceTree} from './ai-secret-safety.mjs';

const CATEGORIES=new Set(AI_ANALYSIS_FINDING_CATEGORIES),HASH=/^sha256:[0-9a-f]{64}$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const text=(value,max)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max?value:null;
const count=value=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&BigInt(value)<=BigInt(Number.MAX_SAFE_INTEGER)?BigInt(value):null;
const iso=value=>{
  const raw=value instanceof Date?value.toISOString():value;
  if(typeof raw!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/.test(raw))return null;
  const parsed=new Date(raw);return Number.isNaN(parsed.valueOf())||parsed.toISOString()!==raw.replace(/Z$/,raw.includes('.')?'Z':'.000Z')?null:(value instanceof Date?parsed.toISOString():raw);
};

export function normalizeAiAccountingAnalysisSummary(value){
  if(!Array.isArray(value)||value.length>AI_ANALYSIS_FINDING_CATEGORIES.length)return null;
  const categories=new Set(),out=[];
  for(const item of value){
    const keys=['category','total_findings','high_findings','medium_findings','low_findings','latest_materialized_at','can_create_draft','can_review','can_approve','can_post'];
    if(!exact(item,keys)||!safeAiEvidenceTree(item)||!CATEGORIES.has(item.category)||categories.has(item.category)||item.can_create_draft!==false||item.can_review!==false||item.can_approve!==false||item.can_post!==false)return null;
    const total=count(item.total_findings),high=count(item.high_findings),medium=count(item.medium_findings),low=count(item.low_findings),at=iso(item.latest_materialized_at);
    if(total===null||high===null||medium===null||low===null||total!==high+medium+low||!at)return null;
    categories.add(item.category);out.push(Object.freeze({...item,latest_materialized_at:at}));
  }
  return Object.freeze(out);
}

export function normalizeAiAccountingAnalysisReports(value,{limit}={}){
  if(!Array.isArray(value)||!Number.isSafeInteger(limit)||limit<1||limit>50||value.length>limit)return null;
  const ids=new Set(),out=[];let prior=null;
  for(const item of value){
    const keys=['idempotency_key','request_hash','actor_id','completed_at','report','can_create_draft','can_review','can_approve','can_post'];
    if(!exact(item,keys)||!safeAiEvidenceTree(item)||!text(item.idempotency_key,200)||ids.has(item.idempotency_key)||!HASH.test(item.request_hash)||!text(item.actor_id,255)||item.can_create_draft!==false||item.can_review!==false||item.can_approve!==false||item.can_post!==false)return null;
    const completedAt=iso(item.completed_at);if(!completedAt||prior&&(completedAt>prior.at||(completedAt===prior.at&&item.idempotency_key>=prior.id)))return null;
    try{assertAiAnalysisExplanationResponse(item.report,{expectedTraceId:item.idempotency_key});}catch{return null;}
    ids.add(item.idempotency_key);prior={at:completedAt,id:item.idempotency_key};out.push(Object.freeze({...item,completed_at:completedAt}));
  }
  return Object.freeze(out);
}
