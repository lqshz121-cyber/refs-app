import {canonicalRequestHash} from './request-hash.mjs';
import {validateApprovedWbsAiEntityPeriodSettings} from './wbs-ai-approved-settings-dto.mjs';

const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const CREDENTIAL=/(?:bearer\s+|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|(?:sk|rk|pk)-[a-z0-9_-]{8,})/i;
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
const safe=value=>{if(CREDENTIAL.test(value))throw Object.assign(new Error('Approved tax mapping evidence contains credential-shaped text.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});return value;};
const list=value=>{const result=value.map(safe);if(new Set(result).size!==result.length)throw Object.assign(new Error('Approved tax mapping evidence contains duplicate requirements.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});return result;};
const timestamp=value=>new Date(value).toISOString();

export function projectAuthoritativeTaxMappings(value,{tenantId,entityId,periodId}={}){
  const settings=validateApprovedWbsAiEntityPeriodSettings(value,{tenantId,entityId,periodId}),family=settings.tax,policy=family.settings;
  const mappings=policy.tax_codes.map(code=>{
    const evidence={code:safe(code.code),rate:code.rate,basis:code.basis,recoverability:code.recoverability,expense_treatment:code.expense_treatment,evidence_requirements:list(code.evidence_requirements),effective_from:code.effective_from,effective_to:code.effective_to,effective_for_period:code.effective_from<=settings.period_start&&(code.effective_to===null||code.effective_to>=settings.period_end)};
    return {...evidence,mapping_hash:canonicalRequestHash(evidence)};
  }).sort((left,right)=>left.code.localeCompare(right.code));
  if(new Set(mappings.map(mapping=>mapping.code)).size!==mappings.length)throw Object.assign(new Error('Approved tax code identities are not unique.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});
  const policyEvidence={jurisdiction:safe(policy.jurisdiction),treatment:policy.treatment,allocation_method:policy.allocation_method,allocation_precision:policy.allocation_precision,coverage_start:policy.coverage_start,coverage_end:policy.coverage_end,residual_rule:policy.residual_rule,expense_account_role:policy.expense_account_role,prepaid_account_role:policy.prepaid_account_role,accrual_account_role:policy.accrual_account_role,effective_from:policy.effective_from,effective_to:policy.effective_to};
  return freeze({
    schema_version:'AUTHORITATIVE_TAX_MAPPING_CATALOG_V1',
    scope:{tenant_id:settings.tenant_id,entity_id:settings.entity_id,company_code:settings.company_code,period_id:settings.period_id,period_code:settings.period_code,period_start:settings.period_start,period_end:settings.period_end,period_status:settings.period_status,currency:settings.currency},
    approval:{settings_snapshot_id:settings.settings_snapshot_id,settings_version:settings.settings_version,settings_hash:settings.settings_hash,tax_snapshot_id:family.setting_snapshot_id,tax_version:family.version,tax_hash:family.snapshot_hash,approval_status:'APPROVED',approved_by:safe(family.approved_by),approved_at:timestamp(family.approved_at)},
    policy:{...policyEvidence,policy_hash:canonicalRequestHash(policyEvidence)},
    population:{total_count:mappings.length,read_count:mappings.length,population_complete:true,population_hash:canonicalRequestHash(mappings)},
    mappings,
    action_flags:ACTIONS
  });
}
