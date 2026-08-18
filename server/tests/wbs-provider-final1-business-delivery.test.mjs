import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalRequestBody} from '../runtime/request-hash.mjs';
import {normalizeVerifiedWbsProviderFinal1Business,verifyWbsProviderFinal1BusinessDelivery} from '../runtime/wbs-provider-final1-business-delivery.mjs';
import {computeWbsFinal1ControlTotals} from '../runtime/wbs-provider-final1-control-totals.mjs';

const canonical=value=>Buffer.from(canonicalRequestBody(value),'utf8');
const sha256=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const KNOWN_CONTROL_TOTALS={row_count:1,currency_totals:[{currency:'USD',row_count:1,amount_total:'10.0000'}]};
const KNOWN_CANONICAL_BODY='{"currency_totals":[{"amount_total":"10.0000","currency":"USD","row_count":1}],"row_count":1}';
const KNOWN_CONTROL_TOTALS_HASH='sha256:faa6c295db3c0d8e097f0f897b7da3102ae098551023cc9e55bba1ebd14011e1';
const control=(row_count,currency_totals)=>{const control_totals={row_count,currency_totals};return {control_totals,control_totals_hash:sha256(canonical(control_totals))};};

function bankRow(){return {account_code:'111000',cb_id:'BANK-1',child_come_from:null,child_count:0,come_from:'AUTOC',company_code:'WBPA',debtor:'10.0000',description:'Deposit',lender:'0.0000',payee:'Tenant',payee_no:'T-1',posting_date:'2026-08-15',review:'REVIEWED',set_date:'2026-08-15',statistical_business:null,sys_id:'SYS-1',turn_flag:'0'};}
function fixture(domain,{mutateReceipt,mutatePackage,requestText='POST /mcp HTTP/1.1\r\nX-Request-Id: safe\r\n\r\n{}'}={}){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'),kid='provider-final1-business-k1';
  const config=domain==='BANK'?{tool:'list_bank_transactions',rows:[bankRow()],scope:{company_codes:['WBPA'],currency:'USD',date_range:['2026-08-01','2026-08-31'],snapshot_token:'snapshot-bank-1'},totals:[{currency:'USD',row_count:1,amount_total:'10.0000'}]}:domain==='COST'?{tool:'list_control_totals',rows:[{amount:'25.5000',metric_key:'COST_METRIC_01'}],scope:{company_codes:['WBPA'],currency:'USD',date_range:['2026-08-01','2026-08-31'],report_type:'COST_GENERAL_LEDGER',period:'2026-08',snapshot_token:'snapshot-cost-1'},totals:[{currency:'USD',row_count:1,amount_total:'25.5000'}]}:{tool:'list_control_totals',rows:[{amount:'100.0000',metric_key:'PROPERTY_VALUE'}],scope:{bank_account_ref:'BANK-1',company_codes:['WBPA'],currency:'USD',date_range:['2026-08-01','2026-08-31'],period_end:'2026-08-31',period_start:'2026-08-01',property_ref:'PROPERTY-A',report_type:'PROPERTY_COMPARISON',snapshot_token:'snapshot-property-1'},totals:[{currency:'USD',row_count:1,amount_total:'100.0000'}]};
  const controls=control(config.rows.length,config.totals),view={scope:config.scope,row_count:config.rows.length,...controls,content_hash:sha256(canonical(config.rows)),rows:config.rows};
  let unsigned={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:'22222222-2222-4222-8222-222222222222',captured_at:'2026-08-15T00:00:00Z',environment:'PRODUCTION',source_system:'WBS',domain,source_tool:config.tool,company_key:'WBPA',date_from:'2026-08-01',date_to:'2026-08-31',views:{[config.tool]:view}};
  if(mutatePackage)unsigned=mutatePackage(structuredClone(unsigned));
  const pkg={...unsigned,package_hash:sha256(canonical(unsigned)),detached_signature:{key_id:kid,algorithm:'Ed25519',value:sign(null,canonical(unsigned),privateKey).toString('base64')}};
  const packageRaw=canonical(pkg),requestRaw=Buffer.from(requestText),responseRaw=Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}');
  let unsignedReceipt={issuer:'refs-mcp.wbm3.com',kid,algorithm:'Ed25519',request_sha256:sha256(requestRaw),response_sha256:sha256(responseRaw),package_hash:sha256(packageRaw),nonce:`final1-${domain.toLowerCase()}-nonce`,signed_at:'2026-08-15T00:01:00Z',expires_at:'2026-08-15T00:16:00Z',tenant_id:'33333333-3333-4333-8333-333333333333',entity_id:'44444444-4444-4444-8444-444444444444',company_code:'WBPA',immutable_version:pkg.snapshot_id,nonempty:true};
  if(mutateReceipt)unsignedReceipt=mutateReceipt(structuredClone(unsignedReceipt));
  const receipt={...unsignedReceipt,detached_signature:{key_id:kid,algorithm:'Ed25519',value:sign(null,canonical(unsignedReceipt),privateKey).toString('base64')}};
  return {providerTrust:{issuer:unsignedReceipt.issuer,key_id:kid,public_key:publicKey.export({type:'spki',format:'pem'}).toString()},receipt,requestRaw,responseRaw,packageRaw,expectedScope:{tenant_id:unsignedReceipt.tenant_id,entity_id:unsignedReceipt.entity_id,company_code:'WBPA'},domain,now:Date.parse('2026-08-15T00:02:00Z')};
}

