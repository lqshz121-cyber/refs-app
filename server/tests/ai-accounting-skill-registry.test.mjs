import assert from 'node:assert/strict';
import test from 'node:test';
import {AI_ACCOUNTING_SKILL_REGISTRY_VERSION,AI_ACCOUNTING_SKILLS,AI_ANALYSIS_FINDING_CATEGORIES,getAiAccountingSkillByFindingCategory,isAiAnalysisFindingCategory} from '../runtime/ai-accounting-skill-registry.mjs';

test('AI Accounting skill registry exposes only retained-evidence, no-action finding skills to the model boundary',()=>{
  assert.equal(AI_ACCOUNTING_SKILL_REGISTRY_VERSION,'REFS_AI_ACCOUNTING_SKILLS_V1');
  assert.deepEqual(AI_ANALYSIS_FINDING_CATEGORIES,['WBS_EXCEPTION','DUPLICATE_PAYABLE','PREPAID_COVERAGE','UNMATCHED_BANK_PAYMENT','COST_DIMENSION','LOAN_REFERENCE']);
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
  assert.ok(planned.length>=4);
  for(const item of planned){
    assert.equal(item.finding_category,null);
    assert.equal(isAiAnalysisFindingCategory(item.finding_category),false);
    assert.deepEqual(item.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  }
});

test('accrual accounting remains disabled until a signed recurring-obligation service-period contract exists',()=>{
  const accrual=AI_ACCOUNTING_SKILLS.find(item=>item.id==='ACCRUAL_ACCOUNTING');
  assert.ok(accrual);
  assert.equal(accrual.status,'PLANNED_SOURCE_CONTRACT');
  assert.equal(accrual.finding_category,null);
  assert.deepEqual(accrual.required_evidence,[
    'service_period_start','service_period_end','recurring_obligation_id',
    'service_frequency','obligation_status','source_document_id','source_document_line_id',
    'source_payload_hash','source_line_hash','entity_id','accounting_period_id','currency','amount'
  ]);
  assert.deepEqual(accrual.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});
