import {safeAiEvidenceTree} from './ai-secret-safety.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,SHA=/^sha256:[0-9a-f]{64}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const SCHEDULE_READ_LIMIT=100;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
const falseActions=value=>value&&Object.keys(ACTIONS).every(key=>value[key]===false);
const exactFalseActions=value=>falseActions(value)&&Object.keys(value).length===4;

export function createAiAccountingApprovedDecisionService({sourceReader,loanSourceReader=null,classificationService,scheduleReader,settingsAdapter}={}){
  if(typeof sourceReader!=='function'||(loanSourceReader!==null&&typeof loanSourceReader!=='function')||typeof classificationService?.analyze!=='function'||typeof scheduleReader!=='function'||typeof settingsAdapter?.buildInvoice!=='function'||(loanSourceReader!==null&&typeof settingsAdapter?.buildLoan!=='function'))throw new TypeError('Approved AI decision service requires authoritative invoice, loan, classification, schedule, and settings adapters.');
  return freeze({async analyze({tenantId,entityId,accountingPeriodId,limit=100}={}){
    if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!Number.isSafeInteger(limit)||limit<1||limit>500)fail('AI_ACCOUNTING_DECISION_SCOPE_INVALID','AI accounting decisions require tenant, entity, period, and limit 1-500.');
    const [sources,loanSources,classifications,schedules]=await Promise.all([sourceReader({tenantId,entityId,accountingPeriodId,limit}),loanSourceReader===null?[]:loanSourceReader({tenantId,entityId,accountingPeriodId,limit}),classificationService.analyze({tenantId,entityId,accountingPeriodId,limit}),scheduleReader({tenantId,entityId,limit:SCHEDULE_READ_LIMIT})]);
    if(!Array.isArray(sources)||!Array.isArray(classifications?.results)||classifications.results.length!==sources.length||!Array.isArray(schedules))fail('AI_ACCOUNTING_DECISION_POPULATION_MISMATCH','Retained source and classification populations must match exactly.');
    const byLine=new Map(sources.map(row=>[row.source_document_line_id,row]));if(byLine.size!==sources.length)fail('AI_ACCOUNTING_DECISION_POPULATION_MISMATCH','Retained source lines must be unique.');
    const packets=[];
    for(const classification of classifications.results){
      const source=byLine.get(classification.source_document_line_id);if(!source||classification.source_document_id!==source.source_document_id||classification.source_payload_hash!==source.source_payload_hash||classification.source_line_hash!==source.source_line_hash)fail('AI_ACCOUNTING_DECISION_POPULATION_MISMATCH','Classification lineage must match one retained source exactly.');
      const scheduleMatches=schedules.filter(row=>row.source_document_id===source.source_document_id&&row.source_payload_hash===source.source_payload_hash&&row.status==='PROPOSED'&&falseActions(row));
      if(scheduleMatches.length>1)fail('AI_ACCOUNTING_APPROVED_SETTINGS_UNAVAILABLE','Amortization schedule evidence is ambiguous.');
      if(classification.classification==='PREPAID_AMORTIZATION'&&scheduleMatches.length===0&&schedules.length===SCHEDULE_READ_LIMIT)fail('AI_ACCOUNTING_AMORTIZATION_SCHEDULE_POPULATION_INCOMPLETE','The bounded amortization schedule read is full, so absence for this retained source cannot be proven.');
      const schedule=scheduleMatches.length===1?{schedule_id:scheduleMatches[0].ai_amortization_schedule_id,schedule_hash:scheduleMatches[0].proposal_hash}:null;
      packets.push(await settingsAdapter.buildInvoice({tenantId,entityId,accountingPeriodId,retainedSource:source,classification,amortizationScheduleTrace:schedule}));
    }
    if(!Array.isArray(loanSources)||loanSources.length>=limit)fail('AI_ACCOUNTING_DECISION_POPULATION_INCOMPLETE','The bounded construction-loan source read cannot prove population completeness.');
    if(new Set(loanSources.map(row=>row.source_document_line_id)).size!==loanSources.length)fail('AI_ACCOUNTING_DECISION_POPULATION_MISMATCH','Construction loan decision population is unsafe or incomplete.');
    for(const source of loanSources)packets.push(await settingsAdapter.buildLoan({tenantId,entityId,accountingPeriodId,retainedSource:source}));
    if(packets.length!==sources.length+loanSources.length||packets.length>limit)fail('AI_ACCOUNTING_DECISION_POPULATION_MISMATCH','Every retained source must produce exactly one complete decision within the caller bound.');
    if(new Set(packets.map(row=>row.settings_snapshot_id)).size>1||new Set(packets.map(row=>row.settings_snapshot_hash)).size>1)fail('AI_ACCOUNTING_APPROVED_SETTINGS_UNAVAILABLE','AI accounting decisions require one exact approved settings snapshot for the entire batch.');
    return freeze({schema_version:'AI_ACCOUNTING_DECISION_PACKET_FULL_BATCH_V1',scope:{tenant_id:tenantId,entity_id:entityId,accounting_period_id:accountingPeriodId},row_count:packets.length,decision_counts:{ready_for_human_review:packets.filter(row=>row.status==='READY_FOR_HUMAN_REVIEW').length,exception:packets.filter(row=>row.status==='EXCEPTION').length},packets,action_flags:ACTIONS});
  }});
}

