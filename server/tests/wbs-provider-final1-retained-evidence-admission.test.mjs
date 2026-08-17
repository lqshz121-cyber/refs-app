import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWbsProviderFinal1RetainedEvidenceAdmission} from '../runtime/wbs-provider-final1-retained-evidence-admission.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c';
const entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const actorId='AbCdEfGhIjKlMnOpQrStUvWxYz012345@clients';
const audience='refs-wbs-provider-final1';
const receipt=Object.freeze({issuer:'wbs-provider',kid:'wbs-refs-2026-08-f98e6609',nonce:'nonce-1234567890',signed_at:'2026-08-16T00:00:00.000Z',expires_at:'2026-08-16T00:15:00.000Z'});
const packageBytes=Buffer.from(JSON.stringify({domain:'PAYABLES',date_from:'2026-01-01',date_to:'2026-06-30'}));
const raw=value=>Buffer.from(value).toString('base64');
const hash=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;

function fixture(overrides={}){
  const calls={scope:0,retain:0,stores:[],scans:[],registry:[],markers:[],logs:[],events:[]};
  const kernel={
    async readWbsProviderFinal1AdmissionScope(){calls.scope++;return {active:true,source_system:'WBS',company_code:'WBPA',base_currency:'USD',company_mapping_hash:'sha256:approved'};},
    async retainWbsProviderFinal1SourceEvidence(input){calls.retain++;calls.events.push('retain');calls.retained=input;return {status:'WBS_FINAL1_RETAINED_SOURCE_EVIDENCE',signature_verified:true,domain:input.delivery.domain,admission_id:input.delivery.admission_id,can_write_wbs:false,can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false};},
    async recordWbsProviderFinal1OrphanRetainedObjects(input){calls.registry.push(input);if(overrides.registryFailure)throw new Error('registry offline');return {status:'WBS_FINAL1_ORPHAN_REGISTRY_RETAINED',object_count:Object.keys(input.artifacts).length};}
  };
  const storage={retentionDays:365,async putImmutableVersion(input){calls.stores.push(input);calls.events.push(`store:${input.artifact}`);return {storageRef:`s3://refs/${input.artifact}`,storageVersion:`v-${calls.stores.length}`,sizeBytes:input.bytes.byteLength,contentHash:input.expectedHash,mediaType:input.artifact.endsWith('.json')?'application/json':'application/octet-stream',retentionMode:'COMPLIANCE',retainUntil:input.retentionUntil};},async inspectImmutableVersion(){return {};},async readVerifiedVersion(){return new Uint8Array();},async putOrphanLifecycleMarker(input){calls.markers.push(input);if(overrides.markerFailure)throw new Error('marker offline');return {status:'WBS_FINAL1_ORPHAN_MARKER_RETAINED',contentHash:'sha256:'+'c'.repeat(64),storageVersion:'marker-v1'};}};
  const scanner={async scan(input){calls.scans.push(input);calls.events.push(`scan:${input.artifact}`);return overrides.scan?.(input,calls.scans.length)??{clean:true,scanRef:`clamav:${input.contentHash.slice(7)}:clean`};}};
  const verified={signature_verified:true,raw_contains_credentials:false,admission_blockers:[],snapshot_id:'ca79111e-fbc5-4168-871d-aabd24813b18',date_from:'2026-01-01',date_to:'2026-06-30',row_count:1,package_hash:'sha256:package',package:{captured_at:'2026-08-16T00:00:00.000Z'}};
  const plan={plan_hash:'sha256:plan',rows:[{source_row_ordinal:0}],can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false};
  const service=createWbsProviderFinal1RetainedEvidenceAdmission({kernel,storage,scanner,providerTrust:{public_key:'PEM'},principal:{trusted:true,actorId,tenantId,audiences:[audience]},serviceActorId:actorId,serviceAudience:audience,serviceTenantId:tenantId,clock:()=>Date.parse('2026-08-16T00:01:00.000Z'),opsLogger:{warn:value=>calls.logs.push(JSON.parse(value)),error:value=>calls.logs.push(JSON.parse(value))},verifyPayables:overrides.verifyPayables??(()=>overrides.verified??verified),verifyInsurance:()=>overrides.verified??verified,normalizePayables:()=>overrides.plan??plan,normalizeInsurance:()=>overrides.plan??plan});
  const input={domain:'PAYABLES',tenantId,entityId,receipt,requestRawBase64:raw('redacted request'),responseRawBase64:raw('redacted response'),packageRawBase64:packageBytes.toString('base64'),idempotencyKey:'wbs-final1-admission-0001'};
  return {calls,kernel,storage,scanner,service,input};
}

