import {createHash} from 'node:crypto';
import {verifyWbsSignedDelivery} from './wbs-signed-delivery-admission.mjs';
import {validateWbsSnapshotPackage} from './wbs-snapshot-package.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY=/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/;
const HASH=/^sha256:[0-9a-f]{64}$/;

export class WbsProviderSignedAdmissionClientError extends Error{
  constructor(code,message,{status=null}={}){super(message);this.name='WbsProviderSignedAdmissionClientError';this.code=code;this.status=status;}
}
const fail=(code,message,details)=>{throw new WbsProviderSignedAdmissionClientError(code,message,details);};
const text=value=>value==null?'':String(value).trim();
const sha256=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const exactObject=value=>value&&typeof value==='object'&&!Array.isArray(value);

function apiOrigin(value){
  let parsed;try{parsed=new URL(value);}catch{fail('WBS_PROVIDER_API_URL_INVALID','REFS API base URL is invalid.');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||!parsed.hostname||!['','/'].includes(parsed.pathname))fail('WBS_PROVIDER_API_URL_INVALID','REFS API base URL must be an HTTPS origin without credentials, path, query, or fragment.');
  return parsed.origin;
}
function token(value,label){
  if(typeof value!=='string'||value.length<16||value.length>16384||/[\r\n]/.test(value))fail('WBS_PROVIDER_ACCESS_TOKEN_REQUIRED',`${label} is required and must be supplied out of band.`);
  return value;
}
function safeJson(value){
  try{return JSON.parse(value);}catch{fail('WBS_PROVIDER_API_RESPONSE_INVALID','REFS API returned invalid JSON.');}
}
async function requestJson(fetchImpl,url,{method='GET',accessToken,headers={},body,timeoutMs}){
  let response;
  try{
    response=await fetchImpl(url,{method,redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{accept:'application/json',authorization:`Bearer ${accessToken}`,...headers},body});
  }catch{fail('WBS_PROVIDER_API_UNAVAILABLE','REFS API request failed before an HTTP response was received.');}
  const raw=await response.text();
  if(raw.length>2*1024*1024)fail('WBS_PROVIDER_API_RESPONSE_INVALID','REFS API response exceeded the safe read limit.',{status:response.status});
  const payload=safeJson(raw);
  if(!response.ok){
    const code=typeof payload?.code==='string'?payload.code:'WBS_PROVIDER_API_REJECTED';
    fail(code,typeof payload?.message==='string'?payload.message:'REFS API rejected the provider delivery.',{status:response.status});
  }
  if(!exactObject(payload)||payload.ok!==true||!Object.hasOwn(payload,'data'))fail('WBS_PROVIDER_API_RESPONSE_INVALID','REFS API success response did not match the authoritative envelope.',{status:response.status});
  return {status:response.status,data:payload.data};
}
function assertAdmission(data,verified,rawArtifacts){
  if(!exactObject(data)||data.status!=='PERSISTED_PAYABLE_STAGING_REVIEW_REQUIRED'||data.signature_verified!==true||!UUID.test(data.wbs_provider_signed_payable_admission_id||'')||data.snapshot_id!==verified.snapshot_id||data.company_code!==verified.company_code||!Number.isSafeInteger(data.row_count)||data.row_count<1||data.can_create_draft!==false||data.can_approve!==false||data.can_post!==false)fail('WBS_PROVIDER_ADMISSION_RESPONSE_UNSAFE','REFS returned an incomplete or unsafe signed-admission result.');
  const expected={request_raw_hash:sha256(rawArtifacts.requestRaw),response_raw_hash:sha256(rawArtifacts.responseRaw),package_raw_hash:sha256(rawArtifacts.packageRaw)};
  for(const [field,value] of Object.entries(expected))if(data[field]!==value||!HASH.test(data[field]))fail('WBS_PROVIDER_ADMISSION_HASH_MISMATCH',`REFS admission response did not bind ${field}.`);
  return data;
}
function assertReviewCandidates(data){
  if(!Array.isArray(data)||data.length>50)fail('WBS_PROVIDER_READBACK_RESPONSE_INVALID','REFS review-candidate readback was not a bounded array.');
  for(const row of data)if(!exactObject(row)||!UUID.test(row.wbs_inbound_row_id||'')||typeof row.source_version!=='string'||!row.source_version||!HASH.test(row.receipt_hash||'')||!HASH.test(row.evidence_hash||''))fail('WBS_PROVIDER_READBACK_RESPONSE_INVALID','REFS review-candidate readback contained malformed provenance.');
  return data;
}

