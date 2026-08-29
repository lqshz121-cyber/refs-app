import {canonicalRequestHash} from './request-hash.mjs';
import {validateApprovedWbsAiEntityPeriodSettings} from './wbs-ai-approved-settings-dto.mjs';

const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const CREDENTIAL=/(?:bearer\s+|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|(?:sk|rk|pk)-[a-z0-9_-]{8,})/i;
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
const safe=value=>{if(typeof value==='string'&&CREDENTIAL.test(value))throw Object.assign(new Error('Approved materiality evidence contains credential-shaped text.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});return value;};

export function projectAuthoritativeMaterialityPolicy(value,{tenantId,entityId,periodId}={}){
  const settings=validateApprovedWbsAiEntityPeriodSettings(value,{tenantId,entityId,periodId}),family=settings.materiality,source=family.settings;
  const evidence={
    currency:source.currency,
    minimum_absolute_balance:source.minimum_absolute_balance,
    minimum_open_amount:source.minimum_open_amount,
    financial_statement_amount:source.financial_statement_amount,
    budget_variance_amount:source.budget_variance_amount,
    manual_je_amount:source.manual_je_amount,
    manual_round_amount:source.manual_round_amount,
    duplicate_amount:source.duplicate_amount,
    near_duplicate_amount:source.near_duplicate_amount,
    ap_aging_amount:source.ap_aging_amount,
    loan_difference_amount:source.loan_difference_amount,
    loan_excess_draw_amount:source.loan_excess_draw_amount,
    ap_stale_days:source.ap_stale_days,
    balance_dormant_days:source.balance_dormant_days,
    amount_drop_ratio:source.amount_drop_ratio,
    amount_drop_window_days:source.amount_drop_window_days,
    vendor_frequency_count:source.vendor_frequency_count,
    vendor_frequency_window_days:source.vendor_frequency_window_days,
    effective_from:source.effective_from,
    effective_to:source.effective_to,
    effective_for_period:source.effective_from<=settings.period_start&&(source.effective_to===null||source.effective_to>=settings.period_end)
  };
  return freeze({
    schema_version:'AUTHORITATIVE_MATERIALITY_POLICY_V1',
    scope:{tenant_id:settings.tenant_id,entity_id:settings.entity_id,company_code:settings.company_code,period_id:settings.period_id,period_code:settings.period_code,period_start:settings.period_start,period_end:settings.period_end,period_status:settings.period_status,currency:settings.currency},
    approval:{settings_snapshot_id:settings.settings_snapshot_id,settings_version:settings.settings_version,settings_hash:settings.settings_hash,materiality_snapshot_id:family.setting_snapshot_id,materiality_version:family.version,materiality_hash:family.snapshot_hash,approval_status:'APPROVED',approved_by:safe(family.approved_by),approved_at:new Date(family.approved_at).toISOString()},
    policy:{...evidence,policy_hash:canonicalRequestHash(evidence)},
    action_flags:ACTIONS
  });
}