test('retains exactly four immutable artifacts before one atomic no-action database command',async()=>{
  const {calls,service,input}=fixture();
  const result=await service.admit(input);
  assert.equal(result.status,'WBS_FINAL1_RETAINED_SOURCE_EVIDENCE');
  assert.deepEqual(calls.stores.map(item=>item.artifact),['receipt.json','request.raw','response.raw','package.json']);
  assert.deepEqual(calls.events,['store:receipt.json','scan:receipt.json','store:request.raw','scan:request.raw','store:response.raw','scan:response.raw','store:package.json','scan:package.json','retain']);
  assert.equal(calls.scans.length,4);assert.ok(calls.scans.every(item=>item.admissionId&&item.storageVersion&&!item.attachmentId));
  assert.equal(calls.retain,1);
  assert.equal(calls.retained.delivery.company_code,'WBPA');
  assert.equal(calls.retained.delivery.package_raw_hash,hash(packageBytes));
  assert.equal(calls.retained.delivery.observation_at,'2026-08-16T00:00:00.000Z');
  assert.equal(calls.retained.artifacts.receipt.retentionMode,'COMPLIANCE');
  assert.equal(calls.retained.artifacts.receipt.scan_clean,true);assert.match(calls.retained.artifacts.receipt.scan_ref,/^clamav:[0-9a-f]{64}:clean$/);
  assert.equal(result.can_write_wbs,false);
  assert.equal(result.can_post,false);
  assert.equal(JSON.stringify(result).includes('redacted request'),false);
});

test('credential blockers are evaluated before the first COMPLIANCE PUT',async()=>{
  for(const mutate of [
    input=>{input.requestRawBase64=raw('?access_token=secret');},
    input=>{input.requestRawBase64=raw('X-Api-Key: secret');},
    input=>{input.requestRawBase64=raw('{"accessToken":"secret"}');},
    input=>{input.receipt={...input.receipt,accessToken:'secret'};},
    input=>{input.packageRawBase64=raw('{"domain":"PAYABLES","date_from":"2026-01-01","date_to":"2026-06-30","note":"?%2561ccess%255Ftoken=secret"}');}
  ]){
    const {calls,service,input}=fixture();mutate(input);
    await assert.rejects(service.admit(input),error=>error.code==='WBS_FINAL1_BOUNDARY_INVALID');
    assert.equal(calls.scope,0);assert.equal(calls.stores.length,0);assert.equal(calls.scans.length,0);assert.equal(calls.retain,0);
  }
});

