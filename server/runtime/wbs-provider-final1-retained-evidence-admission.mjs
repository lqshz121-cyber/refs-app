import {createHash} from 'node:crypto';
import {canonicalRequestBody,canonicalRequestHash} from './request-hash.mjs';
import {verifyWbsProviderFinal1Delivery,verifyWbsProviderFinal1InsuranceDelivery} from './wbs-provider-final1-delivery.mjs';
import {normalizeVerifiedWbsProviderFinal1Payables} from './wbs-provider-final1-payable-normalizer.mjs';
import {normalizeVerifiedWbsProviderFinal1Insurance} from './wbs-provider-final1-insurance-normalizer.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const IDEMPOTENCY=/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/;
const BASE64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_ARTIFACT_BYTES=4*1024*1024;
const MAX_COMBINED_BYTES=7*1024*1024;

export class WbsProviderFinal1RetainedEvidenceError extends Error{
  constructor(code,message){super(message);this.name='WbsProviderFinal1RetainedEvidenceError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsProviderFinal1RetainedEvidenceError(code,message);};
const text=value=>value==null?'':String(value).trim();
const sha256=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const deterministicUuid=value=>{const bytes=createHash('sha256').update(value).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;};
const decode=(value,label)=>{
  if(typeof value!=='string'||value.length===0||value.length%4!==0||!BASE64.test(value))fail('WBS_FINAL1_RAW_INVALID',`${label} must be canonical base64.`);
  const bytes=Buffer.from(value,'base64');
  if(bytes.byteLength===0||bytes.byteLength>MAX_ARTIFACT_BYTES||bytes.toString('base64')!==value)fail('WBS_FINAL1_RAW_INVALID',`${label} is absent, oversized, or noncanonical.`);
  return bytes;
};
const packagePreflight=(packageRaw,domain)=>{
  let pkg;try{pkg=JSON.parse(packageRaw.toString('utf8'));}catch{fail('WBS_FINAL1_PACKAGE_INVALID','Final-1 package is not JSON.');}
  if(pkg?.domain!==domain||!DATE.test(pkg?.date_from||'')||!DATE.test(pkg?.date_to||'')||pkg.date_from>pkg.date_to)fail('WBS_FINAL1_PACKAGE_INVALID','Final-1 package domain or date range is invalid.');
  return {dateFrom:pkg.date_from,dateTo:pkg.date_to};
};
const artifactDescriptor=value=>Object.freeze({storage_ref:value.storageRef,storage_version:value.storageVersion,size_bytes:value.sizeBytes,content_hash:value.contentHash,retentionMode:value.retentionMode,retainUntil:value.retainUntil});

export function createWbsProviderFinal1RetainedEvidenceAdmission({
  kernel,storage,providerTrust,principal,serviceActorId,clock=()=>Date.now(),
  verifyPayables=verifyWbsProviderFinal1Delivery,verifyInsurance=verifyWbsProviderFinal1InsuranceDelivery,
  normalizePayables=normalizeVerifiedWbsProviderFinal1Payables,normalizeInsurance=normalizeVerifiedWbsProviderFinal1Insurance
}={}){
  if(!kernel||typeof kernel.readWbsProviderFinal1AdmissionScope!=='function'||typeof kernel.retainWbsProviderFinal1SourceEvidence!=='function')fail('WBS_FINAL1_PERSISTENCE_REQUIRED','Final-1 scope and atomic persistence kernel are required.');
  if(!storage||typeof storage.putImmutableVersion!=='function'||!Number.isInteger(storage.retentionDays))fail('WBS_FINAL1_STORAGE_REQUIRED','Immutable versioned WBS evidence storage is required.');
  if(!principal?.trusted||!principal.actorId||principal.actorId!==serviceActorId)fail('WBS_FINAL1_SERVICE_IDENTITY_DENIED','Only the configured authenticated OIDC service subject may retain Final-1 evidence.');
  if(!providerTrust||typeof providerTrust.public_key!=='string')fail('WBS_FINAL1_TRUST_REQUIRED','Pinned Provider trust is required.');
  for(const dependency of [verifyPayables,verifyInsurance,normalizePayables,normalizeInsurance])if(typeof dependency!=='function')fail('WBS_FINAL1_BOUNDARY_REQUIRED','Final-1 verification and normalization boundaries are required.');
  return Object.freeze({
    mode:'WBS_PROVIDER_FINAL1_RETAINED_EVIDENCE_V1',
    async admit({domain,tenantId,entityId,receipt,requestRawBase64,responseRawBase64,packageRawBase64,idempotencyKey}={}){
      if(!['PAYABLES','INSURANCE'].includes(domain)||!UUID.test(text(tenantId))||!UUID.test(text(entityId)))fail('WBS_FINAL1_SCOPE_INVALID','Authenticated tenant, entity, and fixed Final-1 domain are required.');
      if(!IDEMPOTENCY.test(text(idempotencyKey)))fail('WBS_FINAL1_IDEMPOTENCY_REQUIRED','A stable 16-200 character idempotency key is required.');
      const requestRaw=decode(requestRawBase64,'requestRawBase64'),responseRaw=decode(responseRawBase64,'responseRawBase64'),packageRaw=decode(packageRawBase64,'packageRawBase64');
      const receiptRaw=Buffer.from(canonicalRequestBody(receipt),'utf8');
      if(receiptRaw.byteLength<1||requestRaw.byteLength+responseRaw.byteLength+packageRaw.byteLength+receiptRaw.byteLength>MAX_COMBINED_BYTES)fail('WBS_FINAL1_RAW_INVALID','Final-1 artifact set exceeds the controlled admission bound.');
      const {dateFrom,dateTo}=packagePreflight(packageRaw,domain);
      const scope=await kernel.readWbsProviderFinal1AdmissionScope({tenantId,entityId,dateFrom,dateTo});
      if(!scope||scope.active!==true||scope.source_system!=='WBS'||typeof scope.company_code!=='string'||scope.base_currency!=='USD'||typeof scope.company_mapping_hash!=='string')fail('WBS_FINAL1_APPROVED_SCOPE_REQUIRED','An active Controller-approved WBS company/USD mapping is required.');
      let verified,plan;
      try{
        if(domain==='PAYABLES'){
          verified=verifyPayables({providerTrust,receipt,requestRaw,responseRaw,packageRaw,expectedScope:{tenant_id:tenantId,entity_id:entityId,company_code:scope.company_code},expectedCurrency:'USD',now:clock()});
          plan=normalizePayables({verified,expectedCurrency:'USD'});
        }else{
          verified=verifyInsurance({providerTrust,receipt,requestRaw,responseRaw,packageRaw,expectedScope:{tenant_id:tenantId,entity_id:entityId,company_code:scope.company_code,company_mapping_hash:scope.company_mapping_hash},expectedCurrency:'USD',now:clock()});
          plan=normalizeInsurance({verified,expectedCurrency:'USD'});
        }
      }catch(cause){throw new WbsProviderFinal1RetainedEvidenceError(cause?.code||'WBS_FINAL1_VERIFICATION_FAILED','Final-1 verification or normalization failed.');}
      if(verified.signature_verified!==true||verified.raw_contains_credentials!==false||verified.admission_blockers?.length!==0||plan.can_create_draft!==false||plan.can_review!==false||plan.can_approve!==false||plan.can_post!==false||plan.can_propose_amortization===true)fail('WBS_FINAL1_BOUNDARY_INVALID','Final-1 evidence boundary returned an unsafe result.');
      const admissionId=deterministicUuid(`${tenantId}\0${entityId}\0${domain}\0${idempotencyKey}`),receiptHash=canonicalRequestHash(receipt),retentionUntil=new Date(clock()+storage.retentionDays*86400000).toISOString();
      const inputs=[
        ['receipt','receipt.json',receiptRaw,receiptHash],['request','request.raw',requestRaw,sha256(requestRaw)],
        ['response','response.raw',responseRaw,sha256(responseRaw)],['package','package.json',packageRaw,sha256(packageRaw)]
      ];
      const artifacts={};
      for(const [name,artifact,bytes,expectedHash] of inputs){
        const stored=await storage.putImmutableVersion({tenantId,entityId,admissionId,immutableVersion:verified.snapshot_id,domain,artifact,bytes,expectedHash,receiptHash,retentionUntil});
        artifacts[name]=artifactDescriptor(stored);
      }
      const delivery=Object.freeze({
        admission_id:admissionId,domain,issuer:receipt.issuer,key_id:receipt.kid,algorithm:'Ed25519',nonce:receipt.nonce,
        company_code:scope.company_code,...(domain==='INSURANCE'?{company_mapping_hash:scope.company_mapping_hash}:{}),
        signed_at:receipt.signed_at,expires_at:receipt.expires_at,observation_at:verified.package?.captured_at||receipt.signed_at,
        date_from:verified.date_from,date_to:verified.date_to,snapshot_id:verified.snapshot_id,row_count:verified.row_count,
        receipt_hash:receiptHash,request_raw_hash:sha256(requestRaw),response_raw_hash:sha256(responseRaw),package_raw_hash:sha256(packageRaw),package_hash:verified.package_hash,
        plan_hash:plan.plan_hash,signature_verified:true
      });
      const result=await kernel.retainWbsProviderFinal1SourceEvidence({tenantId,entityId,delivery,artifacts:Object.freeze(artifacts),plan,idempotencyKey});
      if(!result||result.status!=='WBS_FINAL1_RETAINED_SOURCE_EVIDENCE'||result.signature_verified!==true||result.domain!==domain||result.admission_id!==admissionId||result.can_write_wbs!==false||result.can_propose_amortization!==false||result.can_create_draft!==false||result.can_review!==false||result.can_approve!==false||result.can_post!==false)fail('WBS_FINAL1_RESULT_INVALID','Final-1 atomic retention returned an unsafe result.');
      return Object.freeze(result);
    }
  });
}
