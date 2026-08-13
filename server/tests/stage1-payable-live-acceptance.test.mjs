import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {canonicalWbsLiveReceiptSigningPayload} from '../runtime/wbs-live-receipt-signing.mjs';
import {verifyStage1PayableLiveAcceptance} from '../tools/verify-stage1-payable-live-acceptance.mjs';

const digest=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const now=Date.parse('2026-08-13T12:00:00.000Z');
function fixture(){
  const pair=generateKeyPairSync('ed25519'),scope={tenant_id:randomUUID(),entity_id:randomUUID(),company_code:'COMPANY-A'},raw={request:Buffer.from('request'),response:Buffer.from('response'),package:Buffer.from('package')},receipt={...scope,package_hash:digest(raw.package),issuer:'wanbridge-wbs',kid:'wbs-prod-2026-08',algorithm:'Ed25519',request_sha256:digest(raw.request),response_sha256:digest(raw.response),nonce:'payable-live-001',signed_at:'2026-08-13T11:59:00.000Z',expires_at:'2026-08-13T12:14:00.000Z',immutable_version:randomUUID(),nonempty:true};
  receipt.detached_signature={key_id:receipt.kid,algorithm:'Ed25519',value:sign(null,Buffer.from(canonicalWbsLiveReceiptSigningPayload(receipt),'utf8'),pair.privateKey).toString('base64')};
  const row=randomUUID(),attachment=randomUUID(),review=randomUUID(),journal=randomUUID(),source=randomUUID(),hash=digest('evidence');
  const chain={scope:{...scope,package_hash:receipt.package_hash},payable:{wbs_inbound_row_id:row,source_record_id:'WBS-INV-001',source_version:'snapshot:1',receipt_hash:digest('receipt'),evidence_hash:hash},attachment:{attachment_id:attachment,wbs_inbound_row_id:row,source_version:'snapshot:1',receipt_hash:digest('receipt'),status:'VERIFIED_CLEAN',object_version:'v1',content_hash:digest('attachment')},review:{review_evidence_id:review,wbs_inbound_row_id:row,expected_evidence_hash:hash,attachment_id:attachment,status:'READY_FOR_DRAFT',reviewer_actor_id:'payable-reviewer'},draft:{wbs_inbound_row_id:row,review_evidence_id:review,attachment_id:attachment,status:'DRAFT',journal_entry_id:journal,maker_actor_id:'payable-maker',source_document_id:source,gross_amount:'89.1250',currency:'USD'},workflow:[{journal_entry_id:journal,action:'SUBMIT',status:'PENDING_REVIEW',submitter_actor_id:'journal-submitter'},{journal_entry_id:journal,action:'REVIEW',status:'PENDING_APPROVAL',journal_reviewer_actor_id:'journal-reviewer'},{journal_entry_id:journal,action:'APPROVE',status:'APPROVED',approver_actor_id:'journal-approver'},{journal_entry_id:journal,action:'POST',status:'POSTED',poster_actor_id:'journal-poster'}],posted:{journal_entry_id:journal,status:'POSTED',source_document_id:source},gl:{journal_entry_id:journal,source_document_id:source,debit_amount:'89.1250',credit_amount:'0.0000'},trial_balance:[{account_code:'610000',period_debit:'89.1250',period_credit:'0.0000'},{account_code:'291001',period_debit:'0.0000',period_credit:'89.1250'}],ap_aging:{currency:'USD',total_open_balance:'89.1250'}};
  return {providerTrust:{issuer:receipt.issuer,key_id:receipt.kid,public_key:pair.publicKey.export({type:'spki',format:'pem'})},receipt,raw,chain};
}

test('validates one real-shaped signed Payable chain through attachment, four-role post, GL, TB and AP Aging',()=>{
  const result=verifyStage1PayableLiveAcceptance({...fixture(),now});
  assert.equal(result.status,'STAGE1_PAYABLE_LIVE_ACCEPTANCE_VERIFIED');assert.equal(result.amount,'89.1250');
});

test('rejects a reused actor, attachment/source mismatch, and AP Aging mismatch',()=>{
  const sod=fixture();sod.chain.workflow[3].poster_actor_id='payable-maker';assert.throws(()=>verifyStage1PayableLiveAcceptance({...sod,now}),error=>error.code==='STAGE1_PAYABLE_SOD_INVALID');
  const attachment=fixture();attachment.chain.attachment.receipt_hash=digest('other');assert.throws(()=>verifyStage1PayableLiveAcceptance({...attachment,now}),error=>error.code==='STAGE1_PAYABLE_ATTACHMENT_INVALID');
  const aging=fixture();aging.chain.ap_aging.total_open_balance='89.1251';assert.throws(()=>verifyStage1PayableLiveAcceptance({...aging,now}),error=>error.code==='STAGE1_PAYABLE_AGING_INVALID');
});