test('rejects a wrong service identity before scope, storage, or persistence',()=>{
  const {kernel,storage}=fixture();
  for(const principal of [{trusted:true,actorId:'OtherClientId01234567890123456789@clients',tenantId,audiences:[audience]},{trusted:true,actorId,tenantId,audiences:['refs-human']},{trusted:true,actorId,tenantId,audiences:[audience,'refs-accounting']},{trusted:true,actorId,tenantId:entityId,audiences:[audience]}])assert.throws(()=>createWbsProviderFinal1RetainedEvidenceAdmission({kernel,storage,scanner:{scan:async()=>{}},providerTrust:{public_key:'PEM'},principal,serviceActorId:actorId,serviceAudience:audience,serviceTenantId:tenantId}),error=>error.code==='WBS_FINAL1_SERVICE_IDENTITY_DENIED');
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
  storage.putImmutableVersion=async value=>{calls.stores.push(value);if(calls.stores.length===3)throw new Error('object lock unavailable');return {storageRef:`s3://refs/${value.artifact}`,storageVersion:`v-${calls.stores.length}`,sizeBytes:value.bytes.byteLength,contentHash:value.expectedHash,mediaType:value.artifact.endsWith('.json')?'application/json':'application/octet-stream',retentionMode:'COMPLIANCE',retainUntil:value.retentionUntil};};
  await assert.rejects(service.admit(input),error=>error.code==='WBS_FINAL1_ORPHAN_RETAINED'&&error.retainedCount===2&&error.attemptedArtifact==='response.raw');
  assert.equal(calls.stores.length,3);
  assert.equal(calls.retain,0);
  assert.equal(calls.registry.length,1);assert.equal(calls.registry[0].failureStage,'STORAGE_OR_SCAN');assert.deepEqual(Object.keys(calls.registry[0].artifacts),['receipt','request']);
});

test('an unconfirmed first PUT failure writes no orphan registry row',async()=>{
  const {calls,service,input,storage}=fixture();storage.putImmutableVersion=async value=>{calls.stores.push(value);throw new Error('first PUT response unavailable');};
  await assert.rejects(service.admit(input),error=>error.code==='WBS_FINAL1_ORPHAN_RETAINED'&&error.retainedCount===0&&error.registryPersisted===false);
  assert.equal(calls.stores.length,1);assert.equal(calls.registry.length,0);assert.equal(calls.retain,0);
});

test('a second or third infected, unbound, or failed exact-version scan leaves zero database rows and reports retained orphans',async()=>{
  for(const [failAt,bad] of [[2,()=>({clean:false,scanRef:'clamav:'+'0'.repeat(64)+':infected'})],[3,input=>({clean:true,scanRef:`clamav:${input.contentHash.slice(7)}:infected`})],[2,()=>{throw new Error('scanner offline');}]]){
    const scan=(input,count)=>count===failAt?bad(input):{clean:true,scanRef:`clamav:${input.contentHash.slice(7)}:clean`};
    const {calls,service,input}=fixture({scan});
    await assert.rejects(service.admit(input),error=>error.code==='WBS_FINAL1_ORPHAN_RETAINED'&&error.retainedCount===failAt&&error.attemptedArtifact===calls.stores.at(-1).artifact);
    assert.equal(calls.retain,0);
    assert.equal(calls.stores.length,failAt);
    assert.equal(calls.scans.length,failAt);
    assert.equal(calls.registry.length,1);assert.equal(Object.keys(calls.registry[0].artifacts).length,failAt);
  }
});

test('database completion failure reports four retained artifacts without leaking storage refs',async()=>{
  const {calls,service,input,kernel}=fixture();kernel.retainWbsProviderFinal1SourceEvidence=async()=>{calls.retain++;throw new Error('s3://secret-bucket/key?token=secret');};
  await assert.rejects(service.admit(input),error=>error.code==='WBS_FINAL1_ORPHAN_RETAINED'&&error.retainedCount===4&&error.attemptedArtifact==='database-completion'&&!error.message.includes('secret'));
  assert.equal(calls.stores.length,4);assert.equal(calls.scans.length,4);assert.equal(calls.retain,1);assert.equal(calls.registry.length,1);assert.equal(calls.registry[0].failureStage,'DATABASE_COMPLETION');assert.equal(Object.keys(calls.registry[0].artifacts).length,4);
});

