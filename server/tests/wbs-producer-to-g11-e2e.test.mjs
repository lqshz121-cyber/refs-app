import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalRequestBody} from '../runtime/request-hash.mjs';
import {buildWbsMcpReadonlySnapshot} from '../runtime/wbs-mcp-inbound-lineage.mjs';
import {buildAutoReconciliationReviewRequest,buildStandardDraftRequest,createWbsInboundDataAdapter,validateWbsAutoRecG11PostedTrace} from '../runtime/wbs-inbound-data-adapter.mjs';

const hash=rows=>createHash('sha256').update(canonicalRequestBody(rows),'utf8').digest('hex');
const envelope=(tool,rows)=>({tool,contract_version:'1',environment:'production',captured_at:'2026-08-10T00:00:00.000Z',source:{provider:'WBS'},scope:{company:'COMPANY-A',currency:'USD',snapshot_token:'wbs-snapshot-1'},rows,record_count:rows.length,content_sha256:hash(rows),cursor_next:null,etl_notice:null});
const ruleReceipt=body=>({hash:`sha256:${body.content_sha256}`,ref:'object://wbs/rule',version:'1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'Ed25519',verified_on:'2026-08-10T00:00:00.000Z'});
const reader=value=>({readOnly:true,readSnapshot:async()=>structuredClone(value)});

test('receipt-backed Payable and Bank inputs reach one review/Draft/G11 proof while an unlinked AutoRec detail stays quarantined',async()=>{
  const payableEnvelope=envelope('list_payables',[{ap_guid:'11111111-1111-4111-8111-111111111111',ap_type:'AUTOC',bank_account_ref:'BANK-1',company_code:'COMPANY-A',currency:'USD',amount:'100.0000',incurred_date:'2026-08-09',posting_date:'2026-08-09',vendor_no:'VENDOR-1',project_guid:'PROJECT-1',cost_id:'COST-1'}]);
  const bankEnvelope=envelope('list_bank_transactions',[{bank_transaction_id:'22222222-2222-4222-8222-222222222222',cb_id:'RELATION-ONLY',company_code:'COMPANY-A',currency:'USD',account_code:'BANK-1',debtor:'0.0000',lender:'100.0000',set_date:'2026-08-09',posting_date:'2026-08-09',payee_no:'VENDOR-1'}]);
  const detailEnvelope=envelope('list_autorec_details',[{pd_guid:'33333333-3333-4333-8333-333333333333',pd_pv_guid:'RELATION-ONLY',cb_id:'RELATION-ONLY',company_code:'COMPANY-A',currency:'USD',biz_type:'WB',deposit:'0.0000',payment:'100.0000',incurred_date:'2026-08-09',posting_date:'2026-08-09',vendor_no:'VENDOR-1',project_guid:'PROJECT-1',cost_code:'COST-1'}]);
  const payableRules=[{scope:{company_key:'COMPANY-A',currency:'USD'},receipt:ruleReceipt(payableEnvelope),rule_id:'payable-dr',version:'1',ap_type:'AUTOC',direction:'DEBIT'}];
  const bankRules=[{scope:{company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1'},receipt:ruleReceipt(bankEnvelope),rule_id:'bank-cr',version:'1',lender_direction:'CREDIT',debtor_direction:'DEBIT'}];
  const detailRules=[{scope:{company_key:'COMPANY-A',currency:'USD'},receipt:ruleReceipt(detailEnvelope),rule_id:'detail-dr',version:'1',biz_type:'WB',deposit_direction:'CREDIT',payment_direction:'DEBIT',business_date_field:'incurred_date'}];
  const snapshot=buildWbsMcpReadonlySnapshot({
    snapshotId:'11111111-1111-4111-8111-111111111111',dictionaryVersion:'WBS-2026-08',
    envelopes:[payableEnvelope,bankEnvelope,detailEnvelope],
    bankDirectionConventions:bankRules,payableDirectionConventions:payableRules,autoRecDetailDirectionConventions:detailRules
  });
  const prepared=await createWbsInboundDataAdapter({snapshotReader:reader(snapshot)}).pull();
  assert.equal(prepared.staging.length,2);assert.equal(prepared.exceptions.length,1);
  assert.equal(prepared.exceptions[0].raw_trace.source_type,'AUTOREC_PAYMENT_DETAIL');
  assert.equal(prepared.exceptions[0].exception.code,'WBS_RECEIPT_FIELD_MISSING');

  const raw=type=>prepared.staging.find(item=>item.raw_trace.source_type===type).raw_trace;
  const pay={...raw('PAYABLE'),stage:'STAGING_REVIEWED',receipt_id:'receipt-pay',staging_item_id:'stg-pay',raw_event_id:'raw-pay',source_document_id:'doc-pay',bill_no:'11111111-1111-4111-8111-111111111111',project_ref:'PROJECT-1',project_code:'PROJECT-1',account_before:'600000',account_after:'291001',review_event_id:'review-pay'};
  const bank={...raw('BANK_TRANSACTION'),stage:'STAGING_REVIEWED',receipt_id:'receipt-bank',staging_item_id:'stg-bank',raw_event_id:'raw-bank',source_document_id:'doc-bank',journal_no:'22222222-2222-4222-8222-222222222222',payee_no:'VENDOR-1',account_before:'111000',account_after:'291001',review_event_id:'review-bank'};
  assert.throws(()=>buildAutoReconciliationReviewRequest({bankStaging:bank,businessStaging:{...pay,bank_account_ref:''}}),error=>error.code==='WBS_AUTOREC_ELIGIBILITY_TRACE_REQUIRED');
  const review=buildAutoReconciliationReviewRequest({bankStaging:bank,businessStaging:pay,dateWindowDays:0,dateMatchBasis:'BUSINESS_AND_ACCOUNTING'});
  assert.equal(review.status,'REVIEW_REQUIRED');assert.equal(review.allocated_amount,100);assert.equal(review.can_release,false);

  const mapping={mapping_id:'payable-map-1',version:'1',snapshot_hash:'sha256:'+'d'.repeat(64),status:'APPROVED',source_type:'PAYABLE',company_key:'COMPANY-A',currency:'USD',effective_from:'2026-01-01T00:00:00.000Z',effective_to:null};
  const draft=buildStandardDraftRequest({stagingItem:pay,mapping,journal:{period_id:'2026-08',journal_number:'REFS-DRAFT-PAY-1',company_key:'COMPANY-A',currency:'USD',accounting_date:'2026-08-09',lines:[{debit_amount:'100.0000',credit_amount:'0.0000'},{debit_amount:'0.0000',credit_amount:'100.0000'}]}});
  assert.equal(draft.status,'READY_FOR_STANDARD_JE_COMMAND');assert.equal(draft.can_dispatch,false);

  const journal=(accounting_type,lines)=>({accounting_type,source_system:'REFS_STANDARD_JE',status:'POSTED',journal_entry_id:`je-${accounting_type}`,audit_event_id:`audit-${accounting_type}`,audit_event_type:'AUTO_JOURNAL_CREATED',company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',source_trace:review.trace,ledger_lines:lines});
  const result=validateWbsAutoRecG11PostedTrace({reviewRequest:review,postedJournals:[
    journal('PAYABLE_INCUR',[{ledger_line_id:'pay-291001',account_code:'291001',member_ref:'VENDOR-1',debit_amount:0,credit_amount:100},{ledger_line_id:'pay-expense',account_code:'600000',debit_amount:100,credit_amount:0}]),
    journal('AUTOC',[{ledger_line_id:'autoc-291001',account_code:'291001',member_ref:'VENDOR-1',debit_amount:100,credit_amount:0},{ledger_line_id:'autoc-bank',account_code:'111000',debit_amount:0,credit_amount:100}])
  ]});
  assert.equal(result.status,'POSTED_TRACE_VERIFIED');assert.equal(result.control_totals.ap_291001_member_nets['VENDOR-1'],0);assert.equal(result.can_post,false);
});
