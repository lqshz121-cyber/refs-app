import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalRequestBody} from '../runtime/request-hash.mjs';
import {admitWbsProviderFinal1PayableDelivery} from '../runtime/wbs-provider-signed-admission-client.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',companyCode='WBPA',snapshotId='33333333-3333-4333-8333-333333333333';
const sha=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const canonical=value=>Buffer.from(canonicalRequestBody(value),'utf8');

function fixture(){
  const {publicKey,privateKey}=generateKeyPairSync('ed25519'),keyId='provider-key-1',issuer='wbs-provider',requestRaw=Buffer.from('{"request":"redacted"}'),responseRaw=Buffer.from('{"response":"redacted"}'),row={ap_guid:'44444444-4444-4444-8444-444444444444',company_code:companyCode,currency:'USD',amount:'100.0000',invoice_no:'INV-1',invoice_date:'2026-01-15',business_id:'B-1',service_period_start:null,service_period_end:null,recurring_obligation_id:null,contract_id:null,charge_code:null,service_frequency:null,obligation_status:null};
  const controls={row_count:1,currency_totals:[{currency:'USD',row_count:1,amount_total:'100.0000'}]};
  const view={rows:[row],row_count:1,content_hash:sha(canonical([row])),scope:{company_codes:[companyCode],date_range:['2026-01-01','2026-06-30']},control_totals:controls,control_totals_hash:sha(canonical(controls))};
  const unsigned={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:snapshotId,captured_at:'2026-08-23T12:00:00.000Z',environment:'PRODUCTION',source_system:'WBS',domain:'PAYABLES',company_key:companyCode,date_from:'2026-01-01',date_to:'2026-06-30',views:{list_payables:view}},packageHash=sha(canonical(unsigned));
  const packageWithoutSignature={...unsigned,package_hash:packageHash},packageRaw=canonical({...packageWithoutSignature,detached_signature:{key_id:keyId,algorithm:'Ed25519',value:sign(null,canonical(unsigned),privateKey).toString('base64')}});
  const receiptBase={issuer,kid:keyId,algorithm:'Ed25519',request_sha256:sha(requestRaw),response_sha256:sha(responseRaw),package_hash:sha(packageRaw),nonce:'nonce-final1-001',signed_at:'2026-08-23T12:00:00.000Z',expires_at:'2026-08-23T12:15:00.000Z',tenant_id:tenantId,entity_id:entityId,company_code:companyCode,immutable_version:snapshotId,nonempty:true};
  const receipt={...receiptBase,detached_signature:{key_id:keyId,algorithm:'Ed25519',value:sign(null,canonical(receiptBase),privateKey).toString('base64')}};
  const providerTrust={issuer,key_id:keyId,public_key:publicKey.export({type:'spki',format:'pem'}),fingerprint_sha256:createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex')};
  return {providerTrust,receipt,requestRaw,responseRaw,packageRaw};
}

test('Final-1 client verifies both signatures before one exact no-action admission request',async()=>{
  const signed=fixture(),calls=[];
  const fetchImpl=async(url,request)=>{calls.push({url,request});return new Response(JSON.stringify({ok:true,data:{status:'WBS_FINAL1_RETAINED_SOURCE_EVIDENCE',signature_verified:true,domain:'PAYABLES',admission_id:'55555555-5555-4555-8555-555555555555',snapshot_id:snapshotId,company_code:companyCode,row_count:1,idempotent:false,can_write_wbs:false,can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false}}),{status:201,headers:{'content-type':'application/json'}});};
  const result=await admitWbsProviderFinal1PayableDelivery({...signed,apiBaseUrl:'https://api.example',admissionAccessToken:'opaque-provider-token',tenantId,entityId,companyCode,expectedCurrency:'USD',fetchImpl,now:Date.parse('2026-08-23T12:01:00.000Z')});
  assert.equal(calls.length,1);assert.equal(calls[0].url,`https://api.example/api/v1/entities/${entityId}/wbs/provider-signed/final1/payables/admissions`);assert.equal(calls[0].request.headers.authorization,'Bearer opaque-provider-token');assert.equal(result.status,'ADMITTED_PROVIDER_FINAL1_PAYABLE_EVIDENCE');assert.equal(result.can_create_draft,false);assert.equal(result.can_post,false);assert.equal(JSON.stringify(result).includes('opaque-provider-token'),false);
  assert.deepEqual(Object.keys(JSON.parse(calls[0].request.body)).sort(),['packageRawBase64','receipt','requestRawBase64','responseRawBase64']);
});

test('tampered package makes zero network calls',async()=>{
  const signed=fixture(),calls=[];signed.packageRaw=Buffer.concat([signed.packageRaw,Buffer.from(' ')]);
  await assert.rejects(()=>admitWbsProviderFinal1PayableDelivery({...signed,apiBaseUrl:'https://api.example',admissionAccessToken:'opaque-provider-token',tenantId,entityId,companyCode,fetchImpl:async()=>{calls.push(true);},now:Date.parse('2026-08-23T12:01:00.000Z')}),error=>error.code==='WBS_SIGNED_DELIVERY_RAW_HASH_MISMATCH');
  assert.equal(calls.length,0);
});
