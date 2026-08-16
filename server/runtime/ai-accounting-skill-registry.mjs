// The registry is a policy boundary, not a prompt catalogue.  A skill may
// explain retained evidence, but it never receives accounting command power.
export const AI_ACCOUNTING_SKILL_REGISTRY_VERSION='REFS_AI_ACCOUNTING_SKILLS_V1';

const noAccountingActions=Object.freeze({
  can_create_draft:false,
  can_review:false,
  can_approve:false,
  can_post:false
});

const skill=({id,name,status,findingCategory,requiredEvidence,allowedOutputs})=>Object.freeze({
  id,
  name,
  status,
  finding_category:findingCategory,
  required_evidence:Object.freeze([...requiredEvidence]),
  allowed_outputs:Object.freeze([...allowedOutputs]),
  prohibited_actions:noAccountingActions
});

// IMPLEMENTED_FINDING skills are the only categories eligible for the
// explanation gateway. IMPLEMENTED_REVIEW_CANDIDATE skills have a separate,
// deterministic retained-evidence analysis contract, but are deliberately not
// findings and cannot become model input. PLANNED_SOURCE_CONTRACT entries have
// neither contract yet.
export const AI_ACCOUNTING_SKILLS=Object.freeze([
  skill({id:'REAL_ESTATE_CONTROLLER_REVIEW',name:'Real Estate Controller Review',status:'IMPLEMENTED_FINDING',findingCategory:'WBS_EXCEPTION',requiredEvidence:['source_record_id','source_payload_hash','source_document_version'],allowedOutputs:['controller_memo','assignable_review_action']}),
  skill({id:'AP_PAYABLE_AUDIT',name:'AP and Payable Audit',status:'IMPLEMENTED_FINDING',findingCategory:'DUPLICATE_PAYABLE',requiredEvidence:['source_document_id','candidate_source_document_id','source_payload_hash','candidate_payload_hash','match_key_hash'],allowedOutputs:['controller_memo','duplicate_review_action']}),
  skill({id:'PREPAID_AMORTIZATION',name:'Prepaid and Amortization',status:'IMPLEMENTED_FINDING',findingCategory:'PREPAID_COVERAGE',requiredEvidence:['source_document_id','source_document_line_id','source_payload_hash','source_line_hash'],allowedOutputs:['controller_memo','coverage_evidence_request','amortization_proposal_review_action']}),
  skill({id:'BANK_RECONCILIATION',name:'Bank Reconciliation',status:'IMPLEMENTED_FINDING',findingCategory:'UNMATCHED_BANK_PAYMENT',requiredEvidence:['external_bank_line_id','source_payload_hash','observation_hash'],allowedOutputs:['controller_memo','bank_match_review_action']}),
  skill({id:'CONSTRUCTION_COST_ACCOUNTING',name:'Construction Cost Accounting',status:'IMPLEMENTED_FINDING',findingCategory:'COST_DIMENSION',requiredEvidence:['source_document_id','source_document_line_id','source_payload_hash','source_line_hash'],allowedOutputs:['controller_memo','dimension_completion_action']}),
  skill({id:'CONSTRUCTION_LOAN_ACCOUNTING',name:'Construction Loan Accounting',status:'IMPLEMENTED_FINDING',findingCategory:'LOAN_REFERENCE',requiredEvidence:['source_document_id','source_document_line_id','source_payload_hash','source_line_hash'],allowedOutputs:['controller_memo','loan_reference_review_action']}),
  // Accruals may become a human review candidate only after a signed source
  // identifies both the actual service window and the recurring obligation.
  // These explicit fields prevent a generic invoice, amount, or LLM guess from
  // being mistaken for support for an accrual.
  skill({id:'ACCRUAL_ACCOUNTING',name:'Accrual Accounting',status:'IMPLEMENTED_REVIEW_CANDIDATE',findingCategory:null,requiredEvidence:['service_period_start','service_period_end','recurring_obligation_id','service_frequency','obligation_status','source_document_id','source_document_line_id','source_payload_hash','source_line_hash','entity_id','accounting_period_id','currency','amount'],allowedOutputs:['accrual_review_candidate']}),
  skill({id:'REVENUE_PROPERTY_MANAGEMENT',name:'Revenue and Property Management',status:'PLANNED_SOURCE_CONTRACT',findingCategory:null,requiredEvidence:['rent_roll_or_operating_report','gl_revenue_trace','entity','property'],allowedOutputs:['future_revenue_review_action']}),
  skill({id:'FINANCIAL_REPORTING',name:'Financial Reporting',status:'PLANNED_SOURCE_CONTRACT',findingCategory:null,requiredEvidence:['posted_gl_lines','period','entity','account_mapping'],allowedOutputs:['future_variance_explanation']}),
  skill({id:'INTERCOMPANY_CLOSE_CONTROLLER',name:'Intercompany and Close Controller',status:'PLANNED_SOURCE_CONTRACT',findingCategory:null,requiredEvidence:['counterparty_entity','intercompany_mapping','posted_gl_lines','period'],allowedOutputs:['future_close_review_action']})
]);

export const AI_ANALYSIS_FINDING_CATEGORIES=Object.freeze(AI_ACCOUNTING_SKILLS
  .filter(item=>item.status==='IMPLEMENTED_FINDING')
  .map(item=>item.finding_category));

export function getAiAccountingSkillByFindingCategory(category){
  return AI_ACCOUNTING_SKILLS.find(item=>item.finding_category===category)||null;
}

export function isAiAnalysisFindingCategory(category){
  return typeof category==='string'&&AI_ANALYSIS_FINDING_CATEGORIES.includes(category);
}
