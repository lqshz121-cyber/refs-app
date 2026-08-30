import {safeAiEvidenceTree} from './ai-secret-safety.mjs';

const ACTION_KEYS=Object.freeze(['can_create_draft','can_review','can_approve','can_post']);
const ACTIONS=Object.freeze(Object.fromEntries(ACTION_KEYS.map(key=>[key,false])));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;

export class AiFullControllerScanError extends Error{
  constructor(code,message){super(message);this.name='AiFullControllerScanError';this.code=code;}
}

function closedActions(value){return value&&typeof value==='object'&&Object.keys(value).length===4&&ACTION_KEYS.every(key=>value[key]===false);}
function findingActionsClosed(value){return ACTION_KEYS.every(key=>!(key in value)||value[key]===false)&&(!('action_flags' in value)||closedActions(value.action_flags));}
function explainedFinding(value){return value&&typeof value==='object'&&
  typeof value.rule_id==='string'&&/^[A-Z][A-Z0-9_]{2,127}$/.test(value.rule_id)&&
  ['HIGH','MEDIUM','LOW'].includes(value.risk_level)&&
  typeof value.reason==='string'&&value.reason.trim().length>=8&&value.reason.length<=2000&&
  typeof value.suggested_action==='string'&&value.suggested_action.trim().length>=8&&value.suggested_action.length<=2000&&findingActionsClosed(value);}
function closedBatch(value,{entityId,periodId}){
  return value&&typeof value==='object'&&safeAiEvidenceTree(value)&&typeof value.schema_version==='string'&&/^[A-Z][A-Z0-9_]{2,127}$/.test(value.schema_version)&&value.current_accounting_period_id===periodId&&
    Number.isSafeInteger(value.finding_count)&&value.finding_count>=0&&Array.isArray(value.findings)&&
    value.finding_count===value.findings.length&&value.findings.length<=2000&&new Set(value.findings.map(canonical)).size===value.findings.length&&closedActions(value.action_flags)&&
    value.findings.every(finding=>explainedFinding(finding)&&(!('entity_id' in finding)||finding.entity_id===entityId)&&(!('accounting_period_id' in finding)||finding.accounting_period_id===periodId));
}

const CATEGORY=/^[A-Z][A-Z0-9_]{2,63}$/;
const CODE=/^[A-Z][A-Z0-9_]{2,127}$/;

// A Full Controller scan is only trustworthy if the set of sections it had to
// produce is fixed independently of the analyzer map it was handed. Deriving
// required_section_count from the wiring lets a dropped analyzer shrink the
// denominator, leaving every surviving section COMPLETE and the whole scan
// reporting COMPLETE with silently fewer findings. When a frozen registry is
// supplied it, not the wiring, decides what the scan owes.
function frozenRegistry(requiredSections){
  if(requiredSections===null||requiredSections===undefined)return null;
  const analyzed=requiredSections.analyzed,unavailable=requiredSections.unavailable??{};
  if(!Array.isArray(analyzed)||analyzed.length===0||analyzed.some(name=>typeof name!=='string'||!CATEGORY.test(name))||new Set(analyzed).size!==analyzed.length)throw new AiFullControllerScanError('AI_FULL_SCAN_REGISTRY_INVALID','The Full Controller required-section registry must list unique, stable analyzed categories');
  if(!unavailable||typeof unavailable!=='object'||Array.isArray(unavailable))throw new AiFullControllerScanError('AI_FULL_SCAN_REGISTRY_INVALID','The Full Controller required-section registry must map unavailable categories to stable failure codes');
  const unavailableNames=Object.keys(unavailable);
  if(unavailableNames.some(name=>!CATEGORY.test(name)||typeof unavailable[name]!=='string'||!CODE.test(unavailable[name])))throw new AiFullControllerScanError('AI_FULL_SCAN_REGISTRY_INVALID','Every unavailable Full Controller section requires a stable failure code');
  if(unavailableNames.some(name=>analyzed.includes(name)))throw new AiFullControllerScanError('AI_FULL_SCAN_REGISTRY_INVALID','A Full Controller section cannot be both analyzed and unavailable');
  return Object.freeze({analyzed:Object.freeze([...analyzed].sort()),unavailable:Object.freeze({...unavailable})});
}

