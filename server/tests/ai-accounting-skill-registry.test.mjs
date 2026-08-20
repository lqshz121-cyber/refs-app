import assert from 'node:assert/strict';
import test from 'node:test';
import {AI_ACCOUNTING_SKILL_REGISTRY_VERSION,AI_ACCOUNTING_SKILLS,AI_ANALYSIS_FINDING_CATEGORIES,getAiAccountingSkillByFindingCategory,isAiAnalysisFindingCategory} from '../runtime/ai-accounting-skill-registry.mjs';

test('AI Accounting skill registry exposes only retained-evidence, no-action finding skills to the model boundary',()=>{
  assert.equal(AI_ACCOUNTING_SKILL_REGISTRY_VERSION,'REFS_AI_ACCOUNTING_SKILLS_V1');
  assert.deepEqual(AI_ANALYSIS_FINDING_CATEGORIES,['WBS_EXCEPTION','DUPLICATE_PAYABLE','PREPAID_COVERAGE','UNMATCHED_BANK_PAYMENT','BANK_DUPLICATE_PAYMENT','VENDOR_INVOICE_AMOUNT_SPIKE','VENDOR_INVOICE_FREQUENCY_SPIKE','VENDOR_INVOICE_AMOUNT_DROP','VENDOR_INVOICE_NEAR_DUPLICATE','MANUAL_JOURNAL_RISK','COST_DIMENSION','LOAN_REFERENCE']);
  assert.equal(new Set(AI_ANALYSIS_FINDING_CATEGORIES).size,AI_ANALYSIS_FINDING_CATEGORIES.length);
  for(const category of AI_ANALYSIS_FINDING_CATEGORIES){
    const item=getAiAccountingSkillByFindingCategory(category);
    assert.ok(item);
    assert.equal(item.status,'IMPLEMENTED_FINDING');
    assert.ok(item.required_evidence.length>0);
    assert.deepEqual(item.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
    assert.equal(isAiAnalysisFindingCategory(category),true);
  }
  assert.equal(isAiAnalysisFindingCategory('ACCRUAL'),false);
  assert.equal(getAiAccountingSkillByFindingCategory('ACCRUAL'),null);
});

test('planned AI skills cannot be accidentally sent to the model before their source contracts exist',()=>{
  const planned=AI_ACCOUNTING_SKILLS.filter(item=>item.status==='PLANNED_SOURCE_CONTRACT');
  assert.equal(planned.length,0);
  for(const item of planned){
    assert.equal(item.finding_category,null);
    assert.equal(isAiAnalysisFindingCategory(item.finding_category),false);
    assert.deepEqual(item.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  }
});

test('vendor account coding drift is a Posted evidence review candidate with no accounting authority',()=>{const item=AI_ACCOUNTING_SKILLS.find(skill=>skill.id==='VENDOR_ACCOUNT_CODING_DRIFT_REVIEW');assert.equal(item.status,'IMPLEMENTED_REVIEW_CANDIDATE');assert.equal(item.finding_category,null);for(const field of ['business_document_id','source_document_id','posted_journal_entry_id','posted_journal_line_id','posted_line_hash'])assert.ok(item.required_evidence.includes(field));assert.deepEqual(item.allowed_outputs,['vendor_account_coding_drift_review_candidate']);assert.deepEqual(item.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});});
test('vendor payment terms drift is a source-bound review candidate with no payment or accounting authority',()=>{const item=AI_ACCOUNTING_SKILLS.find(skill=>skill.id==='VENDOR_PAYMENT_TERMS_DRIFT_REVIEW');assert.equal(item.status,'IMPLEMENTED_REVIEW_CANDIDATE');assert.equal(item.finding_category,null);for(const field of ['business_document_id','source_document_id','source_payload_hash','posted_journal_entry_id','invoice_date','due_date','historical_source_payload_hashes'])assert.ok(item.required_evidence.includes(field));assert.deepEqual(item.allowed_outputs,['vendor_payment_terms_drift_review_candidate']);assert.deepEqual(item.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});});
test('new vendor material invoice review requires signed source, policy, and history with no accounting authority',()=>{const item=AI_ACCOUNTING_SKILLS.find(skill=>skill.id==='NEW_VENDOR_MATERIAL_INVOICE_REVIEW');assert.equal(item.status,'IMPLEMENTED_REVIEW_CANDIDATE');assert.equal(item.finding_category,null);for(const field of ['source_document_id','source_document_line_id','source_payload_hash','source_line_hash','approved_materiality_policy','prior_period_vendor_history'])assert.ok(item.required_evidence.includes(field));assert.deepEqual(item.allowed_outputs,['new_vendor_material_invoice_review_candidate']);assert.deepEqual(item.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});});
test('monthly vendor spend review requires a complete current and historical source set with no accounting authority',()=>{const item=AI_ACCOUNTING_SKILLS.find(skill=>skill.id==='VENDOR_MONTHLY_SPEND_VARIANCE_REVIEW');assert.equal(item.status,'IMPLEMENTED_REVIEW_CANDIDATE');assert.equal(item.finding_category,null);for(const field of ['current_source_trace','history_source_line_hashes','approved_vendor_anomaly_policy','entity_id','accounting_period_id'])assert.ok(item.required_evidence.includes(field));assert.deepEqual(item.allowed_outputs,['vendor_monthly_spend_review_candidate']);assert.deepEqual(item.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});});
test('AP cutoff review requires exact period and Posted lineage with no accounting authority',()=>{const item=AI_ACCOUNTING_SKILLS.find(skill=>skill.id==='AP_INVOICE_CUTOFF_REVIEW');assert.equal(item.status,'IMPLEMENTED_REVIEW_CANDIDATE');assert.equal(item.finding_category,null);for(const field of ['invoice_business_date','invoice_accounting_period_id','invoice_period_status','posted_journal_entry_id','current_accounting_period_id'])assert.ok(item.required_evidence.includes(field));assert.deepEqual(item.allowed_outputs,['ap_invoice_cutoff_review_candidate']);assert.deepEqual(item.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});});

