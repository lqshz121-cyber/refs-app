import {createHash,verify} from 'node:crypto';
import {canonicalRequestBody} from './request-hash.mjs';
import {normalizeWbsProviderTrust,WBS_SIGNED_DELIVERY_MAX_TTL_MS,WbsSignedDeliveryAdmissionError} from './wbs-signed-delivery-admission.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^(?:sha256:)?[0-9a-f]{64}$/;
const UTC=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{3}))?Z$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MAX_RAW_BYTES=32*1024*1024;
const SENSITIVE_RAW=/(?:^|\r?\n)(?:authorization|proxy-authorization|cookie|set-cookie|cf-access-client-secret|x-refs-auth)\s*:/i;
const verifiedFinal1Evidence=new WeakSet();

const fail=(code,message)=>{throw new WbsSignedDeliveryAdmissionError(code,message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const without=(value,...keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const bytes=value=>Buffer.from(canonicalRequestBody(value),'utf8');
const sha256=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const bare=value=>typeof value==='string'&&value.startsWith('sha256:')?value.slice(7):value;
const safeRaw=(value,label)=>{
  if(!Buffer.isBuffer(value)||value.byteLength===0||value.byteLength>MAX_RAW_BYTES)fail('WBS_FINAL1_RAW_INVALID',`${label} raw bytes are absent or outside the fixed size bound.`);
  return value;
};
const instant=value=>{
  if(typeof value!=='string')return null;
  const match=UTC.exec(value),time=Date.parse(value);
  return match&&Number.isFinite(time)&&new Date(time).toISOString()===`${match[1]}.${match[2]||'000'}Z`?time:null;
};
const signatureValue=value=>object(value)&&value.algorithm==='Ed25519'&&typeof value.value==='string'&&value.value.length>0?value.value:null;
const verified=(publicKey,payload,value)=>{
  try{return verify(null,payload,publicKey,Buffer.from(value,'base64'))===true;}catch{return false;}
};
const exactDate=value=>DATE.test(value||'')&&new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10)===value;
const deepFreeze=value=>{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

// A Final-1 verifier result is a capability, not a serializable assertion.
// Normalizers may use only the exact in-process object produced here.  A
// clone with self-consistent replacement hashes still lacks this provenance
// and must never be promoted into a staging plan.
export function requireVerifiedWbsProviderFinal1Evidence(value){
  if(!verifiedFinal1Evidence.has(value))fail('WBS_FINAL1_NORMALIZATION_TAMPERED','Final-1 evidence must be the exact immutable result of the signature verifier.');
  return value;
}

// Final-1 is the Provider's externally versioned delivery envelope.  It is
// verified separately from REFS' internal normalized snapshot contract so a
// transformed row can never be mistaken for the exact bytes the Provider
// signed.  This function is evidence-only: it cannot persist or create a JE.
export function verifyWbsProviderFinal1Delivery({providerTrust,receipt,requestRaw,responseRaw,packageRaw,expectedScope,expectedCurrency=null,now=Date.now()}={}){
  const trust=normalizeWbsProviderTrust(providerTrust);
  safeRaw(requestRaw,'request');safeRaw(responseRaw,'response');safeRaw(packageRaw,'package');
  if(!object(receipt)||!object(expectedScope)||!UUID.test(expectedScope.tenant_id||'')||!UUID.test(expectedScope.entity_id||'')||!TOKEN.test(expectedScope.company_code||''))fail('WBS_FINAL1_SCOPE_INVALID','An independent tenant, entity, and company scope is required.');
  const required=['issuer','kid','algorithm','request_sha256','response_sha256','package_hash','nonce','signed_at','expires_at','tenant_id','entity_id','company_code','immutable_version'];
  if(required.some(key=>typeof receipt[key]!=='string'||receipt[key].length===0)||receipt.algorithm!=='Ed25519'||receipt.nonempty!==true||!TOKEN.test(receipt.nonce)||![receipt.request_sha256,receipt.response_sha256,receipt.package_hash].every(value=>HASH.test(value)))fail('WBS_FINAL1_RECEIPT_INVALID','Final-1 receipt is incomplete.');
  const signedAt=instant(receipt.signed_at),expiresAt=instant(receipt.expires_at);
  if(signedAt===null||expiresAt===null||signedAt>=expiresAt||expiresAt-signedAt>WBS_SIGNED_DELIVERY_MAX_TTL_MS||signedAt>now+5*60*1000||expiresAt<=now)fail('WBS_SIGNED_DELIVERY_RECEIPT_EXPIRED','Final-1 receipt is expired, future-dated, malformed, or exceeds 15 minutes.');
  if(receipt.issuer!==trust.issuer||receipt.kid!==trust.key_id)fail('WBS_SIGNED_DELIVERY_TRUST_MISMATCH','Final-1 issuer or key id differs from pinned trust.');
  if(receipt.tenant_id!==expectedScope.tenant_id||receipt.entity_id!==expectedScope.entity_id||receipt.company_code!==expectedScope.company_code)fail('WBS_SIGNED_DELIVERY_SCOPE_MISMATCH','Final-1 scope differs from independently configured scope.');
  if(sha256(requestRaw)!==`sha256:${bare(receipt.request_sha256)}`||sha256(responseRaw)!==`sha256:${bare(receipt.response_sha256)}`||sha256(packageRaw)!==`sha256:${bare(receipt.package_hash)}`)fail('WBS_SIGNED_DELIVERY_RAW_HASH_MISMATCH','Final-1 receipt does not bind the exact raw artifacts.');
  const receiptSignature=signatureValue(receipt.detached_signature);
  if(receipt.detached_signature?.key_id!==receipt.kid||!receiptSignature||!verified(trust.publicKey,bytes(without(receipt,'detached_signature')),receiptSignature))fail('WBS_SIGNED_DELIVERY_RECEIPT_SIGNATURE_INVALID','Final-1 receipt signature is invalid.');
  let pkg;try{pkg=JSON.parse(packageRaw.toString('utf8'));}catch{fail('WBS_SIGNED_DELIVERY_PACKAGE_INVALID','Final-1 package is not JSON.');}
  if(!packageRaw.equals(bytes(pkg)))fail('WBS_SIGNED_DELIVERY_PACKAGE_NONCANONICAL','Final-1 package must be canonical UTF-8 JSON.');
  if(!object(pkg)||pkg.schema_version!=='WBS_READONLY_SNAPSHOT_V2'||pkg.environment!=='PRODUCTION'||pkg.source_system!=='WBS'||pkg.domain!=='PAYABLES'||!UUID.test(pkg.snapshot_id||'')||pkg.snapshot_id!==receipt.immutable_version||pkg.company_key!==expectedScope.company_code||!exactDate(pkg.date_from)||!exactDate(pkg.date_to)||pkg.date_from>pkg.date_to||!object(pkg.views)||Object.keys(pkg.views).length!==1||!object(pkg.views.list_payables))fail('WBS_FINAL1_PACKAGE_INVALID','Final-1 Payables package identity, scope, or range is invalid.');
  const packageSignature=signatureValue(pkg.detached_signature),unsignedPackage=without(pkg,'package_hash','detached_signature'),packageCanonical=bytes(unsignedPackage);
  if(!HASH.test(pkg.package_hash||'')||bare(pkg.package_hash)!==bare(sha256(packageCanonical))||pkg.detached_signature?.key_id!==receipt.kid||!packageSignature||!verified(trust.publicKey,packageCanonical,packageSignature))fail('WBS_SIGNED_DELIVERY_PACKAGE_SIGNATURE_INVALID','Final-1 package hash or signature is invalid.');
  const view=pkg.views.list_payables,rows=view.rows;
  if(!Array.isArray(rows)||!Number.isSafeInteger(view.row_count)||view.row_count!==rows.length||bare(view.content_hash)!==bare(sha256(bytes(rows)))||!object(view.scope)||!Array.isArray(view.scope.company_codes)||view.scope.company_codes.length!==1||view.scope.company_codes[0]!==expectedScope.company_code||!Array.isArray(view.scope.date_range)||view.scope.date_range.length!==2||view.scope.date_range[0]!==pkg.date_from||view.scope.date_range[1]!==pkg.date_to)fail('WBS_FINAL1_VIEW_INVALID','Final-1 Payables row count, content hash, or scope is invalid.');
  const ids=new Set();
  for(const row of rows){
    if(!object(row)||!UUID.test(row.ap_guid||'')||ids.has(row.ap_guid.toLowerCase())||row.company_code!==expectedScope.company_code)fail('WBS_FINAL1_ROW_INVALID','Final-1 Payables rows require unique ap_guid values and exact company scope.');
    ids.add(row.ap_guid.toLowerCase());
  }
  const rawContainsCredentials=SENSITIVE_RAW.test(requestRaw.toString('latin1'))||SENSITIVE_RAW.test(responseRaw.toString('latin1'));
  const currencySigned=rows.length>0&&rows.every(row=>/^[A-Z]{3}$/.test(row.currency||''))&&new Set(rows.map(row=>row.currency)).size===1;
  const configuredCurrency=typeof expectedCurrency==='string'&&/^[A-Z]{3}$/.test(expectedCurrency)?expectedCurrency:null;
  if(currencySigned&&configuredCurrency&&rows[0].currency!==configuredCurrency)fail('WBS_FINAL1_CURRENCY_SCOPE_MISMATCH','Provider currency differs from the independently approved REFS currency.');
  const accountingCurrency=currencySigned?rows[0].currency:configuredCurrency;
  const result=deepFreeze({
    status:'VERIFIED_FINAL1_EVIDENCE_ONLY',format:'WBS_PROVIDER_FINAL1',signature_verified:true,
    tenant_id:expectedScope.tenant_id,entity_id:expectedScope.entity_id,company_code:expectedScope.company_code,
    snapshot_id:pkg.snapshot_id,date_from:pkg.date_from,date_to:pkg.date_to,row_count:rows.length,
    package_hash:`sha256:${bare(pkg.package_hash)}`,raw_package_hash:`sha256:${bare(receipt.package_hash)}`,
    raw_contains_credentials:rawContainsCredentials,currency_signed:currencySigned,
    accounting_currency:accountingCurrency,currency_authority:currencySigned?'PROVIDER_SIGNED':'REFS_BUSINESS_OWNER_CONFIRMED',
    admission_blockers:Object.freeze([
      ...(rawContainsCredentials?['RAW_ARTIFACT_CREDENTIAL_REDACTION_REQUIRED']:[]),
      ...(accountingCurrency?[]:['APPROVED_CURRENCY_REQUIRED_FOR_ACCOUNTING']),
    ]),
    package:pkg,can_admit:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false
  });
  verifiedFinal1Evidence.add(result);
  return result;
}
