import {createHash,verify} from 'node:crypto';
import {canonicalRequestBody,canonicalRequestHash} from './request-hash.mjs';
import {containsWbsProviderFinal1Credential} from './wbs-provider-final1-delivery.mjs';
import {normalizeWbsProviderTrust,WBS_SIGNED_DELIVERY_MAX_TTL_MS,WbsSignedDeliveryAdmissionError} from './wbs-signed-delivery-admission.mjs';
import {computeWbsFinal1ControlTotals,formatWbsFinal1Money4,parseWbsFinal1Money4,validateWbsFinal1SignedControlTotals} from './wbs-provider-final1-control-totals.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^sha256:[0-9a-f]{64}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const UTC=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{3}))?Z$/;
const SAFE_TEXT=/^[^\u0000-\u001f\u007f]{1,512}$/;
const MAX_ROWS=500;
const verifiedBusinessEvidence=new WeakSet();

export const WBS_FINAL1_BUSINESS_DOMAINS=Object.freeze({
  BANK:Object.freeze({tool:'list_bank_transactions',reportType:null,stableKey:'cb_id',rowKeys:Object.freeze(['account_code','cb_id','child_come_from','child_count','come_from','company_code','debtor','description','lender','payee','payee_no','posting_date','review','set_date','statistical_business','sys_id','turn_flag'])}),
  COST:Object.freeze({tool:'list_control_totals',reportType:'COST_GENERAL_LEDGER',stableKey:'metric_key',rowKeys:Object.freeze(['amount','metric_key'])}),
  PROPERTY:Object.freeze({tool:'list_control_totals',reportType:'PROPERTY_COMPARISON',stableKey:'metric_key',rowKeys:Object.freeze(['amount','metric_key'])})
});

const fail=(code,message)=>{throw new WbsSignedDeliveryAdmissionError(code,message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exactKeys=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const canonical=value=>Buffer.from(canonicalRequestBody(value),'utf8');
const sha256=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const without=(value,...keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const instant=value=>{const match=typeof value==='string'&&UTC.exec(value),time=Date.parse(value);return match&&Number.isFinite(time)&&new Date(time).toISOString()===`${match[1]}.${match[2]||'000'}Z`?time:null;};
const exactDate=value=>DATE.test(value||'')&&new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10)===value;
const signature=value=>exactKeys(value,['key_id','algorithm','value'])&&value.algorithm==='Ed25519'&&typeof value.value==='string'&&value.value.length>0?value.value:null;
const signatureOk=(key,payload,value)=>{try{return verify(null,payload,key,Buffer.from(value,'base64'))===true;}catch{return false;}};
const deepFreeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}return value;};
function computedControls(domain,view,rows){
  return computeWbsFinal1ControlTotals({rows,currencyOf:()=>view.scope.currency,amountOf:row=>{if(domain==='BANK'){const debtor=parseWbsFinal1Money4(row.debtor),lender=parseWbsFinal1Money4(row.lender);if(debtor<0n||lender<0n||(debtor===0n)===(lender===0n))fail('WBS_FINAL1_BANK_DIRECTION_INVALID','A Bank row must have exactly one non-zero non-negative debtor or lender amount.');return debtor+lender;}return parseWbsFinal1Money4(row.amount);}});
}

function validateRows(domain,config,view,expectedScope){
  const rows=view.rows;
  if(!Array.isArray(rows)||rows.length<1||rows.length>MAX_ROWS||view.row_count!==rows.length||sha256(canonical(rows))!==view.content_hash)fail('WBS_FINAL1_BUSINESS_VIEW_INVALID','Signed business row count or content hash is invalid.');
  let prior='';
  for(const row of rows){
    if(!exactKeys(row,config.rowKeys)||!SAFE_TEXT.test(String(row[config.stableKey]||''))||String(row[config.stableKey])<=prior)fail('WBS_FINAL1_BUSINESS_ROW_INVALID','Signed business rows must use the exact domain allowlist and strictly ascending stable keys.');
    prior=String(row[config.stableKey]);
    if(domain==='BANK'&&row.company_code!==expectedScope.company_code)fail('WBS_FINAL1_BUSINESS_SCOPE_MISMATCH','Bank row company differs from the independently approved scope.');
    if(domain!=='BANK'&&(!SAFE_TEXT.test(row.metric_key||'')||typeof row.amount!=='string'))fail('WBS_FINAL1_BUSINESS_ROW_INVALID','Control evidence rows require exact metric_key and fixed-point amount strings.');
  }
  return rows;
}

