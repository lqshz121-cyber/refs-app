import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {verifyWbsLiveAcceptance} from '../tools/verify-wbs-live-acceptance.mjs';
import {canonicalWbsLiveReceiptSigningPayload} from '../runtime/wbs-live-receipt-signing.mjs';

const hash=letter=>`sha256:${letter.repeat(64)}`;
const rawHash=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
function evidence(){
  const pair=generateKeyPairSync('ed25519'),raw={request:Buffer.from('{"request":"canonical"}'),response:Buffer.from('{"response":"canonical"}'),package:Buffer.from('{"package":"canonical"}')},packageHash=rawHash(raw.package),scope={tenant_id:'tenant-1',entity_id:'entity-1',company_code:'COMPANY-A',package_hash:packageHash};
  const receipt={...scope,issuer:'wbs',kid:'wbs-2026',algorithm:'Ed25519',response_sha256:rawHash(raw.response),request_sha256:rawHash(raw.request),nonce:'nonce-1',signed_at:'2026-08-11T00:00:00.000Z',expires_at:'2026-08-12T00:00:00.000Z',immutable_version:'1',nonempty:true};
  receipt.detached_signature={key_id:'wbs-2026',algorithm:'Ed25519',value:sign(null,Buffer.from(canonicalWbsLiveReceiptSigningPayload(receipt),'utf8'),pair.privateKey).toString('base64')};
  const trace={company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',bank_business_date:'2026-08-10',bank_accounting_date:'2026-08-10',business_business_date:'2026-08-10',business_accounting_date:'2026-08-10',bank_receipt_id:'receipt-bank',bank_receipt_ref:'ref-bank',bank_receipt_hash:hash('d'),business_receipt_id:'receipt-pay',business_receipt_ref:'ref-pay',business_receipt_hash:hash('e'),bank_raw_event_id:'raw-bank',business_raw_event_id:'raw-pay',bank_source_document_id:'doc-bank',business_source_document_id:'doc-pay',bank_source_record_id:'bank-1',bank_source_version:'1',business_source_record_id:'pay-1',business_source_version:'1',bank_staging_item_id:'stg-bank',business_staging_item_id:'stg-pay',allocated_amount:'100.0000'};
  const review_request={request_type:'AUTOREC_REVIEW_REQUEST',status:'REVIEW_REQUIRED',allocated_amount:'100.0000',company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',trace};
  const journal=(type,id,account,lineId,debit,credit)=>({accounting_type:type,source_system:'REFS_STANDARD_JE',status:'POSTED',journal_entry_id:id,audit_event_id:`audit-${id}`,audit_event_type:'AUTO_JOURNAL_CREATED',company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',source_trace:trace,ledger_lines:[{ledger_line_id:lineId,account_code:'291001',member_ref:'VENDOR-1',debit_amount:debit,credit_amount:credit},{ledger_line_id:`${lineId}-other`,account_code:account,debit_amount:credit,credit_amount:debit}]});
  const publicKey=pair.publicKey.export({type:'spki',format:'pem'});
  return {providerTrust:{issuer:'wbs',key_id:'wbs-2026',public_key:publicKey},keyring:{'wbs-2026':publicKey},raw,receipt,ingress:{...scope,status:'PERSISTED_STAGING_REVIEW_REQUIRED',can_dispatch_draft:false,can_dispatch_autorec:false,can_post:false,trace:{import_batch_id:'batch-1',trace_rows:[{receipt_id:'receipt-bank',raw_event_id:'raw-bank',source_document_id:'doc-bank',staging_item_id:'stg-bank',source_record_id:'bank-1',source_version:'1',receipt_hash:hash('d')},{receipt_id:'receipt-pay',raw_event_id:'raw-pay',source_document_id:'doc-pay',staging_item_id:'stg-pay',source_record_id:'pay-1',source_version:'1',receipt_hash:hash('e')}]},staging_reviews:[{staging_item_id:'stg-bank',review_event_id:'review-bank',reviewed_by:'reviewer',reviewed_at:'2026-08-11T00:00:00.000Z',status:'REVIEWED'},{staging_item_id:'stg-pay',review_event_id:'review-pay',reviewed_by:'reviewer',reviewed_at:'2026-08-11T00:00:00.000Z',status:'REVIEWED'}]},g11:{...scope,review_request,posted_journals:[journal('PAYABLE_INCUR','je-pay','600000','line-pay',0,'100.0000'),journal('AUTOC','je-autoc','111000','line-autoc','100.0000',0)]},glReport:{...scope,gl:{status:'POSTED',currency:'USD',journal_entry_ids:['je-pay','je-autoc']},report:{status:'FINAL',report_id:'report-1',currency:'USD',journal_entry_ids:['je-pay','je-autoc']},tie:{gl_debits:'200.0000',gl_credits:'200.0000',report_debits:'200.0000',report_credits:'200.0000',ap_291001_net:'0.0000'}}};
}

test('read-only live acceptance verifier accepts a signed receipt through ingress, G11 and final report tie',()=>{
  const result=verifyWbsLiveAcceptance(evidence());
  assert.equal(result.status,'WBS_LIVE_ACCEPTANCE_EVIDENCE_VERIFIED');assert.equal(result.posted_journal_count,2);
});

test('live acceptance verifier fails closed on missing review evidence and does not disclose supplied values',()=>{
  const input=evidence();input.ingress.staging_reviews=[];
  assert.throws(()=>verifyWbsLiveAcceptance(input),error=>error.code==='WBS_LIVE_ACCEPTANCE_STAGING_REVIEW_REQUIRED');
});

test('live acceptance verifier rejects a report that does not tie to both G11 journals',()=>{
  const input=evidence();input.glReport.report.journal_entry_ids=['je-pay','other'];
  assert.throws(()=>verifyWbsLiveAcceptance(input),error=>error.code==='WBS_LIVE_ACCEPTANCE_GL_REPORT_TIE_FAILED');
});

test('live acceptance verifier compares report ties as exact MONEY4 strings without floating point rounding',()=>{
  const input=evidence();
  Object.assign(input.glReport.tie,{gl_debits:'10.1010',gl_credits:'10.1010',report_debits:'10.1010',report_credits:'10.1010',ap_291001_net:'0.0000'});
  assert.equal(verifyWbsLiveAcceptance(input).status,'WBS_LIVE_ACCEPTANCE_EVIDENCE_VERIFIED');
  input.glReport.tie.report_credits='10.1011';
  assert.throws(()=>verifyWbsLiveAcceptance(input),error=>error.code==='WBS_LIVE_ACCEPTANCE_GL_REPORT_TIE_FAILED');
});

test('live acceptance verifier rejects non-canonical or numeric report totals',()=>{
  const numeric=evidence();numeric.glReport.tie.gl_debits=200;
  assert.throws(()=>verifyWbsLiveAcceptance(numeric),error=>error.code==='WBS_LIVE_ACCEPTANCE_GL_REPORT_TIE_FAILED');
  const precision=evidence();precision.glReport.tie.gl_debits='200.00001';
  assert.throws(()=>verifyWbsLiveAcceptance(precision),error=>error.code==='WBS_LIVE_ACCEPTANCE_GL_REPORT_TIE_FAILED');
});

test('live acceptance verifier does not trust a self-supplied evidence keyring',()=>{
  const input=evidence();
  delete input.providerTrust;
  assert.throws(()=>verifyWbsLiveAcceptance(input),error=>error.code==='WBS_LIVE_ACCEPTANCE_PROVIDER_TRUST_INVALID');
});

test('live acceptance verifier rejects receipt issuer and key-id that differ from the pinned provider',()=>{
  const issuerInput=evidence();issuerInput.receipt.issuer='different-provider';
  assert.throws(()=>verifyWbsLiveAcceptance(issuerInput),error=>error.code==='WBS_LIVE_ACCEPTANCE_RECEIPT_ISSUER_MISMATCH');
  const kidInput=evidence();kidInput.receipt.kid='different-key';kidInput.receipt.detached_signature.key_id='different-key';
  assert.throws(()=>verifyWbsLiveAcceptance(kidInput),error=>error.code==='WBS_LIVE_ACCEPTANCE_RECEIPT_KEY_ID_MISMATCH');
});

test('live acceptance verifier rejects raw bytes whose hashes differ from the receipt',()=>{
  const input=evidence();input.raw.response=Buffer.from('{"response":"tampered"}');
  assert.throws(()=>verifyWbsLiveAcceptance(input),error=>error.code==='WBS_LIVE_ACCEPTANCE_RAW_HASH_MISMATCH');
});

test('live acceptance verifier rejects a receipt claim changed after signing',()=>{
  const input=evidence();
  input.receipt.immutable_version='substituted-version';
  assert.throws(()=>verifyWbsLiveAcceptance(input),error=>error.code==='WBS_LIVE_ACCEPTANCE_RECEIPT_SIGNATURE_INVALID');
});
