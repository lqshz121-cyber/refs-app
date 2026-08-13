import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {buildWbsLivePilotObservation} from '../runtime/wbs-live-pilot-read-service.mjs';
import {createWbsOperatorAttestedPayableService} from '../runtime/wbs-operator-attested-payable.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const rows=[{ap_guid:'ap-2026-0001',amount:'89.12500',invoice_no:'INV-2026-1',invoice_date:'2026-07-01',incurred_date:'2026-07-10',posting_date:'2026-07-11',pay_due_date:'2026-07-20',company_code:'COMP-01',vendor_no:'V-01',currency:'USD'}];
const envelope={tool_name:'list_payables',contract_version:'WBS-REFS-MCP-V1',environment:'production',captured_at:'2026-08-13T00:00:00.000Z',scope:{company_codes:['COMP-01'],date_range:['2026-07-01','2026-07-31']},record_count:1,content_sha256:canonicalRequestHash(rows).slice(7),cursor_next:null,rows};
const observation=buildWbsLivePilotObservation({observed:envelope,entityId,tool:'list_payables'});

test('operator attestation rereads WBS and persists only unsigned exception evidence',async()=>{
  const calls=[];
  const client={initialize:async()=>calls.push('initialize'),listTools:async()=>calls.push('listTools'),readView:async args=>(calls.push(args),structuredClone(envelope))};
  const kernel={assertWbsOperatorPayableAttest:async args=>calls.push(args),attestWbsOperatorPayables:async args=>(calls.push(args),{wbs_operator_payable_attestation_id:'11111111-1111-4111-8111-111111111111',status:'EXCEPTION_REVIEW_REQUIRED',provenance_mode:'OPERATOR_ATTESTED',signature_verified:false,row_count:1,idempotent:false,can_import_to_staging:false,can_create_draft:false,can_approve:false,can_post:false})};
  const result=await createWbsOperatorAttestedPayableService({client,kernel}).attest({tenantId,entityId,expectedObservationHash:observation.observation_hash,expectedProviderContentSha256:observation.provider_content_sha256,reason:'Controller attests this exact WBS read for exception review.',limit:10,idempotencyKey:'operator-attest-0001'});
  assert.equal(result.status,'EXCEPTION_REVIEW_REQUIRED');assert.equal(result.signature_verified,false);assert.equal(result.can_import_to_staging,false);assert.equal(result.can_create_draft,false);assert.equal(result.can_post,false);
  assert.deepEqual(calls[0],{tenantId,entityId});assert.equal(calls[3].toolName,'list_payables');
  const persisted=calls[4];assert.equal(persisted.rows.length,1);assert.equal(persisted.rows[0].source_record_id,'ap-2026-0001');assert.match(persisted.rows[0].source_version,/^operator:/);assert.match(persisted.rows[0].row_hash,/^sha256:[0-9a-f]{64}$/);assert.deepEqual(persisted.companyCodes,['COMP-01']);
});

test('changed, empty, ambiguous, or duplicate provider observations never reach persistence',async()=>{
  for(const [name,mutation,expected] of [
    ['changed',value=>{value.rows[0].amount='90.00000';value.content_sha256=canonicalRequestHash(value.rows).slice(7);},'WBS_OPERATOR_ATTEST_STALE_OBSERVATION'],
    ['empty',value=>{value.rows=[];value.record_count=0;value.content_sha256=canonicalRequestHash([]).slice(7);},'WBS_OPERATOR_ATTEST_STALE_OBSERVATION'],
    ['ambiguous',value=>{value.scope.company_codes=['COMP-01','COMP-02'];},'WBS_OPERATOR_ATTEST_STALE_OBSERVATION'],
    ['duplicate',value=>{value.rows.push(structuredClone(value.rows[0]));value.record_count=2;value.content_sha256=canonicalRequestHash(value.rows).slice(7);},'WBS_OPERATOR_ATTEST_STALE_OBSERVATION']
  ]){
    let writes=0;const value=structuredClone(envelope);mutation(value);
    const service=createWbsOperatorAttestedPayableService({client:{initialize:async()=>{},listTools:async()=>{},readView:async()=>value},kernel:{assertWbsOperatorPayableAttest:async()=>{},attestWbsOperatorPayables:async()=>{writes++;}}});
    await assert.rejects(service.attest({tenantId,entityId,expectedObservationHash:observation.observation_hash,expectedProviderContentSha256:observation.provider_content_sha256,reason:'Controller attests this exact WBS read for exception review.',limit:10,idempotencyKey:`operator-${name}-0001`}),error=>error.code===expected,name);
    assert.equal(writes,0,name);
  }
});

test('operator attestation never accepts rows or identity from the browser request',async()=>{
  const service=createWbsOperatorAttestedPayableService({client:{initialize:async()=>{},listTools:async()=>{},readView:async()=>structuredClone(envelope)},kernel:{assertWbsOperatorPayableAttest:async()=>{},attestWbsOperatorPayables:async()=>({status:'EXCEPTION_REVIEW_REQUIRED',signature_verified:false,can_create_draft:false,can_post:false})}});
  await assert.rejects(service.attest({tenantId,entityId,expectedObservationHash:'sha256:'+'0'.repeat(64),expectedProviderContentSha256:observation.provider_content_sha256,reason:'Controller attests this exact WBS read for exception review.',limit:10,idempotencyKey:'operator-attest-0002',rows:[{ap_guid:'forged'}]}),error=>error.code==='WBS_OPERATOR_ATTEST_STALE_OBSERVATION');
});
