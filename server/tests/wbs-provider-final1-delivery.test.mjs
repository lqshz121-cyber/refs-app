import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalRequestBody} from '../runtime/request-hash.mjs';
import {verifyWbsProviderFinal1Delivery} from '../runtime/wbs-provider-final1-delivery.mjs';

const canonical=value=>Buffer.from(canonicalRequestBody(value),'utf8');
const hash=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const without=(value,...keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const units=value=>{const [whole,fraction='']=String(value).split('.');return BigInt(whole)*10000n+BigInt((fraction+'0000').slice(0,4));};
const controls=rows=>{const total=rows.reduce((sum,row)=>sum+units(String(row.amount).replace(/^-/,'')),0n),control_totals={row_count:rows.length,currency_totals:[{currency:'USD',row_count:rows.length,amount_total:`${total/10000n}.${String(total%10000n).padStart(4,'0')}`}]};return {control_totals,control_totals_hash:hash(canonical(control_totals))};};

async function fixture({credentials=false,requestText=null,currency='USD',receiptExtra={},packageExtra={},rowExtra={},rows=null,controlTotals=null,controlTotalsHash=null}={}){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'),kid='wbs-final1-test';
  const row={ap_guid:'11111111-1111-4111-8111-111111111111',company_code:'WBPA',amount:'10.000',incurred_date:'2026-01-15T00:00:00',posting_date:'2026-01-15T00:00:00',invoice_no:'INV-1',invoice_date:'2026-01-15',business_id:'BUS-1',service_period_start:null,service_period_end:null,recurring_obligation_id:null,contract_id:null,charge_code:null,service_frequency:null,obligation_status:null,...(currency?{currency}:{}),...rowExtra};
  const signedRows=rows??[row],computedControls=controls(signedRows),signedControls={control_totals:controlTotals??computedControls.control_totals,control_totals_hash:controlTotalsHash??hash(canonical(controlTotals??computedControls.control_totals))},view={scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-06-30']},row_count:signedRows.length,...signedControls,content_hash:hash(canonical(signedRows)).slice(7),rows:signedRows};
  const unsigned={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:'22222222-2222-4222-8222-222222222222',captured_at:'2026-08-15T00:00:00Z',environment:'PRODUCTION',source_system:'WBS',domain:'PAYABLES',company_key:'WBPA',date_from:'2026-01-01',date_to:'2026-06-30',views:{list_payables:view},...packageExtra};
  const packageHash=hash(canonical(unsigned)).slice(7);
  const pkg={...unsigned,package_hash:packageHash,detached_signature:{key_id:kid,algorithm:'Ed25519',value:sign(null,canonical(unsigned),privateKey).toString('base64')}};
  const packageRaw=canonical(pkg),requestRaw=Buffer.from(requestText??(credentials?'POST /mcp HTTP/1.1\r\nX-REFS-Auth: secret\r\n\r\n{}':'POST /mcp HTTP/1.1\r\nX-Request-Id: safe\r\n\r\n{}')),responseRaw=Buffer.from('HTTP/1.1 200 OK\r\n\r\n{}');
  const unsignedReceipt={issuer:'refs-mcp.wbm3.com',kid,algorithm:'Ed25519',request_sha256:hash(requestRaw),response_sha256:hash(responseRaw),package_hash:hash(packageRaw),nonce:'final1-nonce',signed_at:'2026-08-15T00:01:00Z',expires_at:'2026-08-15T00:16:00Z',tenant_id:'33333333-3333-4333-8333-333333333333',entity_id:'44444444-4444-4444-8444-444444444444',company_code:'WBPA',immutable_version:pkg.snapshot_id,nonempty:true,...receiptExtra};
  const receipt={...unsignedReceipt,detached_signature:{key_id:kid,algorithm:'Ed25519',value:sign(null,canonical(unsignedReceipt),privateKey).toString('base64')}};
  return {providerTrust:{issuer:unsignedReceipt.issuer,key_id:kid,public_key:publicKey.export({type:'spki',format:'pem'}).toString()},receipt,requestRaw,responseRaw,packageRaw,expectedScope:{tenant_id:unsignedReceipt.tenant_id,entity_id:unsignedReceipt.entity_id,company_code:'WBPA'},now:Date.parse('2026-08-15T00:02:00Z')};
}

test('Final-1 verifies exact dual signatures and reports no accounting blocker when currency and raw artifacts are safe',async()=>{
  const result=verifyWbsProviderFinal1Delivery(await fixture());
  assert.equal(result.signature_verified,true);assert.equal(result.row_count,1);assert.deepEqual(result.admission_blockers,[]);assert.equal(result.can_admit,false);
  assert.deepEqual(result.control_totals,{row_count:1,currency_totals:[{currency:'USD',row_count:1,amount_total:'10.0000'}]});
  assert.equal(result.control_totals_hash,'sha256:faa6c295db3c0d8e097f0f897b7da3102ae098551023cc9e55bba1ebd14011e1');
});

test('Final-1 signed totals use the frozen canonical V1 vector and reject legacy shape or hash drift',async()=>{
  const value={row_count:1,currency_totals:[{currency:'USD',row_count:1,amount_total:'10.0000'}]};
  assert.equal(canonicalRequestBody(value),'{"currency_totals":[{"amount_total":"10.0000","currency":"USD","row_count":1}],"row_count":1}');
  assert.equal(hash(canonical(value)),'sha256:faa6c295db3c0d8e097f0f897b7da3102ae098551023cc9e55bba1ebd14011e1');
  const legacy=await fixture({controlTotals:{row_count:1,per_currency_totals:[{currency:'USD',gross_amount:'10.0000'}]}});
  assert.throws(()=>verifyWbsProviderFinal1Delivery(legacy),error=>error.code==='WBS_FINAL1_VIEW_INVALID');
  const drift=await fixture({controlTotalsHash:'sha256:0aa6c295db3c0d8e097f0f897b7da3102ae098551023cc9e55bba1ebd14011e1'});
  assert.throws(()=>verifyWbsProviderFinal1Delivery(drift),error=>error.code==='WBS_FINAL1_VIEW_INVALID');
});

test('Final-1 credential detector blocks query, header, camelCase JSON, and percent-encoded token names',async()=>{
  for(const requestText of [
    'GET /mcp?access_token=secret HTTP/1.1\r\n\r\n',
    'GET /mcp?safe=1&ACCESS_TOKEN=secret HTTP/1.1\r\n\r\n',
    'GET /mcp?%61ccess%5Ftoken=secret HTTP/1.1\r\n\r\n',
    'GET /mcp?%2561ccess%255Ftoken=secret HTTP/1.1\r\n\r\n',
    'POST /mcp HTTP/1.1\r\nX-Api-Key: secret\r\n\r\n{}',
    'POST /mcp HTTP/1.1\r\nContent-Type: application/json\r\n\r\n{"accessToken":"secret"}'
  ])assert.equal(verifyWbsProviderFinal1Delivery(await fixture({requestText})).raw_contains_credentials,true);
  assert.equal(verifyWbsProviderFinal1Delivery(await fixture({requestText:'GET /mcp?access_tokenized=safe&api_key_name=safe HTTP/1.1\r\nX-Api-Key-Name: safe\r\n\r\n{"accessTokenLabel":"safe"}'})).raw_contains_credentials,false);
  assert.equal(verifyWbsProviderFinal1Delivery(await fixture({receiptExtra:{accessToken:'secret'}})).raw_contains_credentials,true);
  assert.equal(verifyWbsProviderFinal1Delivery(await fixture({packageExtra:{note:'?%2561ccess%255Ftoken=secret'}})).raw_contains_credentials,true);
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

test('Final-1 signed Payables population is hard capped at 500 before any admission boundary',async()=>{
  const one={ap_guid:'11111111-1111-4111-8111-111111111111',company_code:'WBPA',amount:'10.000',incurred_date:'2026-01-15T00:00:00',posting_date:'2026-01-15T00:00:00',invoice_no:'INV-1',invoice_date:'2026-01-15',business_id:'BUS-1',service_period_start:null,service_period_end:null,recurring_obligation_id:null,contract_id:null,charge_code:null,service_frequency:null,obligation_status:null,currency:'USD'};
  const rows=Array.from({length:500},(_,index)=>({...one,ap_guid:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`}));
  assert.equal(verifyWbsProviderFinal1Delivery(await fixture({rows})).row_count,500);
  const oversize=await fixture({rows:[...rows,{...one,ap_guid:'00000000-0000-4000-8000-000000000501'}]});
  assert.throws(()=>verifyWbsProviderFinal1Delivery(oversize),error=>error.code==='WBS_FINAL1_VIEW_INVALID');
});

test('Final-1 accepts only complete closed typed invoice or tax-statement evidence',async()=>{
  const invoice={document_evidence_schema_version:'WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_V1',document_kind:'INVOICE',taxing_jurisdiction:null,tax_statement_identifier:null,tax_coverage_period_start:null,tax_coverage_period_end:null,tax_obligation_basis:null,controlled_property_ref:null,parcel_identifier:null};
  assert.equal(verifyWbsProviderFinal1Delivery(await fixture({rowExtra:invoice})).row_count,1);
  const tax={...invoice,document_kind:'TAX_STATEMENT',taxing_jurisdiction:'Cook County',tax_statement_identifier:'PIN-2026-42',tax_coverage_period_start:'2026-01-01',tax_coverage_period_end:'2026-12-31',tax_obligation_basis:'ASSESSED_VALUE',controlled_property_ref:'PROPERTY-1',parcel_identifier:'17-09-123-045'};
  assert.equal(verifyWbsProviderFinal1Delivery(await fixture({rowExtra:tax})).row_count,1);
  for(const bad of [{...invoice,taxing_jurisdiction:'Cook County'},{...tax,document_kind:'UNKNOWN'},{...tax,tax_coverage_period_start:'2026-02-30'},{...tax,tax_obligation_basis:'VENDOR_DESCRIPTION'}]){
    const input=await fixture({rowExtra:bad});assert.throws(()=>verifyWbsProviderFinal1Delivery(input),error=>['WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_INVALID','WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_CONTRADICTORY'].includes(error.code));
  }
});
