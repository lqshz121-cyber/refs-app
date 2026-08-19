import assert from 'node:assert/strict';
import {refreshAuthoritativeAiInvoiceAccountingClassifications,retainAuthoritativeAiInvoiceAccountingClassifications} from '../src/accounting-api.js';

const entityId='22222222-2222-4222-8222-222222222222',periodId='33333333-3333-4333-8333-333333333333',hash=c=>`sha256:${c.repeat(64)}`;
const config={baseUrl:'https://refs.example',entityId,periodId,getAccessToken:async()=> 'a'.repeat(48)};
const actions={can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const row={schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2',source_document_id:'44444444-4444-4444-8444-444444444444',source_document_line_id:'55555555-5555-4555-8555-555555555555',source_payload_hash:hash('a'),source_line_hash:hash('b'),classification:'PREPAID_AMORTIZATION',reason:'The retained invoice covers more than one accounting month.',confidence:0.98,required_human_fields:['prepaid_account','expense_account'],rule_id:'AI_MULTI_PERIOD_PREPAID_V1',policy_evidence:null,action_flags:actions};
const data={schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_BATCH_V1',row_count:1,results:[row],classification_counts:{EXPENSE:0,PREPAID_AMORTIZATION:1,ACCRUAL_REVIEW:0,CAPITALIZATION_REVIEW:0,BLOCKED:0},scope:{tenant_id:'11111111-1111-4111-8111-111111111111',entity_id:entityId,accounting_period_id:periodId},scanned_document_count:1,eligible_invoice_line_count:1,action_flags:actions};

const response=payload=>({ok:true,json:async()=>payload});

const run=async payload=>refreshAuthoritativeAiInvoiceAccountingClassifications({config,limit:50,fetcher:async(url,options)=>{
  assert.match(url,new RegExp(`/entities/${entityId}/ai/invoice-accounting-classifications\\?periodId=${periodId}&limit=50$`));assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');assert.equal('body' in options,false);assert.equal('idempotency-key' in options.headers,false);return response(payload);
}});

const accepted=await run({ok:true,data});assert.equal(accepted.ok,true,JSON.stringify(accepted));assert.equal(accepted.data.results[0].classification,'PREPAID_AMORTIZATION');
for(const unsafe of [{...data,action_flags:{...actions,can_post:true}},{...data,raw_package:{credential:'forbidden'}},{...data,results:[{...row,classification:'AUTO_POST'}]}]){
  const rejected=await run({ok:true,data:unsafe});assert.equal(rejected.ok,false);assert.equal(rejected.code,'AI_INVOICE_CLASSIFICATION_PROTOCOL');
}
const evidenceId='66666666-6666-4666-8666-666666666666',receipt={schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_RUN_RECEIPT_V1',accounting_period_id:periodId,row_count:1,inserted_count:1,replayed_count:0,classification_evidence_ids:[evidenceId],request_hash:hash('c'),...actions,idempotent:false};
const retained=await retainAuthoritativeAiInvoiceAccountingClassifications({config,limit:50,idempotencyKey:'invoice-classification-test-1',fetcher:async(url,options)=>{assert.equal(url,`https://refs.example/api/v1/entities/${entityId}/ai/invoice-accounting-classification-runs`);assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');assert.equal(options.headers['idempotency-key'],'invoice-classification-test-1');assert.deepEqual(JSON.parse(options.body),{accounting_period_id:periodId,limit:50});return {ok:true,status:201,json:async()=>({ok:true,data:receipt})};}});
assert.equal(retained.ok,true,JSON.stringify(retained));assert.equal(retained.data.can_post,false);
for(const unsafe of [{...receipt,can_create_draft:true},{...receipt,classification_evidence_ids:[]},{...receipt,request_hash:'weak-hash'},{...receipt,idempotent:true}]){const rejected=await retainAuthoritativeAiInvoiceAccountingClassifications({config,idempotencyKey:'invoice-classification-test-1',fetcher:async()=>({ok:true,status:201,json:async()=>({ok:true,data:unsafe})})});assert.equal(rejected.ok,false);assert.equal(rejected.code,'AI_INVOICE_CLASSIFICATION_RUN_PROTOCOL');}
console.log('authoritative AI invoice classification client: strict source-bound no-action DTO passed');
