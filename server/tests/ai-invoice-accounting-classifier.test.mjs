import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyRetainedInvoice,classifyRetainedInvoiceBatch} from '../runtime/ai-invoice-accounting-classifier.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=c=>`sha256:${c.repeat(64)}`;
const policy={schema_version:'AI_CAPITALIZATION_POLICY_EVIDENCE_V1',setting_snapshot_id:id(10),setting_snapshot_hash:hash('c'),policy_version:1,rule_id:'AI_CAPITALIZATION_POLICY_V1',currency:'USD',capitalization_threshold:'5000.0000',eligible_cost_classes:['EQUIPMENT','HARD_COST','SOFT_COST'],charge_code_classification:{'BUILD-HARD':'HARD_COST','EQUIPMENT':'EQUIPMENT','OPERATING':'OPERATING_EXPENSE'},project_status_by_ref:{'PROJECT-1':'UNDER_CONSTRUCTION','PROJECT-DONE':'COMPLETED'},useful_life_months_by_cost_class:{EQUIPMENT:60,HARD_COST:360,SOFT_COST:360},post_completion_treatment:'EXPENSE_OR_RECLASS_REVIEW'};
const invoice=(overrides={})=>({
  source_document_id:id(1),source_document_line_id:id(2),source_payload_hash:hash('a'),source_line_hash:hash('b'),
  entity_id:id(3),accounting_period_id:id(4),accounting_date:'2026-06-30',vendor_name:'Example vendor',invoice_no:'INV-100',invoice_date:'2026-06-30',
  currency:'USD',amount:'1200.0000',service_period_start:null,service_period_end:null,description:'Operating services',
  project_ref:null,property_ref:null,member_ref:null,charge_code:'OPERATING',duplicate_status:'NONE',accounting_status:'NOT_RECORDED',project_status:'OPERATING',
  cost_class:'OPERATING_EXPENSE',asset_useful_life_months:null,capitalization_threshold:'5000.0000',...overrides
});