export function assertAiAccountingDecisionPacketFullBatch(value,{tenantId,entityId,accountingPeriodId}={}){
  const keys=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort().join('|'):'';
  const countKeys=value?.decision_counts&&typeof value.decision_counts==='object'&&!Array.isArray(value.decision_counts)?Object.keys(value.decision_counts).sort().join('|'):'',ready=value?.decision_counts?.ready_for_human_review,exceptions=value?.decision_counts?.exception,actualReady=Array.isArray(value?.packets)?value.packets.filter(packet=>packet?.status==='READY_FOR_HUMAN_REVIEW').length:-1,actualExceptions=Array.isArray(value?.packets)?value.packets.filter(packet=>packet?.status==='EXCEPTION').length:-1;
  const sourceIdentities=Array.isArray(value?.packets)?value.packets.map(packet=>{const source=packet?.source;return UUID.test(source?.source_document_id||'')&&UUID.test(source?.source_document_line_id||'')&&SHA.test(source?.source_payload_hash||'')&&SHA.test(source?.source_line_hash||'')?`${source.source_document_id}|${source.source_document_line_id}`:null;}):[];
  if(keys!=='action_flags|decision_counts|packets|row_count|schema_version|scope'||value.schema_version!=='AI_ACCOUNTING_DECISION_PACKET_FULL_BATCH_V1'||value.scope?.tenant_id!==tenantId||value.scope?.entity_id!==entityId||value.scope?.accounting_period_id!==accountingPeriodId||!Number.isSafeInteger(value.row_count)||value.row_count<0||value.row_count>500||!Array.isArray(value.packets)||value.packets.length!==value.row_count||sourceIdentities.some(identity=>identity===null)||new Set(sourceIdentities).size!==sourceIdentities.length||!safeAiEvidenceTree(value)||!exactFalseActions(value.action_flags)||value.packets.some(packet=>packet?.schema_version!=='AI_ACCOUNTING_DECISION_PACKET_V1'||packet.tenant_id!==tenantId||packet.entity_id!==entityId||packet.accounting_period_id!==accountingPeriodId||!['READY_FOR_HUMAN_REVIEW','EXCEPTION'].includes(packet.status)||!exactFalseActions(packet.action_flags)||packet.proposed_journal?.status!=='SUGGESTED_ONLY'||packet.status==='EXCEPTION'&&(packet.proposed_journal.lines.length!==0||packet.expected_report_deltas.length!==0))||countKeys!=='exception|ready_for_human_review'||!Number.isSafeInteger(ready)||!Number.isSafeInteger(exceptions)||ready<0||exceptions<0||ready!==actualReady||exceptions!==actualExceptions)fail('AI_ACCOUNTING_DECISION_RESPONSE_INVALID','AI accounting decision response is unsafe or incomplete.');
  return value;
}
