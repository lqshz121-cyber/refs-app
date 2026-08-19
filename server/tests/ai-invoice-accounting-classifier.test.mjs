import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyRetainedInvoice,classifyRetainedInvoiceBatch} from '../runtime/ai-invoice-accounting-classifier.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=c=>`sha256:${c.repeat(64)}`;
const invoice=(overrides={})=>({
  source_document_id:id(1),source_document_line_id:id(2),source_payload_hash:hash('a'),source_line_hash:hash('b'),
  entity_id:id(3),accounting_period_id:id(4),vendor_name:'Example vendor',invoice_no:'INV-100',invoice_date:'2026-06-30',
  currency:'USD',amount:'1200.0000',service_period_start:null,service_period_end:null,description:'Operating services',
  project_ref:null,property_ref:null,duplicate_status:'NONE',accounting_status:'NOT_RECORDED',project_status:'OPERATING',
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
  ])assert.equal(classifyRetainedInvoice(row).classification,'CAPITALIZATION_REVIEW');
});

test('classifies prior-service unrecorded invoices for accrual review and ordinary invoices as expense',()=>{
  assert.equal(classifyRetainedInvoice(invoice({invoice_date:'2026-07-15',service_period_start:'2026-06-01',service_period_end:'2026-06-30'})).classification,'ACCRUAL_REVIEW');
  assert.equal(classifyRetainedInvoice(invoice()).classification,'EXPENSE');
});

test('fails closed on duplicates, partial periods, invalid evidence, and never poisons a batch',()=>{
  const batch=classifyRetainedInvoiceBatch([
    invoice(),
    invoice({source_document_line_id:id(5),duplicate_status:'POSSIBLE'}),
    invoice({source_document_line_id:id(6),service_period_start:'2026-01-01'}),
    invoice({source_document_line_id:id(7),source_line_hash:'bad'})
  ]);
  assert.equal(batch.row_count,4);
  assert.deepEqual(batch.classification_counts,{EXPENSE:1,PREPAID_AMORTIZATION:0,ACCRUAL_REVIEW:0,CAPITALIZATION_REVIEW:0,BLOCKED:3});
  assert.deepEqual(batch.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('rejects oversized scans before processing',()=>{
  assert.throws(()=>classifyRetainedInvoiceBatch(Array.from({length:501},()=>invoice())),error=>error.code==='AI_INVOICE_CLASSIFICATION_SCOPE_INVALID');
});
