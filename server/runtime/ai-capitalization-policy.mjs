const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const MONEY4=/^(0|[1-9]\d*)\.\d{4}$/;
const COST_CLASSES=Object.freeze(['OPERATING_EXPENSE','HARD_COST','SOFT_COST','EQUIPMENT','REPAIR','INTEREST']);
const PROJECT_STATUSES=Object.freeze(['OPERATING','UNDER_CONSTRUCTION','IN_SERVICE','COMPLETED']);

const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,fields)=>plain(value)&&Object.keys(value).length===fields.length&&fields.every(field=>own(value,field));
const safeToken=(value,max=128)=>typeof value==='string'&&value.length>=1&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const sortedUnique=(values)=>Array.isArray(values)&&values.length>0&&values.every(value=>safeToken(value))&&new Set(values).size===values.length&&values.every((value,index)=>index===0||values[index-1]<value);

export function validateAiCapitalizationPolicyEvidence(value){
  const fields=['schema_version','setting_snapshot_id','setting_snapshot_hash','policy_version','rule_id','currency','capitalization_threshold','eligible_cost_classes','charge_code_classification','project_status_by_ref','useful_life_months_by_cost_class','post_completion_treatment'];
  if(!exact(value,fields)||value.schema_version!=='AI_CAPITALIZATION_POLICY_EVIDENCE_V1'||!UUID.test(value.setting_snapshot_id||'')||!SHA256.test(value.setting_snapshot_hash||'')||!Number.isSafeInteger(value.policy_version)||value.policy_version<1||value.rule_id!=='AI_CAPITALIZATION_POLICY_V1'||!/^[A-Z]{3}$/.test(value.currency||'')||!MONEY4.test(value.capitalization_threshold||'')||!sortedUnique(value.eligible_cost_classes)||value.eligible_cost_classes.some(item=>!COST_CLASSES.includes(item))||!plain(value.charge_code_classification)||!plain(value.project_status_by_ref)||!plain(value.useful_life_months_by_cost_class)||value.post_completion_treatment!=='EXPENSE_OR_RECLASS_REVIEW')return null;
  for(const [key,costClass] of Object.entries(value.charge_code_classification))if(!safeToken(key)||!COST_CLASSES.includes(costClass))return null;
  for(const [key,status] of Object.entries(value.project_status_by_ref))if(!safeToken(key)||!PROJECT_STATUSES.includes(status))return null;
  for(const [costClass,months] of Object.entries(value.useful_life_months_by_cost_class))if(!COST_CLASSES.includes(costClass)||!Number.isSafeInteger(months)||months<1||months>600)return null;
  return Object.freeze({...value,eligible_cost_classes:Object.freeze([...value.eligible_cost_classes]),charge_code_classification:Object.freeze({...value.charge_code_classification}),project_status_by_ref:Object.freeze({...value.project_status_by_ref}),useful_life_months_by_cost_class:Object.freeze({...value.useful_life_months_by_cost_class})});
}

export function applyAiCapitalizationPolicy({policy,amount,currency,chargeCode=null,projectRef=null}={}){
  const evidence=validateAiCapitalizationPolicyEvidence(policy);
  if(!evidence)return Object.freeze({status:'POLICY_BLOCKED',reason:'A unique approved capitalization policy was not retained for this entity and accounting period.',required_human_fields:Object.freeze(['capitalization_policy']),policy_evidence:null});
  if(currency!==evidence.currency)return Object.freeze({status:'POLICY_BLOCKED',reason:'Invoice currency does not match the approved capitalization policy currency.',required_human_fields:Object.freeze(['currency_policy_review']),policy_evidence:evidence});
  if(!MONEY4.test(amount||''))return Object.freeze({status:'POLICY_BLOCKED',reason:'Invoice amount is not a valid non-negative four-decimal accounting amount.',required_human_fields:Object.freeze(['amount_correction']),policy_evidence:evidence});
  const costClass=chargeCode===null?null:evidence.charge_code_classification[chargeCode]??null;
  if(chargeCode!==null&&costClass===null)return Object.freeze({status:'POLICY_BLOCKED',reason:'The retained charge code has no approved capitalization policy classification.',required_human_fields:Object.freeze(['charge_code_mapping']),policy_evidence:evidence});
  if(costClass===null)return Object.freeze({status:'NOT_APPLICABLE',reason:'No retained capital-nature charge code was available.',required_human_fields:Object.freeze([]),policy_evidence:evidence,cost_class:null,project_status:null,useful_life_months:null,threshold_met:false});
  const projectStatus=projectRef===null?null:evidence.project_status_by_ref[projectRef]??null,capitalNature=evidence.eligible_cost_classes.includes(costClass),thresholdMet=BigInt(amount.replace('.',''))>=BigInt(evidence.capitalization_threshold.replace('.',''));
  if(capitalNature&&projectRef===null)return Object.freeze({status:'POLICY_BLOCKED',reason:'A capital-nature invoice requires a retained project reference.',required_human_fields:Object.freeze(['project_ref']),policy_evidence:evidence,cost_class:costClass,project_status:null,useful_life_months:evidence.useful_life_months_by_cost_class[costClass]??null,threshold_met:thresholdMet});
  if(capitalNature&&projectStatus===null)return Object.freeze({status:'POLICY_BLOCKED',reason:'The retained project has no approved lifecycle status in the capitalization policy.',required_human_fields:Object.freeze(['project_status']),policy_evidence:evidence,cost_class:costClass,project_status:null,useful_life_months:evidence.useful_life_months_by_cost_class[costClass]??null,threshold_met:thresholdMet});
  if(capitalNature&&['IN_SERVICE','COMPLETED'].includes(projectStatus))return Object.freeze({status:'POST_COMPLETION_REVIEW',reason:'Capital-nature cost was identified after the project entered service or completed status.',required_human_fields:Object.freeze(['controller_approval','expense_or_reclass_account','placed_in_service_support']),policy_evidence:evidence,cost_class:costClass,project_status:projectStatus,useful_life_months:evidence.useful_life_months_by_cost_class[costClass]??null,threshold_met:thresholdMet});
  if(capitalNature&&thresholdMet)return Object.freeze({status:'CAPITALIZATION_REVIEW',reason:'Approved policy classifies the retained charge code as capital nature and the invoice meets the entity threshold.',required_human_fields:Object.freeze(['capital_account','placed_in_service_date','controller_approval']),policy_evidence:evidence,cost_class:costClass,project_status:projectStatus,useful_life_months:evidence.useful_life_months_by_cost_class[costClass]??null,threshold_met:true});
  return Object.freeze({status:'EXPENSE_BY_POLICY',reason:capitalNature?'The invoice is below the approved capitalization threshold.':'The approved policy classifies the retained charge code as operating expense.',required_human_fields:Object.freeze(['expense_account','cost_center_or_member']),policy_evidence:evidence,cost_class:costClass,project_status:projectStatus,useful_life_months:evidence.useful_life_months_by_cost_class[costClass]??null,threshold_met:false});
}
