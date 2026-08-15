import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {verifyWbsLiveAcceptance} from '../tools/verify-wbs-live-acceptance.mjs';
import {canonicalWbsLiveReceiptSigningPayload} from '../runtime/wbs-live-receipt-signing.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {validateWbsSnapshotPackage} from '../runtime/wbs-snapshot-package.mjs';

const hash=letter=>`sha256:${letter.repeat(64)}`;
const rawHash=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
function evidence(){
  const pair=generateKeyPairSync('ed25519'),snapshotId='22222222-2222-4222-8222-222222222222',capturedAt='2026-08-11T00:00:00.000Z',views=[{name:'BGDATA.payable',company_key:'COMPANY-A',rows:[{apGuId:'11111111-1111-4111-8111-111111111111',currency:'USD',amount:'100.0000'}]},{name:'BGDATA.bank_transaction',company_key:'COMPANY-A',rows:[{bankTransactionId:'bank-1',bank_account_ref:'BANK-1',currency:'USD',amount:'100.0000'}]}].map(view=>({...view,content_hash:canonicalRequestHash(view.rows),row_count:view.rows.length,first_primary_key:view.rows[0][view.name==='BGDATA.payable'?'apGuId':'bankTransactionId'],last_primary_key:view.rows.at(-1)[view.name==='BGDATA.payable'?'apGuId':'bankTransactionId']})),snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:snapshotId,captured_at:capturedAt,environment:'PRODUCTION',source_system:'WBS',dictionary_version:'WBS-DICT-2026-08-11',views,delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',snapshot_token:'snapshot-token-1',extract_started_at:'2026-08-10T23:59:00.000Z',extract_completed_at:capturedAt,consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'},detached_signature:{key_id:'wbs-2026',algorithm:'Ed25519',value:'provider-package-signature'}};const {detached_signature,...manifest}=snapshot;snapshot.package_hash=canonicalRequestHash(manifest);const raw={request:Buffer.from('{"request":"canonical"}'),response:Buffer.from('{"response":"canonical"}'),package:Buffer.from(JSON.stringify(snapshot))},packageHash=rawHash(raw.package),scope={tenant_id:'tenant-1',entity_id:'entity-1',company_code:'COMPANY-A',package_hash:packageHash};
  const receipt={...scope,issuer:'wbs',kid:'wbs-2026',algorithm:'Ed25519',response_sha256:rawHash(raw.response),request_sha256:rawHash(raw.request),nonce:'nonce-1',signed_at:'2026-08-11T00:00:00.000Z',expires_at:'2099-08-12T00:00:00.000Z',immutable_version:snapshotId,nonempty:true};
  receipt.detached_signature={key_id:'wbs-2026',algorithm:'Ed25519',value:sign(null,Buffer.from(canonicalWbsLiveReceiptSigningPayload(receipt),'utf8'),pair.privateKey).toString('base64')};
  const validated=validateWbsSnapshotPackage(snapshot),bankSource=validated.receipts.find(row=>row.source_module==='BGDATA.bank_transaction'),paySource=validated.receipts.find(row=>row.source_module==='BGDATA.payable');
  const trace={company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',bank_business_date:'2026-08-10',bank_accounting_date:'2026-08-10',business_business_date:'2026-08-10',business_accounting_date:'2026-08-10',bank_receipt_id:'receipt-bank',bank_receipt_ref:'ref-bank',bank_receipt_hash:bankSource.payload_hash,business_receipt_id:'receipt-pay',business_receipt_ref:'ref-pay',business_receipt_hash:paySource.payload_hash,bank_raw_event_id:'raw-bank',business_raw_event_id:'raw-pay',bank_source_document_id:'doc-bank',business_source_document_id:'doc-pay',bank_source_record_id:bankSource.source_record_id,bank_source_version:bankSource.source_version,business_source_record_id:paySource.source_record_id,business_source_version:paySource.source_version,bank_staging_item_id:'stg-bank',business_staging_item_id:'stg-pay',allocated_amount:'100.0000'};
  const review_request={request_type:'AUTOREC_REVIEW_REQUEST',status:'REVIEW_REQUIRED',allocated_amount:'100.0000',company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',trace};
  const journal=(type,id,account,lineId,debit,credit)=>({accounting_type:type,source_system:'REFS_STANDARD_JE',status:'POSTED',journal_entry_id:id,audit_event_id:`audit-${id}`,audit_event_type:'AUTO_JOURNAL_CREATED',company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',source_trace:trace,ledger_lines:[{ledger_line_id:lineId,account_code:'291001',member_ref:'VENDOR-1',debit_amount:debit,credit_amount:credit},{ledger_line_id:`${lineId}-other`,account_code:account,debit_amount:credit,credit_amount:debit}]});
  const publicKey=pair.publicKey.export({type:'spki',format:'pem'});
  return {providerTrust:{issuer:'wbs',key_id:'wbs-2026',public_key:publicKey},keyring:{'wbs-2026':publicKey},privateKey:pair.privateKey,raw,receipt,ingress:{...scope,status:'PERSISTED_STAGING_REVIEW_REQUIRED',can_dispatch_draft:false,can_dispatch_autorec:false,can_post:false,trace:{import_batch_id:'batch-1',trace_rows:[{receipt_id:'receipt-bank',raw_event_id:'raw-bank',source_document_id:'doc-bank',staging_item_id:'stg-bank',source_record_id:bankSource.source_record_id,source_version:bankSource.source_version,receipt_hash:bankSource.payload_hash},{receipt_id:'receipt-pay',raw_event_id:'raw-pay',source_document_id:'doc-pay',staging_item_id:'stg-pay',source_record_id:paySource.source_record_id,source_version:paySource.source_version,receipt_hash:paySource.payload_hash}]},staging_reviews:[{staging_item_id:'stg-bank',review_event_id:'review-bank',reviewed_by:'reviewer',reviewed_at:'2026-08-11T00:00:00.000Z',status:'REVIEWED'},{staging_item_id:'stg-pay',review_event_id:'review-pay',reviewed_by:'reviewer',reviewed_at:'2026-08-11T00:00:00.000Z',status:'REVIEWED'}]},g11:{...scope,review_request,posted_journals:[journal('PAYABLE_INCUR','je-pay','600000','line-pay',0,'100.0000'),journal('AUTOC','je-autoc','111000','line-autoc','100.0000',0)]},glReport:{...scope,gl:{status:'POSTED',currency:'USD',journal_entry_ids:['je-pay','je-autoc']},report:{status:'FINAL',report_id:'report-1',currency:'USD',journal_entry_ids:['je-pay','je-autoc']},tie:{gl_debits:'200.0000',gl_credits:'200.0000',report_debits:'200.0000',report_credits:'200.0000',ap_291001_net:'0.0000'}}};
}

function replaceSignedPackage(input,mutate,{rebind=false}={}){
  const snapshot=JSON.parse(input.raw.package.toString('utf8'));mutate(snapshot);for(const view of snapshot.views){view.content_hash=canonicalRequestHash(view.rows);view.row_count=view.rows.length;}const unsigned={...snapshot};delete unsigned.package_hash;delete unsigned.detached_signature;snapshot.package_hash=canonicalRequestHash(unsigned);input.raw.package=Buffer.from(JSON.stringify(snapshot));input.receipt.package_hash=rawHash(input.raw.package);input.receipt.detached_signature.value=sign(null,Buffer.from(canonicalWbsLiveReceiptSigningPayload(input.receipt),'utf8'),input.privateKey).toString('base64');for(const target of [input.ingress,input.g11,input.glReport])target.package_hash=input.receipt.package_hash;
  if(rebind){const sources=validateWbsSnapshotPackage(snapshot).receipts,byModule=new Map(sources.map(row=>[row.source_module,row])),trace=input.g11.review_request.trace;for(const [index,module,prefix] of [[0,'BGDATA.bank_transaction','bank'],[1,'BGDATA.payable','business']]){const source=byModule.get(module),row=input.ingress.trace.trace_rows[index];row.source_record_id=source.source_record_id;row.source_version=source.source_version;row.receipt_hash=source.payload_hash;trace[`${prefix}_source_record_id`]=source.source_record_id;trace[`${prefix}_source_version`]=source.source_version;trace[`${prefix}_receipt_hash`]=source.payload_hash;}}
}

test('read-only live acceptance verifier accepts a signed receipt through ingress, G11 and final report tie',()=>{
  const result=verifyWbsLiveAcceptance(evidence());
  assert.equal(result.status,'WBS_LIVE_ACCEPTANCE_OFFLINE_CONSISTENCY_VERIFIED');assert.equal(result.posted_journal_count,2);assert.equal(result.authoritative_downstream,false);assert.equal(result.requires_authenticated_api_e2e,true);
});

test('live acceptance verifier fails closed on missing review evidence and does not disclose supplied values',()=>{
  const input=evidence();input.ingress.staging_reviews=[];
  assert.throws(()=>verifyWbsLiveAcceptance(input),error=>error.code==='WBS_LIVE_ACCEPTANCE_STAGING_REVIEW_REQUIRED');
});

test('live acceptance verifier rejects ingress rows not present in the signed production package',()=>{
  const changedId=evidence();changedId.ingress.trace.trace_rows[0].source_record_id='substituted-bank';
  assert.throws(()=>verifyWbsLiveAcceptance(changedId),error=>error.code==='WBS_LIVE_ACCEPTANCE_INGRESS_PACKAGE_MISMATCH');
  const changedHash=evidence();changedHash.ingress.trace.trace_rows[1].receipt_hash=hash('f');
  assert.throws(()=>verifyWbsLiveAcceptance(changedHash),error=>error.code==='WBS_LIVE_ACCEPTANCE_INGRESS_PACKAGE_MISMATCH');
  const extra=evidence();extra.ingress.trace.trace_rows.push({...extra.ingress.trace.trace_rows[0],staging_item_id:'stg-extra'});extra.ingress.staging_reviews.push({staging_item_id:'stg-extra',review_event_id:'review-extra',reviewed_by:'reviewer',reviewed_at:'2026-08-11T00:00:00.000Z',status:'REVIEWED'});
  assert.throws(()=>verifyWbsLiveAcceptance(extra),error=>error.code==='WBS_LIVE_ACCEPTANCE_INGRESS_TRACE_REQUIRED');
});

test('live acceptance verifier binds G11 bank/business sides and staging ids to signed package sources',()=>{
  const wrongSide=evidence(),rows=wrongSide.ingress.trace.trace_rows,trace=wrongSide.g11.review_request.trace;trace.bank_source_record_id=rows[1].source_record_id;trace.bank_source_version=rows[1].source_version;trace.bank_receipt_hash=rows[1].receipt_hash;
  assert.throws(()=>verifyWbsLiveAcceptance(wrongSide),error=>error.code==='WBS_LIVE_ACCEPTANCE_G11_PACKAGE_LINEAGE_MISMATCH');
  const wrongStaging=evidence();wrongStaging.g11.review_request.trace.bank_staging_item_id='stg-not-ingressed';
  assert.throws(()=>verifyWbsLiveAcceptance(wrongStaging),error=>error.code==='WBS_LIVE_ACCEPTANCE_G11_PACKAGE_LINEAGE_MISMATCH');
  const swapped=evidence(),swappedTrace=swapped.g11.review_request.trace;[swappedTrace.bank_staging_item_id,swappedTrace.business_staging_item_id]=[swappedTrace.business_staging_item_id,swappedTrace.bank_staging_item_id];
  assert.throws(()=>verifyWbsLiveAcceptance(swapped),error=>error.code==='WBS_LIVE_ACCEPTANCE_G11_PACKAGE_LINEAGE_MISMATCH');
  const changedReceipt=evidence();changedReceipt.g11.review_request.trace.bank_receipt_id='receipt-substituted';
  assert.throws(()=>verifyWbsLiveAcceptance(changedReceipt),error=>error.code==='WBS_LIVE_ACCEPTANCE_G11_PACKAGE_LINEAGE_MISMATCH');
});

test('live acceptance verifier binds allocation amount, currency and bank account to signed source facts',()=>{
  const amount=evidence();replaceSignedPackage(amount,snapshot=>{snapshot.views.find(view=>view.name==='BGDATA.bank_transaction').rows[0].amount='50.0000';},{rebind:true});
  assert.throws(()=>verifyWbsLiveAcceptance(amount),error=>error.code==='WBS_LIVE_ACCEPTANCE_G11_SOURCE_AMOUNT_INVALID');
  const currency=evidence();replaceSignedPackage(currency,snapshot=>{snapshot.views.find(view=>view.name==='BGDATA.payable').rows[0].currency='CAD';},{rebind:true});
  assert.throws(()=>verifyWbsLiveAcceptance(currency),error=>error.code==='WBS_LIVE_ACCEPTANCE_G11_SOURCE_AMOUNT_INVALID');
  const account=evidence();replaceSignedPackage(account,snapshot=>{snapshot.views.find(view=>view.name==='BGDATA.bank_transaction').rows[0].bank_account_ref='BANK-OTHER';},{rebind:true});
  assert.throws(()=>verifyWbsLiveAcceptance(account),error=>error.code==='WBS_LIVE_ACCEPTANCE_G11_SOURCE_AMOUNT_INVALID');
});

test('live acceptance verifier rejects a report that does not tie to both G11 journals',()=>{
  const input=evidence();input.glReport.report.journal_entry_ids=['je-pay','other'];
  assert.throws(()=>verifyWbsLiveAcceptance(input),error=>error.code==='WBS_LIVE_ACCEPTANCE_GL_REPORT_TIE_FAILED');
});

test('live acceptance verifier compares report ties as exact MONEY4 strings without floating point rounding',()=>{
  const input=evidence();
  Object.assign(input.glReport.tie,{gl_debits:'10.1010',gl_credits:'10.1010',report_debits:'10.1010',report_credits:'10.1010',ap_291001_net:'0.0000'});
  assert.equal(verifyWbsLiveAcceptance(input).status,'WBS_LIVE_ACCEPTANCE_OFFLINE_CONSISTENCY_VERIFIED');
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

test('live acceptance verifier rejects signed arbitrary bytes and non-production or cross-company packages',()=>{
  const arbitrary=evidence();arbitrary.raw.package=Buffer.from('{"package":"canonical"}');arbitrary.receipt.package_hash=rawHash(arbitrary.raw.package);arbitrary.receipt.detached_signature.value=sign(null,Buffer.from(canonicalWbsLiveReceiptSigningPayload(arbitrary.receipt),'utf8'),arbitrary.privateKey).toString('base64');
  assert.throws(()=>verifyWbsLiveAcceptance(arbitrary),error=>error.code==='WBS_LIVE_ACCEPTANCE_PACKAGE_INVALID');
  const sandbox=evidence();replaceSignedPackage(sandbox,snapshot=>{snapshot.environment='SANDBOX';});
  assert.throws(()=>verifyWbsLiveAcceptance(sandbox),error=>error.code==='WBS_LIVE_ACCEPTANCE_PACKAGE_INVALID');
  const wrongCompany=evidence();replaceSignedPackage(wrongCompany,snapshot=>{for(const view of snapshot.views)view.company_key='COMPANY-B';});
  assert.throws(()=>verifyWbsLiveAcceptance(wrongCompany),error=>error.code==='WBS_LIVE_ACCEPTANCE_PACKAGE_INVALID');
  const wrongVersion=evidence();wrongVersion.receipt.immutable_version='33333333-3333-4333-8333-333333333333';wrongVersion.receipt.detached_signature.value=sign(null,Buffer.from(canonicalWbsLiveReceiptSigningPayload(wrongVersion.receipt),'utf8'),wrongVersion.privateKey).toString('base64');
  assert.throws(()=>verifyWbsLiveAcceptance(wrongVersion),error=>error.code==='WBS_LIVE_ACCEPTANCE_PACKAGE_INVALID');
});

test('live acceptance verifier rejects expired, malformed, and implausibly future receipt windows before accepting the signature',()=>{
  const expired=evidence();expired.receipt.expires_at='2026-08-10T00:00:00.000Z';
  assert.throws(()=>verifyWbsLiveAcceptance({...expired,now:Date.parse('2026-08-11T00:00:00.000Z')}),error=>error.code==='WBS_LIVE_ACCEPTANCE_RECEIPT_TIME_WINDOW_INVALID');
  const malformed=evidence();malformed.receipt.signed_at='2026-08-11';
  assert.throws(()=>verifyWbsLiveAcceptance({...malformed,now:Date.parse('2026-08-11T00:00:00.000Z')}),error=>error.code==='WBS_LIVE_ACCEPTANCE_RECEIPT_TIME_WINDOW_INVALID');
  const future=evidence();future.receipt.signed_at='2099-08-11T00:00:00.000Z';future.receipt.expires_at='2099-08-12T00:00:00.000Z';
  assert.throws(()=>verifyWbsLiveAcceptance({...future,now:Date.parse('2026-08-11T00:00:00.000Z')}),error=>error.code==='WBS_LIVE_ACCEPTANCE_RECEIPT_TIME_WINDOW_INVALID');
});