test('orphan registry failure falls back to one immutable lifecycle marker',async()=>{
  const {calls,service,input,kernel}=fixture({registryFailure:true});kernel.retainWbsProviderFinal1SourceEvidence=async()=>{calls.retain++;throw new Error('database unavailable');};
  await assert.rejects(service.admit(input),error=>error.code==='WBS_FINAL1_ORPHAN_RETAINED'&&error.registryPersisted===false&&error.markerPersisted===true&&!error.message.includes('unavailable'));
  assert.equal(calls.markers.length,1);assert.equal(calls.markers[0].failureStage,'DATABASE_COMPLETION');assert.equal(Object.keys(calls.markers[0].artifacts).length,4);assert.deepEqual(calls.logs,[{event:'wbs_final1_orphan_marker_retained',failure_stage:'DATABASE_COMPLETION',reason_code:'WBS_FINAL1_DATABASE_COMPLETION_FAILED',object_count:4,marker_hash:'sha256:'+'c'.repeat(64),marker_version:'marker-v1',marker_status:'RETAINED'}]);
});

test('dual orphan persistence failure stays redacted and emits a safe structured event',async()=>{
  const {calls,service,input,kernel}=fixture({registryFailure:true,markerFailure:true});kernel.retainWbsProviderFinal1SourceEvidence=async()=>{calls.retain++;throw new Error('database unavailable');};
  await assert.rejects(service.admit(input),error=>error.code==='WBS_FINAL1_ORPHAN_RETAINED'&&error.registryPersisted===false&&error.markerPersisted===false&&!error.message.includes('unavailable'));
  assert.deepEqual(calls.logs,[{event:'wbs_final1_orphan_persistence_failed',failure_stage:'DATABASE_COMPLETION',reason_code:'WBS_FINAL1_DATABASE_COMPLETION_FAILED',object_count:4,registry_status:'NOT_CONFIRMED',marker_status:'NOT_CONFIRMED'}]);
});

