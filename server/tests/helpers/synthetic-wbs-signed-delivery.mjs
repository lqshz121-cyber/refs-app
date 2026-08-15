import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {canonicalRequestBody,canonicalRequestHash} from '../../runtime/request-hash.mjs';
import {canonicalWbsLiveReceiptSigningPayload,isWbsLiveReceiptTimeWindowValid} from '../../runtime/wbs-live-receipt-signing.mjs';
import {validateWbsSnapshotPackage} from '../../runtime/wbs-snapshot-package.mjs';
import {WbsSignedDeliveryAdmissionError,WBS_SIGNED_DELIVERY_MAX_TTL_MS} from '../../runtime/wbs-signed-delivery-admission.mjs';

const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const fail=(code,message)=>{throw new WbsSignedDeliveryAdmissionError(code,message);};
const without=(value,...keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const canonicalBytes=value=>Buffer.from(canonicalRequestBody(value),'utf8');
const exactScope=scope=>scope!==null&&typeof scope==='object'&&!Array.isArray(scope)&&UUID.test(scope.tenant_id||'')&&UUID.test(scope.entity_id||'')&&TOKEN.test(scope.company_code||'');

// Test-only fixture builder. Production code intentionally has no signing path.
export async function createSyntheticWbsSignedDelivery({unsignedSnapshot,requestRaw,responseRaw,scope,issuer,keyId,nonce,signedAt,expiresAt,privateKeyPem,now=Date.now()}={}){
  if(!Buffer.isBuffer(requestRaw)||!Buffer.isBuffer(responseRaw)||requestRaw.byteLength===0||responseRaw.byteLength===0)fail('WBS_SIGNED_DELIVERY_RAW_INVALID','Test fixture raw bytes are required.');
  if(!exactScope(scope)||!TOKEN.test(issuer||'')||!TOKEN.test(keyId||'')||!TOKEN.test(nonce||''))fail('WBS_SIGNED_DELIVERY_SCOPE_INVALID','Test fixture scope is invalid.');
  let privateKey;try{privateKey=createPrivateKey(String(privateKeyPem||'').replace(/\\n/g,'\n'));}catch{fail('WBS_SIGNED_DELIVERY_PRIVATE_KEY_INVALID','A test Ed25519 private key is required.');}
  if(privateKey.asymmetricKeyType!=='ed25519')fail('WBS_SIGNED_DELIVERY_PRIVATE_KEY_INVALID','The test signing key must be Ed25519.');
  const manifest=without(structuredClone(unsignedSnapshot),'package_hash','detached_signature'),packageHash=canonicalRequestHash(manifest);
  const snapshot={...manifest,package_hash:packageHash,detached_signature:{key_id:keyId,algorithm:'Ed25519',value:sign(null,Buffer.from(packageHash,'utf8'),privateKey).toString('base64')}};
  let validated;try{validated=validateWbsSnapshotPackage(snapshot);}catch{fail('WBS_SIGNED_DELIVERY_PACKAGE_INVALID','The test snapshot package is invalid.');}
  if(validated.environment!=='PRODUCTION'||validated.company_key!==scope.company_code||validated.receipt_count<1)fail('WBS_SIGNED_DELIVERY_SCOPE_INVALID','The test package must be nonempty and scope-matched.');
  const packageRaw=canonicalBytes(snapshot),receipt={issuer,kid:keyId,algorithm:'Ed25519',request_sha256:sha256(requestRaw),response_sha256:sha256(responseRaw),package_hash:sha256(packageRaw),nonce,signed_at:signedAt,expires_at:expiresAt,tenant_id:scope.tenant_id,entity_id:scope.entity_id,company_code:scope.company_code,immutable_version:snapshot.snapshot_id,nonempty:true};
  if(!isWbsLiveReceiptTimeWindowValid(receipt,now)||Date.parse(expiresAt)-Date.parse(signedAt)>WBS_SIGNED_DELIVERY_MAX_TTL_MS)fail('WBS_SIGNED_DELIVERY_RECEIPT_EXPIRED','The test receipt time window is invalid.');
  receipt.detached_signature={key_id:keyId,algorithm:'Ed25519',value:sign(null,Buffer.from(canonicalWbsLiveReceiptSigningPayload(receipt),'utf8'),privateKey).toString('base64')};
  const publicKey=createPublicKey(privateKey);
  return Object.freeze({providerTrust:Object.freeze({issuer,key_id:keyId,public_key:publicKey.export({type:'spki',format:'pem'}).toString(),fingerprint_sha256:sha256(publicKey.export({type:'spki',format:'der'}))}),receipt:Object.freeze(receipt),package:Object.freeze(snapshot),packageRaw});
}
