import {createHash,verify} from 'node:crypto';
import {canonicalRequestBody} from './request-hash.mjs';
import {normalizeWbsProviderTrust,WBS_SIGNED_DELIVERY_MAX_TTL_MS,WbsSignedDeliveryAdmissionError} from './wbs-signed-delivery-admission.mjs';
import {computeWbsFinal1ControlTotals,parseWbsFinal1Money4,validateWbsFinal1SignedControlTotals} from './wbs-provider-final1-control-totals.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^(?:sha256:)?[0-9a-f]{64}$/;
const UTC=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{3}))?Z$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MAX_RAW_BYTES=32*1024*1024;
const FINAL1_SIGNED_POPULATION_MAX=500;
const SENSITIVE_RAW=/(?:^|\r?\n)(?:authorization|proxy-authorization|cookie|set-cookie|cf-access-client-secret|x-refs-auth|x-api-key)\s*:/i;
const SENSITIVE_JSON=/"(?:authorization|proxy_authorization|cookie|set_cookie|cf_access_client_secret|x_refs_auth|password|access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key)"\s*:/i;
const SENSITIVE_QUERY=/[?&](?:access[_-]?token|api[_-]?key)=/i;
const verifiedFinal1Evidence=new WeakSet();
const verifiedFinal1InsuranceEvidence=new WeakSet();

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
const percentDecode=value=>{let decoded=value;for(let pass=0;pass<3;pass++){const next=decoded.replace(/%([0-9a-f]{2})/gi,(_match,hex)=>String.fromCharCode(Number.parseInt(hex,16)));if(next===decoded)break;decoded=next;}return decoded;};
export const containsWbsProviderFinal1Credential=value=>{const raw=value.toString('latin1'),decoded=percentDecode(raw);return SENSITIVE_RAW.test(raw)||SENSITIVE_JSON.test(raw)||SENSITIVE_QUERY.test(raw)||SENSITIVE_RAW.test(decoded)||SENSITIVE_JSON.test(decoded)||SENSITIVE_QUERY.test(decoded);};
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

