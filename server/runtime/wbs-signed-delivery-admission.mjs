import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {canonicalRequestBody,canonicalRequestHash} from './request-hash.mjs';
import {canonicalWbsLiveReceiptSigningPayload,isWbsLiveReceiptTimeWindowValid} from './wbs-live-receipt-signing.mjs';
import {validateWbsSnapshotPackage} from './wbs-snapshot-package.mjs';
import {createWbsSnapshotSignatureVerifier} from './wbs-snapshot-signature.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^sha256:[0-9a-f]{64}$/;
const MAX_RAW_BYTES=32*1024*1024;
export const WBS_SIGNED_DELIVERY_MAX_TTL_MS=15*60*1000;

export class WbsSignedDeliveryAdmissionError extends Error{
  constructor(code,message){super(message);this.name='WbsSignedDeliveryAdmissionError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsSignedDeliveryAdmissionError(code,message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const sha256=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const canonicalBytes=value=>Buffer.from(canonicalRequestBody(value),'utf8');
const safeRaw=(value,label)=>{
  if(!Buffer.isBuffer(value)||value.byteLength===0||value.byteLength>MAX_RAW_BYTES)fail('WBS_SIGNED_DELIVERY_RAW_INVALID',`${label} raw bytes are absent or outside the fixed size bound.`);
  return value;
};
const exactUtc=value=>typeof value==='string'&&value.endsWith('Z')&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString()===value;
const exactScope=scope=>object(scope)&&UUID.test(scope.tenant_id||'')&&UUID.test(scope.entity_id||'')&&TOKEN.test(scope.company_code||'');
const without=(value,...keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const declaredFingerprint=value=>{
  if(typeof value!=='string')return null;
  const match=/^(?:sha256:)?([0-9a-f]{64})$/i.exec(value.trim());
  return match?`sha256:${match[1].toLowerCase()}`:null;
};

function keyPair(privateKeyPem){
  let privateKey;try{privateKey=createPrivateKey(String(privateKeyPem||'').replace(/\\n/g,'\n'));}catch{fail('WBS_SIGNED_DELIVERY_PRIVATE_KEY_INVALID','An Ed25519 provider private key is required.');}
  if(privateKey.asymmetricKeyType!=='ed25519')fail('WBS_SIGNED_DELIVERY_PRIVATE_KEY_INVALID','The provider signing key must be Ed25519.');
  return Object.freeze({privateKey,publicKey:createPublicKey(privateKey)});
}

export function normalizeWbsProviderTrust(value){
  if(!object(value)||!TOKEN.test(value.issuer||'')||!TOKEN.test(value.key_id||'')||typeof value.public_key!=='string')fail('WBS_SIGNED_DELIVERY_PROVIDER_TRUST_INVALID','Pinned provider issuer, key id, and Ed25519 public key are required.');
  let publicKey;try{publicKey=createPublicKey(value.public_key.replace(/\\n/g,'\n'));}catch{fail('WBS_SIGNED_DELIVERY_PROVIDER_TRUST_INVALID','Pinned provider public key is invalid.');}
  if(publicKey.asymmetricKeyType!=='ed25519')fail('WBS_SIGNED_DELIVERY_PROVIDER_TRUST_INVALID','Pinned provider public key must be Ed25519.');
  const publicKeyPem=publicKey.export({type:'spki',format:'pem'}).toString();
  const fingerprint=sha256(publicKey.export({type:'spki',format:'der'}));
  // SPKI DER is the canonical public-key fingerprint representation. Accept the
  // previous normalized-PEM digest only for existing pinned configurations; the
  // returned trust record is always normalized to the canonical DER digest.
  const legacyFingerprint=sha256(Buffer.from(publicKeyPem,'utf8'));
  if(value.fingerprint_sha256!==undefined){
    const declared=declaredFingerprint(value.fingerprint_sha256);
    if(declared===null||![fingerprint,legacyFingerprint].includes(declared))fail('WBS_SIGNED_DELIVERY_PROVIDER_TRUST_INVALID','Pinned provider public-key fingerprint does not match.');
  }
  return Object.freeze({issuer:value.issuer,key_id:value.key_id,public_key:publicKeyPem,fingerprint_sha256:fingerprint,publicKey});
}

function validReceiptWindow(receipt,now){
  if(!isWbsLiveReceiptTimeWindowValid(receipt,now)||!exactUtc(receipt.signed_at)||!exactUtc(receipt.expires_at)||Date.parse(receipt.expires_at)-Date.parse(receipt.signed_at)>WBS_SIGNED_DELIVERY_MAX_TTL_MS)fail('WBS_SIGNED_DELIVERY_RECEIPT_EXPIRED','The signed receipt is expired, future-dated, malformed, or exceeds the fixed 15-minute lifetime.');
}

export async function createWbsSignedDelivery({unsignedSnapshot,requestRaw,responseRaw,scope,issuer,keyId,nonce,signedAt,expiresAt,privateKeyPem,now=Date.now()}={}){
  safeRaw(requestRaw,'request');safeRaw(responseRaw,'response');
  if(!exactScope(scope)||!TOKEN.test(issuer||'')||!TOKEN.test(keyId||'')||!TOKEN.test(nonce||''))fail('WBS_SIGNED_DELIVERY_SCOPE_INVALID','One exact tenant, entity, company, issuer, key id, and nonce are required.');
  if(!object(unsignedSnapshot))fail('WBS_SIGNED_DELIVERY_PACKAGE_INVALID','A WBS snapshot package is required.');
  const keys=keyPair(privateKeyPem);
  const manifest=without(structuredClone(unsignedSnapshot),'package_hash','detached_signature');
  const packageHash=canonicalRequestHash(manifest);
  const snapshot={...manifest,package_hash:packageHash,detached_signature:{key_id:keyId,algorithm:'Ed25519',value:sign(null,Buffer.from(packageHash,'utf8'),keys.privateKey).toString('base64')}};
  let validated;try{validated=validateWbsSnapshotPackage(snapshot);}catch{fail('WBS_SIGNED_DELIVERY_PACKAGE_INVALID','The WBS snapshot package does not satisfy the production V2 contract.');}
  if(validated.environment!=='PRODUCTION'||validated.company_key!==scope.company_code||validated.receipt_count<1)fail('WBS_SIGNED_DELIVERY_SCOPE_INVALID','The signed production package must be nonempty and match the exact company scope.');
  const packageRaw=canonicalBytes(snapshot);
  const receipt={issuer,kid:keyId,algorithm:'Ed25519',request_sha256:sha256(requestRaw),response_sha256:sha256(responseRaw),package_hash:sha256(packageRaw),nonce,signed_at:signedAt,expires_at:expiresAt,tenant_id:scope.tenant_id,entity_id:scope.entity_id,company_code:scope.company_code,immutable_version:snapshot.snapshot_id,nonempty:true};
  validReceiptWindow(receipt,now);
  receipt.detached_signature={key_id:keyId,algorithm:'Ed25519',value:sign(null,Buffer.from(canonicalWbsLiveReceiptSigningPayload(receipt),'utf8'),keys.privateKey).toString('base64')};
  const publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
  const providerTrust=Object.freeze({issuer,key_id:keyId,public_key:publicKey,fingerprint_sha256:sha256(keys.publicKey.export({type:'spki',format:'der'}))});
  return Object.freeze({providerTrust,receipt:Object.freeze(receipt),package:Object.freeze(snapshot),packageRaw});
}

export async function verifyWbsSignedDelivery({providerTrust,receipt,requestRaw,responseRaw,packageRaw,expectedScope,now=Date.now()}={}){
  const trust=normalizeWbsProviderTrust(providerTrust);
  safeRaw(requestRaw,'request');safeRaw(responseRaw,'response');safeRaw(packageRaw,'package');
  if(!exactScope(expectedScope)||!object(receipt))fail('WBS_SIGNED_DELIVERY_SCOPE_INVALID','Expected tenant, entity, and company scope are required independently of provider evidence.');
  const required=['issuer','kid','algorithm','request_sha256','response_sha256','package_hash','nonce','signed_at','expires_at','tenant_id','entity_id','company_code','immutable_version'];
  if(required.some(field=>typeof receipt[field]!=='string'||receipt[field].length===0)||receipt.nonempty!==true||receipt.algorithm!=='Ed25519'||![receipt.request_sha256,receipt.response_sha256,receipt.package_hash].every(value=>HASH.test(value))||!TOKEN.test(receipt.nonce))fail('WBS_SIGNED_DELIVERY_RECEIPT_INVALID','The signed receipt is incomplete.');
  validReceiptWindow(receipt,now);
  if(receipt.issuer!==trust.issuer||receipt.kid!==trust.key_id)fail('WBS_SIGNED_DELIVERY_TRUST_MISMATCH','Receipt issuer or key id differs from pinned provider trust.');
  if(receipt.tenant_id!==expectedScope.tenant_id||receipt.entity_id!==expectedScope.entity_id||receipt.company_code!==expectedScope.company_code)fail('WBS_SIGNED_DELIVERY_SCOPE_MISMATCH','Receipt scope differs from the independently configured admission scope.');
  if(sha256(requestRaw)!==receipt.request_sha256||sha256(responseRaw)!==receipt.response_sha256||sha256(packageRaw)!==receipt.package_hash)fail('WBS_SIGNED_DELIVERY_RAW_HASH_MISMATCH','Signed receipt hashes do not bind the exact raw request, response, and package bytes.');
  const signature=receipt.detached_signature;
  if(!object(signature)||signature.key_id!==receipt.kid||signature.algorithm!=='Ed25519'||typeof signature.value!=='string')fail('WBS_SIGNED_DELIVERY_RECEIPT_SIGNATURE_INVALID','Receipt detached signature is missing or malformed.');
  try{if(!verify(null,Buffer.from(canonicalWbsLiveReceiptSigningPayload(receipt),'utf8'),trust.publicKey,Buffer.from(signature.value,'base64')))fail('WBS_SIGNED_DELIVERY_RECEIPT_SIGNATURE_INVALID','Receipt detached signature is invalid.');}catch(error){if(error instanceof WbsSignedDeliveryAdmissionError)throw error;fail('WBS_SIGNED_DELIVERY_RECEIPT_SIGNATURE_INVALID','Receipt detached signature is invalid.');}
  let snapshot;try{snapshot=JSON.parse(packageRaw.toString('utf8'));}catch{fail('WBS_SIGNED_DELIVERY_PACKAGE_INVALID','Signed package raw bytes are not JSON.');}
  if(!packageRaw.equals(canonicalBytes(snapshot)))fail('WBS_SIGNED_DELIVERY_PACKAGE_NONCANONICAL','Signed package must use the deterministic canonical UTF-8 JSON representation.');
  let validated;try{validated=validateWbsSnapshotPackage(snapshot);}catch{fail('WBS_SIGNED_DELIVERY_PACKAGE_INVALID','Signed package does not satisfy the production V2 contract.');}
  const verifySnapshot=createWbsSnapshotSignatureVerifier({publicKeys:{[trust.key_id]:trust.public_key}});
  if(validated.environment!=='PRODUCTION'||await verifySnapshot(snapshot)!==true)fail('WBS_SIGNED_DELIVERY_PACKAGE_SIGNATURE_INVALID','Production snapshot package signature is invalid.');
  if(snapshot.detached_signature.key_id!==receipt.kid||validated.company_key!==expectedScope.company_code||snapshot.snapshot_id!==receipt.immutable_version||validated.receipt_count<1||Date.parse(snapshot.captured_at)>Date.parse(receipt.signed_at))fail('WBS_SIGNED_DELIVERY_PACKAGE_SCOPE_MISMATCH','Package identity, company, capture time, or nonempty status differs from the signed receipt.');
  const admissionId=canonicalRequestHash({issuer:receipt.issuer,kid:receipt.kid,nonce:receipt.nonce});
  return Object.freeze({status:'VERIFIED_NOT_ADMITTED',admission_id:admissionId,tenant_id:expectedScope.tenant_id,entity_id:expectedScope.entity_id,company_code:expectedScope.company_code,snapshot_id:snapshot.snapshot_id,package_hash:snapshot.package_hash,raw_package_hash:receipt.package_hash,signature_verified:true,snapshot,can_import:false,can_create_transaction:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false});
}

export async function captureWbsSignedDelivery({captureDirectory,...input}={}){
  if(typeof captureDirectory!=='string'||captureDirectory.trim().length===0)fail('WBS_SIGNED_DELIVERY_CAPTURE_PATH_REQUIRED','An operator-controlled capture directory is required.');
  const verified=await verifyWbsSignedDelivery(input);
  const root=resolve(captureDirectory),leaf=verified.admission_id.slice(7),directory=join(root,leaf);
  mkdirSync(root,{recursive:true,mode:0o700});
  try{mkdirSync(directory,{recursive:false,mode:0o700});}catch(error){if(error?.code==='EEXIST')fail('WBS_SIGNED_DELIVERY_REPLAY','This provider nonce was already captured.');throw error;}
  const write=(name,value)=>writeFileSync(join(directory,name),value,{flag:'wx',mode:0o600});
  write('request.raw',input.requestRaw);write('response.raw',input.responseRaw);write('package.json',input.packageRaw);write('receipt.json',canonicalBytes(input.receipt));
  const idempotencyKey=`wbs-signed-admission-${leaf}`;
  write('admission-request.json',canonicalBytes({snapshot:verified.snapshot}));
  const manifest={schema_version:'WBS_SIGNED_ADMISSION_CAPTURE_V1',status:'VERIFIED_CAPTURED_PENDING_AUTHORITATIVE_API',admission_id:verified.admission_id,tenant_id:verified.tenant_id,entity_id:verified.entity_id,company_code:verified.company_code,snapshot_id:verified.snapshot_id,package_hash:verified.package_hash,raw_package_hash:verified.raw_package_hash,signature_verified:true,api:{method:'POST',path:`/api/v1/entities/${verified.entity_id}/wbs/snapshots`,idempotency_key:idempotencyKey,body_file:'admission-request.json'},can_import:false,can_create_transaction:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false};
  write('capture-manifest.json',canonicalBytes(manifest));
  return Object.freeze({...manifest,directory});
}