test('Final-1 Bank, Cost control, and Property control evidence require exact signed controls and normalize without accounting authority',()=>{
  for(const domain of ['BANK','COST','PROPERTY']){
    const verified=verifyWbsProviderFinal1BusinessDelivery(fixture(domain)),plan=normalizeVerifiedWbsProviderFinal1Business({verified});
    assert.equal(verified.domain,domain);assert.equal(verified.signature_verified,true);assert.equal(verified.control_totals_hash,verified.package.views[verified.source_tool].control_totals_hash);
    assert.deepEqual(verified.control_totals,verified.package.views[verified.source_tool].control_totals);
    assert.equal(plan.evidence_rows.length,1);assert.equal(plan.provenance.control_totals_hash,verified.control_totals_hash);assert.equal(plan.can_create_transaction,false);assert.equal(plan.can_create_draft,false);assert.equal(plan.can_post,false);
    assert.equal(plan.evidence_rows[0].outcome,domain==='BANK'?'STAGING_REVIEW_REQUIRED':'CONTROL_EVIDENCE_ONLY');
  }
});

test('Final-1 business verification rejects missing, changed, and noncanonical signed controls',()=>{
  assert.throws(()=>verifyWbsProviderFinal1BusinessDelivery(fixture('BANK',{mutatePackage:value=>{delete value.views.list_bank_transactions.control_totals;return value;}})),error=>error.code==='WBS_FINAL1_CONTROL_INVALID');
  assert.throws(()=>verifyWbsProviderFinal1BusinessDelivery(fixture('BANK',{mutatePackage:value=>{value.views.list_bank_transactions.control_totals={row_count:1,per_currency_totals:[{currency:'USD',gross_amount:'10.0000'}]};return value;}})),error=>error.code==='WBS_FINAL1_CONTROL_INVALID');
  assert.throws(()=>verifyWbsProviderFinal1BusinessDelivery(fixture('COST',{mutatePackage:value=>{value.views.list_control_totals.control_totals_hash='sha256:0aa6c295db3c0d8e097f0f897b7da3102ae098551023cc9e55bba1ebd14011e1';return value;}})),error=>error.code==='WBS_FINAL1_CONTROL_INVALID');
});

test('Final-1 business control totals freeze the Provider canonical V1 bytes and SHA-256 vector',()=>{
  assert.equal(canonicalRequestBody(KNOWN_CONTROL_TOTALS),KNOWN_CANONICAL_BODY);
  assert.equal(sha256(Buffer.from(KNOWN_CANONICAL_BODY,'utf8')),KNOWN_CONTROL_TOTALS_HASH);
  assert.deepEqual(control(1,KNOWN_CONTROL_TOTALS.currency_totals),{control_totals:KNOWN_CONTROL_TOTALS,control_totals_hash:KNOWN_CONTROL_TOTALS_HASH});
});

