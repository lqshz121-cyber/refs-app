import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalRequestBody} from '../runtime/request-hash.mjs';
import {verifyWbsProviderFinal1InsuranceDelivery} from '../runtime/wbs-provider-final1-delivery.mjs';
import {normalizeVerifiedWbsProviderFinal1Insurance} from '../runtime/wbs-provider-final1-insurance-normalizer.mjs';

const canonical=value=>Buffer.from(canonicalRequestBody(value),'utf8');
const hash=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const mappingHash=`sha256:${'a'.repeat(64)}`;

function fixture({rows,credentials=false}={}){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'),kid='wbs-final1-insurance-test';
  const sourceRows=rows||[{id:1,policy_id:'POL-1',company_code:'WBPA',pc_code:'PC-1',property_code:'PROP-1',unit_code:'UNIT-1',insurance_status:'Active',approval_status:'Approved',policy_number:'P-100',carrier:'Carrier',insurance_type:'Fire',final_premium:'1200.00',start_date:'2026-01-01',expire_date:'2026-12-31',attachment_count:1,policy_attachment_id:'attachment-1',data_source:'new-insurance',update_time:'2026-08-15 00:00:00',deleted:0}];
  const view={scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-12-31']},row_count:sourceRows.length,content_hash:hash(canonical(sourceRows)).slice(7),rows:sourceRows};
  const unsigned={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:'22222222-2222-4222-8222-222222222222',captured_at:'2026-08-15T00:00:00Z',environment:'PRODUCTION',source_system:'WBS',domain:'INSURANCE',source_database:'wb_insurance',source_table:'insurance_data',company_key:'WBPA',company_mapping_hash:mappingHash,currency:'USD',date_from:'2026-01-01',date_to:'2026-12-31',views:{list_insurance:view}};
  const packageHash=hash(canonical(unsigned)).slice(7),pkg={...unsigned,package_hash:packageHash,detached_signature:{key_id:kid,algorithm:'Ed25519',value:sign(null,canonical(unsigned),privateKey).toString('base64')}},packageRaw=canonical(pkg);
  const requestRaw=Buffer.from(credentials?'GET /insurance\r\nAuthorization: Bearer secret':'GET /insurance\r\nX-Request-Id: safe'),responseRaw=Buffer.from('{"ok":true}');
  const unsignedReceipt={issuer:'refs-mcp.wbm3.com',kid,algorithm:'Ed25519',request_sha256:hash(requestRaw),response_sha256:hash(responseRaw),package_hash:hash(packageRaw),nonce:'final1-insurance-nonce',signed_at:'2026-08-15T00:01:00Z',expires_at:'2026-08-15T00:16:00Z',tenant_id:'33333333-3333-4333-8333-333333333333',entity_id:'44444444-4444-4444-8444-444444444444',company_code:'WBPA',immutable_version:pkg.snapshot_id,nonempty:true};
  const receipt={...unsignedReceipt,detached_signature:{key_id:kid,algorithm:'Ed25519',value:sign(null,canonical(unsignedReceipt),privateKey).toString('base64')}};
  const input={providerTrust:{issuer:unsignedReceipt.issuer,key_id:kid,public_key:publicKey.export({type:'spki',format:'pem'}).toString()},receipt,requestRaw,responseRaw,packageRaw,expectedScope:{tenant_id:unsignedReceipt.tenant_id,entity_id:unsignedReceipt.entity_id,company_code:'WBPA',company_mapping_hash:mappingHash},expectedCurrency:'USD',now:Date.parse('2026-08-15T00:02:00Z')};
  return {input,sourceRows};
}

test('verifies actual insurance_data source keys and retains an exact whole-month 12-month candidate with no accounting action',()=>{
  const {input}=fixture(),verified=verifyWbsProviderFinal1InsuranceDelivery(input),plan=normalizeVerifiedWbsProviderFinal1Insurance({verified,expectedCurrency:'USD'}),row=plan.evidence_rows[0];
  assert.equal(verified.signature_verified,true);assert.equal(verified.raw_contains_credentials,false);
  assert.equal(row.source_module,'payable');assert.equal(row.source_domain,'insurance');
  assert.deepEqual(row.source_surface,{database:'wb_insurance',table:'insurance_data',stable_keys:['id','policy_id']});
  assert.equal(row.source_primary_key,'1');assert.equal(row.source_record_id,'POL-1');assert.equal(row.normalized.finalPremium,'1200.00');
  assert.equal(row.outcome,'AMORTIZATION_COVERAGE_EVIDENCE_CANDIDATE');assert.equal(plan.candidate_rows.length,1);assert.equal(plan.exception_rows.length,0);
  for(const key of ['can_propose_amortization','can_create_draft','can_review','can_approve','can_post'])assert.equal(row[key],false);
});

test('retains missing, invalid, nonpositive, and approximate coverage as exceptions rather than AI proposals',()=>{
  const rows=[
    {id:1,policy_id:'POL-MISSING',company_code:'WBPA',pc_code:'PC-1',final_premium:'100.00',start_date:null,expire_date:null,deleted:0},
    {id:2,policy_id:'POL-INVALID',company_code:'WBPA',pc_code:'PC-1',final_premium:'100.00',start_date:'2026-12-31',expire_date:'2026-01-01',deleted:0},
    {id:3,policy_id:'POL-ZERO',company_code:'WBPA',pc_code:'PC-1',final_premium:'0.00',start_date:'2026-01-01',expire_date:'2026-12-31',deleted:0},
    {id:4,policy_id:'POL-APPROX',company_code:'WBPA',pc_code:null,final_premium:'100.00',start_date:'2026-01-15',expire_date:'2027-01-14',deleted:0}
  ];
  const {input}=fixture({rows}),verified=verifyWbsProviderFinal1InsuranceDelivery(input),plan=normalizeVerifiedWbsProviderFinal1Insurance({verified});
  assert.equal(plan.candidate_rows.length,0);assert.equal(plan.exception_rows.length,4);
  assert.deepEqual(plan.exception_rows.map(row=>row.exception_codes),[
    ['INSURANCE_COVERAGE_DATE_MISSING'],
    ['INSURANCE_COVERAGE_DATE_INVALID'],
    ['INSURANCE_PREMIUM_NONPOSITIVE'],
    ['INSURANCE_ENTITY_MAPPING_REQUIRED','INSURANCE_COVERAGE_NORMALIZATION_REQUIRED']
  ]);
  assert.equal(plan.can_propose_amortization,false);assert.equal(plan.can_create_draft,false);assert.equal(plan.can_post,false);
});

test('fails closed for credentialed raw artifacts, unredacted columns, tamper, wrong mapping or non-USD scope',()=>{
  const credentialed=fixture({credentials:true}),verified=verifyWbsProviderFinal1InsuranceDelivery(credentialed.input);
  assert.deepEqual(verified.admission_blockers,['RAW_ARTIFACT_CREDENTIAL_REDACTION_REQUIRED']);
  assert.throws(()=>normalizeVerifiedWbsProviderFinal1Insurance({verified}),error=>error.code==='WBS_FINAL1_INSURANCE_NORMALIZATION_BLOCKED');

  const unredacted=fixture({rows:[{id:1,policy_id:'POL-PII',company_code:'WBPA',pc_code:'PC-1',final_premium:'100.00',start_date:'2026-01-01',expire_date:'2026-12-31',deleted:0,owner:'must not cross boundary'}]});
  assert.throws(()=>verifyWbsProviderFinal1InsuranceDelivery(unredacted.input),error=>error.code==='WBS_FINAL1_INSURANCE_ROW_INVALID');
  const nested=fixture({rows:[{id:1,policy_id:'POL-NESTED',company_code:'WBPA',pc_code:'PC-1',carrier:{access_token:'must not cross boundary'},final_premium:'100.00',start_date:'2026-01-01',expire_date:'2026-12-31',deleted:0}]});
  assert.throws(()=>verifyWbsProviderFinal1InsuranceDelivery(nested.input),error=>error.code==='WBS_FINAL1_INSURANCE_ROW_INVALID');
  const tampered=fixture();tampered.input.packageRaw=Buffer.from(tampered.input.packageRaw);tampered.input.packageRaw[5]^=1;
  assert.throws(()=>verifyWbsProviderFinal1InsuranceDelivery(tampered.input),error=>error.code==='WBS_SIGNED_DELIVERY_RAW_HASH_MISMATCH');
  const wrongMapping=fixture();wrongMapping.input.expectedScope.company_mapping_hash=`sha256:${'b'.repeat(64)}`;
  assert.throws(()=>verifyWbsProviderFinal1InsuranceDelivery(wrongMapping.input),error=>error.code==='WBS_FINAL1_INSURANCE_PACKAGE_INVALID');
  const wrongCurrency=fixture();wrongCurrency.input.expectedCurrency='CAD';
  assert.throws(()=>verifyWbsProviderFinal1InsuranceDelivery(wrongCurrency.input),error=>error.code==='WBS_FINAL1_INSURANCE_SCOPE_INVALID');
});
