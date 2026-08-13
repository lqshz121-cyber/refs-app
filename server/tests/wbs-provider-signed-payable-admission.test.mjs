import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {buildWbsMcpReadonlySnapshot} from '../runtime/wbs-mcp-inbound-lineage.mjs';
import {createWbsSignedDelivery} from '../runtime/wbs-signed-delivery-admission.mjs';
import {createWbsProviderSignedPayableAdmission,WbsProviderSignedPayableAdmissionError} from '../runtime/wbs-provider-signed-payable-admission.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222';
const serviceActorId='oidc|wbs-provider-admission-service',pair=generateKeyPairSync('ed25519'),keyId='provider-key-2026';
const privateKeyPem=pair.privateKey.export({type:'pkcs8',format:'pem'}).toString();
const row={ap_guid:'33333333-3333-4333-8333-333333333333',ap_type:'AUTOC',company_code:'COMPANY-A',currency:'USD',amount:'125.5000',incurred_date:'2026-08-10',posting_date:'2026-08-11',vendor_no:'VENDOR-1'};
const source={contract_version:'WBS-REFS-MCP-V1',tool:'list_payables',environment:'production',captured_at:'2026-08-11T02:00:00.000Z',source:{system:'WBS'},scope:{company:'COMPANY-A',currency:'USD',snapshot_token:'provider-snapshot-payable-1'},record_count:1,content_sha256:canonicalRequestHash([row]).slice(7),cursor_next:null,etl_notice:'Snapshot comparison required',rows:[row]};
const conventions=[{scope:{company_key:'COMPANY-A',currency:'USD'},receipt:{hash:`sha256:${source.content_sha256}`,ref:'object://wbs/payable/direction',version:'1',verification_id:'verify-payable-1',key_id:keyId,algorithm:'Ed25519',verified_on:'2026-08-11T02:00:00.000Z'},rule_id:'WBS-PAYABLE-DIRECTION-1',version:'1',ap_type:'AUTOC',direction:'DEBIT'}];
const unsignedSnapshot=()=>buildWbsMcpReadonlySnapshot({envelopes:[source],snapshotId:'44444444-4444-4444-8444-444444444444',dictionaryVersion:'WBS-MCP-V1',environment:'PRODUCTION',delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',snapshot_token:'provider-snapshot-payable-1',extract_started_at:'2026-08-11T01:59:00.000Z',extract_completed_at:'2026-08-11T02:00:00.000Z',consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'},detachedSignature:{key_id:keyId,algorithm:'Ed25519',value:'placeholder'},payableDirectionConventions:conventions});

async function delivery({nonce='nonce-0001',signedAt='2026-08-11T02:01:00.000Z',expiresAt='2026-08-11T02:11:00.000Z',creationNow=Date.parse('2026-08-11T02:02:00.000Z')}={}){
  const made=await createWbsSignedDelivery({unsignedSnapshot:unsignedSnapshot(),requestRaw:Buffer.from('{"query":"payables"}'),responseRaw:Buffer.from('{"count":1}'),scope:{tenant_id:tenantId,entity_id:entityId,company_code:'COMPANY-A'},issuer:'wbs-provider',keyId,nonce,signedAt,expiresAt,privateKeyPem,now:creationNow});
  return {...made,body:{receipt:made.receipt,requestRawBase64:Buffer.from('{"query":"payables"}').toString('base64'),responseRawBase64:Buffer.from('{"count":1}').toString('base64'),packageRawBase64:made.packageRaw.toString('base64')}};
}
function harness({actorId=serviceActorId}={}){const calls=[];const kernel={async admitWbsProviderSignedPayables(input){calls.push(input);return {status:'PERSISTED_PAYABLE_STAGING_REVIEW_REQUIRED',signature_verified:true,wbs_provider_signed_payable_admission_id:'55555555-5555-4555-8555-555555555555',row_count:1,can_create_draft:false,can_approve:false,can_post:false,idempotent:false};}};return {calls,service:createWbsProviderSignedPayableAdmission({kernel,providerTrust:null,principal:{trusted:true,tenantId,actorId},serviceActorId,clock:()=>Date.parse('2026-08-11T02:02:00.000Z')}),kernel};}
const createService=(kernel,providerTrust,actorId=serviceActorId)=>createWbsProviderSignedPayableAdmission({kernel,providerTrust,principal:{trusted:true,tenantId,actorId},serviceActorId,clock:()=>Date.parse('2026-08-11T02:02:00.000Z')});

test('verified provider delivery reaches exactly one atomic non-dispatchable kernel command',async()=>{
  const made=await delivery(),calls=[],kernel={async admitWbsProviderSignedPayables(input){calls.push(input);return {status:'PERSISTED_PAYABLE_STAGING_REVIEW_REQUIRED',signature_verified:true,row_count:1,can_create_draft:false,can_approve:false,can_post:false,idempotent:false};}};
  const service=createService(kernel,made.providerTrust),result=await service.admit({tenantId,entityId,...made.body,idempotencyKey:'provider-signed-admission-0001'});
  assert.equal(calls.length,1);assert.equal(calls[0].delivery.nonce,'nonce-0001');assert.equal(calls[0].delivery.company_code,'COMPANY-A');assert.equal(calls[0].snapshot.schema_version,'WBS_READONLY_SNAPSHOT_V2');assert.equal(calls[0].groups.length,1);assert.equal(calls[0].groups[0].rows.length,1);assert.equal(result.can_post,false);
});

test('bad scope, changed raw hash, expired receipt, unsigned package and user identity perform zero persistence',async()=>{
  const base=await delivery(),cases=[];
  cases.push({...base.body,receipt:{...base.receipt,entity_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}});
  cases.push({...base.body,responseRawBase64:Buffer.from('{"count":2}').toString('base64')});
  cases.push((await delivery({nonce:'nonce-expired',signedAt:'2026-08-11T01:00:00.000Z',expiresAt:'2026-08-11T01:10:00.000Z',creationNow:Date.parse('2026-08-11T01:01:00.000Z')})).body);
  const unsigned=structuredClone(base.package);delete unsigned.detached_signature;cases.push({...base.body,packageRawBase64:Buffer.from(JSON.stringify(unsigned)).toString('base64')});
  for(const [index,body] of cases.entries()){const calls=[],kernel={async admitWbsProviderSignedPayables(input){calls.push(input);}};const service=createService(kernel,base.providerTrust);await assert.rejects(()=>service.admit({tenantId,entityId,...body,idempotencyKey:`provider-signed-negative-${index}`}),error=>error.code?.startsWith('WBS_'));assert.equal(calls.length,0);}
  assert.throws(()=>createService({admitWbsProviderSignedPayables:async()=>{}},base.providerTrust,'oidc|human-user'),error=>error instanceof WbsProviderSignedPayableAdmissionError&&error.code==='WBS_PROVIDER_SIGNED_SERVICE_IDENTITY_DENIED');
});

test('server construction rejects caller-supplied trust absence',async()=>{const made=await delivery();assert.throws(()=>createWbsProviderSignedPayableAdmission({kernel:{admitWbsProviderSignedPayables:async()=>{}},providerTrust:null,principal:{trusted:true,actorId:serviceActorId},serviceActorId}),error=>error.code==='WBS_PROVIDER_SIGNED_TRUST_REQUIRED');assert.equal(made.providerTrust.issuer,'wbs-provider');});