test('Insurance Phase B rereads and rescans the four original versions without another PUT or Controller VIEW',async()=>{
  const observationId='55555555-5555-4555-8555-555555555555',approvalId='66666666-6666-4666-8666-666666666666',admissionId='77777777-7777-4777-8777-777777777777',immutableVersion='88888888-8888-4888-8888-888888888888';
  const decisionHash=hash('controller decision'),mappingHash=hash('company mapping'),proposalHash=hash('proposal'),receiptBytes=Buffer.from(JSON.stringify(receipt)),payloads={receipt:receiptBytes,request:Buffer.from('request'),response:Buffer.from('response'),package:Buffer.from('{}')};
  const artifacts=Object.fromEntries(Object.entries(payloads).map(([name,bytes])=>[name,{storage_ref:`s3://refs/${name}`,storage_version:`version-${name}`,content_hash:hash(bytes),size_bytes:bytes.length,media_type:['receipt','package'].includes(name)?'application/json':'application/octet-stream',object_lock_mode:'COMPLIANCE',retain_until:'2027-08-16T00:00:00.000Z',scan_disposition:'CLEAN',scan_ref:`clamav:${hash(bytes).slice(7)}:clean`,scan_hash:hash(bytes)}]));
  const publicBase={schema_version:'REFS_INSURANCE_PRE_ADMISSION_OBSERVATION_V1',observation_id:observationId,status:'PRE_ADMISSION_OBSERVATION',admission_state:'NOT_ADMITTED',source_kind:'PRE_ADMISSION_OBSERVATION',source_evidence_hash:hash('source evidence'),scope_kind:'FIRST_PACKAGE_WBPA',scope_pc_code_count:1,artifact_set_hash:canonicalRequestHash(artifacts),package_hash:hash('package'),source_payload_hash:hash('source payload'),canonical_set_hash:hash('pc set'),captured_at:'2026-08-16T00:00:00.000Z',record_count:1,null_pc_code_row_count:0};
  const actions={can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false},write_delta={admission:0,retention:0,coverage:0,staging:0,journal_entry:0,ledger:0,audit:0,outbox:0,model_call:0,storage_action:0};
  const hashBase={...publicBase,admission_id:admissionId,immutable_version:immutableVersion,receipt_hash:hash(receiptBytes),date_from:'2026-01-01',date_to:'2026-12-31',signature_algorithm:'Ed25519',signature_verified:true,artifacts,actions,write_delta,public_dto:publicBase},observationHash=canonicalRequestHash(hashBase),observation={...hashBase,observation_hash:observationHash,public_dto:{...publicBase,observation_hash:observationHash}};
  const calls={puts:0,inspects:[],reads:[],scans:[],retains:0};
  const kernel={async readWbsProviderFinal1AdmissionScope(){return {active:true,source_system:'WBS',company_code:'WBPA',base_currency:'USD',company_mapping_hash:mappingHash};},async recordWbsProviderFinal1OrphanRetainedObjects(){throw new Error('not used');},async readWbsInsurancePcMappingAdmissionResume(){return {admission_id:admissionId,immutable_version:immutableVersion,receipt_hash:hash(receiptBytes),date_from:'2026-01-01',date_to:'2026-12-31',observation,approval:{mapping_approval_id:approvalId,canonical_mapping_decision_hash:decisionHash,parent_company_mapping_hash:mappingHash,proposal_hash:proposalHash,status:'APPROVED',revoked:false}};},async retainWbsProviderFinal1SourceEvidence(input){calls.retains++;return {status:'WBS_FINAL1_RETAINED_SOURCE_EVIDENCE',admission_id:input.delivery.admission_id};}};
  const storage={retentionDays:365,async putImmutableVersion(){calls.puts++;throw new Error('Phase B must not PUT');},async putOrphanLifecycleMarker(){throw new Error('not used');},async inspectImmutableVersion(ref,version,expected){calls.inspects.push({ref,version,expected});return expected;},async readVerifiedVersion({storageRef,storageVersion}){calls.reads.push({storageRef,storageVersion});return payloads[storageRef.split('/').at(-1)];}};
  const scanner={async scan(input){calls.scans.push(input);return {clean:true,scanRef:artifacts[input.artifact.replace(/\.(json|raw)$/,'')].scan_ref};}};
  const verified={signature_verified:true,raw_contains_credentials:false,admission_blockers:[],snapshot_id:immutableVersion,date_from:'2026-01-01',date_to:'2026-12-31',row_count:1,package_hash:publicBase.package_hash,raw_package_hash:publicBase.source_payload_hash,package:{captured_at:publicBase.captured_at}},plan={plan_hash:hash('plan'),evidence_rows:[{normalized:{pcCode:'PC-1'}}],can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false};
  const service=createWbsProviderFinal1RetainedEvidenceAdmission({kernel,storage,scanner,providerTrust:{public_key:'PEM'},principal:{trusted:true,actorId,tenantId,audiences:[audience]},serviceActorId:actorId,serviceAudience:audience,serviceTenantId:tenantId,clock:()=>Date.parse('2026-08-16T00:01:00.000Z'),verifyInsurance:()=>verified,normalizeInsurance:()=>plan,verifyPayables:()=>verified,normalizePayables:()=>plan});
  const result=await service.resumeInsurance({tenantId,entityId,observationId,expectedObservationHash:observationHash,expectedApprovalId:approvalId,expectedDecisionHash:decisionHash,expectedCompanyMappingHash:mappingHash,reason:'Resume exact immutable Insurance evidence after independent Controller approval.',idempotencyKey:'insurance-phase-b-resume-001'});
  assert.equal(result.status,'WBS_FINAL1_RETAINED_SOURCE_EVIDENCE');assert.equal(calls.puts,0);assert.equal(calls.inspects.length,4);assert.equal(calls.reads.length,4);assert.equal(calls.scans.length,4);assert.equal(calls.retains,1);
});