test('intercompany controller exposes only reciprocal posted-evidence review candidates',()=>{
  const intercompany=AI_ACCOUNTING_SKILLS.find(item=>item.id==='INTERCOMPANY_CLOSE_CONTROLLER');
  assert.equal(intercompany.status,'IMPLEMENTED_REVIEW_CANDIDATE');
  assert.equal(intercompany.finding_category,null);
  assert.deepEqual(intercompany.allowed_outputs,['intercompany_close_review_candidate']);
  for(const field of ['entity_id','counterparty_entity_id','reciprocal_mapping_snapshots','posted_journal_entry_ids','ledger_line_ids','source_document_ids'])assert.ok(intercompany.required_evidence.includes(field));
  assert.deepEqual(intercompany.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('construction loan balance review requires lender, mapping, policy, and POSTED GL lineage',()=>{
  const loan=AI_ACCOUNTING_SKILLS.find(item=>item.id==='CONSTRUCTION_LOAN_BALANCE_REVIEW');
  assert.equal(loan.status,'IMPLEMENTED_REVIEW_CANDIDATE');assert.equal(loan.finding_category,null);
  assert.deepEqual(loan.allowed_outputs,['construction_loan_balance_review_candidate']);
  for(const field of ['lender_statement_source_document_id','loan_ref','approved_loan_account_mapping_snapshot','posted_journal_entry_ids','ledger_line_ids','gl_source_document_ids','policy_evidence'])assert.ok(loan.required_evidence.includes(field));
  assert.deepEqual(loan.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});
test('construction loan draw-to-CWIP review remains a mapped Posted evidence-only control',()=>{const item=AI_ACCOUNTING_SKILLS.find(skill=>skill.id==='CONSTRUCTION_LOAN_DRAW_CWIP_REVIEW');assert.ok(item);assert.equal(item.status,'IMPLEMENTED_REVIEW_CANDIDATE');assert.deepEqual(item.allowed_outputs,['loan_draw_cwip_review_candidate']);for(const field of ['period_draws','period_cwip_net_additions','approved_loan_mapping_hashes','approved_cwip_mapping_hashes','posted_ledger_line_ids'])assert.ok(item.required_evidence.includes(field));assert.deepEqual(item.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});});
test('project loan-cost review requires exact project and both Posted mapping lineages',()=>{const item=AI_ACCOUNTING_SKILLS.find(skill=>skill.id==='CONSTRUCTION_LOAN_PROJECT_COST_REVIEW');assert.ok(item);assert.deepEqual(item.allowed_outputs,['project_loan_cost_review_candidate']);for(const field of ['project_ref','period_draws','cwip_net_additions','loan_mapping_hashes','cwip_mapping_hashes','posted_ledger_line_ids'])assert.ok(item.required_evidence.includes(field));assert.deepEqual(item.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});});

test('unusual payment review requires signed bank line and approved calendar evidence with no accounting action',()=>{
  const payment=AI_ACCOUNTING_SKILLS.find(item=>item.id==='BANK_UNUSUAL_TIMING_REVIEW');
  assert.equal(payment.status,'IMPLEMENTED_REVIEW_CANDIDATE');assert.equal(payment.finding_category,null);
  assert.deepEqual(payment.allowed_outputs,['unusual_payment_review_candidate']);
  for(const field of ['bank_source_id','source_document_id','source_document_line_id','source_payload_hash','source_line_hash','approved_business_calendar_policy'])assert.ok(payment.required_evidence.includes(field));
  assert.deepEqual(payment.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('revenue and Property Management exposes only source-bound revenue review candidates',()=>{
  const revenue=AI_ACCOUNTING_SKILLS.find(item=>item.id==='REVENUE_PROPERTY_MANAGEMENT');
  assert.ok(revenue);
  assert.equal(revenue.status,'IMPLEMENTED_REVIEW_CANDIDATE');
  assert.equal(revenue.finding_category,null);
  assert.deepEqual(revenue.required_evidence,['source_document_id','source_version','receipt_hash','source_evidence_hash','mapping_snapshot_id','mapping_snapshot_hash','journal_entry_id','expected_rent_amount','posted_revenue_amount']);
  assert.deepEqual(revenue.allowed_outputs,['property_rent_revenue_review_candidate']);
  assert.deepEqual(revenue.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('financial reporting exposes only posted-lineage variance review candidates',()=>{
  const reporting=AI_ACCOUNTING_SKILLS.find(item=>item.id==='FINANCIAL_REPORTING');
  assert.ok(reporting);assert.equal(reporting.status,'IMPLEMENTED_REVIEW_CANDIDATE');assert.equal(reporting.finding_category,null);
  assert.deepEqual(reporting.allowed_outputs,['account_variance_review_candidate']);
  assert.ok(reporting.required_evidence.includes('current_ledger_line_ids'));assert.ok(reporting.required_evidence.includes('prior_source_document_ids'));
  assert.deepEqual(reporting.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('AP aging exposes only posted source-bound review candidates',()=>{const aging=AI_ACCOUNTING_SKILLS.find(item=>item.id==='AP_AGING_RISK_REVIEW');assert.ok(aging);assert.equal(aging.status,'IMPLEMENTED_REVIEW_CANDIDATE');assert.equal(aging.finding_category,null);assert.deepEqual(aging.allowed_outputs,['ap_aging_review_candidate']);assert.ok(aging.required_evidence.includes('posted_journal_entry_id'));assert.ok(aging.required_evidence.includes('policy_evidence'));assert.deepEqual(aging.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});});
test('balance-sheet aging exposes only source-bound dormant-balance review candidates',()=>{const aging=AI_ACCOUNTING_SKILLS.find(item=>item.id==='BALANCE_SHEET_ACCOUNT_AGING');assert.ok(aging);assert.equal(aging.status,'IMPLEMENTED_REVIEW_CANDIDATE');assert.deepEqual(aging.allowed_outputs,['dormant_nonzero_balance_review_candidate']);for(const field of ['ending_balance','last_activity_date','posted_journal_entry_ids','posted_ledger_line_ids','approved_policy_hash'])assert.ok(aging.required_evidence.includes(field));assert.deepEqual(aging.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});});

test('accrual accounting exposes only its signed-evidence review candidate contract',()=>{
  const accrual=AI_ACCOUNTING_SKILLS.find(item=>item.id==='ACCRUAL_ACCOUNTING');
  assert.ok(accrual);
  assert.equal(accrual.status,'IMPLEMENTED_REVIEW_CANDIDATE');
  assert.equal(accrual.finding_category,null);
  assert.deepEqual(accrual.required_evidence,[
    'service_period_start','service_period_end','recurring_obligation_id',
    'service_frequency','obligation_status','source_document_id','source_document_line_id',
    'source_payload_hash','source_line_hash','entity_id','accounting_period_id','currency','amount'
  ]);
  assert.deepEqual(accrual.allowed_outputs,['accrual_review_candidate']);
  assert.deepEqual(accrual.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  assert.equal(isAiAnalysisFindingCategory(accrual.finding_category),false);
});
