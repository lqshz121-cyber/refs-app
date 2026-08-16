import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalRequestBody} from '../runtime/request-hash.mjs';
import {verifyWbsProviderFinal1Delivery} from '../runtime/wbs-provider-final1-delivery.mjs';
import {normalizeVerifiedWbsProviderFinal1Payables} from '../runtime/wbs-provider-final1-payable-normalizer.mjs';

const canonical=value=>Buffer.from(canonicalRequestBody(value),'utf8');
const hash=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;

function fixture({currency='USD',credentials=false}={}){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'),kid='wbs-final1-normalize-test';
  const row={
    ap_guid:'11111111-1111-4111-8111-111111111111',ap_long_id:'AP-LONG-1',ap_type:'AUTOC',company_code:'WBPA',
    ...(currency==null?{}:{currency}),amount:'10.0000',invoice_no:'INV-1',invoice_date:'2026-01-14',business_id:'BUS-1',incurred_date:'2026-01-15',posting_date:'2026-01-16',
    vendor_no:'V-1',vendor_name:'Vendor',project_guid:'P-1',pj_code:'PROJECT-1',pj_name:'Project',description:'Invoice',
    service_period_start:null,service_period_end:null,recurring_obligation_id:null,contract_id:null,charge_code:null,service_frequency:null,obligation_status:null,
    provider_metadata:{control:{state:'ORIGINAL'}}
  };
  const view={scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-06-30']},row_count:1,content_hash:hash(canonical([row])).slice(7),rows:[row]};
  const unsigned={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:'22222222-2222-4222-8222-222222222222',captured_at:'2026-08-15T00:00:00Z',environment:'PRODUCTION',source_system:'WBS',domain:'PAYABLES',company_key:'WBPA',date_from:'2026-01-01',date_to:'2026-06-30',views:{list_payables:view}};
  const packageHash=hash(canonical(unsigned)).slice(7);
  const pkg={...unsigned,package_hash:packageHash,detached_signature:{key_id:kid,algorithm:'Ed25519',value:sign(null,canonical(unsigned),privateKey).toString('base64')}};
  const packageRaw=canonical(pkg);
  const requestRaw=Buffer.from(credentials?'GET /mcp/payables\r\nAuthorization: Bearer secret':'GET /mcp/payables');
  const responseRaw=Buffer.from('{"ok":true}');
  const unsignedReceipt={issuer:'refs-mcp.wbm3.com',kid,algorithm:'Ed25519',request_sha256:hash(requestRaw),response_sha256:hash(responseRaw),package_hash:hash(packageRaw),nonce:'final1-normalize-nonce',signed_at:'2026-08-15T00:01:00Z',expires_at:'2026-08-15T00:16:00Z',tenant_id:'33333333-3333-4333-8333-333333333333',entity_id:'44444444-4444-4444-8444-444444444444',company_code:'WBPA',immutable_version:pkg.snapshot_id,nonempty:true};
  const receipt={...unsignedReceipt,detached_signature:{key_id:kid,algorithm:'Ed25519',value:sign(null,canonical(unsignedReceipt),privateKey).toString('base64')}};
  const verified=verifyWbsProviderFinal1Delivery({providerTrust:{issuer:unsignedReceipt.issuer,key_id:kid,public_key:publicKey.export({type:'spki',format:'pem'}).toString()},receipt,requestRaw,responseRaw,packageRaw,expectedScope:{tenant_id:unsignedReceipt.tenant_id,entity_id:unsignedReceipt.entity_id,company_code:'WBPA'},expectedCurrency:'USD',now:Date.parse('2026-08-15T00:02:00Z')});
  return {verified,row};
}

test('normalizes Provider-signed USD rows into immutable staging only',()=>{
  const {verified,row}=fixture(),plan=normalizeVerifiedWbsProviderFinal1Payables({verified,expectedCurrency:'USD'}),output=plan.staging_rows[0];
  assert.equal(plan.status,'NORMALIZED_FINAL1_PAYABLE_STAGING_PLAN');
  assert.equal(plan.provenance.currency_authority,'PROVIDER_SIGNED_CURRENCY');
  assert.equal(output.source_record_id,row.ap_guid);
  assert.equal(output.source_module,'BGDATA.payable');
  assert.deepEqual(output.source_surface,{database:'wbsdata',table:'account_book_payable_info',stable_keys:['ap_guid']});
  assert.equal(output.normalized.vendorName,'Vendor');
  assert.equal(output.normalized.projectCode,'PROJECT-1');
  assert.equal(output.raw_row.invoice_no,'INV-1');assert.equal(output.raw_row.invoice_date,'2026-01-14');assert.equal(output.raw_row.business_id,'BUS-1');
  assert.equal(output.normalized.invoiceNo,'INV-1');assert.equal(output.normalized.invoiceDate,'2026-01-14');assert.equal(output.normalized.businessId,'BUS-1');
  for(const field of ['servicePeriodStart','servicePeriodEnd','recurringObligationId','contractId','chargeCode','serviceFrequency','obligationStatus'])assert.equal(output.normalized[field],null,`${field} must remain explicit null rather than inferred`);
  assert.match(output.raw_row_hash,/^sha256:/);
  assert.equal(output.raw_row.ap_guid,row.ap_guid);
  assert.equal(Object.isFrozen(output.raw_row.provider_metadata),true);
  assert.equal(Object.isFrozen(output.raw_row.provider_metadata.control),true);
  const originalRawRowHash=output.raw_row_hash;
  assert.throws(()=>{output.raw_row.provider_metadata.control.state='MUTATED';},TypeError);
  assert.equal(output.raw_row.provider_metadata.control.state,'ORIGINAL');
  assert.equal(hash(canonical(output.raw_row)),originalRawRowHash);
  assert.equal(output.can_create_draft,false);
  assert.equal(plan.can_post,false);
  assert.deepEqual(plan.exception_rows,[]);
});

test('retains missing invoice or vendor facts as signed exceptions without confirming duplicates or creating accounting actions',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'),kid='wbs-final1-missing-fields';
  const row={ap_guid:'55555555-5555-4555-8555-555555555555',company_code:'WBPA',currency:'USD',amount:'10.0000',invoice_no:null,invoice_date:null,business_id:null,incurred_date:'2026-01-15',service_period_start:null,service_period_end:null,recurring_obligation_id:null,contract_id:null,charge_code:null,service_frequency:null,obligation_status:null};
  const view={scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-06-30']},row_count:1,content_hash:hash(canonical([row])).slice(7),rows:[row]};
  const unsigned={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:'66666666-6666-4666-8666-666666666666',captured_at:'2026-08-15T00:00:00Z',environment:'PRODUCTION',source_system:'WBS',domain:'PAYABLES',company_key:'WBPA',date_from:'2026-01-01',date_to:'2026-06-30',views:{list_payables:view}};
  const packageHash=hash(canonical(unsigned)).slice(7),pkg={...unsigned,package_hash:packageHash,detached_signature:{key_id:kid,algorithm:'Ed25519',value:sign(null,canonical(unsigned),privateKey).toString('base64')}},packageRaw=canonical(pkg),requestRaw=Buffer.from('GET /mcp/payables'),responseRaw=Buffer.from('{"ok":true}');
  const unsignedReceipt={issuer:'refs-mcp.wbm3.com',kid,algorithm:'Ed25519',request_sha256:hash(requestRaw),response_sha256:hash(responseRaw),package_hash:hash(packageRaw),nonce:'missing-fields-nonce',signed_at:'2026-08-15T00:01:00Z',expires_at:'2026-08-15T00:16:00Z',tenant_id:'33333333-3333-4333-8333-333333333333',entity_id:'44444444-4444-4444-8444-444444444444',company_code:'WBPA',immutable_version:pkg.snapshot_id,nonempty:true};
  const receipt={...unsignedReceipt,detached_signature:{key_id:kid,algorithm:'Ed25519',value:sign(null,canonical(unsignedReceipt),privateKey).toString('base64')}};
  const verified=verifyWbsProviderFinal1Delivery({providerTrust:{issuer:unsignedReceipt.issuer,key_id:kid,public_key:publicKey.export({type:'spki',format:'pem'}).toString()},receipt,requestRaw,responseRaw,packageRaw,expectedScope:{tenant_id:unsignedReceipt.tenant_id,entity_id:unsignedReceipt.entity_id,company_code:'WBPA'},expectedCurrency:'USD',now:Date.parse('2026-08-15T00:02:00Z')});
  const plan=normalizeVerifiedWbsProviderFinal1Payables({verified,expectedCurrency:'USD'}),output=plan.staging_rows[0];
  assert.equal(output.outcome,'EXCEPTION_REVIEW_REQUIRED');
  assert.deepEqual(output.exception_codes,['WBS_PAYABLE_INVOICE_NUMBER_MISSING','WBS_PAYABLE_VENDOR_MISSING','WBS_PAYABLE_ATTACHMENT_REQUIRED','WBS_PAYABLE_MAPPING_REVIEW_REQUIRED']);
  assert.equal(plan.exception_rows.length,1);
  assert.equal(JSON.stringify(output).includes('DUPLICATE'),false);
  assert.equal(output.can_create_draft,false);assert.equal(output.can_review,false);assert.equal(output.can_approve,false);assert.equal(output.can_post,false);
});

test('normalizes rows without a Provider currency only under independently approved USD authority',()=>{
  const {verified,row}=fixture({currency:null});
  assert.equal(row.currency,undefined);
  assert.equal(verified.currency_signed,false);
  assert.equal(verified.accounting_currency,'USD');
  assert.deepEqual(verified.admission_blockers,[]);
  const plan=normalizeVerifiedWbsProviderFinal1Payables({verified,expectedCurrency:'USD'}),output=plan.staging_rows[0];
  assert.equal(plan.provenance.currency,'USD');
  assert.equal(plan.provenance.currency_authority,'REFS_BUSINESS_OWNER_CONFIRMED_CURRENCY');
  assert.equal(output.raw_row.currency,undefined);
  assert.equal(output.currency,'USD');
  assert.equal(output.normalized.currency,'USD');
  assert.equal(output.currency_authority,'REFS_BUSINESS_OWNER_CONFIRMED_CURRENCY');
  assert.equal(plan.can_create_draft,false);
  assert.equal(plan.can_post,false);
});

test('fails closed for credentials, tamper, scope, currency authority or mismatch',()=>{
  const credentialed=fixture({credentials:true});
  assert.throws(()=>normalizeVerifiedWbsProviderFinal1Payables({verified:credentialed.verified,expectedCurrency:'USD'}),error=>error.code==='WBS_FINAL1_NORMALIZATION_ADMISSION_BLOCKED');

  const tampered=fixture();
  assert.throws(()=>{tampered.verified.package.views.list_payables.rows[0].amount='11.0000';},TypeError);
  assert.equal(tampered.verified.package.views.list_payables.rows[0].amount,'10.0000');
  const cloned=structuredClone(tampered.verified),view=cloned.package.views.list_payables;
  view.rows.push(structuredClone(tampered.row));view.row_count=2;view.content_hash=hash(canonical(view.rows)).slice(7);
  const unsigned=Object.fromEntries(Object.entries(cloned.package).filter(([key])=>key!=='package_hash'&&key!=='detached_signature'));
  cloned.package.package_hash=hash(canonical(unsigned)).slice(7);cloned.package.detached_signature.value='forged';cloned.package_hash=`sha256:${cloned.package.package_hash}`;
  assert.throws(()=>normalizeVerifiedWbsProviderFinal1Payables({verified:cloned,expectedCurrency:'USD'}),error=>error.code==='WBS_FINAL1_NORMALIZATION_TAMPERED');

  const scoped=fixture();
  assert.throws(()=>normalizeVerifiedWbsProviderFinal1Payables({verified:{...scoped.verified,company_code:'OTHER'},expectedCurrency:'USD'}),error=>error.code==='WBS_FINAL1_NORMALIZATION_TAMPERED');
  const missing=fixture();
  assert.throws(()=>normalizeVerifiedWbsProviderFinal1Payables({verified:missing.verified}),error=>error.code==='WBS_FINAL1_NORMALIZATION_CURRENCY_AUTHORITY_REQUIRED');
  const wrong=fixture();
  assert.throws(()=>normalizeVerifiedWbsProviderFinal1Payables({verified:wrong.verified,expectedCurrency:'CAD'}),error=>error.code==='WBS_FINAL1_NORMALIZATION_ADMISSION_BLOCKED');
  assert.throws(()=>fixture({currency:'CAD'}),error=>error.code==='WBS_FINAL1_CURRENCY_SCOPE_MISMATCH');
});
