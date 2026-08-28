import {canonicalRequestHash} from './request-hash.mjs';
import {validateApprovedWbsAiEntityPeriodSettings} from './wbs-ai-approved-settings-dto.mjs';

const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const CREDENTIAL=/(?:bearer\s+|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|(?:sk|rk|pk)-[a-z0-9_-]{8,})/i;
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
const actor=value=>{if(CREDENTIAL.test(value))throw Object.assign(new Error('Approved report-mapping actor evidence contains credential-shaped text.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});return value;};
const timestamp=value=>new Date(value).toISOString();

export function projectAuthoritativeReportMappings(value,{tenantId,entityId,periodId}={}){
  const settings=validateApprovedWbsAiEntityPeriodSettings(value,{tenantId,entityId,periodId});
  const accounts=new Map(settings.coa.settings.accounts.map(account=>[account.account_code,account]));
  const mappings=settings.report_mapping.settings.account_mappings.map(mapping=>{
    const account=accounts.get(mapping.account_code);
    if(!account||account.role!==mapping.account_role)throw Object.assign(new Error('Approved report mapping does not bind the approved account catalog.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});
    const evidence={account_code:mapping.account_code,account_role:mapping.account_role,account_class:account.account_class,account_type:account.account_type,dimension_requirements:[...account.dimension_requirements],statement:mapping.statement,report_row_code:mapping.report_row_code,normal_balance:mapping.normal_balance,contra:mapping.contra,cash_flow_class:mapping.cash_flow_class,effective_from:mapping.effective_from,effective_to:mapping.effective_to,status:'ACTIVE_FOR_PERIOD'};
    return {...evidence,mapping_hash:canonicalRequestHash(evidence)};
  }).sort((left,right)=>left.statement.localeCompare(right.statement)||left.report_row_code.localeCompare(right.report_row_code)||left.account_code.localeCompare(right.account_code));
  const identities=new Set(mappings.map(mapping=>`${mapping.account_code}\u0000${mapping.account_role}`));
  if(identities.size!==mappings.length)throw Object.assign(new Error('Approved report mapping identities are not unique.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});
  return freeze({
    schema_version:'AUTHORITATIVE_REPORT_MAPPING_CATALOG_V1',
    scope:{tenant_id:settings.tenant_id,entity_id:settings.entity_id,company_code:settings.company_code,period_id:settings.period_id,period_code:settings.period_code,period_start:settings.period_start,period_end:settings.period_end,period_status:settings.period_status,currency:settings.currency},
    approval:{settings_snapshot_id:settings.settings_snapshot_id,settings_version:settings.settings_version,settings_hash:settings.settings_hash,report_mapping_snapshot_id:settings.report_mapping.setting_snapshot_id,report_mapping_version:settings.report_mapping.version,report_mapping_hash:settings.report_mapping.snapshot_hash,approval_status:'APPROVED',approved_by:actor(settings.report_mapping.approved_by),approved_at:timestamp(settings.report_mapping.approved_at)},
    population:{total_count:mappings.length,read_count:mappings.length,population_complete:true,population_hash:canonicalRequestHash(mappings)},
    mappings,
    action_flags:ACTIONS
  });
}
