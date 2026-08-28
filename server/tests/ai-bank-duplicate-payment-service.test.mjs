import assert from 'node:assert/strict';
import test from 'node:test';
import {createAiBankDuplicatePaymentService} from '../runtime/ai-bank-duplicate-payment-service.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=n=>`sha256:${String(n%10).repeat(64)}`;
const rows=[1,2].map(n=>({bank_source_id:id(n),source_document_id:id(n+100),source_payload_hash:hash(n),entity_id:id(1),accounting_period_id:id(8),bank_account_ref:'OPERATING-001',external_bank_line_id:`BANK-${n}`,transaction_date:'2026-08-19',currency:'USD',amount:'-500.0000',source_admission_status:'ADMITTED',signature_verified:true}));

test('reads the exact authoritative period and produces a source-bound zero-action finding',async()=>{
  let read;const service=createAiBankDuplicatePaymentService({sourceReader:async input=>(read=input,rows)});
  const result=await service.analyze({tenantId:id(80),entityId:id(1),currentAccountingPeriodId:id(8),limit:25});
  assert.deepEqual(read,{tenantId:id(80),entityId:id(1),currentAccountingPeriodId:id(8),limit:25});assert.equal(result.finding_count,1);assert.equal(result.findings[0].source_trace.length,2);assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('fails before reading for an invalid scope',async()=>{
  let reads=0;const service=createAiBankDuplicatePaymentService({sourceReader:async()=>{reads+=1;return rows;}});
  await assert.rejects(()=>service.analyze({tenantId:'bad',entityId:id(1),currentAccountingPeriodId:id(8)}),error=>error.code==='AI_BANK_DUPLICATE_PAYMENT_SCOPE_INVALID');assert.equal(reads,0);
});

test('fails closed on a saturated population before findings or materialization',async()=>{
  let writes=0;const service=createAiBankDuplicatePaymentService({sourceReader:async()=>rows,materializeWriter:async()=>{writes+=1;}});
  await assert.rejects(()=>service.analyze({tenantId:id(80),entityId:id(1),currentAccountingPeriodId:id(8),limit:2}),error=>error.code==='AI_BANK_DUPLICATE_PAYMENT_POPULATION_INCOMPLETE');
  await assert.rejects(()=>service.analyzeAndMaterialize({tenantId:id(80),entityId:id(1),currentAccountingPeriodId:id(8),limit:2,idempotencyKey:'bank-duplicate-saturated'}),error=>error.code==='AI_BANK_DUPLICATE_PAYMENT_POPULATION_INCOMPLETE');
  assert.equal(writes,0);
});

test('materializes only the freshly recomputed immutable batch under one stable command identity',async()=>{
  let written;const receipt={schema_version:'AI_BANK_DUPLICATE_PAYMENT_RUN_RECEIPT_V1',can_create_draft:false,can_review:false,can_approve:false,can_post:false};
  const service=createAiBankDuplicatePaymentService({sourceReader:async()=>rows,materializeWriter:async input=>(written=input,receipt)});
  const result=await service.analyzeAndMaterialize({tenantId:id(80),entityId:id(1),currentAccountingPeriodId:id(8),idempotencyKey:'bank-duplicate-001'});
  assert.equal(result,receipt);assert.equal(written.batch.finding_count,1);assert.equal(written.accountingPeriodId,id(8));assert.equal(written.idempotencyKey,'bank-duplicate-001');
});
