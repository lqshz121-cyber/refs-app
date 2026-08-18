import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',periodId='33333333-3333-4333-8333-333333333333',sourceDocumentId='44444444-4444-4444-8444-444444444444';
const uuid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-${String(n).padStart(12,'0')}`,hash=letter=>`sha256:${letter.repeat(64)}`;
const control_totals={row_count:1,currency_totals:[{currency:'USD',row_count:1,amount_total:'10.0000'}]},control_totals_hash='sha256:faa6c295db3c0d8e097f0f897b7da3102ae098551023cc9e55bba1ebd14011e1';
const row={tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId,source_document_id:sourceDocumentId,raw_event_id:uuid(5),source_record_id:'insurance:POLICY-1',source_version:'v-1',source_row_hash:hash('1'),admission_id:uuid(6),admission_hash:hash('2'),snapshot_id:uuid(7),issuer:'refs-mcp.wbm3.com',key_id:'wbs-final1-2026',algorithm:'Ed25519',control_totals,control_totals_hash,receipt_hash:hash('3'),receipt_storage_version:'receipt-v1',request_raw_hash:hash('4'),request_storage_version:'request-v1',response_raw_hash:hash('5'),response_storage_version:'response-v1',package_raw_hash:hash('6'),package_hash:hash('7'),package_storage_version:'package-v1'};

test('repository derives canonical signed evidence only from exact Final-1 joins',async()=>{
  const queries=[];const kernel=Object.create(PostgresAccountingKernel.prototype);kernel.inSession=async work=>work({query:async(sql,params)=>{queries.push({sql,params});return queries.length===1?{rowCount:1,rows:[{}]}:{rowCount:1,rows:[row]};}});
  const result=await kernel.getWbsProviderSignedSourceEvidence({tenantId,entityId,sourceDocumentId});
  assert.deepEqual(result.control_totals,control_totals);assert.equal(result.control_totals_hash,control_totals_hash);assert.deepEqual(result.action_flags,{can_propose_amortization:false,can_review:false,can_create_draft:false,can_approve:false,can_post:false});
  assert.deepEqual(queries[0].params,[tenantId,entityId,'GL.JE.VIEW']);assert.deepEqual(queries[1].params,[tenantId,entityId,sourceDocumentId]);
  for(const token of ['wbs_final1_retained_source_row','wbs_final1_signed_business_source_row','wbs_final1_signed_control_total','r.raw_row_hash=d.payload_hash','r.accounting_period_id IS NOT NULL'])assert.match(queries[1].sql,new RegExp(token.replaceAll('.','\\.')));
  assert.equal(JSON.stringify(result).includes('storage_ref'),false);
});

test('HTTP signed evidence read is GET-only, no-store and fail-closed',async()=>{
  const calls=[],evidence={control_totals,control_totals_hash};const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({async getWbsProviderSignedSourceEvidence(input){calls.push(input);return evidence;}})});
  const url=`/api/v1/entities/${entityId}/wbs/provider-signed/evidence/source-documents/${sourceDocumentId}`,response=await api({method:'GET',url,headers:{accept:'application/json'}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:evidence});assert.deepEqual(calls,[{tenantId,entityId,sourceDocumentId}]);
  assert.equal((await api({method:'GET',url:`${url}?raw=true`,headers:{accept:'application/json'}})).status,400);assert.equal((await api({method:'GET',url,headers:{'idempotency-key':'no'}})).status,400);
  const absent=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({async getWbsProviderSignedSourceEvidence(){throw Object.assign(new Error('absent'),{code:'WBS_PROVIDER_SIGNED_SOURCE_EVIDENCE_NOT_AVAILABLE'});}})});
  assert.equal((await absent({method:'GET',url,headers:{accept:'application/json'}})).status,404);
});

test('OpenAPI publishes canonical closed evidence without raw or storage locations',async()=>{
  const document=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8')),schema=document.components.schemas.WbsProviderSignedSourceEvidence,totals=document.components.schemas.WbsFinal1SignedControlTotals;
  assert.equal(document.paths['/entities/{entityId}/wbs/provider-signed/evidence/source-documents/{sourceDocumentId}'].get.responses['200'].$ref,'#/components/responses/WbsProviderSignedSourceEvidenceReadOk');
  assert.equal(schema.additionalProperties,false);assert.equal(totals.additionalProperties,false);assert.deepEqual(totals.required,['row_count','currency_totals']);assert.equal(schema.properties.action_flags.$ref,'#/components/schemas/WbsProviderActionFlags');
  const serialized=JSON.stringify(schema);for(const forbidden of ['storage_ref','raw_payload','requestRawBase64','responseRawBase64','packageRawBase64','detached_signature','access_token','client_secret'])assert.equal(serialized.includes(forbidden),false);
});