export async function admitWbsProviderSignedPayableDelivery({apiBaseUrl,admissionAccessToken,reviewAccessToken=null,providerTrust,receipt,requestRaw,responseRaw,packageRaw,tenantId,entityId,companyCode,idempotencyKey=null,fetchImpl=globalThis.fetch,now=Date.now(),timeoutMs=30000}={}){
  if(typeof fetchImpl!=='function')fail('WBS_PROVIDER_FETCH_REQUIRED','A fetch implementation is required.');
  if(!UUID.test(text(tenantId))||!UUID.test(text(entityId))||!companyCode||text(companyCode)!==companyCode)fail('WBS_PROVIDER_SCOPE_INVALID','Exact tenant, entity, and company scope are required.');
  if(!Buffer.isBuffer(requestRaw)||!Buffer.isBuffer(responseRaw)||!Buffer.isBuffer(packageRaw))fail('WBS_PROVIDER_ARTIFACTS_REQUIRED','Exact request, response, and package bytes are required.');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)fail('WBS_PROVIDER_TIMEOUT_INVALID','timeoutMs must be an integer from 1000 to 120000.');
  const origin=apiOrigin(apiBaseUrl),admitToken=token(admissionAccessToken,'REFS provider M2M access token'),reviewerToken=reviewAccessToken==null?null:token(reviewAccessToken,'REFS reviewer access token');
  if(reviewerToken===admitToken)fail('WBS_PROVIDER_REVIEW_IDENTITY_NOT_SEPARATE','Admission and reviewer access tokens must not be identical; server-side grants remain authoritative.');
  const verified=await verifyWbsSignedDelivery({providerTrust,receipt,requestRaw,responseRaw,packageRaw,expectedScope:{tenant_id:tenantId,entity_id:entityId,company_code:companyCode},now});
  const stableKey=idempotencyKey??`wbs-provider-${verified.admission_id.slice(7)}`;
  if(!IDEMPOTENCY.test(stableKey))fail('WBS_PROVIDER_IDEMPOTENCY_INVALID','Idempotency key must be a stable 16-200 character canonical token.');
  const path=`/api/v1/entities/${entityId}/wbs/provider-signed/payables/admissions`;
  const body=JSON.stringify({receipt,requestRawBase64:requestRaw.toString('base64'),responseRawBase64:responseRaw.toString('base64'),packageRawBase64:packageRaw.toString('base64')});
  const admitted=await requestJson(fetchImpl,`${origin}${path}`,{method:'POST',accessToken:admitToken,headers:{'content-type':'application/json','idempotency-key':stableKey},body,timeoutMs});
  const admission=assertAdmission(admitted.data,verified,{requestRaw,responseRaw,packageRaw});
  let readback={status:'NOT_REQUESTED',http_status:null,record_count:null,rows:[]};
  if(reviewerToken!=null){
    const readPath=`/api/v1/entities/${entityId}/wbs/inbound/payables/review-candidates?limit=50`;
    const read=await requestJson(fetchImpl,`${origin}${readPath}`,{accessToken:reviewerToken,timeoutMs});
    const rows=assertReviewCandidates(read.data);
    const validated=validateWbsSnapshotPackage(verified.snapshot),expected=new Set(validated.receipts.filter(item=>item.source_module==='BGDATA.payable'&&item.ingestion_kind==='TRANSACTION_CANDIDATE').map(item=>`${item.source_version}\u0000${item.payload_hash}`));
    const matched=rows.filter(row=>expected.has(`${row.source_version}\u0000${row.receipt_hash}`));
    readback={status:matched.length?'READ_BACK_MATCHED':'READ_BACK_NOT_OBSERVED',http_status:read.status,queue_record_count:rows.length,record_count:matched.length,rows:matched.map(row=>Object.freeze({wbs_inbound_row_id:row.wbs_inbound_row_id,source_version:row.source_version,receipt_hash:row.receipt_hash,evidence_hash:row.evidence_hash,review_readiness:row.review_readiness??null,can_review:row.can_review===true}))};
  }
  return Object.freeze({status:'ADMITTED_SIGNED_PAYABLE_EVIDENCE',offline_verification:'PASS',api_origin:origin,tenant_id:tenantId,entity_id:entityId,company_code:companyCode,snapshot_id:verified.snapshot_id,admission_id:admission.wbs_provider_signed_payable_admission_id,idempotency_key:stableKey,admission_http_status:admitted.status,row_count:admission.row_count,idempotent:admission.idempotent===true,request_raw_hash:admission.request_raw_hash,response_raw_hash:admission.response_raw_hash,package_raw_hash:admission.package_raw_hash,signature_verified:true,readback,can_create_draft:false,can_approve:false,can_post:false});
}
