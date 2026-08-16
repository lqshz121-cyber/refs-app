import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {canonicalWbsLiveReceiptSigningPayload} from '../runtime/wbs-live-receipt-signing.mjs';
import {verifyStage1PayableLiveAcceptance} from '../tools/verify-stage1-payable-live-acceptance.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {validateWbsSnapshotPackage} from '../runtime/wbs-snapshot-package.mjs';

const digest=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const now=Date.parse('2026-08-13T12:00:00.000Z');
function fixture(){
  const pair=generateKeyPairSync('ed25519'),snapshotId=randomUUID(),capturedAt='2026-08-13T11:58:30.000Z',payableRow={apGuId:randomUUID(),currency:'USD',amount:'89.1250'},view={name:'BGDATA.payable',company_key:'COMPANY-A',rows:[payableRow]};
  Object.assign(view,{content_hash:canonicalRequestHash(view.rows),row_count:1,first_primary_key:payableRow.apGuId,last_primary_key:payableRow.apGuId});
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:snapshotId,captured_at:capturedAt,environment:'PRODUCTION',source_system:'WBS',dictionary_version:'WBS-DICT-2026-08-13',views:[view],delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',snapshot_token:'stage1-payable-live',extract_started_at:'2026-08-13T11:58:00.000Z',extract_completed_at:capturedAt,consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'},detached_signature:{key_id:'wbs-prod-2026-08',algorithm:'Ed25519',value:'provider-package-signature'}};
  const {detached_signature,...manifest}=snapshot;snapshot.package_hash=canonicalRequestHash(manifest);
  const raw={request:Buffer.from('request'),response:Buffer.from('response'),package:Buffer.from(JSON.stringify(snapshot))},scope={tenant_id:randomUUID(),entity_id:randomUUID(),company_code:'COMPANY-A'},receipt={...scope,package_hash:digest(raw.package),issuer:'wanbridge-wbs',kid:'wbs-prod-2026-08',algorithm:'Ed25519',request_sha256:digest(raw.request),response_sha256:digest(raw.response),nonce:'payable-live-001',signed_at:'2026-08-13T11:59:00.000Z',expires_at:'2026-08-13T12:14:00.000Z',immutable_version:snapshotId,nonempty:true};
  receipt.detached_signature={key_id:receipt.kid,algorithm:'Ed25519',value:sign(null,Buffer.from(canonicalWbsLiveReceiptSigningPayload(receipt),'utf8'),pair.privateKey).toString('base64')};
  const signedPayable=validateWbsSnapshotPackage(snapshot).receipts[0],row=randomUUID(),attachment=randomUUID(),review=randomUUID(),journal=randomUUID(),source=randomUUID(),hash=digest('evidence');
  const chain={scope:{...scope,package_hash:receipt.package_hash},payable:{wbs_inbound_row_id:row,source_record_id:signedPayable.source_record_id,source_version:signedPayable.source_version,receipt_hash:signedPayable.payload_hash,evidence_hash:hash},attachment:{attachment_id:attachment,wbs_inbound_row_id:row,source_version:signedPayable.source_version,receipt_hash:signedPayable.payload_hash,status:'VERIFIED_CLEAN',object_version:'v1',content_hash:digest('attachment')},review:{review_evidence_id:review,wbs_inbound_row_id:row,expected_evidence_hash:hash,attachment_id:attachment,status:'READY_FOR_DRAFT',reviewer_actor_id:'payable-reviewer'},draft:{wbs_inbound_row_id:row,review_evidence_id:review,attachment_id:attachment,status:'DRAFT',journal_entry_id:journal,maker_actor_id:'payable-maker',source_document_id:source,gross_amount:'89.1250',currency:'USD'},workflow:[{journal_entry_id:journal,action:'SUBMIT',status:'PENDING_REVIEW',submitter_actor_id:'journal-submitter'},{journal_entry_id:journal,action:'REVIEW',status:'PENDING_APPROVAL',journal_reviewer_actor_id:'journal-reviewer'},{journal_entry_id:journal,action:'APPROVE',status:'APPROVED',approver_actor_id:'journal-approver'},{journal_entry_id:journal,action:'POST',status:'POSTED',poster_actor_id:'journal-poster'}],posted:{journal_entry_id:journal,status:'POSTED',source_document_id:source},gl:{journal_entry_id:journal,source_document_id:source,debit_amount:'89.1250',credit_amount:'0.0000'},trial_balance:[{account_code:'610000',period_debit:'89.1250',period_credit:'0.0000'},{account_code:'291001',period_debit:'0.0000',period_credit:'89.1250'}],ap_aging:{currency:'USD',total_open_balance:'89.1250'}};
  const providerReceiptHash=canonicalRequestHash(signedPayable);
  chain.payable.provider_receipt_hash=providerReceiptHash;
  chain.attachment.provider_receipt_hash=providerReceiptHash;
  chain.review.expected_provider_receipt_hash=providerReceiptHash;
  return {providerTrust:{issuer:receipt.issuer,key_id:receipt.kid,public_key:pair.publicKey.export({type:'spki',format:'pem'})},receipt,raw,chain};
}

test('validates one real-shaped signed Payable chain through attachment, four-role post, GL, TB and AP Aging',()=>{
  const result=verifyStage1PayableLiveAcceptance({...fixture(),now});
  assert.equal(result.status,'STAGE1_PAYABLE_LIVE_ACCEPTANCE_VERIFIED');assert.equal(result.amount,'89.1250');
});

test('rejects a reused actor, attachment/source mismatch, and AP Aging mismatch',()=>{
  const sod=fixture();sod.chain.workflow[3].poster_actor_id='payable-maker';assert.throws(()=>verifyStage1PayableLiveAcceptance({...sod,now}),error=>error.code==='STAGE1_PAYABLE_SOD_INVALID');
  const attachment=fixture();attachment.chain.attachment.receipt_hash=digest('other');assert.throws(()=>verifyStage1PayableLiveAcceptance({...attachment,now}),error=>error.code==='STAGE1_PAYABLE_ATTACHMENT_INVALID');
  const providerReceipt=fixture();providerReceipt.chain.review.expected_provider_receipt_hash=digest('other');assert.throws(()=>verifyStage1PayableLiveAcceptance({...providerReceipt,now}),error=>error.code==='STAGE1_PAYABLE_REVIEW_INVALID');
  const aging=fixture();aging.chain.ap_aging.total_open_balance='89.1251';assert.throws(()=>verifyStage1PayableLiveAcceptance({...aging,now}),error=>error.code==='STAGE1_PAYABLE_AGING_INVALID');
});

test('rejects a payable source that is not the exact signed package receipt',()=>{
  const input=fixture();input.chain.payable.source_record_id=randomUUID();
  assert.throws(()=>verifyStage1PayableLiveAcceptance({...input,now}),error=>error.code==='STAGE1_PAYABLE_SOURCE_INVALID');
});
