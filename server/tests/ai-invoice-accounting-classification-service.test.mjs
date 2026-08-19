import assert from 'node:assert/strict';
import test from 'node:test';
import {createAiInvoiceAccountingClassificationService} from '../runtime/ai-invoice-accounting-classification-service.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`,hash=c=>`sha256:${c.repeat(64)}`;
const tenantId=id(1),entityId=id(2),periodId=id(3),documentId=id(4),lineId=id(5);
const service=overrides=>createAiInvoiceAccountingClassificationService({
  sourceReader:async()=>[{source_document_id:documentId,source_system:'WBS'}],
  detailReader:async()=>[{source_document_id:documentId,payload_hash:hash('a'),currency:'USD',posted_journal_entry_ids:[],lines:[{source_document_line_id:lineId,amount:'1200.0000',party_ref:'Insurance vendor',project_ref:null,property_ref:'PROPERTY-1',provider_trace:{trace_version:'WBS_PROVIDER_SOURCE_TRACE_V1',domain:'PAYABLES',disposition:'RETAINED',invoice_no:'INV-1',invoice_date:'2026-01-02',accrual:{service_period_start:'2026-01-01',service_period_end:'2026-12-31'}}}]}],
  evidenceReader:async()=>({accounting_period_id:periodId,signature_verified:true,admission_status:'ADMITTED',source_row_hash:hash('b')}),duplicateFindingReader:async()=>[],...overrides
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