// This verifier accepts only fields that the reviewed nine-tool Provider
// contract can actually produce: Bank transactions and Cost/Property control
// totals.  It deliberately does not turn Property control evidence into a rent
// transaction or Cost controls into a CWIP transaction.
export function verifyWbsProviderFinal1BusinessDelivery({providerTrust,receipt,requestRaw,responseRaw,packageRaw,expectedScope,domain,now=Date.now()}={}){
  const config=WBS_FINAL1_BUSINESS_DOMAINS[domain],trust=normalizeWbsProviderTrust(providerTrust);
  if(!config||!Buffer.isBuffer(requestRaw)||!Buffer.isBuffer(responseRaw)||!Buffer.isBuffer(packageRaw)||!object(expectedScope)||!UUID.test(expectedScope.tenant_id||'')||!UUID.test(expectedScope.entity_id||'')||!SAFE_TEXT.test(expectedScope.company_code||''))fail('WBS_FINAL1_BUSINESS_SCOPE_INVALID','Exact authenticated scope and a supported signed business domain are required.');
  const receiptKeys=['issuer','kid','algorithm','request_sha256','response_sha256','package_hash','nonce','signed_at','expires_at','tenant_id','entity_id','company_code','immutable_version','nonempty','control_totals','detached_signature'];
  if(!exactKeys(receipt,receiptKeys)||receipt.algorithm!=='Ed25519'||receipt.nonempty!==true||![receipt.request_sha256,receipt.response_sha256,receipt.package_hash].every(value=>HASH.test(value||'')))fail('WBS_FINAL1_BUSINESS_RECEIPT_INVALID','Signed business receipt is not the exact closed contract.');
  const signedAt=instant(receipt.signed_at),expiresAt=instant(receipt.expires_at);
  if(signedAt===null||expiresAt===null||signedAt>=expiresAt||expiresAt-signedAt>WBS_SIGNED_DELIVERY_MAX_TTL_MS||signedAt>now+300000||expiresAt<=now)fail('WBS_SIGNED_DELIVERY_RECEIPT_EXPIRED','Signed business receipt is outside the strict 15-minute window.');
  if(receipt.issuer!==trust.issuer||receipt.kid!==trust.key_id||receipt.tenant_id!==expectedScope.tenant_id||receipt.entity_id!==expectedScope.entity_id||receipt.company_code!==expectedScope.company_code)fail('WBS_SIGNED_DELIVERY_SCOPE_MISMATCH','Signed business receipt differs from pinned trust or authenticated scope.');
  if(sha256(requestRaw)!==receipt.request_sha256||sha256(responseRaw)!==receipt.response_sha256||sha256(packageRaw)!==receipt.package_hash)fail('WBS_SIGNED_DELIVERY_RAW_HASH_MISMATCH','Signed business receipt does not bind all exact raw artifacts.');
  const receiptSignature=signature(receipt.detached_signature);
  if(receipt.detached_signature?.key_id!==receipt.kid||!receiptSignature||!signatureOk(trust.publicKey,canonical(without(receipt,'detached_signature')),receiptSignature))fail('WBS_SIGNED_DELIVERY_RECEIPT_SIGNATURE_INVALID','Signed business receipt signature is invalid.');
  let pkg;try{pkg=JSON.parse(packageRaw.toString('utf8'));}catch{fail('WBS_SIGNED_DELIVERY_PACKAGE_INVALID','Signed business package is not JSON.');}
  if(!packageRaw.equals(canonical(pkg)))fail('WBS_SIGNED_DELIVERY_PACKAGE_NONCANONICAL','Signed business package must be canonical UTF-8 JSON.');
  const packageKeys=['schema_version','snapshot_id','captured_at','environment','source_system','domain','source_tool','company_key','date_from','date_to','views','control_totals','package_hash','detached_signature'];
  if(!exactKeys(pkg,packageKeys)||pkg.schema_version!=='WBS_READONLY_SNAPSHOT_V2'||pkg.environment!=='PRODUCTION'||pkg.source_system!=='WBS'||pkg.domain!==domain||pkg.source_tool!==config.tool||!UUID.test(pkg.snapshot_id||'')||pkg.snapshot_id!==receipt.immutable_version||pkg.company_key!==expectedScope.company_code||instant(pkg.captured_at)===null||!exactDate(pkg.date_from)||!exactDate(pkg.date_to)||pkg.date_from>pkg.date_to||!exactKeys(pkg.views,[config.tool]))fail('WBS_FINAL1_BUSINESS_PACKAGE_INVALID','Signed business package identity, tool, scope, or range is invalid.');
  const packageSignature=signature(pkg.detached_signature),unsigned=without(pkg,'package_hash','detached_signature');
  if(!HASH.test(pkg.package_hash||'')||sha256(canonical(unsigned))!==pkg.package_hash||pkg.detached_signature?.key_id!==receipt.kid||!packageSignature||!signatureOk(trust.publicKey,canonical(unsigned),packageSignature))fail('WBS_SIGNED_DELIVERY_PACKAGE_SIGNATURE_INVALID','Signed business package hash or signature is invalid.');
  const view=pkg.views[config.tool],viewKeys=['scope','row_count','content_hash','rows'];
  if(!exactKeys(view,viewKeys)||!object(view.scope)||!HASH.test(view.content_hash||''))fail('WBS_FINAL1_BUSINESS_VIEW_INVALID','Signed business view is not the exact closed contract.');
  const scopeKeys=domain==='BANK'?['company_codes','currency','date_range','snapshot_token']:domain==='COST'?['company_codes','currency','date_range','report_type','period','snapshot_token']:['bank_account_ref','company_codes','currency','date_range','period_end','period_start','property_ref','report_type','snapshot_token'];
  if(!exactKeys(view.scope,scopeKeys)||!Array.isArray(view.scope.company_codes)||view.scope.company_codes.length!==1||view.scope.company_codes[0]!==expectedScope.company_code||view.scope.currency!=='USD'||!Array.isArray(view.scope.date_range)||view.scope.date_range.length!==2||view.scope.date_range[0]!==pkg.date_from||view.scope.date_range[1]!==pkg.date_to||!SAFE_TEXT.test(view.scope.snapshot_token||''))fail('WBS_FINAL1_BUSINESS_SCOPE_MISMATCH','Signed business view scope is incomplete or differs from the approved scope.');
  if(config.reportType&&view.scope.report_type!==config.reportType)fail('WBS_FINAL1_BUSINESS_SCOPE_MISMATCH','Signed control report type differs from its fixed domain.');
  if(domain==='PROPERTY'&&(!SAFE_TEXT.test(view.scope.property_ref||'')||!SAFE_TEXT.test(view.scope.bank_account_ref||'')||!exactDate(view.scope.period_start)||!exactDate(view.scope.period_end)||view.scope.period_start>view.scope.period_end))fail('WBS_FINAL1_BUSINESS_SCOPE_MISMATCH','Property control evidence requires exact property, bank account, and period scope.');
  const rows=validateRows(domain,config,view,expectedScope),computed=computedControls(domain,view,rows);
  validateWbsFinal1SignedControlTotals(receipt.control_totals,{label:'Receipt',expected:computed});validateWbsFinal1SignedControlTotals(pkg.control_totals,{label:'Package',expected:computed});
  const rawContainsCredentials=[canonical(receipt),requestRaw,responseRaw,packageRaw].some(containsWbsProviderFinal1Credential);
  const result=deepFreeze({status:'VERIFIED_FINAL1_BUSINESS_EVIDENCE_ONLY',format:'WBS_PROVIDER_FINAL1_BUSINESS_V1',signature_verified:true,tenant_id:expectedScope.tenant_id,entity_id:expectedScope.entity_id,company_code:expectedScope.company_code,domain,source_tool:config.tool,snapshot_id:pkg.snapshot_id,date_from:pkg.date_from,date_to:pkg.date_to,row_count:rows.length,per_currency_totals:computed.per_currency_totals,control_totals_hash:computed.control_totals_hash,package_hash:pkg.package_hash,raw_package_hash:receipt.package_hash,raw_contains_credentials:rawContainsCredentials,admission_blockers:rawContainsCredentials?['RAW_ARTIFACT_CREDENTIAL_REDACTION_REQUIRED']:[],package:pkg,can_persist:false,can_create_transaction:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  verifiedBusinessEvidence.add(result);return result;
}

export function normalizeVerifiedWbsProviderFinal1Business({verified}={}){
  if(!verifiedBusinessEvidence.has(verified)||verified.status!=='VERIFIED_FINAL1_BUSINESS_EVIDENCE_ONLY'||verified.raw_contains_credentials||verified.admission_blockers.length)fail('WBS_FINAL1_BUSINESS_NORMALIZATION_BLOCKED','Only the exact credential-free verifier capability may be normalized.');
  const config=WBS_FINAL1_BUSINESS_DOMAINS[verified.domain],view=verified.package.views[config.tool];
  const rows=view.rows.map((row,index)=>{
    const raw=deepFreeze(structuredClone(row)),rawHash=sha256(canonical(raw)),sourceRecordId=String(row[config.stableKey]);
    let grossAmount,businessDate;
    if(verified.domain==='BANK'){grossAmount=formatWbsFinal1Money4(parseWbsFinal1Money4(row.debtor)+parseWbsFinal1Money4(row.lender));businessDate=row.posting_date||row.set_date;}
    else{const amount=parseWbsFinal1Money4(row.amount);grossAmount=formatWbsFinal1Money4(amount<0n?-amount:amount);businessDate=verified.domain==='PROPERTY'?view.scope.period_end:`${view.scope.period}-01`;}
    if(!exactDate(businessDate))fail('WBS_FINAL1_BUSINESS_ROW_INVALID','Every normalized business row requires an exact signed business date.');
    return deepFreeze({source_system:'WBS',source_module:config.tool,source_domain:verified.domain,source_record_id:sourceRecordId,source_primary_key:sourceRecordId,source_row_ordinal:index,source_version:`final1:${verified.snapshot_id}:${rawHash.slice(7,23)}`,raw_row:raw,raw_row_hash:rawHash,provider_package_hash:verified.package_hash,provider_raw_package_hash:verified.raw_package_hash,provider_snapshot_id:verified.snapshot_id,provider_company_code:verified.company_code,currency:'USD',gross_amount:grossAmount,business_date:businessDate,normalized:verified.domain==='BANK'?{bankAccountCode:row.account_code,debtor:row.debtor,lender:row.lender,payee:row.payee||null,description:row.description||null}:{metricKey:row.metric_key,amount:row.amount,reportType:config.reportType,propertyRef:view.scope.property_ref||null,bankAccountRef:view.scope.bank_account_ref||null},outcome:verified.domain==='BANK'?'STAGING_REVIEW_REQUIRED':'CONTROL_EVIDENCE_ONLY',exception_codes:[],can_create_transaction:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  });
  const provenance=deepFreeze({tenant_id:verified.tenant_id,entity_id:verified.entity_id,company_code:verified.company_code,domain:verified.domain,source_tool:verified.source_tool,snapshot_id:verified.snapshot_id,source_row_count:rows.length,row_count:verified.row_count,per_currency_totals:verified.per_currency_totals,control_totals_hash:verified.control_totals_hash,currency:'USD'});
  return deepFreeze({status:'NORMALIZED_FINAL1_BUSINESS_EVIDENCE_PLAN',format:'WBS_PROVIDER_FINAL1_NORMALIZED_BUSINESS_V1',provenance,plan_hash:canonicalRequestHash({provenance,row_hashes:rows.map(row=>row.raw_row_hash)}),evidence_rows:rows,can_persist_evidence:true,can_create_transaction:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false});
}
