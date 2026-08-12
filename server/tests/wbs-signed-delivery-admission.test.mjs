import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {canonicalRequestBody,canonicalRequestHash} from '../runtime/request-hash.mjs';
import {canonicalWbsLiveReceiptSigningPayload} from '../runtime/wbs-live-receipt-signing.mjs';
import {captureWbsSignedDelivery,createWbsSignedDelivery,verifyWbsSignedDelivery,WbsSignedDeliveryAdmissionError} from '../runtime/wbs-signed-delivery-admission.mjs';

const NOW=Date.parse('2026-08-12T08:05:00.000Z');
const rawHash=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const fixture=async()=>{
  const pair=generateKeyPairSync('ed25519'),scope={tenant_id:randomUUID(),entity_id:randomUUID(),company_code:'COMPANY-A'},snapshotId=randomUUID(),recordId=randomUUID();
  const rows=[{apGuId:recordId,companyCode:'COMPANY-A',amount:'25.0000'}];
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:snapshotId,captured_at:'2026-08-12T08:00:00.000Z',environment:'PRODUCTION',source_system:'WBS',dictionary_version:'WBS-2026-08',delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',extract_started_at:'2026-08-12T08:00:00.000Z',extract_completed_at:'2026-08-12T08:00:00.000Z',consistency:'COMPLETE',read_consistency:'REPEATABLE_READ_TRANSACTION',pagination:'PRIMARY_KEY_SEEK'},views:[{name:'BGDATA.payable',company_key:'COMPANY-A',rows,content_hash:canonicalRequestHash(rows),row_count:1,first_primary_key:recordId,last_primary_key:recordId}]};
  const requestRaw=Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/call"}','utf8'),responseRaw=Buffer.from('{"jsonrpc":"2.0","id":1,"result":{"captured":true}}','utf8');
  const created=await createWbsSignedDelivery({unsignedSnapshot:snapshot,requestRaw,responseRaw,scope,issuer:'wanbridge-wbs',keyId:'wbs-prod-2026-08',nonce:'delivery-nonce-0001',signedAt:'2026-08-12T08:05:00.000Z',expiresAt:'2026-08-12T08:20:00.000Z',privateKeyPem:pair.privateKey.export({type:'pkcs8',format:'pem'}),now:NOW});
  return {pair,scope,requestRaw,responseRaw,...created};
};
const rejected=(code)=>error=>error instanceof WbsSignedDeliveryAdmissionError&&error.code===code;

test('provider creates one deterministic dual-signed package that verifies against separately pinned trust and exact raw bytes',async()=>{
  const input=await fixture();
  const verified=await verifyWbsSignedDelivery({providerTrust:input.providerTrust,receipt:input.receipt,requestRaw:input.requestRaw,responseRaw:input.responseRaw,packageRaw:input.packageRaw,expectedScope:input.scope,now:NOW});
  assert.equal(verified.status,'VERIFIED_NOT_ADMITTED');assert.equal(verified.signature_verified,true);assert.equal(verified.snapshot_id,input.package.snapshot_id);
  for(const field of ['can_import','can_create_transaction','can_allocate','can_create_draft','can_approve','can_post'])assert.equal(verified[field],false);
});

test('capture is write-once by provider nonce and prepares only the existing authoritative snapshot endpoint request',async()=>{
  const input=await fixture(),root=mkdtempSync(join(tmpdir(),'refs-wbs-signed-'));
  try{
    const args={providerTrust:input.providerTrust,receipt:input.receipt,requestRaw:input.requestRaw,responseRaw:input.responseRaw,packageRaw:input.packageRaw,expectedScope:input.scope,now:NOW,captureDirectory:root};
    const captured=await captureWbsSignedDelivery(args);
    assert.equal(captured.status,'VERIFIED_CAPTURED_PENDING_AUTHORITATIVE_API');assert.equal(captured.api.method,'POST');assert.equal(captured.api.path,`/api/v1/entities/${input.scope.entity_id}/wbs/snapshots`);
    const body=JSON.parse(readFileSync(join(captured.directory,'admission-request.json'),'utf8'));assert.deepEqual(body,{snapshot:input.package});
    await assert.rejects(()=>captureWbsSignedDelivery(args),rejected('WBS_SIGNED_DELIVERY_REPLAY'));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('admission rejects expired evidence, independently configured scope mismatch, and any raw-byte substitution',async()=>{
  const input=await fixture(),base={providerTrust:input.providerTrust,receipt:input.receipt,requestRaw:input.requestRaw,responseRaw:input.responseRaw,packageRaw:input.packageRaw,expectedScope:input.scope,now:NOW};
  await assert.rejects(()=>verifyWbsSignedDelivery({...base,now:Date.parse('2026-08-12T08:21:00.000Z')}),rejected('WBS_SIGNED_DELIVERY_RECEIPT_EXPIRED'));
  await assert.rejects(()=>verifyWbsSignedDelivery({...base,expectedScope:{...input.scope,entity_id:randomUUID()}}),rejected('WBS_SIGNED_DELIVERY_SCOPE_MISMATCH'));
  await assert.rejects(()=>verifyWbsSignedDelivery({...base,responseRaw:Buffer.from('substituted')}),rejected('WBS_SIGNED_DELIVERY_RAW_HASH_MISMATCH'));
});

test('a receipt correctly re-signed over a modified package still fails the independent snapshot-package signature',async()=>{
  const input=await fixture(),changed=structuredClone(input.package);
  changed.detached_signature.value=Buffer.alloc(64,1).toString('base64');
  const packageRaw=Buffer.from(canonicalRequestBody(changed),'utf8'),receipt={...input.receipt,package_hash:rawHash(packageRaw),detached_signature:{...input.receipt.detached_signature}};
  receipt.detached_signature.value=sign(null,Buffer.from(canonicalWbsLiveReceiptSigningPayload(receipt),'utf8'),input.pair.privateKey).toString('base64');
  await assert.rejects(()=>verifyWbsSignedDelivery({providerTrust:input.providerTrust,receipt,requestRaw:input.requestRaw,responseRaw:input.responseRaw,packageRaw,expectedScope:input.scope,now:NOW}),rejected('WBS_SIGNED_DELIVERY_PACKAGE_SIGNATURE_INVALID'));
});

test('plain delivery documents, unsigned packages, and self-supplied non-Ed25519 trust cannot satisfy admission',async()=>{
  const input=await fixture();
  await assert.rejects(()=>createWbsSignedDelivery({unsignedSnapshot:input.package,requestRaw:input.requestRaw,responseRaw:input.responseRaw,scope:input.scope,issuer:'wanbridge-wbs',keyId:'wbs-prod-2026-08',nonce:'delivery-nonce-0002',signedAt:'2026-08-12T08:05:00.000Z',expiresAt:'2026-08-12T08:20:00.000Z',privateKeyPem:'not a provider key',now:NOW}),rejected('WBS_SIGNED_DELIVERY_PRIVATE_KEY_INVALID'));
  await assert.rejects(()=>verifyWbsSignedDelivery({providerTrust:{issuer:'wanbridge-wbs',key_id:'wbs-prod-2026-08',public_key:'not a key'},receipt:input.receipt,requestRaw:input.requestRaw,responseRaw:input.responseRaw,packageRaw:input.packageRaw,expectedScope:input.scope,now:NOW}),rejected('WBS_SIGNED_DELIVERY_PROVIDER_TRUST_INVALID'));
});
