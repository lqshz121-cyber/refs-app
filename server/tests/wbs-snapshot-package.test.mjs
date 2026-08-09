import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {validateWbsSnapshotPackage,WbsSnapshotError} from '../runtime/wbs-snapshot-package.mjs';

const guid='11111111-1111-4111-8111-111111111111';
const make=()=>{const value={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:'22222222-2222-4222-8222-222222222222',captured_at:'2026-08-03T10:00:00.000Z',environment:'SANDBOX',source_system:'WBS',dictionary_version:'WBS-DICT-2026-08-03',views:[{name:'BGDATA.payable',company_key:'COMPANY-A',rows:[{apGuId:guid,ap_type:'AUTOC',ap_long_id:'PD-1'}]},{name:'BGDATA.bank_transaction',company_key:'COMPANY-A',rows:[{bankTransactionId:'BANK-TX-20260803-1',bank_account_ref:'EWB-001',amount:'10.0000'}]},{name:'BGDATA.autoc_detail',company_key:'COMPANY-A',rows:[{pdGuId:'33333333-3333-4333-8333-333333333333',pd_status:'I'}]},{name:'BGDATA.autoc_bank',company_key:'COMPANY-A',rows:[{pbGuId:'44444444-4444-4444-8444-444444444444',bank_account_ref:'EWB-001'}]},{name:'accounting.accounting_info',company_key:'COMPANY-A',rows:[{accountingInfoId:'AI-1',ledger_ref:'PRIMARY',come_from:'AUTOC'}]}]};value.views=value.views.map(view=>({...view,content_hash:canonicalRequestHash(view.rows)}));return {...value,package_hash:canonicalRequestHash(value)};};
const productionViews=views=>views.map(view=>{const id=({ 'BGDATA.payable':'apGuId','BGDATA.bank_transaction':'bankTransactionId','BGDATA.autoc_detail':'pdGuId','BGDATA.autoc_bank':'pbGuId','accounting.accounting_info':'accountingInfoId'})[view.name];return {...view,row_count:view.rows.length,first_primary_key:view.rows[0][id],last_primary_key:view.rows.at(-1)[id]};});

test('snapshot package produces immutable WBS receipt plans without creating accounting events',()=>{
  const result=validateWbsSnapshotPackage(make());assert.equal(result.receipt_count,5);assert.equal(result.receipts[0].source_record_id,guid);assert.match(result.receipts[0].source_version,/^snapshot:22222222-/);assert.equal(result.receipts.find(x=>x.source_module==='accounting.accounting_info').ingestion_kind,'LEDGER_EVIDENCE');
});

test('snapshot package rejects tampering, display identifiers and unscoped bank or ledger evidence',()=>{
  const scenarios=[
    value=>{value.views[0].rows[0].ap_type='MUTATED';},
    value=>{value.views[0].rows[0].apGuId='BILL-001';},
    value=>{delete value.views[1].rows[0].bank_account_ref;},
    value=>{delete value.views[4].rows[0].ledger_ref;}
    ,value=>{value.views[4].company_key='COMPANY-B';}
  ];
  for(const mutate of scenarios){const value=make();mutate(value);assert.throws(()=>validateWbsSnapshotPackage(value),error=>error instanceof WbsSnapshotError&&/WBS_SNAPSHOT_(HASH_MISMATCH|VIEW_INVALID|ROW_INVALID)/.test(error.code));}
});

