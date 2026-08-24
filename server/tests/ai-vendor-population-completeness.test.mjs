import assert from 'node:assert/strict';
import test from 'node:test';
import {createAiVendorInvoiceAnomalyService} from '../runtime/ai-vendor-invoice-anomaly-service.mjs';
import {createAiVendorInvoiceFrequencyAnomalyService} from '../runtime/ai-vendor-invoice-frequency-anomaly-service.mjs';
import {createAiVendorInvoiceAmountDropAnomalyService} from '../runtime/ai-vendor-invoice-amount-drop-anomaly-service.mjs';
import {createAiVendorInvoiceNearDuplicateService} from '../runtime/ai-vendor-invoice-near-duplicate-service.mjs';
import {createAiNewVendorMaterialInvoiceReviewService} from '../runtime/ai-new-vendor-material-invoice-review-service.mjs';
import {createAccountingApi} from '../api/accounting-http.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenantId=id(1),entityId=id(2),periodId=id(3),document={source_system:'WBS',source_document_id:id(4)};
const dependencies={sourceReader:async()=>[document],detailReader:async()=>{throw new Error('detail read must not run for an incomplete population');},evidenceReader:async()=>{throw new Error('evidence read must not run for an incomplete population');},policyReader:async()=>({})};
const cases=[
  ['amount',createAiVendorInvoiceAnomalyService,'AI_VENDOR_ANOMALY_POPULATION_INCOMPLETE'],
  ['frequency',createAiVendorInvoiceFrequencyAnomalyService,'AI_VENDOR_FREQUENCY_POPULATION_INCOMPLETE'],
  ['amount-drop',createAiVendorInvoiceAmountDropAnomalyService,'AI_VENDOR_AMOUNT_DROP_POPULATION_INCOMPLETE'],
  ['near-duplicate',createAiVendorInvoiceNearDuplicateService,'AI_VENDOR_NEAR_DUPLICATE_POPULATION_INCOMPLETE']
];

for(const [name,factory,code] of cases)test(`${name} vendor analysis fails closed when its bounded source population is full`,async()=>{
  const service=factory(dependencies);
  await assert.rejects(service.analyze({tenantId,entityId,currentAccountingPeriodId:periodId,limit:1}),error=>error?.code===code);
});

test('new-vendor material analysis fails closed when its bounded source population is full',async()=>{
  const service=createAiNewVendorMaterialInvoiceReviewService(dependencies);
  await assert.rejects(service.analyze({tenantId,entityId,accountingPeriodId:periodId,limit:1}),error=>error?.code==='AI_NEW_VENDOR_MATERIAL_POPULATION_INCOMPLETE');
});

test('population failures remain no-store 503 at the HTTP boundary',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:id(9)}),kernelFactory:async()=>({}),aiVendorInvoiceAnomalyServiceFactory:async()=>({analyze:async()=>{throw Object.assign(new Error('full'),{code:'AI_VENDOR_ANOMALY_POPULATION_INCOMPLETE'});}})});
  const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/ai/vendor-invoice-amount-anomalies?periodId=${periodId}&limit=1`,headers:{},body:null});
  assert.equal(response.status,503);
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(response.body.code,'AI_VENDOR_ANOMALY_POPULATION_INCOMPLETE');
});
