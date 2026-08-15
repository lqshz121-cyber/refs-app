import test from 'node:test';
import assert from 'node:assert/strict';
import {mapWbsReadonlyProviderRow,mergeWbsReadonlyResultEvidence,WbsProviderReadonlyRowAdapterError} from '../runtime/wbs-provider-readonly-row-adapter.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {buildWbsAutoRecBankControlEvidence,buildWbsAutoRecDetailCaseBinding,buildWbsMcpReadonlySnapshot,mapWbsMcpEnvelopeToInbound,WbsMcpLineageError} from '../runtime/wbs-mcp-inbound-lineage.mjs';
import {buildAutoReconciliationReviewRequest,createWbsInboundDataAdapter} from '../runtime/wbs-inbound-data-adapter.mjs';

const scope={company_code:'COMPANY-A',currency:'USD'};

test('observed Payable, Detail, PB, and journal schemas map only into read-only formal provider rows',()=>{
  const payable=mapWbsReadonlyProviderRow({sourceTable:'wbsdata.account_book_payable_info',scope,row:{uuid:'PAY-1',company_code:'COMPANY-A',type:'AUTOC',amount:'100.0000',incurred_date:'2026-08-01',posting_date:'2026-08-02',business_id:'DETAIL-1',cb_id:'RELATION-1'}});
  assert.deepEqual({key:payable.ap_guid,type:payable.ap_type,company:payable.company_code,currency:payable.currency,bank:payable.bank_account_ref,relation:payable.cb_id},{key:'PAY-1',type:'AUTOC',company:'COMPANY-A',currency:'USD',bank:null,relation:'RELATION-1'});
  const detail=mapWbsReadonlyProviderRow({sourceTable:'wbsdata.fast_auto_payment_detail',scope,row:{pd_guid:'DETAIL-1',pd_pvguid:'PB-NAVIGATION',pd_cbid:'CB-NAVIGATION',pd_biz_type:'WB',pd_payment:'100',pd_deposit:'0',pd_incurred_date:'2026-08-01',pd_company:'UNVERIFIED-COMPANY'}});
  assert.deepEqual({key:detail.pd_guid,company:detail.company_code,currency:detail.currency,providerCompany:detail.detail_company_trace,posting:detail.posting_date},{key:'DETAIL-1',company:'COMPANY-A',currency:'USD',providerCompany:'UNVERIFIED-COMPANY',posting:null});
  const bank=mapWbsReadonlyProviderRow({sourceTable:'wbsdata.autopaymentbank',scope,row:{PB_GuId:'PB-1',PB_CompanyCode:'COMPANY-A',PB_PayAmount:'100',PB_DebitAmount:'0',PB_Released:'0',PB_Incurred:'0',PB_Quantity:'1',PB_AhId:'BANK-1'}});
  assert.deepEqual({key:bank.pb_guid,company:bank.company_code,account:bank.ah_id,pay:bank.pay_amount},{key:'PB-1',company:'COMPANY-A',account:'BANK-1',pay:'100'});
  const journal=mapWbsReadonlyProviderRow({sourceTable:'accounting.accounting_info',scope,row:{id:1,com_code:'COMPANY-A',account:'291001',debtor:'100',lender:'0',posting_date:'2026-08-02',cb_id:'TRACE-ONLY'}});
  assert.deepEqual({id:journal.id,company:journal.company,bank:journal.cb_id,currency:journal.currency},{id:1,company:'COMPANY-A',bank:'TRACE-ONLY',currency:'USD'});
});

test('row adapter fails closed for cross-company input and requires the Provider cb_id bank key',()=>{
  assert.throws(()=>mapWbsReadonlyProviderRow({sourceTable:'wbsdata.account_book_payable_info',scope,row:{uuid:'PAY-1',company_code:'COMPANY-B'}}),error=>error instanceof WbsProviderReadonlyRowAdapterError&&error.code==='WBS_PROVIDER_COMPANY_SCOPE_MISMATCH');
  assert.throws(()=>mapWbsReadonlyProviderRow({sourceTable:'accounting.bank_transaction_result',scope,row:{bank_transaction_id:'LEGACY-ONLY',com_code:'COMPANY-A'}}),error=>error instanceof WbsProviderReadonlyRowAdapterError&&error.code==='WBS_PROVIDER_STABLE_KEY_REQUIRED');
});

