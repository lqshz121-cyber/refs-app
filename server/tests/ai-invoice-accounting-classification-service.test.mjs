import assert from 'node:assert/strict';
import test from 'node:test';
import {createAiInvoiceAccountingClassificationService} from '../runtime/ai-invoice-accounting-classification-service.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`,hash=c=>`sha256:${c.repeat(64)}`;
const tenantId=id(1),entityId=id(2),periodId=id(3),documentId=id(4),lineId=id(5);
const invoiceEvidence={document_evidence_status:'COMPLETE',document_evidence_schema_version:'WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_V1',document_evidence_hash:hash('d'),document_kind:'INVOICE',tax_year:null,taxing_jurisdiction:null,tax_statement_identifier:null,tax_coverage_period_start:null,tax_coverage_period_end:null,tax_obligation_basis:null,controlled_property_ref:null,parcel_identifier:null,document_revision_schema_version:null,document_revision_kind:null,document_revision:null,predecessor_document_evidence_hash:null,predecessor_document_revision_hash:null,predecessor_document_revision:null,predecessor_source_record_id:null,document_revision_hash:null,document_lifecycle_status:'NOT_APPLICABLE'};
const policy={schema_version:'AI_CAPITALIZATION_POLICY_EVIDENCE_V1',setting_snapshot_id:id(10),setting_snapshot_hash:hash('c'),policy_version:1,rule_id:'AI_CAPITALIZATION_POLICY_V1',currency:'USD',capitalization_threshold:'5000.0000',eligible_cost_classes:['HARD_COST'],charge_code_classification:{'BUILD-HARD':'HARD_COST'},project_status_by_ref:{'PROJECT-1':'UNDER_CONSTRUCTION'},useful_life_months_by_cost_class:{HARD_COST:360},post_completion_treatment:'EXPENSE_OR_RECLASS_REVIEW'};
const service=overrides=>createAiInvoiceAccountingClassificationService({
  sourceReader:async()=>[{source_document_id:documentId,source_system:'WBS'}],
  detailReader:async()=>[{source_document_id:documentId,payload_hash:hash('a'),currency:'USD',posted_journal_entry_ids:[],lines:[{source_document_line_id:lineId,amount:'1200.0000',party_ref:'Insurance vendor',project_ref:null,property_ref:'PROPERTY-1',provider_trace:{trace_version:'WBS_PROVIDER_SOURCE_TRACE_V1',domain:'PAYABLES',disposition:'RETAINED',invoice_no:'INV-1',invoice_date:'2026-01-02',accrual:{service_period_start:'2026-01-01',service_period_end:'2026-12-31'}}}]}],
  evidenceReader:async()=>({accounting_period_id:periodId,signature_verified:true,admission_status:'ADMITTED',source_row_hash:hash('b'),...invoiceEvidence}),duplicateFindingReader:async()=>[],capitalizationPolicyReader:async()=>policy,...overrides
});

