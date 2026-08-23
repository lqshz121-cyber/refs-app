const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const ACCOUNT=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const optional=(value,max)=>value===null||typeof value==='string'&&value.length>=1&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);

export function assertWbsH1AccountingSettingsProposal(value,{periodId}={}){
  const keys=['schema_version','status','company_code','currency','period_id','period_code','period_start','period_end','source_setting_count','ready_rule_count','blocked_rule_count','exception_count','rules','source_mode','accounting_authority','can_create_draft','can_review','can_approve','can_post','proposal_hash'];
  if(!exact(value,keys)||value.schema_version!=='WBS_H1_ACCOUNTING_SETTINGS_PROPOSAL_V1'||!['READY_FOR_HUMAN_REVIEW','EXCEPTION'].includes(value.status)||!COMPANY.test(value.company_code||'')||!/^[A-Z]{3}$/.test(value.currency||'')||value.period_id!==periodId||!UUID.test(value.period_id||'')||!/^2026-(?:0[1-6])$/.test(value.period_code||'')||!DATE.test(value.period_start||'')||!DATE.test(value.period_end||'')||value.period_start>value.period_end||!SHA.test(value.proposal_hash||'')||value.source_mode!=='REAL_WBS_STAGED'||value.accounting_authority!=='NONE'||[value.can_create_draft,value.can_review,value.can_approve,value.can_post].some(Boolean)||!Array.isArray(value.rules))throw new Error('WBS_H1_ACCOUNTING_SETTINGS_PROPOSAL_INVALID');
  for(const count of ['source_setting_count','ready_rule_count','blocked_rule_count','exception_count'])if(!Number.isSafeInteger(value[count])||value[count]<0)throw new Error('WBS_H1_ACCOUNTING_SETTINGS_PROPOSAL_INVALID');
  if(value.source_setting_count!==value.rules.length||value.ready_rule_count+value.blocked_rule_count+value.exception_count!==value.rules.length||(value.exception_count>0)!==(value.status==='EXCEPTION'))throw new Error('WBS_H1_ACCOUNTING_SETTINGS_PROPOSAL_INVALID');
  const ids=new Set();
  for(const rule of value.rules){const ruleKeys=['rule_id','wbs_setting_id','source_setting_hash','selection_mode','decision','detail','project_codes','account_code','account_name','supplementary','effective_from','effective_to'];if(!exact(rule,ruleKeys)||!/^WBS-[1-9][0-9]*$/.test(rule.rule_id||'')||!/^[1-9][0-9]*$/.test(rule.wbs_setting_id||'')||rule.rule_id!==`WBS-${rule.wbs_setting_id}`||ids.has(rule.wbs_setting_id)||!SHA.test(rule.source_setting_hash||'')||!['COST_CODE','BLOCKED_DEFAULT'].includes(rule.selection_mode)||!['READY_FOR_HUMAN_REVIEW','BLOCKED_DEFAULT','MAPPING_MISSING','ACCOUNT_NOT_READY','MAPPING_AMBIGUOUS'].includes(rule.decision)||typeof rule.detail!=='string'||rule.detail.length>128||!Array.isArray(rule.project_codes)||rule.project_codes.some(item=>!optional(item,128))||!(rule.account_code===null||ACCOUNT.test(rule.account_code))||!optional(rule.account_name,255)||!optional(rule.supplementary,64)||!DATE.test(rule.effective_from||'')||!DATE.test(rule.effective_to||'')||rule.effective_from>rule.effective_to)throw new Error('WBS_H1_ACCOUNTING_SETTINGS_PROPOSAL_INVALID');ids.add(rule.wbs_setting_id);}
  return value;
}

export function assertWbsH1AccountingSettingsHumanDecision(value,{periodId,proposalHash}={}){
  const keys=['schema_version','decision_id','period_id','proposal_hash','outcome','decision_hash','decided_by','decided_at','approved_rule_count','can_create_draft','can_review','can_approve','can_post','idempotent'];
  if(!exact(value,keys)||value.schema_version!=='WBS_H1_ACCOUNTING_SETTINGS_HUMAN_DECISION_V1'||!UUID.test(value.decision_id||'')||value.period_id!==periodId||value.proposal_hash!==proposalHash||!SHA.test(value.proposal_hash||'')||!['APPROVED','REJECTED'].includes(value.outcome)||!SHA.test(value.decision_hash||'')||typeof value.decided_by!=='string'||value.decided_by.length<1||value.decided_by.length>256||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/.test(value.decided_at||'')||!Number.isSafeInteger(value.approved_rule_count)||value.approved_rule_count<0||(value.outcome==='REJECTED'&&value.approved_rule_count!==0)||[value.can_create_draft,value.can_review,value.can_approve,value.can_post].some(Boolean)||typeof value.idempotent!=='boolean')throw new Error('WBS_H1_ACCOUNTING_SETTINGS_HUMAN_DECISION_INVALID');
  return value;
}
