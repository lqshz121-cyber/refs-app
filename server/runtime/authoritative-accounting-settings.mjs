import {validateApprovedWbsAiEntityPeriodSettings} from './wbs-ai-approved-settings-dto.mjs';

const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const FAMILY_ORDER=Object.freeze(['coa','vendor_treatment','project_property_cost_code','period_close_policy','tax','intercompany','materiality','approval_thresholds','report_mapping','loan_capitalization_policy']);
const CREDENTIAL=/(?:bearer\s+|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|(?:sk|rk|pk)-[a-z0-9_-]{8,})/i;
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
const actor=value=>{if(CREDENTIAL.test(value))throw Object.assign(new Error('Approved settings actor evidence contains credential-shaped text.'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});return value;};
const timestamp=value=>new Date(value).toISOString();

export function projectAuthoritativeAccountingSettings(value,{tenantId,entityId,periodId}={}){
  const settings=validateApprovedWbsAiEntityPeriodSettings(value,{tenantId,entityId,periodId});
  const close=settings.period_close_policy.settings,materiality=settings.materiality.settings;
  return freeze({
    schema_version:'AUTHORITATIVE_ACCOUNTING_SETTINGS_V1',
    scope:{tenant_id:settings.tenant_id,entity_id:settings.entity_id,company_code:settings.company_code,period_id:settings.period_id,period_code:settings.period_code,period_start:settings.period_start,period_end:settings.period_end,period_status:settings.period_status,currency:settings.currency},
    approval:{settings_snapshot_id:settings.settings_snapshot_id,settings_version:settings.settings_version,settings_hash:settings.settings_hash,approval_status:'APPROVED',approved_by:actor(settings.approved_by),approved_at:timestamp(settings.approved_at)},
    families:FAMILY_ORDER.map(family=>({family,schema_version:settings[family].schema_version,setting_snapshot_id:settings[family].setting_snapshot_id,version:settings[family].version,snapshot_hash:settings[family].snapshot_hash,approval_status:'APPROVED',approved_by:actor(settings[family].approved_by),approved_at:timestamp(settings[family].approved_at)})),
    period_close_policy:{allow_post:close.allow_post,posting_lock:close.posting_lock,soft_lock:close.soft_lock,hard_lock:close.hard_lock,cutoff_date:close.cutoff_date,accrual_cutoff_date:close.accrual_cutoff_date,prepaid_boundary_date:close.prepaid_boundary_date,reversal_policy:close.reversal_policy,prior_period_adjustment_policy:close.prior_period_adjustment_policy,override_policy:close.override_policy},
    materiality:{currency:materiality.currency,financial_statement_amount:materiality.financial_statement_amount,budget_variance_amount:materiality.budget_variance_amount,manual_je_amount:materiality.manual_je_amount,duplicate_amount:materiality.duplicate_amount,loan_difference_amount:materiality.loan_difference_amount},
    coverage:{active_posting_account_count:settings.coa.settings.accounts.filter(row=>row.status==='ACTIVE'&&row.posting_allowed&&row.effective_from<=settings.period_start&&(row.effective_to===null||row.effective_to>=settings.period_end)).length,vendor_rule_count:settings.vendor_treatment.settings.vendor_rules.length,dimension_rule_count:settings.project_property_cost_code.settings.dimension_rules.length,tax_code_count:settings.tax.settings.tax_codes.length,intercompany_enabled:settings.intercompany.settings.enabled,intercompany_counterparty_count:settings.intercompany.settings.entities.length,approval_level_count:settings.approval_thresholds.settings.approval_levels.length,classification_threshold_count:settings.approval_thresholds.settings.classification_thresholds.length,report_mapping_count:settings.report_mapping.settings.account_mappings.length,qualifying_loan_combination_count:settings.loan_capitalization_policy.settings.qualifying_combinations.length},
    action_flags:ACTIONS
  });
}