test('scans admitted retained payable evidence into a source-bound prepaid classification',async()=>{
  const result=await service().analyze({tenantId,entityId,accountingPeriodId:periodId});
  assert.equal(result.eligible_invoice_line_count,1);assert.equal(result.results[0].classification,'PREPAID_AMORTIZATION');assert.equal(result.results[0].source_line_hash,hash('b'));
  assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('duplicate findings block classification and unrelated period rows are excluded',async()=>{
  const duplicate=await service({duplicateFindingReader:async()=>[{source_document_id:documentId}]}).analyze({tenantId,entityId,accountingPeriodId:periodId});assert.equal(duplicate.results[0].classification,'BLOCKED');
  const wrongPeriod=await service({evidenceReader:async()=>({accounting_period_id:id(9),signature_verified:true,admission_status:'ADMITTED',source_row_hash:hash('b')})}).analyze({tenantId,entityId,accountingPeriodId:periodId});assert.equal(wrongPeriod.eligible_invoice_line_count,0);
});

test('does not inspect immutable artifact bytes or invoke a model',async()=>{
  const calls=[];const result=await service({detailReader:async input=>(calls.push(['detail',input]),[]),evidenceReader:async input=>(calls.push(['evidence',input]),null)}).analyze({tenantId,entityId,accountingPeriodId:periodId});
  assert.equal(result.row_count,0);assert.deepEqual(calls,[['detail',{tenantId,entityId,sourceDocumentId:documentId}]]);
});

test('fails the entire read on an authoritative evidence-reader failure',async()=>{
  await assert.rejects(service({evidenceReader:async()=>{throw Object.assign(new Error('database unavailable'),{code:'SERIALIZATION_RETRY_EXHAUSTED'});}}).analyze({tenantId,entityId,accountingPeriodId:periodId}),error=>error.code==='SERIALIZATION_RETRY_EXHAUSTED');
});

test('atomically materializes the exact computed batch with actor-bound idempotency',async()=>{
  const writes=[];const result=await service({materializeWriter:async input=>(writes.push(input),{schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_RUN_RECEIPT_V1',inserted_count:1})}).analyzeAndMaterialize({tenantId,entityId,accountingPeriodId:periodId,idempotencyKey:'invoice-scan-001'});
  assert.equal(result.inserted_count,1);assert.equal(writes.length,1);assert.equal(writes[0].batch.results[0].classification,'PREPAID_AMORTIZATION');assert.equal(writes[0].idempotencyKey,'invoice-scan-001');
  assert.deepEqual(writes[0].batch.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('does not scan when persistence or a stable idempotency key is unavailable',async()=>{
  await assert.rejects(service().analyzeAndMaterialize({tenantId,entityId,accountingPeriodId:periodId,idempotencyKey:'invoice-scan-001'}),error=>error.code==='AI_INVOICE_CLASSIFICATION_PERSISTENCE_UNAVAILABLE');
  await assert.rejects(service({materializeWriter:async()=>({})}).analyzeAndMaterialize({tenantId,entityId,accountingPeriodId:periodId,idempotencyKey:'short'}),error=>error.code==='AI_INVOICE_CLASSIFICATION_IDEMPOTENCY_INVALID');
});

test('retained invoice wording triggers coverage review instead of silent expense treatment',async()=>{
  const result=await service({detailReader:async()=>[{source_document_id:documentId,payload_hash:hash('a'),currency:'USD',posted_journal_entry_ids:[],lines:[{source_document_line_id:lineId,amount:'1200.0000',party_ref:'Annual Insurance Company',project_ref:null,property_ref:null,description:'Annual insurance premium',provider_trace:{trace_version:'WBS_PROVIDER_SOURCE_TRACE_V1',domain:'PAYABLES',disposition:'RETAINED',invoice_no:'INV-2',invoice_date:'2026-01-02',invoice_description:'Annual insurance premium',accrual:{service_period_start:null,service_period_end:null,charge_code:'BUILD-HARD'}}}]}]}).analyze({tenantId,entityId,accountingPeriodId:periodId});
  assert.equal(result.results[0].classification,'BLOCKED');assert.equal(result.results[0].rule_id,'AI_PREPAID_COVERAGE_REQUIRED_V1');
});

test('historical documents cannot crowd current-period invoices out of a bounded scan',async()=>{
  const oldDocuments=Array.from({length:3},(_,index)=>({source_document_id:id(20+index),source_system:'WBS'}));
  const currentDocument={source_document_id:documentId,source_system:'WBS'};
  const detailFor=sourceDocumentId=>[{source_document_id:sourceDocumentId,payload_hash:hash('a'),currency:'USD',posted_journal_entry_ids:[],lines:[{source_document_line_id:lineId,amount:'100.0000',party_ref:'Ordinary Vendor',project_ref:null,property_ref:null,provider_trace:{trace_version:'WBS_PROVIDER_SOURCE_TRACE_V1',domain:'PAYABLES',disposition:'RETAINED',invoice_no:'INV-1',invoice_date:'2026-01-02',invoice_description:'Current monthly service',accrual:{service_period_start:null,service_period_end:null,charge_code:null}}}]}];
  const result=await service({
    sourceReader:async()=>[...oldDocuments,currentDocument],
    detailReader:async({sourceDocumentId})=>detailFor(sourceDocumentId),
    evidenceReader:async({sourceDocumentId})=>({accounting_period_id:sourceDocumentId===documentId?periodId:id(9),signature_verified:true,admission_status:'ADMITTED',source_row_hash:hash('b'),...invoiceEvidence})
  }).analyze({tenantId,entityId,accountingPeriodId:periodId,limit:1});
  assert.equal(result.eligible_invoice_line_count,1);assert.equal(result.scanned_document_count,1);
  assert.equal(result.results[0].classification,'EXPENSE');assert.equal(result.results[0].source_document_id,documentId);
});

test('fails closed rather than truncating bounded period-reader or fallback invoice populations',async()=>{
  const completeRow={source_document_id:documentId,source_document_line_id:lineId,source_payload_hash:hash('a'),source_line_hash:hash('b'),entity_id:entityId,accounting_period_id:periodId,accounting_date:'2026-01-31',vendor_name:'Ordinary Vendor',invoice_no:'INV-9',invoice_date:'2026-01-09',currency:'USD',amount:'100',service_period_start:null,service_period_end:null,description:'Monthly service',project_ref:null,property_ref:null,charge_code:null,accounting_status:'NOT_RECORDED',...invoiceEvidence};
  await assert.rejects(service({classificationInputReader:async()=>[completeRow]}).analyze({tenantId,entityId,accountingPeriodId:periodId,limit:1}),error=>error?.code==='AI_INVOICE_CLASSIFICATION_POPULATION_INCOMPLETE');
  await assert.rejects(service({detailReader:async()=>[{source_document_id:documentId,payload_hash:hash('a'),currency:'USD',posted_journal_entry_ids:[],lines:[
    {source_document_line_id:lineId,amount:'100.0000',party_ref:'Vendor',provider_trace:{trace_version:'WBS_PROVIDER_SOURCE_TRACE_V1',domain:'PAYABLES',disposition:'RETAINED',invoice_no:'INV-1',invoice_date:'2026-01-02'}},
    {source_document_line_id:id(6),amount:'200.0000',party_ref:'Vendor',provider_trace:{trace_version:'WBS_PROVIDER_SOURCE_TRACE_V1',domain:'PAYABLES',disposition:'RETAINED',invoice_no:'INV-2',invoice_date:'2026-01-03'}}
  ]}]}).analyze({tenantId,entityId,accountingPeriodId:periodId,limit:1}),error=>error?.code==='AI_INVOICE_CLASSIFICATION_POPULATION_INCOMPLETE');
});

test('passes exact period scope to source and duplicate evidence readers',async()=>{
  const calls=[];
  await service({sourceReader:async input=>(calls.push(['source',input]),[]),duplicateFindingReader:async input=>(calls.push(['duplicate',input]),[])}).analyze({tenantId,entityId,accountingPeriodId:periodId,limit:7});
  assert.deepEqual(calls.sort(([a],[b])=>a.localeCompare(b)),[
    ['duplicate',{tenantId,entityId,accountingPeriodId:periodId,limit:500}],
    ['source',{tenantId,entityId,accountingPeriodId:periodId}],
  ]);
});

test('dedicated period reader classifies every returned line without generic GL readers',async()=>{
  let genericReads=0;
  const result=await service({
    classificationInputReader:async input=>[{source_document_id:documentId,source_document_line_id:lineId,source_payload_hash:hash('a'),source_line_hash:hash('b'),entity_id:entityId,accounting_period_id:periodId,accounting_date:'2026-01-31',vendor_name:'Ordinary Vendor',invoice_no:'INV-9',invoice_date:'2026-01-09',currency:'USD',amount:'100',service_period_start:null,service_period_end:null,description:'Monthly service',project_ref:null,property_ref:null,charge_code:null,accounting_status:'NOT_RECORDED',...invoiceEvidence}],
    sourceReader:async()=>{genericReads+=1;return [];},detailReader:async()=>{genericReads+=1;return [];},evidenceReader:async()=>{genericReads+=1;return null;}
  }).analyze({tenantId,entityId,accountingPeriodId:periodId,limit:10});
  assert.equal(genericReads,0);assert.equal(result.row_count,1);assert.equal(result.results[0].classification,'EXPENSE');
  assert.equal(result.results[0].source_document_id,documentId);assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('Controller evidence flags Posted expense treatment for a multi-period prepaid invoice',async()=>{
  const result=await service({classificationInputReader:async()=>[{source_document_id:documentId,source_document_line_id:lineId,source_payload_hash:hash('a'),source_line_hash:hash('b'),entity_id:entityId,accounting_period_id:periodId,accounting_date:'2026-01-31',vendor_name:'Insurance Vendor',invoice_no:'INV-12',invoice_date:'2026-01-02',currency:'USD',amount:'1200.0000',service_period_start:'2026-01-01',service_period_end:'2026-12-31',description:'Annual insurance',project_ref:null,property_ref:null,charge_code:null,accounting_status:'POSTED',posted_debit_account_classes:['EXPENSE'],...invoiceEvidence}]}).analyze({tenantId,entityId,accountingPeriodId:periodId,includeControllerEvidence:true});
  assert.equal(result.results[0].classification,'PREPAID_AMORTIZATION');
  assert.deepEqual(result.controller_evidence[0],{status:'MISMATCH',expected_debit_account_class:'ASSET',observed_posted_debit_account_classes:['EXPENSE'],reason:'Expected only Posted ASSET debits, but retained Posted debits use EXPENSE.'});
});

test('Controller evidence accepts matching expense treatment and flags a Posted blocked invoice',async()=>{
  const base={source_document_id:documentId,source_document_line_id:lineId,source_payload_hash:hash('a'),source_line_hash:hash('b'),entity_id:entityId,accounting_period_id:periodId,accounting_date:'2026-01-31',vendor_name:'Ordinary Vendor',invoice_no:'INV-10',invoice_date:'2026-01-02',currency:'USD',amount:'100.0000',service_period_start:null,service_period_end:null,description:'Monthly service',project_ref:null,property_ref:null,charge_code:null,accounting_status:'POSTED',posted_debit_account_classes:['EXPENSE'],...invoiceEvidence};
  const consistent=await service({classificationInputReader:async()=>[base]}).analyze({tenantId,entityId,accountingPeriodId:periodId,includeControllerEvidence:true});
  assert.equal(consistent.controller_evidence[0].status,'CONSISTENT');
  const blocked=await service({classificationInputReader:async()=>[{...base,vendor_name:'Insurance Vendor',description:'Annual insurance policy'}]}).analyze({tenantId,entityId,accountingPeriodId:periodId,includeControllerEvidence:true});
  assert.equal(blocked.results[0].classification,'BLOCKED');assert.equal(blocked.controller_evidence[0].status,'MISMATCH');
  assert.match(blocked.controller_evidence[0].reason,/Posted even though/);
  const mixed=await service({classificationInputReader:async()=>[{...base,posted_debit_account_classes:['EXPENSE','ASSET']}]}).analyze({tenantId,entityId,accountingPeriodId:periodId,includeControllerEvidence:true});
  assert.equal(mixed.controller_evidence[0].status,'MISMATCH');assert.match(mixed.controller_evidence[0].reason,/Expected only Posted EXPENSE/);
});
