import {canonicalRequestHash} from './request-hash.mjs';
import {validateApprovedWbsAiEntityPeriodSettings} from './wbs-ai-approved-settings-dto.mjs';

const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const CREDENTIAL=/(?:bearer\s+|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|(?:sk|rk|pk)-[a-z0-9_-]{8,})/i;
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
const actor=value=>{if(CREDENTIAL.test(value))throw Object.assign(new Error('Approved dimension-mapping actor evidence contains credential-shaped text.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});return value;};
const timestamp=value=>new Date(value).toISOString();

export function projectAuthoritativeDimensionMappings(value,{tenantId,entityId,periodId}={}){
  const settings=validateApprovedWbsAiEntityPeriodSettings(value,{tenantId,entityId,periodId}),family=settings.project_property_cost_code;
  const mappings=family.settings.dimension_rules.map(rule=>{
    const evidence={rule_id:rule.rule_id,scope_level:rule.scope_level,project_ref:rule.project_ref,property_ref:rule.property_ref,cost_code_ref:rule.cost_code_ref,member_ref:rule.member_ref,ownership_requirement:rule.ownership_requirement,member_requirement:rule.member_requirement,capitalization_treatment:rule.capitalization_treatment,cwip_account_role:rule.cwip_account_role,status:rule.status,effective_from:rule.effective_from,effective_to:rule.effective_to,completion_date:rule.completion_date,pis_date:rule.pis_date,effective_for_period:rule.effective_from<=settings.period_start&&(rule.effective_to===null||rule.effective_to>=settings.period_end)};
    return {...evidence,mapping_hash:canonicalRequestHash(evidence)};
  }).sort((left,right)=>left.scope_level.localeCompare(right.scope_level)||left.rule_id.localeCompare(right.rule_id));
  if(new Set(mappings.map(mapping=>mapping.rule_id)).size!==mappings.length)throw Object.assign(new Error('Approved dimension mapping identities are not unique.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});
  return freeze({
    schema_version:'AUTHORITATIVE_DIMENSION_MAPPING_CATALOG_V1',
    scope:{tenant_id:settings.tenant_id,entity_id:settings.entity_id,company_code:settings.company_code,period_id:settings.period_id,period_code:settings.period_code,period_start:settings.period_start,period_end:settings.period_end,period_status:settings.period_status,currency:settings.currency},
    approval:{settings_snapshot_id:settings.settings_snapshot_id,settings_version:settings.settings_version,settings_hash:settings.settings_hash,dimension_mapping_snapshot_id:family.setting_snapshot_id,dimension_mapping_version:family.version,dimension_mapping_hash:family.snapshot_hash,approval_status:'APPROVED',approved_by:actor(family.approved_by),approved_at:timestamp(family.approved_at)},
    population:{total_count:mappings.length,read_count:mappings.length,population_complete:true,population_hash:canonicalRequestHash(mappings)},
    mappings,
    action_flags:ACTIONS
  });
}
