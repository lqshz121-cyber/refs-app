import {createHash} from 'node:crypto';
import {safeAiEvidenceTree} from './ai-secret-safety.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{40}$/;
const CODE=/^[A-Z][A-Z0-9_]{2,127}$/;
const ACTION_KEYS=Object.freeze(['can_create_draft','can_review','can_approve','can_post']);
const ACTIONS=Object.freeze(Object.fromEntries(ACTION_KEYS.map(key=>[key,false])));
const TOP_KEYS=['action_flags','complete_section_count','coverage_summary','current_accounting_period_id','entity_id','finding_count','required_section_count','risk_summary','schema_version','sections','status'].sort();
const COMPLETE_KEYS=['action_flags','category','finding_count','findings','schema_version','status'].sort();
const UNAVAILABLE_KEYS=['action_flags','category','error_code','finding_count','findings','status'].sort();

const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify(keys);
const closedActions=value=>exactKeys(value,ACTION_KEYS.slice().sort())&&ACTION_KEYS.every(key=>value[key]===false);
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const hash=value=>`sha256:${createHash('sha256').update(canonical(value),'utf8').digest('hex')}`;
const strictTimestamp=value=>{
  if(typeof value!=='string'||!/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.test(value))return false;
  const instant=new Date(value);return Number.isFinite(instant.valueOf())&&instant.toISOString()===value.replace(/Z$/,value.includes('.')?'Z':'.000Z');
};
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

export function buildAiFullControllerScanEvidence({tenantId,entityId,accountingPeriodId,releaseSha,capturedAt,requestedLimit,scan}={}){
  if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!SHA.test(releaseSha||'')||!strictTimestamp(capturedAt)||!Number.isSafeInteger(requestedLimit)||requestedLimit<1||requestedLimit>2000)fail('AI_FULL_SCAN_EVIDENCE_SCOPE_INVALID','Persisted Full Controller evidence requires exact scope, release, time, and bounded request identity.');
  if(!exactKeys(scan,TOP_KEYS)||scan.schema_version!=='AI_FULL_CONTROLLER_SCAN_V1'||scan.entity_id!==entityId||scan.current_accounting_period_id!==accountingPeriodId||!['COMPLETE','INCOMPLETE'].includes(scan.status)||!Number.isSafeInteger(scan.required_section_count)||scan.required_section_count<1||!Number.isSafeInteger(scan.complete_section_count)||scan.complete_section_count<0||scan.complete_section_count>scan.required_section_count||!Number.isSafeInteger(scan.finding_count)||scan.finding_count<0||!closedActions(scan.action_flags)||!safeAiEvidenceTree(scan))fail('AI_FULL_SCAN_EVIDENCE_INVALID','Full Controller evidence is unsafe or does not match the closed scan contract.');
  if(!Array.isArray(scan.sections)||scan.sections.length!==scan.required_section_count)fail('AI_FULL_SCAN_EVIDENCE_SECTION_SET_INVALID','Full Controller evidence must retain every registered section exactly once.');
  const categories=scan.sections.map(section=>section?.category);
  if(categories.some(category=>typeof category!=='string'||!CODE.test(category))||new Set(categories).size!==categories.length||JSON.stringify(categories)!==JSON.stringify([...categories].sort()))fail('AI_FULL_SCAN_EVIDENCE_SECTION_SET_INVALID','Full Controller section identities must be unique and canonically ordered.');
  const sections=scan.sections.map(section=>{
    const complete=section?.status==='COMPLETE';
    if(!exactKeys(section,complete?COMPLETE_KEYS:UNAVAILABLE_KEYS)||!closedActions(section.action_flags)||!Array.isArray(section.findings))fail('AI_FULL_SCAN_EVIDENCE_SECTION_INVALID','Full Controller section evidence is not closed.');
    if(complete){
      if(!CODE.test(section.schema_version||'')||!Number.isSafeInteger(section.finding_count)||section.finding_count<0||section.finding_count!==section.findings.length)fail('AI_FULL_SCAN_EVIDENCE_SECTION_INVALID','Complete section evidence has inconsistent schema or counts.');
    }else if(section.status!=='UNAVAILABLE'||!CODE.test(section.error_code||'')||section.finding_count!==null||section.findings.length!==0)fail('AI_FULL_SCAN_EVIDENCE_SECTION_INVALID','Unavailable section evidence must retain one stable failure code and no findings.');
    const seen=new Set();
    const findings=section.findings.map((evidence,index)=>{
      if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)||!safeAiEvidenceTree(evidence)||!CODE.test(evidence.rule_id||'')||!['HIGH','MEDIUM','LOW'].includes(evidence.risk_level)||evidence.entity_id!==entityId||evidence.accounting_period_id!==accountingPeriodId)fail('AI_FULL_SCAN_EVIDENCE_FINDING_INVALID','Every persisted finding must be safe, explained, and exact-scope.');
      const findingHash=hash(evidence);if(seen.has(findingHash))fail('AI_FULL_SCAN_EVIDENCE_FINDING_DUPLICATE','A section cannot persist duplicate canonical findings.');seen.add(findingHash);
      return Object.freeze({finding_index:index,finding_hash:findingHash,evidence:Object.freeze(structuredClone(evidence))});
    });
    const payload=complete?{category:section.category,status:'COMPLETE',schema_version:section.schema_version,finding_count:findings.length,findings}:{category:section.category,status:'UNAVAILABLE',error_code:section.error_code,finding_count:null,findings:[]};
    return Object.freeze({...payload,section_hash:hash(payload)});
  });
  const completeCount=sections.filter(section=>section.status==='COMPLETE').length;
  const findingCount=sections.reduce((sum,section)=>sum+(section.finding_count??0),0);
  const risks=sections.flatMap(section=>section.findings).map(item=>item.evidence.risk_level);
  const riskSummary={high:risks.filter(value=>value==='HIGH').length,medium:risks.filter(value=>value==='MEDIUM').length,low:risks.filter(value=>value==='LOW').length};
  const unavailable=sections.filter(section=>section.status==='UNAVAILABLE').map(section=>({category:section.category,error_code:section.error_code}));
  if(completeCount!==scan.complete_section_count||findingCount!==scan.finding_count||JSON.stringify(riskSummary)!==JSON.stringify(scan.risk_summary)||!exactKeys(scan.coverage_summary,['complete_section_count','unavailable_section_count','unavailable_sections'])||scan.coverage_summary.complete_section_count!==completeCount||scan.coverage_summary.unavailable_section_count!==unavailable.length||JSON.stringify(scan.coverage_summary.unavailable_sections)!==JSON.stringify(unavailable)||scan.status!==(completeCount===sections.length?'COMPLETE':'INCOMPLETE'))fail('AI_FULL_SCAN_EVIDENCE_TOTALS_INVALID','Full Controller evidence totals and coverage must be recomputed exactly.');
  const payload={schema_version:'AI_FULL_CONTROLLER_SCAN_EVIDENCE_V1',tenant_id:tenantId,entity_id:entityId,accounting_period_id:accountingPeriodId,release_sha:releaseSha,captured_at:capturedAt,requested_limit:requestedLimit,scan_status:scan.status,registered_section_categories:categories,required_section_count:sections.length,complete_section_count:completeCount,finding_count:findingCount,risk_summary:riskSummary,sections,action_flags:ACTIONS};
  return Object.freeze({...payload,snapshot_hash:hash(payload)});
}

