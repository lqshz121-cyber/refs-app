import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import contract from '../api/openapi-accounting.json' with {type:'json'};

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const path=`/api/v1/entities/${entityId}/wbs/operator-attested/payables`;
const body={expectedObservationHash:'sha256:'+'1'.repeat(64),expectedProviderContentSha256:'2'.repeat(64),expectedCompanyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',reason:'Controller attests this exact WBS read for exception review.',limit:10};
const result={wbs_operator_payable_attestation_id:'11111111-1111-4111-8111-111111111111',status:'EXCEPTION_REVIEW_REQUIRED',provenance_mode:'OPERATOR_ATTESTED',signature_verified:false,company_scope_status:'UNASSIGNED_COMPANY',row_count:1,idempotent:false,can_import_to_staging:false,can_review:false,can_create_draft:false,can_approve:false,can_post:false};

test('HTTP accepts only exact authenticated operator attestation hashes and sends no rows',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator-a'}),kernelFactory:async()=>({}),wbsOperatorAttestedPayableServiceFactory:async()=>({attest:async input=>(seen.push(input),result)})});
  const response=await api({method:'POST',url:path,headers:{'idempotency-key':'operator-attest-http-0001'},body});
  assert.equal(response.status,201);assert.deepEqual(response.body.data,result);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(seen[0],{tenantId,entityId,...body,idempotencyKey:'operator-attest-http-0001'});assert.equal(Object.hasOwn(seen[0],'rows'),false);
  for(const forged of [{...body,rows:[]},{...body,tenantId},{...body,signature_verified:true}]){
    const denied=await api({method:'POST',url:path,headers:{'idempotency-key':'operator-attest-http-0002'},body:forged});assert.equal(denied.status,400);
  }
  const staleHeader=await api({method:'POST',url:path,headers:{'idempotency-key':'operator-attest-http-0003','if-match':'"0"'},body});assert.equal(staleHeader.status,400);assert.equal(staleHeader.body.code,'IF_MATCH_NOT_ALLOWED');
});

test('operator attestation route remains unavailable without configured server-side WBS read credentials',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator-a'}),kernelFactory:async()=>({})});
  const response=await api({method:'POST',url:path,headers:{'idempotency-key':'operator-attest-http-0004'},body});assert.equal(response.status,503);assert.equal(response.body.code,'WBS_OPERATOR_ATTEST_UNAVAILABLE');
});

test('operator attestation evidence list is GET-only, closed, no-store, and safe',async()=>{
  const safe=[{wbs_operator_payable_attestation_id:'11111111-1111-4111-8111-111111111111',captured_at:'2026-08-13T00:00:00Z',company_code:null,company_codes:[],company_scope_status:'UNASSIGNED_COMPANY',row_count:3,provenance_mode:'OPERATOR_ATTESTED',signature_verified:false,evidence_status:'EXCEPTION_REVIEW_REQUIRED',can_create_draft:false,can_post:false,attested_at:'2026-08-13T00:01:00Z'}];
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator-a'}),kernelFactory:async()=>({listWbsOperatorPayableAttestations:async input=>(seen.push(input),safe)})});
  const response=await api({method:'GET',url:`${path}?limit=25`,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,safe);assert.deepEqual(seen,[{tenantId,entityId,limit:25}]);
  for(const request of [
    {method:'GET',url:path,headers:{'idempotency-key':'forbidden'},body:null},
    {method:'GET',url:path,headers:{'if-match':'"0"'},body:null},
    {method:'GET',url:path,headers:{},body:{}},
    {method:'GET',url:`${path}?limit=0`,headers:{},body:null},
    {method:'GET',url:`${path}?unexpected=1`,headers:{},body:null}
  ])assert.equal((await api(request)).status,400);
});

test('retained exception-row detail is a scoped no-store GET with no command authority',async()=>{
  const attestationId='11111111-1111-4111-8111-111111111111';
  const safe=[{wbs_operator_payable_attestation_id:attestationId,wbs_operator_payable_evidence_row_id:'22222222-2222-4222-8222-222222222222',captured_at:'2026-08-13T00:00:00Z',provider_content_hash:'sha256:'+'3'.repeat(64),observation_hash:'sha256:'+'4'.repeat(64),company_code:null,company_scope_status:'UNASSIGNED_COMPANY',source_record_id:'payable-1',source_version:'operator:v1',row_hash:'sha256:'+'5'.repeat(64),document_number:'INV-100',accounting_date:'2026-04-09',currency:'USD',observed_amount:'810.0000',provider_status:'Clear',signed_link_status:'EXCEPTION_REVIEW_REQUIRED',signed_wbs_inbound_row_id:null,next_owner:'Accounting data steward',next_action:'Assign this row to one approved WBS company, then obtain a signed provider package.',evidence_status:'EXCEPTION_REVIEW_REQUIRED',signature_verified:false,can_review:false,can_create_draft:false,can_post:false}];
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator-a'}),kernelFactory:async()=>({listWbsOperatorPayableExceptionRows:async input=>(seen.push(input),safe)})});
  const response=await api({method:'GET',url:`${path}/${attestationId}/rows?limit=10`,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,safe);assert.deepEqual(seen,[{tenantId,entityId,wbsOperatorPayableAttestationId:attestationId,limit:10}]);
  for(const request of [{method:'GET',url:`${path}/${attestationId}/rows`,headers:{'idempotency-key':'forbidden'},body:null},{method:'GET',url:`${path}/${attestationId}/rows?limit=11`,headers:{},body:null},{method:'GET',url:`${path}/${attestationId}/rows?extra=1`,headers:{},body:null}])assert.equal((await api(request)).status,400);
});

test('OpenAPI closes the operator attestation request and explicitly forbids accounting promotion',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/operator-attested/payables'].post;
  assert.equal(operation.operationId,'attestObservedWbsPayables');assert.match(operation.description,/OPERATOR_ATTESTED/);assert.match(operation.description,/signature_verified=false/);assert.match(operation.description,/never creates Raw\/Source\/Staging/);
  const schema=contract.components.requestBodies.WbsOperatorPayableAttestation.content['application/json'].schema;
  assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required,['expectedObservationHash','expectedProviderContentSha256','reason','limit']);assert.equal(schema.properties.expectedCompanyCode.pattern,'^[A-Za-z0-9][A-Za-z0-9_:-]{0,63}$');assert.equal(schema.properties.dateFrom.format,'date');assert.equal(schema.properties.dateTo.format,'date');assert.equal(Object.hasOwn(schema.properties,'rows'),false);
  const read=contract.paths['/entities/{entityId}/wbs/operator-attested/payables'].get;
  assert.equal(read.operationId,'listOperatorAttestedWbsPayableEvidence');assert.match(read.description,/Unsigned exception evidence/);assert.match(read.description,/not Posted/);
  const detail=contract.paths['/entities/{entityId}/wbs/operator-attested/payables/{wbsOperatorPayableAttestationId}/rows'].get;
  assert.equal(detail.operationId,'listOperatorAttestedWbsPayableExceptionRows');assert.match(detail.description,/never promotes/);assert.equal(contract.components.schemas.WbsOperatorPayableExceptionRow.properties.can_review.const,false);
});
