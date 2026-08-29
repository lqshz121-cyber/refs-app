import {canonicalRequestHash} from './request-hash.mjs';
import {validateApprovedWbsAiEntityPeriodSettings} from './wbs-ai-approved-settings-dto.mjs';

const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const CREDENTIAL=/(?:bearer\s+|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|(?:sk|rk|pk)-[a-z0-9_-]{8,})/i;
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
const safe=value=>{if(CREDENTIAL.test(value))throw Object.assign(new Error('Approved vendor-treatment evidence contains credential-shaped text.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});return value;};
const list=value=>{const result=value.map(safe);if(new Set(result).size!==result.length)throw Object.assign(new Error('Approved vendor-treatment evidence contains duplicate binding values.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});return result;};
const timestamp=value=>new Date(value).toISOString();

export function projectAuthoritativeVendorTreatmentMappings(value,{tenantId,entityId,periodId}={}){
  const settings=validateApprovedWbsAiEntityPeriodSettings(value,{tenantId,entityId,periodId}),family=settings.vendor_treatment;
  const mappings=family.settings.vendor_rules.map(rule=>{
    const evidence={rule_id:safe(rule.rule_id),vendor_ref:safe(rule.vendor_ref),aliases:list(rule.aliases),contract_keys:list(rule.contract_keys),service_keys:list(rule.service_keys),treatment:rule.treatment,payment_terms_days:rule.payment_terms_days,recurring:rule.recurring,duplicate_normalization:rule.duplicate_normalization,source_requirements:list(rule.source_requirements),effective_from:rule.effective_from,effective_to:rule.effective_to,effective_for_period:rule.effective_from<=settings.period_start&&(rule.effective_to===null||rule.effective_to>=settings.period_end)};
    return {...evidence,mapping_hash:canonicalRequestHash(evidence)};
  }).sort((left,right)=>left.vendor_ref.localeCompare(right.vendor_ref)||left.rule_id.localeCompare(right.rule_id));
  if(new Set(mappings.map(mapping=>mapping.rule_id)).size!==mappings.length||new Set(mappings.map(mapping=>mapping.vendor_ref)).size!==mappings.length)throw Object.assign(new Error('Approved vendor treatment identities are not unique.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});
  return freeze({
    schema_version:'AUTHORITATIVE_VENDOR_TREATMENT_MAPPING_CATALOG_V1',
    scope:{tenant_id:settings.tenant_id,entity_id:settings.entity_id,company_code:settings.company_code,period_id:settings.period_id,period_code:settings.period_code,period_start:settings.period_start,period_end:settings.period_end,period_status:settings.period_status,currency:settings.currency},
    approval:{settings_snapshot_id:settings.settings_snapshot_id,settings_version:settings.settings_version,settings_hash:settings.settings_hash,vendor_treatment_snapshot_id:family.setting_snapshot_id,vendor_treatment_version:family.version,vendor_treatment_hash:family.snapshot_hash,approval_status:'APPROVED',approved_by:safe(family.approved_by),approved_at:timestamp(family.approved_at)},
    policy:{default_treatment:family.settings.default_treatment},
    population:{total_count:mappings.length,read_count:mappings.length,population_complete:true,population_hash:canonicalRequestHash(mappings)},
    mappings,
    action_flags:ACTIONS
  });
}