export function requireVerifiedWbsProviderFinal1InsuranceEvidence(value){
  if(!verifiedFinal1InsuranceEvidence.has(value))fail('WBS_FINAL1_INSURANCE_NORMALIZATION_TAMPERED','Insurance evidence must be the exact immutable result of the signature verifier.');
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
  if(!Array.isArray(rows)||!Number.isSafeInteger(view.row_count)||view.row_count<1||view.row_count>FINAL1_SIGNED_POPULATION_MAX||view.row_count!==rows.length||bare(view.content_hash)!==bare(sha256(bytes(rows)))||!object(view.scope)||!Array.isArray(view.scope.company_codes)||view.scope.company_codes.length!==1||view.scope.company_codes[0]!==expectedScope.company_code||!Array.isArray(view.scope.date_range)||view.scope.date_range.length!==2||view.scope.date_range[0]!==pkg.date_from||view.scope.date_range[1]!==pkg.date_to)fail('WBS_FINAL1_VIEW_INVALID','Final-1 Payables row count, content hash, or scope is invalid.');
  const ids=new Set();
  for(const row of rows){
    const signedAccrualNulls=['service_period_start','service_period_end','recurring_obligation_id','contract_id','charge_code','service_frequency','obligation_status'];
    if(!object(row)||!UUID.test(row.ap_guid||'')||ids.has(row.ap_guid.toLowerCase())||row.company_code!==expectedScope.company_code||['invoice_no','invoice_date','business_id'].some(key=>!Object.hasOwn(row,key))||signedAccrualNulls.some(key=>!Object.hasOwn(row,key)||row[key]!==null))fail('WBS_FINAL1_ROW_INVALID','Final-1 Payables rows require unique ap_guid, exact scope, signed invoice_no/invoice_date/business_id keys, and seven explicit null accrual fields.');
    ids.add(row.ap_guid.toLowerCase());
  }
  const rawContainsCredentials=containsWbsProviderFinal1Credential(bytes(receipt))||containsWbsProviderFinal1Credential(requestRaw)||containsWbsProviderFinal1Credential(responseRaw)||containsWbsProviderFinal1Credential(packageRaw);
  const currencySigned=rows.length>0&&rows.every(row=>/^[A-Z]{3}$/.test(row.currency||''))&&new Set(rows.map(row=>row.currency)).size===1;
  const configuredCurrency=typeof expectedCurrency==='string'&&/^[A-Z]{3}$/.test(expectedCurrency)?expectedCurrency:null;
  if(currencySigned&&configuredCurrency&&rows[0].currency!==configuredCurrency)fail('WBS_FINAL1_CURRENCY_SCOPE_MISMATCH','Provider currency differs from the independently approved REFS currency.');
  const accountingCurrency=currencySigned?rows[0].currency:configuredCurrency;
  let signedControls;try{signedControls=validateWbsFinal1SignedControlTotals({control_totals:view.control_totals,control_totals_hash:view.control_totals_hash},{label:'Package view'});}catch{fail('WBS_FINAL1_VIEW_INVALID','Final-1 Payables signed control totals are invalid.');}
  const controlCurrency=accountingCurrency||(signedControls.control_totals.currency_totals.length===1?signedControls.control_totals.currency_totals[0].currency:null);
  if(!controlCurrency)fail('WBS_FINAL1_CONTROL_CURRENCY_INVALID','Signed Payables controls require one exact currency.');
  const computedControls=computeWbsFinal1ControlTotals({rows,currencyOf:row=>row.currency||controlCurrency,amountOf:row=>parseWbsFinal1Money4(row.amount)});
  try{validateWbsFinal1SignedControlTotals(signedControls,{label:'Package view',expected:computedControls});}catch{fail('WBS_FINAL1_VIEW_INVALID','Final-1 Payables signed control totals differ from the signed source rows.');}
  const result=deepFreeze({
    status:'VERIFIED_FINAL1_EVIDENCE_ONLY',format:'WBS_PROVIDER_FINAL1',signature_verified:true,
    tenant_id:expectedScope.tenant_id,entity_id:expectedScope.entity_id,company_code:expectedScope.company_code,
    snapshot_id:pkg.snapshot_id,date_from:pkg.date_from,date_to:pkg.date_to,row_count:rows.length,control_totals:computedControls.control_totals,control_totals_hash:computedControls.control_totals_hash,
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

const INSURANCE_FIELDS=new Set(['id','policy_id','company_code','pc_code','property_code','unit_code','insurance_status','approval_status','policy_number','carrier','insurance_type','final_premium','start_date','expire_date','attachment_count','policy_attachment_id','data_source','update_time','deleted','currency']);
const INSURANCE_TEXT_FIELDS=['policy_id','company_code','pc_code','property_code','unit_code','insurance_status','approval_status','policy_number','carrier','insurance_type','policy_attachment_id','data_source','update_time'];
const SAFE_SOURCE_TEXT=/^[^\u0000-\u001f\u007f]{1,512}$/;
const FIXED_2=/^-?(?:0|[1-9]\d{0,17})\.\d{2}$/;

// Insurance is verified against the actual production source surface.  The
// Provider must enrich each row with the approved company code and sign the
// exact mapping snapshot hash; REFS never infers an entity from an address,
// owner name, or policy description.
export function verifyWbsProviderFinal1InsuranceDelivery({providerTrust,receipt,requestRaw,responseRaw,packageRaw,expectedScope,expectedCurrency='USD',now=Date.now()}={}){
  const trust=normalizeWbsProviderTrust(providerTrust);
  safeRaw(requestRaw,'request');safeRaw(responseRaw,'response');safeRaw(packageRaw,'package');
  if(!object(receipt)||!object(expectedScope)||!UUID.test(expectedScope.tenant_id||'')||!UUID.test(expectedScope.entity_id||'')||!TOKEN.test(expectedScope.company_code||'')||!HASH.test(expectedScope.company_mapping_hash||'')||expectedCurrency!=='USD')fail('WBS_FINAL1_INSURANCE_SCOPE_INVALID','Insurance evidence requires independent tenant, entity, company, mapping hash, and USD scope.');
  const required=['issuer','kid','algorithm','request_sha256','response_sha256','package_hash','nonce','signed_at','expires_at','tenant_id','entity_id','company_code','immutable_version'];
  if(required.some(key=>typeof receipt[key]!=='string'||receipt[key].length===0)||receipt.algorithm!=='Ed25519'||receipt.nonempty!==true||!TOKEN.test(receipt.nonce)||![receipt.request_sha256,receipt.response_sha256,receipt.package_hash].every(value=>HASH.test(value)))fail('WBS_FINAL1_INSURANCE_RECEIPT_INVALID','Insurance receipt is incomplete.');
  const signedAt=instant(receipt.signed_at),expiresAt=instant(receipt.expires_at);
  if(signedAt===null||expiresAt===null||signedAt>=expiresAt||expiresAt-signedAt>WBS_SIGNED_DELIVERY_MAX_TTL_MS||signedAt>now+5*60*1000||expiresAt<=now)fail('WBS_SIGNED_DELIVERY_RECEIPT_EXPIRED','Insurance receipt is expired, future-dated, malformed, or exceeds 15 minutes.');
  if(receipt.issuer!==trust.issuer||receipt.kid!==trust.key_id)fail('WBS_SIGNED_DELIVERY_TRUST_MISMATCH','Insurance issuer or key id differs from pinned trust.');
  if(receipt.tenant_id!==expectedScope.tenant_id||receipt.entity_id!==expectedScope.entity_id||receipt.company_code!==expectedScope.company_code)fail('WBS_SIGNED_DELIVERY_SCOPE_MISMATCH','Insurance scope differs from independently configured scope.');
  if(sha256(requestRaw)!==`sha256:${bare(receipt.request_sha256)}`||sha256(responseRaw)!==`sha256:${bare(receipt.response_sha256)}`||sha256(packageRaw)!==`sha256:${bare(receipt.package_hash)}`)fail('WBS_SIGNED_DELIVERY_RAW_HASH_MISMATCH','Insurance receipt does not bind the exact raw artifacts.');
  const receiptSignature=signatureValue(receipt.detached_signature);
  if(receipt.detached_signature?.key_id!==receipt.kid||!receiptSignature||!verified(trust.publicKey,bytes(without(receipt,'detached_signature')),receiptSignature))fail('WBS_SIGNED_DELIVERY_RECEIPT_SIGNATURE_INVALID','Insurance receipt signature is invalid.');
  let pkg;try{pkg=JSON.parse(packageRaw.toString('utf8'));}catch{fail('WBS_SIGNED_DELIVERY_PACKAGE_INVALID','Insurance package is not JSON.');}
  if(!packageRaw.equals(bytes(pkg)))fail('WBS_SIGNED_DELIVERY_PACKAGE_NONCANONICAL','Insurance package must be canonical UTF-8 JSON.');
  if(!object(pkg)||pkg.schema_version!=='WBS_READONLY_SNAPSHOT_V2'||pkg.environment!=='PRODUCTION'||pkg.source_system!=='WBS'||pkg.domain!=='INSURANCE'||pkg.source_database!=='wb_insurance'||pkg.source_table!=='insurance_data'||pkg.company_key!==expectedScope.company_code||pkg.company_mapping_hash!==expectedScope.company_mapping_hash||pkg.currency!=='USD'||!UUID.test(pkg.snapshot_id||'')||pkg.snapshot_id!==receipt.immutable_version||instant(pkg.captured_at)===null||!exactDate(pkg.date_from)||!exactDate(pkg.date_to)||pkg.date_from>pkg.date_to||!object(pkg.views)||Object.keys(pkg.views).length!==1||!object(pkg.views.list_insurance))fail('WBS_FINAL1_INSURANCE_PACKAGE_INVALID','Insurance package identity, source surface, company mapping, currency, or range is invalid.');
  const packageSignature=signatureValue(pkg.detached_signature),unsignedPackage=without(pkg,'package_hash','detached_signature'),packageCanonical=bytes(unsignedPackage);
  if(!HASH.test(pkg.package_hash||'')||bare(pkg.package_hash)!==bare(sha256(packageCanonical))||pkg.detached_signature?.key_id!==receipt.kid||!packageSignature||!verified(trust.publicKey,packageCanonical,packageSignature))fail('WBS_SIGNED_DELIVERY_PACKAGE_SIGNATURE_INVALID','Insurance package hash or signature is invalid.');
  const view=pkg.views.list_insurance,rows=view.rows;
  if(!Array.isArray(rows)||!Number.isSafeInteger(view.row_count)||view.row_count<1||view.row_count>FINAL1_SIGNED_POPULATION_MAX||view.row_count!==rows.length||bare(view.content_hash)!==bare(sha256(bytes(rows)))||!object(view.scope)||!Array.isArray(view.scope.company_codes)||view.scope.company_codes.length!==1||view.scope.company_codes[0]!==expectedScope.company_code||!Array.isArray(view.scope.date_range)||view.scope.date_range.length!==2||view.scope.date_range[0]!==pkg.date_from||view.scope.date_range[1]!==pkg.date_to)fail('WBS_FINAL1_INSURANCE_VIEW_INVALID','Insurance population count, content hash, or scope is invalid.');
  const ids=new Set(),policies=new Set();let priorId=0;
  for(const row of rows){
    if(!object(row)||Object.keys(row).some(key=>!INSURANCE_FIELDS.has(key))||INSURANCE_TEXT_FIELDS.some(key=>row[key]!=null&&(typeof row[key]!=='string'||!SAFE_SOURCE_TEXT.test(row[key])))||!Number.isSafeInteger(row.id)||row.id<=priorId||!SAFE_SOURCE_TEXT.test(row.policy_id||'')||(row.pc_code!=null&&!SAFE_SOURCE_TEXT.test(row.pc_code))||ids.has(row.id)||policies.has(row.policy_id)||row.company_code!==null||row.deleted!==0||!FIXED_2.test(row.final_premium||'')||(row.start_date!=null&&!exactDate(row.start_date))||(row.expire_date!=null&&!exactDate(row.expire_date))||(row.currency!=null&&row.currency!=='USD')||(row.attachment_count!=null&&(!Number.isSafeInteger(row.attachment_count)||row.attachment_count<0)))fail('WBS_FINAL1_INSURANCE_ROW_INVALID','Insurance rows require the redacted scalar allowlist, ascending id/policy_id, nullable pc_code, null company_code, fixed-point premium, and valid source fields.');
    ids.add(row.id);policies.add(row.policy_id);priorId=row.id;
  }
  const computedControls=computeWbsFinal1ControlTotals({rows,currencyOf:()=>expectedCurrency,amountOf:row=>parseWbsFinal1Money4(row.final_premium)});
  validateWbsFinal1SignedControlTotals({control_totals:view.control_totals,control_totals_hash:view.control_totals_hash},{label:'Package view',expected:computedControls});
  const rawContainsCredentials=containsWbsProviderFinal1Credential(bytes(receipt))||containsWbsProviderFinal1Credential(requestRaw)||containsWbsProviderFinal1Credential(responseRaw)||containsWbsProviderFinal1Credential(packageRaw);
  const result=deepFreeze({status:'VERIFIED_FINAL1_INSURANCE_EVIDENCE_ONLY',format:'WBS_PROVIDER_FINAL1_INSURANCE',signature_verified:true,tenant_id:expectedScope.tenant_id,entity_id:expectedScope.entity_id,company_code:expectedScope.company_code,company_mapping_hash:expectedScope.company_mapping_hash,snapshot_id:pkg.snapshot_id,date_from:pkg.date_from,date_to:pkg.date_to,row_count:rows.length,control_totals:computedControls.control_totals,control_totals_hash:computedControls.control_totals_hash,package_hash:`sha256:${bare(pkg.package_hash)}`,raw_package_hash:`sha256:${bare(receipt.package_hash)}`,raw_contains_credentials:rawContainsCredentials,accounting_currency:'USD',currency_authority:'REFS_BUSINESS_OWNER_CONFIRMED',admission_blockers:Object.freeze(rawContainsCredentials?['RAW_ARTIFACT_CREDENTIAL_REDACTION_REQUIRED']:[]),package:pkg,can_admit:false,can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  verifiedFinal1InsuranceEvidence.add(result);
  return result;
}
