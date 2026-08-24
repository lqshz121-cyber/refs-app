import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',periodId='33333333-3333-4333-8333-333333333333';
const safe={schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_BATCH_V1',row_count:0,results:[],classification_counts:{EXPENSE:0,PREPAID_AMORTIZATION:0,ACCRUAL_REVIEW:0,CAPITALIZATION_REVIEW:0,BLOCKED:0},scope:{tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId},scanned_document_count:0,eligible_invoice_line_count:0,action_flags:{can_create_draft:false,can_review:false,can_approve:false,can_post:false}};

test('invoice classification GET is period scoped, no-store, bodyless, and action-free',async()=>{
  const calls=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller'}),kernelFactory:async()=>({}),aiInvoiceAccountingClassificationServiceFactory:async()=>({analyze:async input=>(calls.push(input),safe)})});
  const path=`/api/v1/entities/${entityId}/ai/invoice-accounting-classifications?periodId=${periodId}&limit=25`;
  const response=await api({method:'GET',url:path});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,safe);
  assert.deepEqual(calls,[{tenantId,entityId,accountingPeriodId:periodId,limit:25}]);
  assert.equal((await api({method:'GET',url:path,headers:{'idempotency-key':'forbidden'}})).body.code,'READ_COMMAND_HEADERS_FORBIDDEN');
  assert.equal((await api({method:'GET',url:path,body:{}})).body.code,'READ_BODY_FORBIDDEN');
});

test('invoice classification fails closed on wrong scope or enabled accounting actions',async()=>{
  for(const unsafe of [{...safe,scope:{...safe.scope,entity_id:tenantId}},{...safe,action_flags:{...safe.action_flags,can_create_draft:true}},{...safe,raw_package:{secret:'forbidden'}}]){
    const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller'}),kernelFactory:async()=>({}),aiInvoiceAccountingClassificationServiceFactory:async()=>({analyze:async()=>unsafe})});
    const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/ai/invoice-accounting-classifications?periodId=${periodId}`});assert.equal(response.status,502);assert.equal(response.body.code,'AI_INVOICE_CLASSIFICATION_RESPONSE_INVALID');
  }
});

test('invoice classification population failure is an exact no-store 503',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller'}),kernelFactory:async()=>({}),aiInvoiceAccountingClassificationServiceFactory:async()=>({analyze:async()=>{throw Object.assign(new Error('full'),{code:'AI_INVOICE_CLASSIFICATION_POPULATION_INCOMPLETE'});}})});
  const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/ai/invoice-accounting-classifications?periodId=${periodId}&limit=1`});
  assert.equal(response.status,503);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.code,'AI_INVOICE_CLASSIFICATION_POPULATION_INCOMPLETE');
});

test('OpenAPI publishes the exact read-only classification route and closed DTO',async()=>{
  const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8')),operation=contract.paths['/entities/{entityId}/ai/invoice-accounting-classifications'].get;
  assert.equal(operation.operationId,'analyzeInvoiceAccountingClassifications');assert.equal(operation.responses['200'].$ref,'#/components/responses/AiInvoiceAccountingClassificationOk');
  const row=contract.components.schemas.AiInvoiceAccountingClassification;assert.equal(row.additionalProperties,false);assert.deepEqual(row.properties.classification.enum,['EXPENSE','PREPAID_AMORTIZATION','ACCRUAL_REVIEW','CAPITALIZATION_REVIEW','BLOCKED']);
  assert.equal(row.properties.schema_version.const,'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2');assert.ok(row.required.includes('policy_evidence'));assert.ok(row.required.includes('rule_id'));
  assert.deepEqual(contract.components.schemas.AiInvoiceNoAccountingActions.required,['can_create_draft','can_review','can_approve','can_post']);
  const run=contract.paths['/entities/{entityId}/ai/invoice-accounting-classification-runs'].post;assert.equal(run.operationId,'materializeInvoiceAccountingClassifications');assert.ok(run.parameters.some(parameter=>parameter.$ref==='#/components/parameters/IdempotencyKey'));
  const receipt=contract.components.schemas.AiInvoiceAccountingClassificationRunReceipt;assert.equal(receipt.additionalProperties,false);for(const flag of ['can_create_draft','can_review','can_approve','can_post'])assert.equal(receipt.properties[flag].const,false);
});

test('classification run atomically persists a closed source-bound receipt and requires idempotency',async()=>{
  const receipt={schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_RUN_RECEIPT_V1',accounting_period_id:periodId,row_count:1,inserted_count:1,replayed_count:0,classification_evidence_ids:['00000004-0000-4000-8000-000000000004'],request_hash:'sha256:'+'a'.repeat(64),can_create_draft:false,can_review:false,can_approve:false,can_post:false,idempotent:false};
  const calls=[],api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'actor'}),kernelFactory:async()=>({}),aiInvoiceAccountingClassificationServiceFactory:async()=>({analyzeAndMaterialize:async input=>(calls.push(input),receipt)})});
  const response=await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/invoice-accounting-classification-runs`,headers:{'Idempotency-Key':'invoice-scan-001'},body:{accounting_period_id:periodId,limit:25}});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,receipt);assert.deepEqual(calls,[{tenantId,entityId,accountingPeriodId:periodId,limit:25,idempotencyKey:'invoice-scan-001'}]);
  const missing=await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/invoice-accounting-classification-runs`,headers:{},body:{accounting_period_id:periodId}});assert.equal(missing.status,400);
});

test('classification run rejects action-enabled, extra, and inconsistent receipts',async()=>{
  for(const unsafe of [
    {schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_RUN_RECEIPT_V1',accounting_period_id:periodId,row_count:0,inserted_count:0,replayed_count:0,classification_evidence_ids:[],request_hash:'sha256:'+'a'.repeat(64),can_create_draft:true,can_review:false,can_approve:false,can_post:false,idempotent:false},
    {schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_RUN_RECEIPT_V1',accounting_period_id:periodId,row_count:1,inserted_count:0,replayed_count:0,classification_evidence_ids:[],request_hash:'sha256:'+'a'.repeat(64),can_create_draft:false,can_review:false,can_approve:false,can_post:false,idempotent:false}
  ]){
    const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'actor'}),kernelFactory:async()=>({}),aiInvoiceAccountingClassificationServiceFactory:async()=>({analyzeAndMaterialize:async()=>unsafe})});
    const response=await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/invoice-accounting-classification-runs`,headers:{'Idempotency-Key':'invoice-scan-001'},body:{accounting_period_id:periodId}});assert.equal(response.status,502);assert.equal(response.body.code,'AI_INVOICE_CLASSIFICATION_RECEIPT_INVALID');
  }
});