test('Final-1 control aggregation rejects totals outside the canonical MONEY4 bound',()=>{
  assert.throws(()=>computeWbsFinal1ControlTotals({rows:['999999999999999999.9900','100.0000'],currencyOf:()=> 'USD',amountOf:value=>BigInt(value.replace('.',''))}),error=>error.code==='WBS_FINAL1_CONTROL_MONEY_INVALID');
});

test('Final-1 business verification rejects extra fields, wrong tools, wrong scope, and unsigned or old contracts',()=>{
  assert.throws(()=>verifyWbsProviderFinal1BusinessDelivery(fixture('BANK',{mutatePackage:value=>({...value,unexpected:'unsafe'})})),error=>error.code==='WBS_FINAL1_BUSINESS_PACKAGE_INVALID');
  assert.throws(()=>verifyWbsProviderFinal1BusinessDelivery(fixture('PROPERTY',{mutatePackage:value=>({...value,source_tool:'list_payables'})})),error=>error.code==='WBS_FINAL1_BUSINESS_PACKAGE_INVALID');
  assert.throws(()=>verifyWbsProviderFinal1BusinessDelivery(fixture('BANK',{mutatePackage:value=>{value.views.list_bank_transactions.scope.company_codes=['OTHER'];return value;}})),error=>error.code==='WBS_FINAL1_BUSINESS_SCOPE_MISMATCH');
  const unsigned=fixture('BANK');unsigned.receipt.detached_signature.value='AA==';
  assert.throws(()=>verifyWbsProviderFinal1BusinessDelivery(unsigned),error=>error.code==='WBS_SIGNED_DELIVERY_RECEIPT_SIGNATURE_INVALID');
  const old8=fixture('BANK');delete old8.receipt.nonempty;
  assert.throws(()=>verifyWbsProviderFinal1BusinessDelivery(old8),error=>error.code==='WBS_FINAL1_BUSINESS_RECEIPT_INVALID');
});

test('Final-1 business verification binds every row and control period to the signed package range',()=>{
  assert.throws(()=>verifyWbsProviderFinal1BusinessDelivery(fixture('BANK',{mutatePackage:value=>{value.views.list_bank_transactions.rows[0].posting_date='2026-09-01';value.views.list_bank_transactions.content_hash=sha256(canonical(value.views.list_bank_transactions.rows));return value;}})),error=>error.code==='WBS_FINAL1_BUSINESS_SCOPE_MISMATCH');
  assert.throws(()=>verifyWbsProviderFinal1BusinessDelivery(fixture('COST',{mutatePackage:value=>{value.views.list_control_totals.scope.period='2026-07';return value;}})),error=>error.code==='WBS_FINAL1_BUSINESS_SCOPE_MISMATCH');
  assert.throws(()=>verifyWbsProviderFinal1BusinessDelivery(fixture('PROPERTY',{mutatePackage:value=>{value.views.list_control_totals.scope.period_start='2026-07-01';return value;}})),error=>error.code==='WBS_FINAL1_BUSINESS_SCOPE_MISMATCH');
});

test('Final-1 business credential-bearing artifacts remain evidence-only and cannot normalize',()=>{
  const verified=verifyWbsProviderFinal1BusinessDelivery(fixture('BANK',{requestText:'GET /mcp?access_token=secret HTTP/1.1\r\n\r\n'}));
  assert.equal(verified.raw_contains_credentials,true);assert.deepEqual(verified.admission_blockers,['RAW_ARTIFACT_CREDENTIAL_REDACTION_REQUIRED']);
  assert.throws(()=>normalizeVerifiedWbsProviderFinal1Business({verified}),error=>error.code==='WBS_FINAL1_BUSINESS_NORMALIZATION_BLOCKED');
});

test('Final-1 business normalizer rejects a cloned verifier result capability',()=>{
  const verified=verifyWbsProviderFinal1BusinessDelivery(fixture('COST'));
  assert.throws(()=>normalizeVerifiedWbsProviderFinal1Business({verified:structuredClone(verified)}),error=>error.code==='WBS_FINAL1_BUSINESS_NORMALIZATION_BLOCKED');
});
