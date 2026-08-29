import {canonicalRequestHash} from './request-hash.mjs';
import {validateApprovedWbsAiEntityPeriodSettings} from './wbs-ai-approved-settings-dto.mjs';

const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const CREDENTIAL=/(?:bearer\s+|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|(?:sk|rk|pk)-[a-z0-9_-]{8,})/i;
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
const safe=value=>{if(CREDENTIAL.test(value))throw Object.assign(new Error('Approved intercompany mapping evidence contains credential-shaped text.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});return value;};
const list=value=>{const result=value.map(safe);if(new Set(result).size!==result.length)throw Object.assign(new Error('Approved intercompany mapping evidence contains duplicate dimension requirements.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});return result;};
const timestamp=value=>new Date(value).toISOString();

export function projectAuthoritativeIntercompanyMappings(value,{tenantId,entityId,periodId}={}){
  const settings=validateApprovedWbsAiEntityPeriodSettings(value,{tenantId,entityId,periodId}),family=settings.intercompany,policy=family.settings;
  const mappings=policy.entities.map(entity=>{
    const evidence={company_code:safe(entity.company_code),counterparty_entity_id:entity.counterparty_entity_id,counterparty_approval_id:entity.counterparty_approval_id,counterparty_approval_hash:entity.counterparty_approval_hash,currency:entity.currency,dimension_requirements:list(entity.dimension_requirements),due_to_account_role:entity.due_to_account_role,due_from_account_role:entity.due_from_account_role,elimination_account_role:entity.elimination_account_role,effective_from:entity.effective_from,effective_to:entity.effective_to,effective_for_period:entity.effective_from<=settings.period_start&&(entity.effective_to===null||entity.effective_to>=settings.period_end)};
    return {...evidence,mapping_hash:canonicalRequestHash(evidence)};
  }).sort((left,right)=>left.company_code.localeCompare(right.company_code)||left.counterparty_entity_id.localeCompare(right.counterparty_entity_id));
  if(new Set(mappings.map(mapping=>mapping.company_code)).size!==mappings.length||new Set(mappings.map(mapping=>mapping.counterparty_entity_id)).size!==mappings.length)throw Object.assign(new Error('Approved intercompany counterparty identities are not unique.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});
  const policyEvidence={enabled:policy.enabled,clearing_account_role:policy.clearing_account_role};
  return freeze({
    schema_version:'AUTHORITATIVE_INTERCOMPANY_MAPPING_CATALOG_V1',
    scope:{tenant_id:settings.tenant_id,entity_id:settings.entity_id,company_code:settings.company_code,period_id:settings.period_id,period_code:settings.period_code,period_start:settings.period_start,period_end:settings.period_end,period_status:settings.period_status,currency:settings.currency},
    approval:{settings_snapshot_id:settings.settings_snapshot_id,settings_version:settings.settings_version,settings_hash:settings.settings_hash,intercompany_snapshot_id:family.setting_snapshot_id,intercompany_version:family.version,intercompany_hash:family.snapshot_hash,approval_status:'APPROVED',approved_by:safe(family.approved_by),approved_at:timestamp(family.approved_at)},
    policy:{...policyEvidence,policy_hash:canonicalRequestHash(policyEvidence)},
    population:{total_count:mappings.length,read_count:mappings.length,population_complete:true,population_hash:canonicalRequestHash(mappings)},
    mappings,
    action_flags:ACTIONS
  });
}
