import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalRequestBody} from '../runtime/request-hash.mjs';
import {verifyWbsProviderFinal1Delivery} from '../runtime/wbs-provider-final1-delivery.mjs';

const canonical=value=>Buffer.from(canonicalRequestBody(value),'utf8');
const hash=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const without=(value,...keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));

async function fixture({credentials=false,currency='USD'}={}){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'),kid='wbs-final1-test';
  const row={ap_guid:'11111111-1111-4111-8111-111111111111',company_code:'WBPA',amount:'10.000',incurred_date:'2026-01-15T00:00:00',posting_date:'2026-01-15T00:00:00',...(currency?{currency}:{})};
  const view={scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-06-30']},row_count:1,content_hash:hash(canonical([row])).slice(7),rows:[row]};
  const unsigned={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:'22222222-2222-4222-8222-222222222222',captured_at:'2026-08-15T00:00:00Z',environment:'PRODUCTION',source_system:'WBS',domain:'PAYABLES',company_key:'WBPA',date_from:'2026-01-01',date_to:'2026-06-30',views:{list_payables:view}};
  const packageHash=hash(canonical(unsigned)).slice(7);
  const pkg={...unsigned,package_hash:packageHash,detached_signature:{key_id:kid,algorithm:'Ed25519',value:sign(null,canonical(unsigned),privateKey).toString('base64')}};
  const packageRaw=canonical(pkg),requestRaw=Buffer.from(credentials?'POST /mcp HTTP/1.1\r\nX-REFS-Auth: secret\r\n\r\n{}':'POST /mcp HTTP/1.1\r\nX-Request-Id: safe\r\n\r\n{}'),responseRaw=Buffer.from('HTTP/1.1 200 OK\r\n\r\n{}');
  const unsignedReceipt={issuer:'refs-mcp.wbm3.com',kid,algorithm:'Ed25519',request_sha256:hash(requestRaw),response_sha256:hash(responseRaw),package_hash:hash(packageRaw),nonce:'final1-nonce',signed_at:'2026-08-15T00:01:00Z',expires_at:'2026-08-15T00:16:00Z',tenant_id:'33333333-3333-4333-8333-333333333333',entity_id:'44444444-4444-4444-8444-444444444444',company_code:'WBPA',immutable_version:pkg.snapshot_id,nonempty:true};
  const receipt={...unsignedReceipt,detached_signature:{key_id:kid,algorithm:'Ed25519',value:sign(null,canonical(unsignedReceipt),privateKey).toString('base64')}};
  return {providerTrust:{issuer:unsignedReceipt.issuer,key_id:kid,public_key:publicKey.export({type:'spki',format:'pem'}).toString()},receipt,requestRaw,responseRaw,packageRaw,expectedScope:{tenant_id:unsignedReceipt.tenant_id,entity_id:unsignedReceipt.entity_id,company_code:'WBPA'},now:Date.parse('2026-08-15T00:02:00Z')};
}

test('Final-1 verifies exact dual signatures and reports no accounting blocker when currency and raw artifacts are safe',async()=>{
  const result=verifyWbsProviderFinal1Delivery(await fixture());
  assert.equal(result.signature_verified,true);assert.equal(result.row_count,1);assert.deepEqual(result.admission_blockers,[]);assert.equal(result.can_admit,false);
});

test('Final-1 exposes credential-bearing raw artifacts and unsigned currency as explicit fail-closed blockers',async()=>{
  const result=verifyWbsProviderFinal1Delivery(await fixture({credentials:true,currency:null}));
  assert.deepEqual(result.admission_blockers,['RAW_ARTIFACT_CREDENTIAL_REDACTION_REQUIRED','APPROVED_CURRENCY_REQUIRED_FOR_ACCOUNTING']);
  assert.equal(result.can_create_draft,false);assert.equal(result.can_post,false);
});

test('Final-1 keeps unsigned row currency separate from independently approved USD accounting scope',async()=>{
  const input=await fixture({currency:null}),result=verifyWbsProviderFinal1Delivery({...input,expectedCurrency:'USD'});
  assert.equal(result.currency_signed,false);assert.equal(result.accounting_currency,'USD');
  assert.equal(result.currency_authority,'REFS_BUSINESS_OWNER_CONFIRMED');assert.deepEqual(result.admission_blockers,[]);
});

test('Final-1 rejects changed package bytes before any persistence boundary',async()=>{
  const input=await fixture();input.packageRaw=Buffer.from(input.packageRaw);input.packageRaw[10]^=1;
  assert.throws(()=>verifyWbsProviderFinal1Delivery(input),error=>error.code==='WBS_SIGNED_DELIVERY_RAW_HASH_MISMATCH');
});
