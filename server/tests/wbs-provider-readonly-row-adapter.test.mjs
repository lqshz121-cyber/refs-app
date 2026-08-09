import test from 'node:test';
import assert from 'node:assert/strict';
import {mapWbsReadonlyProviderRow,WbsProviderReadonlyRowAdapterError} from '../runtime/wbs-provider-readonly-row-adapter.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {buildWbsMcpReadonlySnapshot,mapWbsMcpEnvelopeToInbound} from '../runtime/wbs-mcp-inbound-lineage.mjs';
import {createWbsInboundDataAdapter} from '../runtime/wbs-inbound-data-adapter.mjs';

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

test('row adapter fails closed for cross-company input and never derives a bank transaction id from journal keys',()=>{
  assert.throws(()=>mapWbsReadonlyProviderRow({sourceTable:'wbsdata.account_book_payable_info',scope,row:{uuid:'PAY-1',company_code:'COMPANY-B'}}),error=>error instanceof WbsProviderReadonlyRowAdapterError&&error.code==='WBS_PROVIDER_COMPANY_SCOPE_MISMATCH');
  assert.throws(()=>mapWbsReadonlyProviderRow({sourceTable:'accounting.bank_transaction_result',scope,row:{id:1,com_code:'COMPANY-A',cb_id:'CB-1'}}),error=>error instanceof WbsProviderReadonlyRowAdapterError&&error.code==='WBS_PROVIDER_STABLE_KEY_REQUIRED');
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
