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
  cost_class:'OPERATING_EXPENSE',asset_useful_life_months:null,capitalization_threshold:'5000.0000',
  document_evidence_status:'COMPLETE',document_evidence_schema_version:'WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_V1',document_evidence_hash:hash('d'),document_kind:'INVOICE',
  tax_year:null,taxing_jurisdiction:null,tax_statement_identifier:null,tax_coverage_period_start:null,tax_coverage_period_end:null,tax_obligation_basis:null,controlled_property_ref:null,parcel_identifier:null,
  document_revision_schema_version:null,document_revision_kind:null,document_revision:null,predecessor_document_evidence_hash:null,predecessor_document_revision_hash:null,predecessor_document_revision:null,predecessor_source_record_id:null,document_revision_hash:null,document_lifecycle_status:'NOT_APPLICABLE',
  ...overrides
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

test('recognizes only the complete current signed TAX_STATEMENT revision and never proposes accounting',()=>{
  const result=classifyRetainedInvoice(invoice({document_kind:'TAX_STATEMENT',tax_year:2026,taxing_jurisdiction:'Example County',tax_statement_identifier:'STATEMENT-2026-01',tax_coverage_period_start:'2026-01-01',tax_coverage_period_end:'2026-12-31',tax_obligation_basis:'ASSESSED_VALUE',controlled_property_ref:'PROPERTY-1',parcel_identifier:'PARCEL-1',document_revision_schema_version:'WBS_FINAL1_PAYABLE_DOCUMENT_REVISION_V1',document_revision_kind:'ORIGINAL',document_revision:1,document_revision_hash:hash('e'),document_lifecycle_status:'CURRENT',description:'Annual services',property_ref:null}),{capitalizationPolicy:policy});
  assert.equal(result.classification,'BLOCKED');
  assert.equal(result.rule_id,'AI_PROPERTY_TAX_TYPED_SOURCE_REVIEW_V1');
  assert.deepEqual(result.required_human_fields,['property_tax_policy_snapshot','tax_treatment_review']);
  assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('service INVOICE text never becomes tax authority, with or without property dimensions',()=>{
  for(const description of ['Phase I Environmental Site Assessment','County tax certificate consulting services','Lender appraisal fee','Mill Creek clubhouse repair','School District Tax Levy 2026'])for(const property_ref of [null,'PROPERTY-1']){
    const result=classifyRetainedInvoice(invoice({description,property_ref}),{capitalizationPolicy:policy});
    assert.equal(result.classification,'EXPENSE',`${description} / ${property_ref}`);
    assert.equal(result.rule_id,'AI_CAPITALIZATION_POLICY_V1');
  }
});

test('missing, unknown, and contradictory signed document evidence fail closed',()=>{
  for(const overrides of [
    {document_evidence_status:'MISSING',document_evidence_schema_version:null,document_evidence_hash:null,document_kind:null},
    {document_kind:'UNKNOWN'},
    {document_kind:'INVOICE',taxing_jurisdiction:'County'},
    {document_kind:'TAX_STATEMENT',taxing_jurisdiction:'County',tax_statement_identifier:'STATEMENT-1',tax_coverage_period_start:'2026-12-31',tax_coverage_period_end:'2026-01-01',tax_obligation_basis:'ASSESSED_VALUE',controlled_property_ref:'PROPERTY-1',parcel_identifier:'PARCEL-1'},
    {document_kind:'TAX_STATEMENT',taxing_jurisdiction:'County',tax_statement_identifier:'STATEMENT-1',tax_coverage_period_start:'2026-01-01',tax_coverage_period_end:'2026-12-31',tax_obligation_basis:'UNKNOWN',controlled_property_ref:'PROPERTY-1',parcel_identifier:'PARCEL-1'}
  ]){
    const result=classifyRetainedInvoice(invoice(overrides),{capitalizationPolicy:policy});
    assert.equal(result.classification,'BLOCKED',JSON.stringify(overrides));
    assert.match(result.rule_id,/AI_PAYABLE_DOCUMENT_KIND_EVIDENCE_(?:REQUIRED|INVALID)_V1/);
    assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  }
});

test('superseded, withdrawn, stale, or predecessor-drifted property-tax revisions fail closed',()=>{
  const current={document_kind:'TAX_STATEMENT',tax_year:2026,taxing_jurisdiction:'County',tax_statement_identifier:'STATEMENT-1',tax_coverage_period_start:'2026-01-01',tax_coverage_period_end:'2026-12-31',tax_obligation_basis:'ASSESSED_VALUE',controlled_property_ref:'PROPERTY-1',parcel_identifier:'PARCEL-1',document_revision_schema_version:'WBS_FINAL1_PAYABLE_DOCUMENT_REVISION_V1',document_revision_kind:'CORRECTION',document_revision:2,predecessor_document_evidence_hash:hash('e'),predecessor_document_revision_hash:hash('f'),predecessor_document_revision:1,predecessor_source_record_id:id(20),document_revision_hash:hash('9'),document_lifecycle_status:'CURRENT'};
  for(const drift of [{document_lifecycle_status:'SUPERSEDED'},{document_revision_kind:'WITHDRAWN'},{predecessor_document_revision:2},{document_revision_hash:'bad'}]){
    const result=classifyRetainedInvoice(invoice({...current,...drift}),{capitalizationPolicy:policy});
    assert.equal(result.classification,'BLOCKED');
    assert.equal(result.rule_id,'AI_PAYABLE_DOCUMENT_KIND_EVIDENCE_INVALID_V1');
    assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  }
});
