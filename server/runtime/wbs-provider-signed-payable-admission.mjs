import {createHash} from 'node:crypto';
import {canonicalRequestHash} from './request-hash.mjs';
import {verifyWbsSignedDelivery} from './wbs-signed-delivery-admission.mjs';
import {createWbsSnapshotSignatureVerifier} from './wbs-snapshot-signature.mjs';
import {createWbsInboundDataAdapter,buildWbsInboundPersistencePlan} from './wbs-inbound-data-adapter.mjs';
import {assertPayableBoundary,assertPreparedBoundary} from './wbs-admitted-payable-ingestion.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY=/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/;
const BASE64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
// Three raw artifacts share one HTTP request.  Keep their combined canonical
// base64 representation below the explicit 10 MiB server body budget.
const MAX_RAW_BYTES=2*1024*1024;

export class WbsProviderSignedPayableAdmissionError extends Error{
  constructor(code,message){super(message);this.name='WbsProviderSignedPayableAdmissionError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsProviderSignedPayableAdmissionError(code,message);};
const text=value=>value==null?'':String(value).trim();
const sha256=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const raw=(value,label)=>{
  if(typeof value!=='string'||value.length===0||value.length%4!==0||!BASE64.test(value))fail('WBS_PROVIDER_SIGNED_RAW_INVALID',`${label} must be canonical base64.`);
  const bytes=Buffer.from(value,'base64');
  if(bytes.byteLength===0||bytes.byteLength>MAX_RAW_BYTES||bytes.toString('base64')!==value)fail('WBS_PROVIDER_SIGNED_RAW_INVALID',`${label} is absent, oversized, or noncanonical.`);
  return bytes;
};

export function createWbsProviderSignedPayableAdmission({kernel,providerTrust,principal,serviceActorId,clock=()=>Date.now()}={}){
  if(!kernel||typeof kernel.admitWbsProviderSignedPayables!=='function')fail('WBS_PROVIDER_SIGNED_PERSISTENCE_REQUIRED','The atomic provider-signed Payable kernel is required.');
  if(!principal?.trusted||!principal.actorId||principal.actorId!==serviceActorId)fail('WBS_PROVIDER_SIGNED_SERVICE_IDENTITY_DENIED','Only the configured authenticated OIDC service subject may admit provider deliveries.');
  if(!providerTrust||typeof providerTrust.public_key!=='string')fail('WBS_PROVIDER_SIGNED_TRUST_REQUIRED','Pinned provider trust is required from server configuration.');
  const snapshotVerifier=createWbsSnapshotSignatureVerifier({publicKeys:{[providerTrust.key_id]:providerTrust.public_key}});
  const snapshotReader=Object.freeze({readOnly:true,async readSnapshot(){fail('WBS_PROVIDER_SIGNED_DIRECT_READ_FORBIDDEN','A verified signed delivery must supply the snapshot.');}});
  const adapter=createWbsInboundDataAdapter({snapshotReader,verifyProductionSnapshot:snapshotVerifier});
  return Object.freeze({
    mode:'WBS_PROVIDER_SIGNED_PAYABLE_ADMISSION_V1',
    async admit({tenantId,entityId,receipt,requestRawBase64,responseRawBase64,packageRawBase64,idempotencyKey}={}){
      if(!UUID.test(text(tenantId))||!UUID.test(text(entityId)))fail('WBS_PROVIDER_SIGNED_IDENTITY_INVALID','Authenticated tenant and entity UUIDs are required.');
      if(!IDEMPOTENCY.test(text(idempotencyKey)))fail('WBS_PROVIDER_SIGNED_IDEMPOTENCY_REQUIRED','A stable 16-200 character idempotency key is required.');
      const requestRaw=raw(requestRawBase64,'requestRawBase64'),responseRaw=raw(responseRawBase64,'responseRawBase64'),packageRaw=raw(packageRawBase64,'packageRawBase64');
      let verified;
      try{
        verified=await verifyWbsSignedDelivery({providerTrust,receipt,requestRaw,responseRaw,packageRaw,
          expectedScope:{tenant_id:tenantId,entity_id:entityId,company_code:text(receipt?.company_code)},now:clock()});
      }catch(cause){throw new WbsProviderSignedPayableAdmissionError(cause?.code||'WBS_PROVIDER_SIGNED_VERIFICATION_FAILED','Provider signed delivery verification failed.');}
      const boundary=assertPayableBoundary(verified.snapshot);
      let prepared;
      try{prepared=await adapter.prepareVerified(verified.snapshot);}catch{fail('WBS_PROVIDER_SIGNED_PACKAGE_SIGNATURE_INVALID','The embedded production snapshot signature is invalid.');}
      assertPreparedBoundary(prepared,boundary);
      const plan=buildWbsInboundPersistencePlan({snapshot:verified.snapshot,prepared,tenantId,entityId,idempotencyKey});
      const groups=plan.raw_normalized_staging_persistence.receipt_groups;
      if(!groups.length)fail('WBS_PROVIDER_SIGNED_EMPTY','A signed delivery must contain at least one Payable row.');
      const delivery=Object.freeze({
        issuer:receipt.issuer,key_id:receipt.kid,algorithm:receipt.algorithm,nonce:receipt.nonce,
        company_code:receipt.company_code,signed_at:receipt.signed_at,expires_at:receipt.expires_at,
        request_raw_hash:receipt.request_sha256,response_raw_hash:receipt.response_sha256,
        package_raw_hash:receipt.package_hash,package_hash:verified.package_hash,
        receipt_hash:canonicalRequestHash(receipt),snapshot_id:verified.snapshot_id
      });
      const snapshot=Object.freeze({
        schema_version:verified.snapshot.schema_version,snapshot_id:boundary.validated.snapshot_id,
        captured_at:boundary.validated.captured_at,environment:boundary.validated.environment,
        source_system:'WBS',dictionary_version:boundary.validated.dictionary_version,
        package_hash:boundary.validated.package_hash,views:verified.snapshot.views,
        receipts:boundary.validated.receipts,delivery_attestation:boundary.validated.delivery_attestation
      });
      const result=await kernel.admitWbsProviderSignedPayables({tenantId,entityId,delivery,snapshot,groups,idempotencyKey});
      if(!result||result.status!=='PERSISTED_PAYABLE_STAGING_REVIEW_REQUIRED'||result.signature_verified!==true||result.can_create_draft!==false||result.can_approve!==false||result.can_post!==false)fail('WBS_PROVIDER_SIGNED_RESULT_INVALID','Atomic admission returned an unsafe result.');
      return Object.freeze({...result,request_raw_hash:sha256(requestRaw),response_raw_hash:sha256(responseRaw),package_raw_hash:sha256(packageRaw)});
    }
  });
}
