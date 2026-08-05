import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {buildAutoReconciliationReviewRequest,buildStandardDraftRequest,createWbsInboundDataAdapter,validatePostedJournalTrace,WbsInboundDataError} from '../runtime/wbs-inbound-data-adapter.mjs';

const guid='11111111-1111-4111-8111-111111111111';
const snapshot=()=>{const value={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:'22222222-2222-4222-8222-222222222222',captured_at:'2026-08-05T10:00:00.000Z',environment:'SANDBOX',source_system:'WBS',dictionary_version:'WBS-DICT-2026-08-05',views:[
  {name:'BGDATA.payable',company_key:'COMPANY-A',rows:[{apGuId:guid,currency:'USD',amount:'100.0000',invoice_date:'2026-08-01'}]},
  {name:'BGDATA.bank_transaction',company_key:'COMPANY-A',rows:[{cashOrBankBookId:'BANK-1',bank_account_ref:'BANK-OP',currency:'USD',amount:'-100.0000',transaction_date:'2026-08-02'}]},
  {name:'BGDATA.autoc_detail',company_key:'COMPANY-A',rows:[{pdGuId:'33333333-3333-4333-8333-333333333333',pbGuId:'44444444-4444-4444-8444-444444444444',currency:'USD',amount:'100.0000',payment_date:'2026-08-02',vendor_ref:'VEN-1',project_ref:'PROJ-1',cost_code_ref:'COST-1',description:'masked'}]}
]};value.views=value.views.map(view=>({...view,content_hash:canonicalRequestHash(view.rows)}));return {...value,package_hash:canonicalRequestHash(value)};};
const reader=value=>({readOnly:true,readSnapshot:async()=>structuredClone(value)});

test('read-only snapshot adapter produces typed Raw/Normalized/Staging seams without a WBS write or Draft command',async()=>{
  const result=await createWbsInboundDataAdapter({snapshotReader:reader(snapshot())}).pull({selection:{company:'COMPANY-A'}});
  assert.deepEqual({raw:result.raw.length,normalized:result.normalized.length,staging:result.staging.length,exceptions:result.exceptions.length},{raw:3,normalized:3,staging:3,exceptions:0});
  assert.equal(result.admission.can_write_wbs,false);assert.equal(result.admission.can_create_draft,false);assert.equal(result.staging.find(item=>item.raw_trace.source_type==='BANK_TRANSACTION').raw_trace.source_record_id,'BANK-1');
});

test('incomplete receipt rows reach Exception rather than staging or a Draft request',async()=>{
  const value=snapshot();delete value.views[0].rows[0].invoice_date;value.views[0].content_hash=canonicalRequestHash(value.views[0].rows);delete value.package_hash;value.package_hash=canonicalRequestHash(value);
  const result=await createWbsInboundDataAdapter({snapshotReader:reader(value)}).pull();
  assert.equal(result.exceptions.length,1);assert.equal(result.exceptions[0].exception.code,'WBS_RECEIPT_FIELD_MISSING');assert.equal(result.staging.length,2);
});

test('Draft and AutoRec requests are review-only seams with immutable source trace',async()=>{
  const result=await createWbsInboundDataAdapter({snapshotReader:reader(snapshot())}).pull();
  const payable=result.staging.find(item=>item.raw_trace.source_type==='PAYABLE').raw_trace;
  const bank=result.staging.find(item=>item.raw_trace.source_type==='BANK_TRANSACTION').raw_trace;
  const reviewedPayable={...payable,stage:'STAGING_REVIEWED',staging_item_id:'stg-pay',source_document_id:'doc-pay',raw_event_id:'raw-pay'};
  const reviewedBank={...bank,stage:'STAGING_REVIEWED',staging_item_id:'stg-bank',source_document_id:'doc-bank',raw_event_id:'raw-bank'};
  const autoRec=buildAutoReconciliationReviewRequest({bankStaging:reviewedBank,businessStaging:reviewedPayable});assert.equal(autoRec.status,'REVIEW_REQUIRED');assert.equal(autoRec.can_release,false);
  const draft=buildStandardDraftRequest({stagingItem:reviewedPayable,mapping:{mapping_id:'map-1',version:'4',status:'APPROVED'},journal:{period_id:'period-1',journal_number:'AUTO-1',lines:[{debit_amount:100,credit_amount:0},{debit_amount:0,credit_amount:100}]}});
  assert.equal(draft.kernel_method,'createAutoJournal');assert.equal(draft.can_dispatch,false);assert.equal(draft.can_post,false);
  const trace=validatePostedJournalTrace({draftRequest:draft,postedEvidence:{source_system:'REFS_STANDARD_JE',status:'POSTED',journal_entry_id:'je-1',ledger_line_ids:['ll-1','ll-2'],review_audit_id:'audit-r',approval_audit_id:'audit-a',post_audit_id:'audit-p'}});
  assert.equal(trace.ok,true);assert.equal(trace.trace.raw_event_id,'raw-pay');
});

test('adapter rejects a mutable reader, cross-currency AutoRec pair, and unbalanced Draft request',async()=>{
  assert.throws(()=>createWbsInboundDataAdapter({snapshotReader:{readSnapshot:async()=>snapshot()}}),error=>error instanceof WbsInboundDataError&&error.code==='WBS_INBOUND_READER_INVALID');
  const staged={stage:'STAGING_REVIEWED',source_record_id:'one',currency:'USD',amount:100,company_key:'C',raw_event_id:'raw',source_document_id:'doc',source_version:'v'};
  assert.throws(()=>buildAutoReconciliationReviewRequest({bankStaging:{...staged,source_type:'BANK_TRANSACTION'},businessStaging:{...staged,source_type:'PAYABLE',currency:'CAD'}}),error=>error.code==='WBS_AUTOREC_SCOPE_MISMATCH');
  assert.throws(()=>buildStandardDraftRequest({stagingItem:{...staged,staging_item_id:'stg'},mapping:{mapping_id:'m',version:'1',status:'APPROVED'},journal:{period_id:'p',journal_number:'j',lines:[{debit_amount:100,credit_amount:0},{debit_amount:0,credit_amount:99}]}}),error=>error.code==='WBS_DRAFT_REQUEST_UNBALANCED');
});
