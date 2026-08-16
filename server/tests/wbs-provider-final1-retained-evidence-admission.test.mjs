import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWbsProviderFinal1RetainedEvidenceAdmission} from '../runtime/wbs-provider-final1-retained-evidence-admission.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c';
const entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const actorId='oidc|wbs-provider-admission-service';
const receipt=Object.freeze({issuer:'wbs-provider',kid:'wbs-refs-2026-08-f98e6609',nonce:'nonce-1234567890',signed_at:'2026-08-16T00:00:00.000Z',expires_at:'2026-08-16T00:15:00.000Z'});
const packageBytes=Buffer.from(JSON.stringify({domain:'PAYABLES',date_from:'2026-01-01',date_to:'2026-06-30'}));
const raw=value=>Buffer.from(value).toString('base64');
const hash=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;

function fixture(overrides={}){
  const calls={scope:0,retain:0,stores:[]};
  const kernel={
    async readWbsProviderFinal1AdmissionScope(){calls.scope++;return {active:true,source_system:'WBS',company_code:'WBPA',base_currency:'USD',company_mapping_hash:'sha256:approved'};},
    async retainWbsProviderFinal1SourceEvidence(input){calls.retain++;calls.retained=input;return {status:'WBS_FINAL1_RETAINED_SOURCE_EVIDENCE',signature_verified:true,domain:input.delivery.domain,admission_id:input.delivery.admission_id,can_write_wbs:false,can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false};}
  };
  const storage={retentionDays:365,async putImmutableVersion(input){calls.stores.push(input);return {storageRef:`s3://refs/${input.artifact}`,storageVersion:`v-${calls.stores.length}`,sizeBytes:input.bytes.byteLength,contentHash:input.expectedHash,retentionMode:'COMPLIANCE',retainUntil:input.retentionUntil};}};
  const verified={signature_verified:true,raw_contains_credentials:false,admission_blockers:[],snapshot_id:'ca79111e-fbc5-4168-871d-aabd24813b18',date_from:'2026-01-01',date_to:'2026-06-30',row_count:1,package_hash:'sha256:package',package:{captured_at:'2026-08-16T00:00:00.000Z'}};
  const plan={plan_hash:'sha256:plan',rows:[{source_row_ordinal:0}],can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false};
  const service=createWbsProviderFinal1RetainedEvidenceAdmission({kernel,storage,providerTrust:{public_key:'PEM'},principal:{trusted:true,actorId},serviceActorId:actorId,clock:()=>Date.parse('2026-08-16T00:01:00.000Z'),verifyPayables:()=>overrides.verified??verified,verifyInsurance:()=>overrides.verified??verified,normalizePayables:()=>overrides.plan??plan,normalizeInsurance:()=>overrides.plan??plan});
  const input={domain:'PAYABLES',tenantId,entityId,receipt,requestRawBase64:raw('redacted request'),responseRawBase64:raw('redacted response'),packageRawBase64:packageBytes.toString('base64'),idempotencyKey:'wbs-final1-admission-0001'};
  return {calls,kernel,storage,service,input};
}

test('retains exactly four immutable artifacts before one atomic no-action database command',async()=>{
  const {calls,service,input}=fixture();
  const result=await service.admit(input);
  assert.equal(result.status,'WBS_FINAL1_RETAINED_SOURCE_EVIDENCE');
  assert.deepEqual(calls.stores.map(item=>item.artifact),['receipt.json','request.raw','response.raw','package.json']);
  assert.equal(calls.retain,1);
  assert.equal(calls.retained.delivery.company_code,'WBPA');
  assert.equal(calls.retained.delivery.package_raw_hash,hash(packageBytes));
  assert.equal(calls.retained.delivery.observation_at,'2026-08-16T00:00:00.000Z');
  assert.equal(calls.retained.artifacts.receipt.retentionMode,'COMPLIANCE');
  assert.equal(result.can_write_wbs,false);
  assert.equal(result.can_post,false);
  assert.equal(JSON.stringify(result).includes('redacted request'),false);
});

test('rejects a wrong service identity before scope, storage, or persistence',()=>{
  const {kernel,storage}=fixture();
  assert.throws(()=>createWbsProviderFinal1RetainedEvidenceAdmission({kernel,storage,providerTrust:{public_key:'PEM'},principal:{trusted:true,actorId:'human'},serviceActorId:actorId}),error=>error.code==='WBS_FINAL1_SERVICE_IDENTITY_DENIED');
});

test('rejects credentialed or action-enabled verifier output before immutable storage',async()=>{
  for(const override of [{verified:{signature_verified:true,raw_contains_credentials:true,admission_blockers:['RAW_ARTIFACT_CREDENTIAL_REDACTION_REQUIRED']}},{plan:{plan_hash:'sha256:plan',rows:[],can_propose_amortization:false,can_create_draft:true,can_review:false,can_approve:false,can_post:false}}]){
    const {calls,service,input}=fixture(override);
    await assert.rejects(service.admit(input),error=>error.code==='WBS_FINAL1_BOUNDARY_INVALID');
    assert.equal(calls.stores.length,0);
    assert.equal(calls.retain,0);
  }
});

test('a partial immutable-storage failure never calls the database retention command',async()=>{
  const {calls,service,input,storage}=fixture();
  storage.putImmutableVersion=async value=>{calls.stores.push(value);if(calls.stores.length===3)throw new Error('object lock unavailable');return {storageRef:`s3://refs/${value.artifact}`,storageVersion:`v-${calls.stores.length}`,sizeBytes:value.bytes.byteLength,contentHash:value.expectedHash,retentionMode:'COMPLIANCE',retainUntil:value.retentionUntil};};
  await assert.rejects(service.admit(input),/object lock unavailable/);
  assert.equal(calls.stores.length,3);
  assert.equal(calls.retain,0);
});