export function createAiFullControllerScanService({analyzers,requiredSections=null}={}){
  if(!analyzers||typeof analyzers!=='object'||Array.isArray(analyzers)||Object.keys(analyzers).length===0)throw new AiFullControllerScanError('AI_FULL_SCAN_CONFIG_INVALID','Full Controller scan requires named analyzers');
  const wired=Object.keys(analyzers).sort();
  if(wired.some(name=>!CATEGORY.test(name)||typeof analyzers[name]?.analyze!=='function'))throw new AiFullControllerScanError('AI_FULL_SCAN_CONFIG_INVALID','Every Full Controller scan analyzer requires a stable category and analyze function');
  const registry=frozenRegistry(requiredSections);
  // An analyzer outside the frozen registry, or one claiming a category this
  // release has declared unprovable, is wiring drift. Refuse it here rather
  // than let it widen or forge the scan at run time.
  if(registry&&wired.some(name=>!registry.analyzed.includes(name)))throw new AiFullControllerScanError('AI_FULL_SCAN_REGISTRY_DRIFT','A Full Controller analyzer is not present in the frozen required-section registry');
  if(registry&&wired.some(name=>name in registry.unavailable))throw new AiFullControllerScanError('AI_FULL_SCAN_REGISTRY_DRIFT','A Full Controller section declared unavailable cannot be satisfied by an analyzer');
  // Registered sections with no analyzer are not dropped. They are reported as
  // UNAVAILABLE so the denominator holds and the scan stays INCOMPLETE.
  const missing=registry?registry.analyzed.filter(name=>!wired.includes(name)):[];
  const declaredUnavailable=Object.freeze(Object.fromEntries([
    ...missing.map(name=>[name,'AI_FULL_SCAN_SECTION_NOT_WIRED']),
    ...Object.entries(registry?.unavailable??{})
  ]));
  const names=registry?[...registry.analyzed.filter(name=>wired.includes(name))]:wired;
  return Object.freeze({
    async analyze({tenantId,entityId,currentAccountingPeriodId,limit=500}={}){
      if(typeof tenantId!=='string'||!tenantId||typeof entityId!=='string'||!entityId||typeof currentAccountingPeriodId!=='string'||!currentAccountingPeriodId||!Number.isSafeInteger(limit)||limit<1||limit>2000)throw new AiFullControllerScanError('AI_FULL_SCAN_SCOPE_INVALID','Full Controller scan requires exact tenant, entity, period, and bounded limit');
      const analyzed=await Promise.all(names.map(async category=>{
        try{
          const batch=await analyzers[category].analyze({tenantId,entityId,currentAccountingPeriodId,limit});
          if(!closedBatch(batch,{entityId,periodId:currentAccountingPeriodId}))throw new AiFullControllerScanError('AI_FULL_SCAN_SECTION_INVALID',`${category} returned unsafe, unscoped, or action-enabled evidence`);
          return Object.freeze({category,status:'COMPLETE',schema_version:batch.schema_version,finding_count:batch.finding_count,findings:Object.freeze(batch.findings),action_flags:ACTIONS});
        }catch(error){
          const errorCode=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{2,127}$/.test(error.code)?error.code:'AI_FULL_SCAN_SECTION_UNAVAILABLE';
          return Object.freeze({category,status:'UNAVAILABLE',error_code:errorCode,finding_count:null,findings:Object.freeze([]),action_flags:ACTIONS});
        }
      }));
      const settled=[...analyzed,...Object.entries(declaredUnavailable).map(([category,errorCode])=>Object.freeze({category,status:'UNAVAILABLE',error_code:errorCode,finding_count:null,findings:Object.freeze([]),action_flags:ACTIONS}))].sort((left,right)=>left.category<right.category?-1:left.category>right.category?1:0);
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
