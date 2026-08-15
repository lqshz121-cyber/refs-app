import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {createSyntheticWbsSignedDelivery} from './helpers/synthetic-wbs-signed-delivery.mjs';
import {admitWbsProviderSignedPayableDelivery,WbsProviderSignedAdmissionClientError} from '../runtime/wbs-provider-signed-admission-client.mjs';

const NOW=Date.parse('2026-08-15T01:05:00.000Z');
async function fixture(){
  const tenantId=randomUUID(),entityId=randomUUID(),recordId=randomUUID(),snapshotId=randomUUID(),companyCode='WBPA',pair=generateKeyPairSync('ed25519');
  const rows=[{apGuId:recordId,companyCode,amount:'25.0000'}],snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:snapshotId,captured_at:'2026-08-15T01:00:00.000Z',environment:'PRODUCTION',source_system:'WBS',dictionary_version:'WBS-2026-08',delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',extract_started_at:'2026-08-15T01:00:00.000Z',extract_completed_at:'2026-08-15T01:00:00.000Z',consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'},views:[{name:'BGDATA.payable',company_key:companyCode,rows,content_hash:canonicalRequestHash(rows),row_count:1,first_primary_key:recordId,last_primary_key:recordId}]};
  const requestRaw=Buffer.from('{"query":"WBPA-2026"}'),responseRaw=Buffer.from('{"count":1}');
  const made=await createSyntheticWbsSignedDelivery({unsignedSnapshot:snapshot,requestRaw,responseRaw,scope:{tenant_id:tenantId,entity_id:entityId,company_code:companyCode},issuer:'wanbridge-wbs',keyId:'wbs-refs-2026-08-f98e6609',nonce:'wbpa-delivery-20260815-0001',signedAt:'2026-08-15T01:05:00.000Z',expiresAt:'2026-08-15T01:15:00.000Z',privateKeyPem:pair.privateKey.export({type:'pkcs8',format:'pem'}),now:NOW});
  return {tenantId,entityId,companyCode,recordId,requestRaw,responseRaw,...made};
}
const jsonResponse=(status,data)=>({ok:status>=200&&status<300,status,async text(){return JSON.stringify(status>=200&&status<300?{ok:true,data}:data);}});

test('offline-verifies, admits with the M2M token, and reads the closed review queue with a separate token',async()=>{
  const input=await fixture(),calls=[],admissionId=randomUUID();
  const rawHashes={request_raw_hash:input.receipt.request_sha256,response_raw_hash:input.receipt.response_sha256,package_raw_hash:input.receipt.package_hash};
  const validated=(await import('../runtime/wbs-snapshot-package.mjs')).validateWbsSnapshotPackage(input.package),receipt=validated.receipts[0];
  const fetchImpl=async(url,options)=>{calls.push({url,options});if(options.method==='POST')return jsonResponse(201,{status:'PERSISTED_PAYABLE_STAGING_REVIEW_REQUIRED',signature_verified:true,wbs_provider_signed_payable_admission_id:admissionId,snapshot_id:input.package.snapshot_id,company_code:input.companyCode,row_count:1,idempotent:false,can_create_draft:false,can_approve:false,can_post:false,...rawHashes});return jsonResponse(200,[{wbs_inbound_row_id:randomUUID(),source_version:receipt.source_version,receipt_hash:receipt.payload_hash,evidence_hash:`sha256:${'b'.repeat(64)}`,review_readiness:'VERIFIED_ATTACHMENT_REQUIRED',can_review:false}]);};
  const result=await admitWbsProviderSignedPayableDelivery({apiBaseUrl:'https://refs-accounting-api-staging.onrender.com',admissionAccessToken:'provider-m2m-secret-token',reviewAccessToken:'reviewer-secret-token',providerTrust:input.providerTrust,receipt:input.receipt,requestRaw:input.requestRaw,responseRaw:input.responseRaw,packageRaw:input.packageRaw,tenantId:input.tenantId,entityId:input.entityId,companyCode:input.companyCode,fetchImpl,now:NOW});
  assert.equal(result.status,'ADMITTED_SIGNED_PAYABLE_EVIDENCE');assert.equal(result.admission_http_status,201);assert.equal(result.readback.status,'READ_BACK_MATCHED');assert.equal(result.readback.record_count,1);assert.equal(result.can_post,false);
  assert.equal(calls.length,2);assert.equal(calls[0].options.headers.authorization,'Bearer provider-m2m-secret-token');assert.equal(calls[1].options.headers.authorization,'Bearer reviewer-secret-token');assert.match(calls[0].url,/provider-signed\/payables\/admissions$/);assert.match(calls[1].url,/review-candidates\?limit=50$/);
  assert(!JSON.stringify(result).includes('secret-token'));const posted=JSON.parse(calls[0].options.body);assert.equal(Buffer.from(posted.packageRawBase64,'base64').equals(input.packageRaw),true);
});