test('classifies multi-month coverage as prepaid amortization with source trace and zero actions',()=>{
  const result=classifyRetainedInvoice(invoice({service_period_start:'2026-01-01',service_period_end:'2026-12-31'}));
  assert.equal(result.classification,'PREPAID_AMORTIZATION');
  assert.equal(result.source_payload_hash,hash('a'));
  assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('classifies supported construction and equipment invoices for capitalization review',()=>{
  for(const row of [
    invoice({amount:'25000.0000',project_status:'UNDER_CONSTRUCTION',project_ref:'PROJECT-1',cost_class:'HARD_COST'}),
    invoice({amount:'9000.0000',cost_class:'EQUIPMENT',asset_useful_life_months:60})
  ])assert.equal(classifyRetainedInvoice({...row,charge_code:row.cost_class==='EQUIPMENT'?'EQUIPMENT':'BUILD-HARD',project_ref:row.project_ref??'PROJECT-1'},{capitalizationPolicy:policy}).classification,'CAPITALIZATION_REVIEW');
});

test('capitalization policy outranks a multi-month construction work interval',()=>{
  const result=classifyRetainedInvoice(invoice({
    amount:'25000.0000',description:'Foundation work January through March',
    service_period_start:'2026-01-01',service_period_end:'2026-03-31',
    charge_code:'BUILD-HARD',project_ref:'PROJECT-1',project_status:'UNDER_CONSTRUCTION',cost_class:'HARD_COST'
  }),{capitalizationPolicy:policy});
  assert.equal(result.classification,'CAPITALIZATION_REVIEW');
  assert.equal(result.rule_id,'AI_CAPITALIZATION_POLICY_V1');
  assert.equal(result.policy_evidence.setting_snapshot_hash,hash('c'));
  assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('classifies prior-service unrecorded invoices for accrual review and ordinary invoices as expense',()=>{
  assert.equal(classifyRetainedInvoice(invoice({invoice_date:'2026-07-15',service_period_start:'2026-06-01',service_period_end:'2026-06-30'}),{capitalizationPolicy:policy}).classification,'ACCRUAL_REVIEW');
  assert.equal(classifyRetainedInvoice(invoice(),{capitalizationPolicy:policy}).classification,'EXPENSE');
});

test('fails closed on duplicates, partial periods, invalid evidence, and never poisons a batch',()=>{
  const batch=classifyRetainedInvoiceBatch([
    invoice(),
    invoice({source_document_line_id:id(5),duplicate_status:'POSSIBLE'}),
    invoice({source_document_line_id:id(6),service_period_start:'2026-01-01'}),
    invoice({source_document_line_id:id(7),source_line_hash:'bad'})
  ],{capitalizationPolicy:policy});
  assert.equal(batch.row_count,4);
  assert.deepEqual(batch.classification_counts,{EXPENSE:1,PREPAID_AMORTIZATION:0,ACCRUAL_REVIEW:0,CAPITALIZATION_REVIEW:0,BLOCKED:3});
  assert.deepEqual(batch.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('fails closed on impossible invoice, accounting, or service calendar dates',()=>{
  for(const changed of [
    {invoice_date:'2026-02-30'},
    {accounting_date:'2026-02-30'},
    {service_period_start:'2026-02-30',service_period_end:'2026-03-01'},
    {service_period_start:'2026-02-01',service_period_end:'2026-02-30'}
  ])assert.equal(classifyRetainedInvoice(invoice(changed),{capitalizationPolicy:policy}).classification,'BLOCKED');
});

test('fails closed without policy and binds approved policy evidence to a capital decision',()=>{
  const missing=classifyRetainedInvoice(invoice());
  assert.equal(missing.classification,'BLOCKED');
  assert.deepEqual(missing.required_human_fields,['capitalization_policy']);
  const capital=classifyRetainedInvoice(invoice({amount:'25000.0000',charge_code:'BUILD-HARD',project_ref:'PROJECT-1'}),{capitalizationPolicy:policy});
  assert.equal(capital.classification,'CAPITALIZATION_REVIEW');
  assert.equal(capital.rule_id,'AI_CAPITALIZATION_POLICY_V1');
  assert.equal(capital.policy_evidence.setting_snapshot_hash,hash('c'));
});

test('blocks unmapped charge codes and routes completed-project capital cost to review',()=>{
  assert.equal(classifyRetainedInvoice(invoice({charge_code:'UNKNOWN'}),{capitalizationPolicy:policy}).classification,'BLOCKED');
  const completed=classifyRetainedInvoice(invoice({amount:'25000.0000',charge_code:'BUILD-HARD',project_ref:'PROJECT-DONE'}),{capitalizationPolicy:policy});
  assert.equal(completed.classification,'CAPITALIZATION_REVIEW');
  assert.equal(completed.rule_id,'AI_POST_COMPLETION_CAPITALIZATION_V1');
});

test('never expenses likely prepaid invoices when coverage evidence is missing',()=>{
  for(const description of ['Annual insurance premium','SaaS subscription renewal','Property tax statement','Loan origination fee','Annual maintenance contract']){
    const result=classifyRetainedInvoice(invoice({description,charge_code:'OPERATING'}),{capitalizationPolicy:policy});
    assert.equal(result.classification,'BLOCKED',description);
    assert.equal(result.rule_id,'AI_PREPAID_COVERAGE_REQUIRED_V1');
    assert.deepEqual(result.required_human_fields,['coverage_source_document','service_period_start','service_period_end']);
    assert.equal(result.policy_evidence,null);
  }
});

test('known one-month coverage may follow policy while multi-month coverage remains prepaid review',()=>{
  const oneMonth=classifyRetainedInvoice(invoice({description:'Insurance premium',service_period_start:'2026-06-01',service_period_end:'2026-06-30'}),{capitalizationPolicy:policy});
  assert.equal(oneMonth.classification,'EXPENSE');
  const annual=classifyRetainedInvoice(invoice({description:'Insurance premium',service_period_start:'2026-01-01',service_period_end:'2026-12-31'}),{capitalizationPolicy:policy});
  assert.equal(annual.classification,'PREPAID_AMORTIZATION');
});

test('rejects oversized scans before processing',()=>{
  assert.throws(()=>classifyRetainedInvoiceBatch(Array.from({length:501},()=>invoice())),error=>error.code==='AI_INVOICE_CLASSIFICATION_SCOPE_INVALID');
});