test('production snapshot packages require a detached Ed25519 signature outside the package hash',()=>{
  const legacy={...make(),environment:'PRODUCTION'};delete legacy.package_hash;legacy.package_hash=canonicalRequestHash(legacy);
  assert.throws(()=>validateWbsSnapshotPackage(legacy),error=>error instanceof WbsSnapshotError&&error.code==='WBS_SNAPSHOT_DELIVERY_INVALID');
  const unsigned={...make(),schema_version:'WBS_READONLY_SNAPSHOT_V2',environment:'PRODUCTION',views:productionViews(make().views),delivery:{mode:'READONLY_VIEW_EXPORT',extract_started_at:'2026-08-03T09:55:00.000Z',extract_completed_at:'2026-08-03T10:00:00.000Z',consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'}};delete unsigned.package_hash;unsigned.package_hash=canonicalRequestHash(unsigned);
  assert.throws(()=>validateWbsSnapshotPackage(unsigned),error=>error instanceof WbsSnapshotError&&error.code==='WBS_SNAPSHOT_SIGNATURE_REQUIRED');
  const signed={...unsigned,detached_signature:{key_id:'wbs-prod-2026-08',algorithm:'Ed25519',value:'base64-signature-placeholder'}};
  const unsignedManifest={...signed};delete unsignedManifest.package_hash;delete unsignedManifest.detached_signature;signed.package_hash=canonicalRequestHash(unsignedManifest);
  assert.equal(validateWbsSnapshotPackage(signed).environment,'PRODUCTION');
});

test('V2 delivery receipts fail closed unless a complete primary-key extract is declared',()=>{
  const incomplete={...make(),schema_version:'WBS_READONLY_SNAPSHOT_V2',delivery:{mode:'READONLY_VIEW_EXPORT',extract_started_at:'2026-08-03T10:01:00.000Z',extract_completed_at:'2026-08-03T10:00:00.000Z',consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'}};delete incomplete.package_hash;incomplete.package_hash=canonicalRequestHash(incomplete);
  assert.throws(()=>validateWbsSnapshotPackage(incomplete),error=>error instanceof WbsSnapshotError&&error.code==='WBS_SNAPSHOT_DELIVERY_INVALID');
  const stale={...make(),schema_version:'WBS_READONLY_SNAPSHOT_V2',delivery:{mode:'READONLY_VIEW_EXPORT',extract_started_at:'2026-08-03T10:01:00.000Z',extract_completed_at:'2026-08-03T10:02:00.000Z',consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'}};delete stale.package_hash;stale.package_hash=canonicalRequestHash(stale);
  assert.throws(()=>validateWbsSnapshotPackage(stale),error=>error instanceof WbsSnapshotError&&error.code==='WBS_SNAPSHOT_DELIVERY_INVALID');
  const missingViewReceipt={...make(),schema_version:'WBS_READONLY_SNAPSHOT_V2',views:productionViews(make().views),delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',extract_started_at:'2026-08-03T09:59:00.000Z',extract_completed_at:'2026-08-03T10:00:00.000Z',consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'}};delete missingViewReceipt.views[0].row_count;delete missingViewReceipt.package_hash;missingViewReceipt.package_hash=canonicalRequestHash(missingViewReceipt);
  assert.throws(()=>validateWbsSnapshotPackage(missingViewReceipt),error=>error instanceof WbsSnapshotError&&error.code==='WBS_SNAPSHOT_DELIVERY_INVALID');
  const inconsistent={...make(),schema_version:'WBS_READONLY_SNAPSHOT_V2',views:productionViews(make().views),delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',extract_started_at:'2026-08-03T09:59:00.000Z',extract_completed_at:'2026-08-03T10:00:00.000Z',consistency:'COMPLETE',read_consistency:'READ_COMMITTED',pagination:'PRIMARY_KEY_SEEK'}};delete inconsistent.package_hash;inconsistent.package_hash=canonicalRequestHash(inconsistent);
  assert.throws(()=>validateWbsSnapshotPackage(inconsistent),error=>error instanceof WbsSnapshotError&&error.code==='WBS_SNAPSHOT_DELIVERY_INVALID');
});

test('a complete production delivery can attest an explicitly empty scoped view',()=>{
  const views=productionViews(make().views);views[1]={...views[1],rows:[],content_hash:canonicalRequestHash([]),row_count:0,first_primary_key:null,last_primary_key:null};
  const value={...make(),schema_version:'WBS_READONLY_SNAPSHOT_V2',environment:'PRODUCTION',views,delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',extract_started_at:'2026-08-03T09:59:00.000Z',extract_completed_at:'2026-08-03T10:00:00.000Z',consistency:'COMPLETE',read_consistency:'REPEATABLE_READ_TRANSACTION',pagination:'PRIMARY_KEY_SEEK'},detached_signature:{key_id:'wbs-prod-test',algorithm:'Ed25519',value:'base64-signature-placeholder'}};delete value.package_hash;const {detached_signature,...manifest}=value;value.package_hash=canonicalRequestHash(manifest);
  const validated=validateWbsSnapshotPackage(value);
  assert.equal(validated.receipt_count,4);
  assert.deepEqual(validated.delivery_attestation.views.find(view=>view.name==='BGDATA.bank_transaction'),{name:'BGDATA.bank_transaction',company_key:'COMPANY-A',row_count:0,first_primary_key:null,last_primary_key:null,content_hash:canonicalRequestHash([])});
});