test('historical candidates are never attributed to the new admission',async()=>{
  const input=await fixture(),calls=[];
  const fetchImpl=async(url,options)=>{calls.push(url);return options.method==='POST'?jsonResponse(201,{status:'PERSISTED_PAYABLE_STAGING_REVIEW_REQUIRED',signature_verified:true,wbs_provider_signed_payable_admission_id:randomUUID(),snapshot_id:input.package.snapshot_id,company_code:input.companyCode,row_count:1,idempotent:false,can_create_draft:false,can_approve:false,can_post:false,request_raw_hash:input.receipt.request_sha256,response_raw_hash:input.receipt.response_sha256,package_raw_hash:input.receipt.package_hash}):jsonResponse(200,[{wbs_inbound_row_id:randomUUID(),source_version:'snapshot:historical',receipt_hash:`sha256:${'a'.repeat(64)}`,evidence_hash:`sha256:${'b'.repeat(64)}`,review_readiness:'READY_FOR_REVIEW',can_review:true}]);};
  const result=await admitWbsProviderSignedPayableDelivery({apiBaseUrl:'https://refs.example',admissionAccessToken:'provider-m2m-secret-token',reviewAccessToken:'reviewer-secret-token',providerTrust:input.providerTrust,receipt:input.receipt,requestRaw:input.requestRaw,responseRaw:input.responseRaw,packageRaw:input.packageRaw,tenantId:input.tenantId,entityId:input.entityId,companyCode:input.companyCode,fetchImpl,now:NOW});
  assert.deepEqual({status:result.readback.status,queue:result.readback.queue_record_count,matched:result.readback.record_count,rows:result.readback.rows},{status:'READ_BACK_NOT_OBSERVED',queue:1,matched:0,rows:[]});assert.equal(calls.length,2);
});

test('the optional readback token must not be identical to the admission token',async()=>{
  const input=await fixture();let calls=0;
  await assert.rejects(()=>admitWbsProviderSignedPayableDelivery({apiBaseUrl:'https://refs.example',admissionAccessToken:'same-service-token-value',reviewAccessToken:'same-service-token-value',providerTrust:input.providerTrust,receipt:input.receipt,requestRaw:input.requestRaw,responseRaw:input.responseRaw,packageRaw:input.packageRaw,tenantId:input.tenantId,entityId:input.entityId,companyCode:input.companyCode,fetchImpl:async()=>{calls++;return jsonResponse(201,{status:'PERSISTED_PAYABLE_STAGING_REVIEW_REQUIRED',signature_verified:true,wbs_provider_signed_payable_admission_id:randomUUID(),snapshot_id:input.package.snapshot_id,company_code:input.companyCode,row_count:1,idempotent:false,can_create_draft:false,can_approve:false,can_post:false,request_raw_hash:input.receipt.request_sha256,response_raw_hash:input.receipt.response_sha256,package_raw_hash:input.receipt.package_hash});},now:NOW}),error=>error.code==='WBS_PROVIDER_REVIEW_IDENTITY_NOT_SEPARATE');
  assert.equal(calls,0);
});

test('offline scope failure performs zero network calls',async()=>{
  const input=await fixture();let calls=0;
  await assert.rejects(()=>admitWbsProviderSignedPayableDelivery({apiBaseUrl:'https://refs.example',admissionAccessToken:'provider-m2m-secret-token',providerTrust:input.providerTrust,receipt:input.receipt,requestRaw:input.requestRaw,responseRaw:input.responseRaw,packageRaw:input.packageRaw,tenantId:input.tenantId,entityId:randomUUID(),companyCode:input.companyCode,fetchImpl:async()=>{calls++;},now:NOW}),error=>error.code==='WBS_SIGNED_DELIVERY_SCOPE_MISMATCH');
  assert.equal(calls,0);
});

test('HTTP rejection stops before readback and preserves the server error classification',async()=>{
  const input=await fixture();let calls=0;
  await assert.rejects(()=>admitWbsProviderSignedPayableDelivery({apiBaseUrl:'https://refs.example',admissionAccessToken:'provider-m2m-secret-token',reviewAccessToken:'reviewer-secret-token',providerTrust:input.providerTrust,receipt:input.receipt,requestRaw:input.requestRaw,responseRaw:input.responseRaw,packageRaw:input.packageRaw,tenantId:input.tenantId,entityId:input.entityId,companyCode:input.companyCode,fetchImpl:async()=>{calls++;return jsonResponse(403,{ok:false,code:'AUTHORIZATION_DENIED',message:'Forbidden'});},now:NOW}),error=>error instanceof WbsProviderSignedAdmissionClientError&&error.code==='AUTHORIZATION_DENIED'&&error.status===403);
  assert.equal(calls,1);
});

test('unsafe success responses fail closed and never run review readback',async()=>{
  const input=await fixture();let calls=0;
  await assert.rejects(()=>admitWbsProviderSignedPayableDelivery({apiBaseUrl:'https://refs.example',admissionAccessToken:'provider-m2m-secret-token',reviewAccessToken:'reviewer-secret-token',providerTrust:input.providerTrust,receipt:input.receipt,requestRaw:input.requestRaw,responseRaw:input.responseRaw,packageRaw:input.packageRaw,tenantId:input.tenantId,entityId:input.entityId,companyCode:input.companyCode,fetchImpl:async()=>{calls++;return jsonResponse(201,{status:'POSTED',signature_verified:true});},now:NOW}),error=>error.code==='WBS_PROVIDER_ADMISSION_RESPONSE_UNSAFE');
  assert.equal(calls,1);
});
