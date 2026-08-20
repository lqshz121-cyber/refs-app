import {safeAiEvidenceTree} from './ai-secret-safety.mjs';

const ACTION_KEYS=Object.freeze(['can_create_draft','can_review','can_approve','can_post']);
const ACTIONS=Object.freeze(Object.fromEntries(ACTION_KEYS.map(key=>[key,false])));

export class AiFullControllerScanError extends Error{
  constructor(code,message){super(message);this.name='AiFullControllerScanError';this.code=code;}
}

function closedActions(value){return value&&typeof value==='object'&&Object.keys(value).length===4&&ACTION_KEYS.every(key=>value[key]===false);}
function explainedFinding(value){return value&&typeof value==='object'&&
  typeof value.rule_id==='string'&&/^[A-Z][A-Z0-9_]{2,127}$/.test(value.rule_id)&&
  ['HIGH','MEDIUM','LOW'].includes(value.risk_level)&&
  typeof value.reason==='string'&&value.reason.trim().length>=8&&value.reason.length<=2000&&
  typeof value.suggested_action==='string'&&value.suggested_action.trim().length>=8&&value.suggested_action.length<=2000;}
function closedBatch(value,{entityId,periodId}){
  return value&&typeof value==='object'&&safeAiEvidenceTree(value)&&value.current_accounting_period_id===periodId&&
    Number.isSafeInteger(value.finding_count)&&value.finding_count>=0&&Array.isArray(value.findings)&&
    value.finding_count===value.findings.length&&value.findings.length<=2000&&closedActions(value.action_flags)&&
    value.findings.every(finding=>explainedFinding(finding)&&(!('entity_id' in finding)||finding.entity_id===entityId)&&(!('accounting_period_id' in finding)||finding.accounting_period_id===periodId));
}

export function createAiFullControllerScanService({analyzers}={}){
  if(!analyzers||typeof analyzers!=='object'||Array.isArray(analyzers)||Object.keys(analyzers).length===0)throw new AiFullControllerScanError('AI_FULL_SCAN_CONFIG_INVALID','Full Controller scan requires named analyzers');
  const names=Object.keys(analyzers).sort();
  if(names.some(name=>!/^[A-Z][A-Z0-9_]{2,63}$/.test(name)||typeof analyzers[name]?.analyze!=='function'))throw new AiFullControllerScanError('AI_FULL_SCAN_CONFIG_INVALID','Every Full Controller scan analyzer requires a stable category and analyze function');
  return Object.freeze({
    async analyze({tenantId,entityId,currentAccountingPeriodId,limit=500}={}){
      if(typeof tenantId!=='string'||!tenantId||typeof entityId!=='string'||!entityId||typeof currentAccountingPeriodId!=='string'||!currentAccountingPeriodId||!Number.isSafeInteger(limit)||limit<1||limit>2000)throw new AiFullControllerScanError('AI_FULL_SCAN_SCOPE_INVALID','Full Controller scan requires exact tenant, entity, period, and bounded limit');
      const settled=await Promise.all(names.map(async category=>{
        try{
          const batch=await analyzers[category].analyze({tenantId,entityId,currentAccountingPeriodId,limit});
          if(!closedBatch(batch,{entityId,periodId:currentAccountingPeriodId}))throw new AiFullControllerScanError('AI_FULL_SCAN_SECTION_INVALID',`${category} returned unsafe, unscoped, or action-enabled evidence`);
          return Object.freeze({category,status:'COMPLETE',schema_version:batch.schema_version,finding_count:batch.finding_count,findings:Object.freeze(batch.findings),action_flags:ACTIONS});
        }catch(error){
          const errorCode=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{2,127}$/.test(error.code)?error.code:'AI_FULL_SCAN_SECTION_UNAVAILABLE';
          return Object.freeze({category,status:'UNAVAILABLE',error_code:errorCode,finding_count:null,findings:Object.freeze([]),action_flags:ACTIONS});
        }
      }));
      const completeCount=settled.filter(section=>section.status==='COMPLETE').length;
      const findingCount=settled.reduce((sum,section)=>sum+(section.finding_count??0),0);
      const completeFindings=settled.filter(section=>section.status==='COMPLETE').flatMap(section=>section.findings);
      const riskSummary=Object.freeze({high:completeFindings.filter(finding=>finding.risk_level==='HIGH').length,medium:completeFindings.filter(finding=>finding.risk_level==='MEDIUM').length,low:completeFindings.filter(finding=>finding.risk_level==='LOW').length});
      const unavailableSections=Object.freeze(settled.filter(section=>section.status==='UNAVAILABLE').map(section=>Object.freeze({category:section.category,error_code:section.error_code})));
      const coverageSummary=Object.freeze({complete_section_count:completeCount,unavailable_section_count:unavailableSections.length,unavailable_sections:unavailableSections});
      return Object.freeze({schema_version:'AI_FULL_CONTROLLER_SCAN_V1',entity_id:entityId,current_accounting_period_id:currentAccountingPeriodId,status:completeCount===settled.length?'COMPLETE':'INCOMPLETE',required_section_count:settled.length,complete_section_count:completeCount,finding_count:findingCount,risk_summary:riskSummary,coverage_summary:coverageSummary,sections:Object.freeze(settled),action_flags:ACTIONS});
    }
  });
}