test('an observed AutoRec physical row with no posting-date column becomes an exception, not staging evidence',()=>{
  const row=mapWbsReadonlyProviderRow({sourceTable:'wbsdata.fast_auto_payment_detail',scope,row:{pd_guid:'DETAIL-POSTING-UNKNOWN',pd_biz_type:'WB',pd_payment:'100.0000',pd_deposit:'0',pd_incurred_date:'2026-08-01',pd_status:'INCURRED'}});
  const rows=[row],content_sha256=canonicalRequestHash(rows).slice(7);
  const envelope={contract_version:'WBS-REFS-MCP-V1',tool:'list_autorec_details',environment:'production',captured_at:'2026-08-10T00:00:00.000Z',source:{system:'WBS'},scope:{company:'COMPANY-A',currency:'USD'},record_count:1,content_sha256,cursor_next:null,etl_notice:'Snapshot comparison required',rows};
  const conventions=[{scope:{company_key:'COMPANY-A',currency:'USD'},receipt:{hash:`sha256:${content_sha256}`,ref:'object://wbs/test/receipt',version:'v1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'ES256',verified_on:'2026-08-10T00:00:00.000Z'},rule_id:'WBS-AUTOREC-DR-1',version:'1',biz_type:'WB',deposit_direction:'CREDIT',payment_direction:'DEBIT',business_date_field:'incurred_date'}];
  const mapped=mapWbsMcpEnvelopeToInbound({envelope,autoRecDetailDirectionConventions:conventions}).rows[0];
  assert.deepEqual({admission:mapped.admission,code:mapped.exception_code,staging:mapped.can_create_draft,post:mapped.can_post},{admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_AUTOREC_POSTING_DATE_REQUIRED',staging:false,post:false});
});

test('a mapped physical Payable row reaches receipt-bound Raw/Normalized/Staging only through the existing ingress seam',async()=>{
  const row=mapWbsReadonlyProviderRow({sourceTable:'wbsdata.account_book_payable_info',scope,row:{uuid:'11111111-1111-4111-8111-111111111111',company_code:'COMPANY-A',type:'AUTOC',amount:'100.0000',incurred_date:'2026-08-01',posting_date:'2026-08-02',vendor_no:'V-1',project_code:'P-1',cost_id:'C-1',journal_no:'J-1'}});
  const rows=[row],content_sha256=canonicalRequestHash(rows).slice(7);
  const envelope={contract_version:'WBS-REFS-MCP-V1',tool:'list_payables',environment:'production',captured_at:'2026-08-10T00:00:00.000Z',source:{system:'WBS'},scope:{company:'COMPANY-A',currency:'USD'},record_count:1,content_sha256,cursor_next:null,etl_notice:'Snapshot comparison required',rows};
  const conventions=[{scope:{company_key:'COMPANY-A',currency:'USD'},receipt:{hash:`sha256:${content_sha256}`,ref:'object://wbs/test/payable-receipt',version:'v1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'ES256',verified_on:'2026-08-10T00:00:00.000Z'},rule_id:'WBS-PAYABLE-DR-1',version:'1',ap_type:'AUTOC',direction:'DEBIT'}];
  const snapshot=buildWbsMcpReadonlySnapshot({envelopes:[envelope],snapshotId:'22222222-2222-4222-8222-222222222222',dictionaryVersion:'WBS-MCP-V1',payableDirectionConventions:conventions});
  const prepared=await createWbsInboundDataAdapter({snapshotReader:{readOnly:true,readSnapshot:async()=>snapshot}}).pull();
  assert.deepEqual({raw:prepared.raw.length,normalized:prepared.normalized.length,staging:prepared.staging.length,exceptions:prepared.exceptions.length},{raw:1,normalized:1,staging:1,exceptions:0});
  assert.equal(prepared.can_dispatch_draft,undefined);assert.equal(prepared.can_post,undefined);
  assert.deepEqual({source:prepared.staging[0].raw_trace.source_type,key:prepared.staging[0].raw_trace.source_record_id,posting:prepared.staging[0].raw_trace.posting_date,amount:prepared.staging[0].raw_trace.amount},{source:'PAYABLE',key:'11111111-1111-4111-8111-111111111111',posting:'2026-08-02',amount:-100});
});

test('a receipt-supplied Provider cb_id reaches staging, while journal relation keys remain trace only',async()=>{
  const row=mapWbsReadonlyProviderRow({sourceTable:'accounting.bank_transaction_result',scope,row:{cb_id:'BANK-TX-001',company_code:'COMPANY-A',account_code:'BANK-OP',debtor:'0',lender:'100.0000',set_date:'2026-08-01',posting_date:'2026-08-02',journal_no:'J-1',ref_no:'DISPLAY-ONLY'}});
  const rows=[row],content_sha256=canonicalRequestHash(rows).slice(7);
  const envelope={contract_version:'WBS-REFS-MCP-V1',tool:'list_bank_transactions',environment:'production',captured_at:'2026-08-10T00:00:00.000Z',source:{system:'WBS'},scope:{company:'COMPANY-A',currency:'USD'},record_count:1,content_sha256,cursor_next:null,etl_notice:'Snapshot comparison required',rows};
  const conventions=[{scope:{company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-OP'},receipt:{hash:`sha256:${content_sha256}`,ref:'object://wbs/test/bank-receipt',version:'v1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'ES256',verified_on:'2026-08-10T00:00:00.000Z'},rule_id:'WBS-BANK-DR-1',version:'1',debtor_direction:'DEBIT',lender_direction:'CREDIT'}];
  const snapshot=buildWbsMcpReadonlySnapshot({envelopes:[envelope],snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1',bankDirectionConventions:conventions});
  const prepared=await createWbsInboundDataAdapter({snapshotReader:{readOnly:true,readSnapshot:async()=>snapshot}}).pull();
  assert.deepEqual({raw:prepared.raw.length,normalized:prepared.normalized.length,staging:prepared.staging.length,exceptions:prepared.exceptions.length},{raw:1,normalized:1,staging:1,exceptions:0});
  assert.deepEqual({source:prepared.staging[0].raw_trace.source_type,key:prepared.staging[0].raw_trace.source_record_id,bank:prepared.staging[0].raw_trace.bank_account_ref,amount:prepared.staging[0].raw_trace.amount,direction:prepared.staging[0].raw_trace.direction},{source:'BANK_TRANSACTION',key:'BANK-TX-001',bank:'BANK-OP',amount:-100,direction:'CREDIT'});
  assert.deepEqual(prepared.staging[0].raw_trace.external_trace,{source_cb_id:'BANK-TX-001',transaction_date:'2026-08-01',posting_date:'2026-08-02',account_code:'BANK-OP',ref_no:'DISPLAY-ONLY'});
  assert.equal(prepared.staging[0].raw_trace.source_record_id,'BANK-TX-001');
});

test('physical AutoRec Bank totals remain control-only and reject an inferred released-quantity formula',()=>{
  const row=mapWbsReadonlyProviderRow({sourceTable:'wbsdata.autopaymentbank',scope,row:{PB_GuId:'PB-CONTROL-001',PB_CompanyCode:'COMPANY-A',PB_AhId:'BANK-OP',PB_Quantity:'2',PB_PayAmount:'100.0000',PB_DebitAmount:'0',PB_Released:'50.0000',PB_Incurred:'25.0000',PB_Status:'INCURRED'}});
  const rows=[row],content_sha256=canonicalRequestHash(rows).slice(7);
  const envelope={contract_version:'WBS-REFS-MCP-V1',tool:'list_autorec_banks',environment:'production',captured_at:'2026-08-10T00:00:00.000Z',source:{system:'WBS'},scope:{company:'COMPANY-A',currency:'USD'},record_count:1,content_sha256,cursor_next:null,etl_notice:'Snapshot comparison required',rows};
  const mapped=mapWbsMcpEnvelopeToInbound({envelope}).rows[0];
  assert.deepEqual({admission:mapped.admission,reconcile:mapped.can_reconcile,draft:mapped.can_create_draft,post:mapped.can_post},{admission:'CONTROL_EVIDENCE_ONLY',reconcile:false,draft:false,post:false});
  const control={scope:{company_key:'COMPANY-A',currency:'USD',period:'2026-08',bank_account_ref:'BANK-OP'},formula:{formula_id:'WBS-PB-ROW-SUM',version:'1',aggregation:'ROW_SUM'},totals:{quantity:'2',released_quantity:'0',pay_amount:'100',released_amount:'50',incurred_amount:'25',debit_amount:'0'},receipt:{hash:`sha256:${content_sha256}`,ref:'object://wbs/test/pb-control',version:'v1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'ES256',verified_on:'2026-08-10T00:00:00.000Z'}};
  assert.throws(()=>buildWbsAutoRecBankControlEvidence({envelope,control}),error=>error instanceof WbsMcpLineageError&&error.code==='WBS_MCP_CONTROL_TOTALS_INVALID');
});

test('only a same-key result row can supply AutoRec Detail posting-date evidence',()=>{
  const physical={pd_guid:'DETAIL-RESULT-001',pd_biz_type:'WB',pd_payment:'100.0000',pd_deposit:'0',pd_incurred_date:'2026-08-01',pd_status:'INCURRED'};
  const row=mergeWbsReadonlyResultEvidence({sourceTable:'wbsdata.fast_auto_payment_detail',scope,row:physical,resultRow:{pd_guid:'DETAIL-RESULT-001',company_code:'COMPANY-A',currency:'USD',posting_date:'2026-08-02'}});
  assert.deepEqual({key:row.pd_guid,posting:row.posting_date,source:row.posting_date_source},{key:'DETAIL-RESULT-001',posting:'2026-08-02',source:'SIGNED_RESULT_ROW'});
  const rows=[row],content_sha256=canonicalRequestHash(rows).slice(7);
  const envelope={contract_version:'WBS-REFS-MCP-V1',tool:'list_autorec_details',environment:'production',captured_at:'2026-08-10T00:00:00.000Z',source:{system:'WBS'},scope:{company:'COMPANY-A',currency:'USD'},record_count:1,content_sha256,cursor_next:null,etl_notice:'Snapshot comparison required',rows};
  const conventions=[{scope:{company_key:'COMPANY-A',currency:'USD'},receipt:{hash:`sha256:${content_sha256}`,ref:'object://wbs/test/detail-receipt',version:'v1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'ES256',verified_on:'2026-08-10T00:00:00.000Z'},rule_id:'WBS-AUTOREC-DR-1',version:'1',biz_type:'WB',deposit_direction:'CREDIT',payment_direction:'DEBIT',business_date_field:'incurred_date'}];
  assert.equal(mapWbsMcpEnvelopeToInbound({envelope,autoRecDetailDirectionConventions:conventions}).rows[0].admission,'AUTOREC_REVIEW_EVIDENCE');
  assert.throws(()=>mergeWbsReadonlyResultEvidence({sourceTable:'wbsdata.fast_auto_payment_detail',scope,row:physical,resultRow:{pd_guid:'OTHER-DETAIL',posting_date:'2026-08-02'}}),error=>error instanceof WbsProviderReadonlyRowAdapterError&&error.code==='WBS_PROVIDER_RESULT_KEY_MISMATCH');
});

test('only a same-key canonical result field can supply AutoRec Bank released quantity',()=>{
  const physical={PB_GuId:'PB-RESULT-001',PB_CompanyCode:'COMPANY-A',PB_AhId:'BANK-OP',PB_Quantity:'2',PB_PayAmount:'100.0000',PB_DebitAmount:'0',PB_Released:'50.0000',PB_Incurred:'25.0000'};
  const row=mergeWbsReadonlyResultEvidence({sourceTable:'wbsdata.autopaymentbank',scope,row:physical,resultRow:{pb_guid:'PB-RESULT-001',company_code:'COMPANY-A',currency:'USD',released_quantity:'1'}});
  assert.deepEqual({key:row.pb_guid,quantity:row.released_quantity,source:row.released_quantity_source},{key:'PB-RESULT-001',quantity:'1',source:'SIGNED_RESULT_ROW'});
  assert.throws(()=>mergeWbsReadonlyResultEvidence({sourceTable:'wbsdata.autopaymentbank',scope,row:physical,resultRow:{pb_guid:'PB-RESULT-001',released_quantity:'NaN'}}),error=>error instanceof WbsProviderReadonlyRowAdapterError&&error.code==='WBS_PROVIDER_RESULT_FIELD_REQUIRED');
});

test('physical AutoRec Detail reaches a case-scoped review row only through a signed pd_guid-to-pb_guid relation',async()=>{
  const snapshotToken='physical-case-snapshot-1',captured='2026-08-10T00:00:00.000Z',pdGuid='44444444-4444-4444-8444-444444444444',pbGuid='55555555-5555-4555-8555-555555555555';
  const detailRow=mergeWbsReadonlyResultEvidence({sourceTable:'wbsdata.fast_auto_payment_detail',scope,row:{pd_guid:pdGuid,pd_pvguid:'NAVIGATION-ONLY',pd_cbid:'CB-NAVIGATION',pd_biz_type:'WB',pd_payment:'100.0000',pd_deposit:'0',pd_incurred_date:'2026-08-01',pd_status:'INCURRED',pd_vendor_no:'V-1',pd_pjguid:'P-1',pd_cost_code:'C-1',pd_memo:'Masked memo'},resultRow:{pd_guid:pdGuid,company_code:'COMPANY-A',currency:'USD',posting_date:'2026-08-02'}});
  const bankRow=mergeWbsReadonlyResultEvidence({sourceTable:'wbsdata.autopaymentbank',scope,row:{PB_GuId:pbGuid,PB_CompanyCode:'COMPANY-A',PB_AhId:'BANK-OP',PB_Quantity:'1',PB_PayAmount:'100.0000',PB_DebitAmount:'0',PB_Released:'0',PB_Incurred:'0'},resultRow:{pb_guid:pbGuid,company_code:'COMPANY-A',currency:'USD',released_quantity:'0'}});
  const buildEnvelope=(tool,rows,extraScope={})=>({contract_version:'WBS-REFS-MCP-V1',tool,environment:'production',captured_at:captured,source:{system:'WBS'},scope:{company:'COMPANY-A',currency:'USD',snapshot_token:snapshotToken,...extraScope},record_count:rows.length,content_sha256:canonicalRequestHash(rows).slice(7),cursor_next:null,etl_notice:'Snapshot comparison required',rows});
  const detail=buildEnvelope('list_autorec_details',[detailRow]),bank=buildEnvelope('list_autorec_banks',[bankRow]);
  const trace=buildEnvelope('trace_by_key',[{relation_id:'detail-case-1',relation_type:'DETAIL_TO_CASE',source_key_type:'pd_guid',source_key_value:pdGuid,related_key_type:'pb_guid',related_key_value:pbGuid}],{trace_key_type:'pd_guid',trace_key_value:pdGuid});
  const detailConventions=[{scope:{company_key:'COMPANY-A',currency:'USD'},receipt:{hash:`sha256:${detail.content_sha256}`,ref:'object://wbs/test/detail-case',version:'v1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'ES256',verified_on:captured},rule_id:'WBS-AUTOREC-DR-1',version:'1',biz_type:'WB',deposit_direction:'CREDIT',payment_direction:'DEBIT',business_date_field:'incurred_date'}];
  const policy={status:'APPROVED',mapping_type:'WBS_AUTOREC_DETAIL_CASE_RELATION',policy_id:'detail-case-policy-1',version:'1',snapshot_hash:'sha256:'+'a'.repeat(64),relation_type:'DETAIL_TO_CASE',scope:{company_key:'COMPANY-A',currency:'USD'}};
  const binding=buildWbsAutoRecDetailCaseBinding({detailEnvelope:detail,bankEnvelope:bank,traceEnvelope:trace,lookup:{key_type:'pd_guid',key_value:pdGuid},relationPolicy:policy});
  const snapshot=buildWbsMcpReadonlySnapshot({envelopes:[detail],snapshotId:'66666666-6666-4666-8666-666666666666',dictionaryVersion:'WBS-MCP-V1',autoRecDetailDirectionConventions:detailConventions,autoRecDetailCaseBindings:[binding]});
  const prepared=await createWbsInboundDataAdapter({snapshotReader:{readOnly:true,readSnapshot:async()=>snapshot}}).pull();
  assert.deepEqual({staging:prepared.staging.length,exceptions:prepared.exceptions.length,pb:prepared.staging[0].raw_trace.pb_guid,bank:prepared.staging[0].raw_trace.bank_account_ref},{staging:1,exceptions:0,pb:pbGuid,bank:'BANK-OP'});
  assert.equal(prepared.staging[0].raw_trace.external_trace.autoc_relation_ref,'NAVIGATION-ONLY');
});

test('physical Payable and Bank Journal rows can reach one receipt-bound AutoRec review proposal without a release or JE command',async()=>{
  const captured='2026-08-10T00:00:00.000Z';
  const payableRow=mapWbsReadonlyProviderRow({sourceTable:'wbsdata.account_book_payable_info',scope,row:{uuid:'77777777-7777-4777-8777-777777777777',company_code:'COMPANY-A',type:'AUTOC',amount:'100.0000',incurred_date:'2026-08-01',posting_date:'2026-08-02',vendor_no:'V-1',project_code:'P-1',cost_id:'C-1'}});
  const bankRow=mapWbsReadonlyProviderRow({sourceTable:'accounting.bank_transaction_result',scope,row:{cb_id:'88888888-8888-4888-8888-888888888888',company_code:'COMPANY-A',account_code:'BANK-OP',debtor:'0',lender:'100.0000',set_date:'2026-08-01',posting_date:'2026-08-02',payee_no:'V-1',ref_no:'DISPLAY-ONLY'}});
  const envelope=(tool,rows)=>({contract_version:'WBS-REFS-MCP-V1',tool,environment:'production',captured_at:captured,source:{system:'WBS'},scope:{company:'COMPANY-A',currency:'USD'},record_count:rows.length,content_sha256:canonicalRequestHash(rows).slice(7),cursor_next:null,etl_notice:'Snapshot comparison required',rows});
  const payable=envelope('list_payables',[payableRow]),bank=envelope('list_bank_transactions',[bankRow]);
  const receipt=(body,ref)=>({hash:`sha256:${body.content_sha256}`,ref,version:'v1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'ES256',verified_on:captured});
  const snapshot=buildWbsMcpReadonlySnapshot({
    envelopes:[payable,bank],snapshotId:'99999999-9999-4999-8999-999999999999',dictionaryVersion:'WBS-MCP-V1',
    payableDirectionConventions:[{scope:{company_key:'COMPANY-A',currency:'USD'},receipt:receipt(payable,'object://wbs/test/payable-review'),rule_id:'payable-dr',version:'1',ap_type:'AUTOC',direction:'DEBIT'}],
    bankDirectionConventions:[{scope:{company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-OP'},receipt:receipt(bank,'object://wbs/test/bank-review'),rule_id:'bank-cr',version:'1',debtor_direction:'DEBIT',lender_direction:'CREDIT'}]
  });
  const prepared=await createWbsInboundDataAdapter({snapshotReader:{readOnly:true,readSnapshot:async()=>snapshot}}).pull();
  assert.deepEqual({staging:prepared.staging.length,exceptions:prepared.exceptions.length},{staging:2,exceptions:0});
  const raw=type=>prepared.staging.find(item=>item.raw_trace.source_type===type).raw_trace;
  const payableRelation={relation_type:'PAYABLE_TO_BANK_REVIEW',source_key:payableRow.ap_guid,bank_account_ref:'BANK-OP'};
  const bankRelation={relation_type:'BANK_TO_PAYABLE_REVIEW',source_key:bankRow.cb_id,bank_account_ref:'BANK-OP'};
  const payableTrace={...raw('PAYABLE'),stage:'STAGING_REVIEWED',receipt_id:'receipt-pay',receipt_ref:'object://refs/receipt/pay',receipt_hash:'sha256:'+'1'.repeat(64),upstream_mcp_snapshot_token:'physical-review-snapshot',staging_item_id:'stg-pay',raw_event_id:'raw-pay',source_document_id:'doc-pay',bill_no:payableRow.ap_guid,project_ref:'P-1',project_code:'P-1',account_before:'600000',account_after:'291001',review_event_id:'review-pay',bank_account_ref:'BANK-OP',external_trace:payableRelation,external_trace_hash:canonicalRequestHash(payableRelation)};
  const bankTrace={...raw('BANK_TRANSACTION'),stage:'STAGING_REVIEWED',receipt_id:'receipt-bank',receipt_ref:'object://refs/receipt/bank',receipt_hash:'sha256:'+'2'.repeat(64),upstream_mcp_snapshot_token:'physical-review-snapshot',staging_item_id:'stg-bank',raw_event_id:'raw-bank',source_document_id:'doc-bank',journal_no:bankRow.cb_id,payee_no:'V-1',account_before:'111000',account_after:'291001',review_event_id:'review-bank',external_trace:bankRelation,external_trace_hash:canonicalRequestHash(bankRelation)};
  assert.throws(()=>buildAutoReconciliationReviewRequest({bankStaging:bankTrace,businessStaging:{...payableTrace,bank_account_ref:''},dateWindowDays:1,dateMatchBasis:'BUSINESS_AND_ACCOUNTING'}),error=>error.code==='WBS_AUTOREC_ELIGIBILITY_TRACE_REQUIRED');
  const review=buildAutoReconciliationReviewRequest({bankStaging:bankTrace,businessStaging:payableTrace,dateWindowDays:1,dateMatchBasis:'BUSINESS_AND_ACCOUNTING'});
  assert.deepEqual({status:review.status,amount:review.allocated_amount,release:review.can_release,post:review.can_post,bankKey:review.trace.bank_source_record_id,businessKey:review.trace.business_source_record_id},{status:'REVIEW_REQUIRED',amount:100,release:false,post:false,bankKey:bankRow.cb_id,businessKey:payableRow.ap_guid});
});
