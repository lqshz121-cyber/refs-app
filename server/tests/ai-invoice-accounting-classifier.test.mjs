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
  for(const description of ['Annual insurance premium','SaaS subscription renewal','Loan origination fee','Annual maintenance contract']){
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
  assert.throws(()=>classifyRetainedInvoiceBatch(Array.from({length:10001},()=>invoice())),error=>error.code==='AI_INVOICE_CLASSIFICATION_SCOPE_INVALID');
});

test('never treats a property tax obligation as a generic multi-period prepaid asset',()=>{
  // The counterexample the generic multi-month rule used to swallow: a real
  // annual property tax bill with a proven twelve-month coverage window.
  const annualTaxBill=invoice({
    vendor_name:'Harris County Tax Assessor-Collector',
    description:'2026 property tax statement, account 0412-88-3301',
    charge_code:'OPERATING',property_ref:'PROPERTY-1',amount:'48250.0000',
    service_period_start:'2026-01-01',service_period_end:'2026-12-31'
  });
  const result=classifyRetainedInvoice(annualTaxBill,{capitalizationPolicy:policy});
  assert.equal(result.classification,'BLOCKED');
  assert.notEqual(result.classification,'PREPAID_AMORTIZATION');
  assert.equal(result.rule_id,'TAX_OBLIGATION_REQUIRES_TAX_STATEMENT_SOURCE');
  assert.equal(result.confidence,1);
  assert.equal(result.policy_evidence,null);
  assert.deepEqual(result.required_human_fields,['tax_statement_source_document','taxing_jurisdiction','tax_statement_identifier','tax_coverage_period','tax_obligation_basis']);
  assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('the tax gate outranks the coverage rule and the approved capitalization policy in either order',()=>{
  for(const overrides of [
    {description:'Real estate taxes 2026',service_period_start:'2026-01-01',service_period_end:'2026-12-31'},
    {description:'Ad valorem tax levy',service_period_start:'2026-01-01',service_period_end:'2026-06-30'},
    {vendor_name:'County Tax Assessor',description:'Assessor statement for the land parcel',service_period_start:null,service_period_end:null},
    {description:'Property tax on parcel under construction',amount:'25000.0000',charge_code:'BUILD-HARD',project_ref:'PROJECT-1',project_status:'UNDER_CONSTRUCTION',cost_class:'HARD_COST'},
    {description:'Property taxes',service_period_start:'2026-06-01',service_period_end:'2026-06-30'},
    {description:'Annual property appraisal notice',service_period_start:'2026-01-01',service_period_end:'2026-12-31'},
    {description:'Notice of taxable value for parcel 0412',amount:'25000.0000',charge_code:'BUILD-HARD',project_ref:'PROJECT-1',project_status:'UNDER_CONSTRUCTION',cost_class:'HARD_COST'},
    {description:'Ad valorem charge',property_ref:'PROPERTY-1',service_period_start:'2026-01-01',service_period_end:'2026-12-31'},
    {description:'Annual millage bill',property_ref:'PROPERTY-1',amount:'25000.0000',charge_code:'BUILD-HARD',project_ref:'PROJECT-1',project_status:'UNDER_CONSTRUCTION',cost_class:'HARD_COST'},
    {description:'2026 mill rate statement',property_ref:'PROPERTY-1',service_period_start:'2026-01-01',service_period_end:'2026-12-31'}
  ]){
    const result=classifyRetainedInvoice(invoice(overrides),{capitalizationPolicy:policy});
    assert.equal(result.classification,'BLOCKED',JSON.stringify(overrides));
    assert.equal(result.rule_id,'TAX_OBLIGATION_REQUIRES_TAX_STATEMENT_SOURCE',JSON.stringify(overrides));
  }
});

test('recognizes statutory property-tax documents without requiring the words property tax',()=>{
  for(const overrides of [
    {vendor_name:'Harris County Appraisal District',description:'2026 tax statement for parcel 0412-88-3301'},
    {vendor_name:'Harris County',description:'County tax bill parcel 0412-88-3301'},
    {vendor_name:'Harris County Appraisal District',description:'Notice of Appraised Value for parcel 0412-88-3301'},
    {vendor_name:'Harris County',description:'County Taxes Due, parcel 0412-88-3301'},
    {vendor_name:'Spring Independent School District',description:'School District Levy, property account 0412-88-3301'},
    {vendor_name:'Municipal Utility District',description:'Special assessment for parcel 0412-88-3301'},
    {vendor_name:'Harris County',description:'Tax invoice for parcel 0412-88-3301'},
    {vendor_name:'Harris County',description:'Notice of delinquent taxes for parcel 0412-88-3301'},
    {vendor_name:'Spring Independent School District',description:'School district taxes for property account 0412-88-3301'},
    {vendor_name:'Municipal Utility District',description:'Municipal property levy for parcel 0412-88-3301'},
    {vendor_name:'Harris County',description:'Tax certificate for parcel 0412-88-3301'},
    {vendor_name:'Harris County Appraisal District',description:'Annual property assessment notice'},
    {vendor_name:'Harris County',description:'Real property levy'},
    {vendor_name:'Harris County',description:'Real estate assessment'},
    {vendor_name:'Harris County Appraisal District',description:'Notice of appraised value, property ID 0412-88-3301'},
    {vendor_name:'Harris County Appraisal District',description:'Assessed value notice',property_ref:'PROPERTY-1'},
    {vendor_name:'Independent Valuation Office',description:'Property valuation notice'},
    {vendor_name:'Harris County Appraisal District',description:'Annual property appraisal notice'},
    {vendor_name:'Harris County Appraisal District',description:'Notice of taxable value for parcel 0412-88-3301'},
    {vendor_name:'Harris County Appraisal District',description:'Property value notice'},
    {vendor_name:'Independent Appraiser',description:'Annual appraisal notice',property_ref:'PROPERTY-1'},
    {vendor_name:'Harris County',description:'Ad valorem charge',property_ref:'PROPERTY-1'},
    {vendor_name:'Harris County',description:'Annual millage bill',property_ref:'PROPERTY-1'},
    {vendor_name:'Harris County',description:'2026 mill rate statement',property_ref:'PROPERTY-1'}
  ]){
    const result=classifyRetainedInvoice(invoice({...overrides,service_period_start:'2026-01-01',service_period_end:'2026-12-31'}),{capitalizationPolicy:policy});
    assert.equal(result.classification,'BLOCKED',JSON.stringify(overrides));
    assert.equal(result.rule_id,'TAX_OBLIGATION_REQUIRES_TAX_STATEMENT_SOURCE',JSON.stringify(overrides));
    assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  }
});

test('ordinary non-property tax and assessment text plus vendor names alone do not trigger the property-tax gate',()=>{
  for(const [description,vendor_name] of [
    ['Landscaping services, sales tax included','Example vendor'],
    ['Sales tax bill preparation and filing','Example vendor'],
    ['Tax preparation advisory retainer','Example vendor'],
    ['Taxi reimbursement for site visit','Example vendor'],
    ['Annual retainer for consulting','Property Tax Advisors LLC'],
    ['Professional services for appeal','Property Tax Advisors LLC'],
    ['Valuation consulting engagement','Property Tax Advisors LLC'],
    ['Consulting engagement','Tax Assessor Consulting'],
    ['Security assessment for access controls','Security Consultants LLC'],
    ['Annual equipment appraisal services','Equipment Appraisers LLC'],
    ['Business value appraisal engagement','Valuation Advisors LLC'],
    ['Annual sales tax advisory','Sales Tax Advisors LLC'],
    ['Payroll tax filing services','Payroll Services LLC'],
    ['Income tax preparation','Tax Preparation LLC']
  ]){
    const result=classifyRetainedInvoice(invoice({description,vendor_name}),{capitalizationPolicy:policy});
    assert.notEqual(result.rule_id,'TAX_OBLIGATION_REQUIRES_TAX_STATEMENT_SOURCE',description);
  }
});

test('ambiguous property-tax-related services block until an authoritative document type is retained',()=>{
  for(const overrides of [
    {description:'Property tax appeal consulting services',vendor_name:'Property Tax Advisors LLC',property_ref:'PROPERTY-1'},
    {description:'Property assessment consulting for parcel 0412',vendor_name:'Property Consultants LLC'},
    {description:'Property valuation consulting engagement',vendor_name:'Valuation Advisors LLC'},
    {description:'Property tax advisory retainer',vendor_name:'Property Tax Advisors LLC',property_ref:'PROPERTY-1'},
    {description:'Property tax software services invoice for parcel tracking',vendor_name:'Property Tax Software LLC'},
    {description:'Assessment software configuration',vendor_name:'Software LLC',property_ref:'PROPERTY-1'},
    {description:'Assessed value appeal service',vendor_name:'Appeal Advisors LLC',property_ref:'PROPERTY-1'},
    {description:'Appraised value consulting',vendor_name:'Appraisal Advisors LLC',property_ref:'PROPERTY-1'},
    {description:'Municipal property levy advisory',vendor_name:'Municipal Advisors LLC'},
    {description:'Real estate assessment review service',vendor_name:'Assessment Review LLC'},
    {description:'Tax certificate consulting for property account',vendor_name:'Tax Consultants LLC'},
    {description:'County property tax legal filing for parcel',vendor_name:'Property Tax Attorneys LLC'}
  ]){
    const result=classifyRetainedInvoice(invoice(overrides),{capitalizationPolicy:policy});
    assert.equal(result.classification,'BLOCKED',JSON.stringify(overrides));
    assert.equal(result.rule_id,'TAX_OBLIGATION_REQUIRES_TAX_STATEMENT_SOURCE',JSON.stringify(overrides));
    assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  }
});
