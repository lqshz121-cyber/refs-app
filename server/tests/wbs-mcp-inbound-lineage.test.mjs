import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {buildWbsMcpReadonlySnapshot,buildWbsAutoRecBankControlEvidence,mapWbsMcpEnvelopeToInbound,planWbsMcpSnapshotDiff,WbsMcpLineageError} from '../runtime/wbs-mcp-inbound-lineage.mjs';
import {createWbsInboundDataAdapter} from '../runtime/wbs-inbound-data-adapter.mjs';
import {validateWbsSnapshotPackage} from '../runtime/wbs-snapshot-package.mjs';

const envelope=(tool,rows,scope={company:'COMPANY-A'})=>{
  const materialized=tool==='list_bank_transactions'?rows.map((row,index)=>Object.hasOwn(row,'bank_transaction_id')?row:{...row,bank_transaction_id:`BANK-TX-${index+1}`}):rows;
  return {contract_version:'WBS-REFS-MCP-V1',tool,environment:'production',captured_at:'2026-08-09T12:00:00.000Z',source:{system:'WBS'},scope,record_count:materialized.length,content_sha256:canonicalRequestHash(materialized).slice(7),cursor_next:null,etl_notice:'Snapshot comparison required',rows:materialized};
};
const bankDirectionConventions=sourceEnvelope=>[{scope:{company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1'},receipt:{hash:`sha256:${sourceEnvelope.content_sha256}`,ref:'object://wbs/bank/receipt',version:'v1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'ES256',verified_on:'2026-08-09T12:00:00.000Z'},rule_id:'WBS-BANK-DR-1',version:'1',debtor_direction:'DEBIT',lender_direction:'CREDIT'}];
const payableDirectionConventions=sourceEnvelope=>[{scope:{company_key:'COMPANY-A',currency:'USD'},receipt:{hash:`sha256:${sourceEnvelope.content_sha256}`,ref:'object://wbs/payable/receipt',version:'v1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'ES256',verified_on:'2026-08-09T12:00:00.000Z'},rule_id:'WBS-PAYABLE-DR-1',version:'1',ap_type:'AUTOC',direction:'DEBIT'}];
const detailDirectionConventions=sourceEnvelope=>[{scope:{company_key:'COMPANY-A',currency:'USD'},receipt:{hash:`sha256:${sourceEnvelope.content_sha256}`,ref:'object://wbs/autorec/receipt',version:'v1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'ES256',verified_on:'2026-08-09T12:00:00.000Z'},rule_id:'WBS-AUTOREC-DR-1',version:'1',biz_type:'WB',deposit_direction:'CREDIT',payment_direction:'DEBIT',business_date_field:'incurred_date'}];

test('formal WBS Payable, Bank Journal, and AutoRec detail envelopes map to read-only typed lineage',()=>{
  const payableEnvelope=envelope('list_payables',[{ap_guid:'A-1',ap_type:'AUTOC',company_code:'COMPANY-A',currency:'USD',amount:'100',posting_date:'2026-08-01',vendor_no:'V-1',ap_long_id:'AP-LONG-1',source_detail_source:'PAYABLE',source_detail_type:'payable',source_detail_come_from:'EXPA',match_status:'MATCHED',payable_no:'P-1',business_status:'PAID',pay_status:'CLEARED',pay_type:'ACH',status:'POSTED',account_code:'6000',account_code_name:'Expense',invoice_no:'I-1',invoice_description:'Invoice',invoice_date:'2026-07-31',incurred_date:'2026-07-30',pay_due_date:'2026-08-15',rolling_date:'2026-08-04',journal_code:'AP',journal_no:'J-1',check_system:'CHECKS',check_no:'CHK-1',check_date:'2026-08-02',check_amount:'100',clear_date:'2026-08-03',cb_id:'CB-1',owner_code:'OWNER',owner_company:'OWNER CO',company_name:'Company A',division:'DIV',pj_code:'PROJECT',activity_no:'ACT',description:'Description',faster_yardi_code:'FAST',unit_code:'UNIT',cost_code:'COST',cost_name:'Cost Name',cost_account_name:'Cost Account',cost_state:'ACTIVE',create_mode:'AUTO',remarks:'Remark',bj_team_remarks:'Bank remark',aging:'CURRENT'}]);
  const payable=mapWbsMcpEnvelopeToInbound({envelope:payableEnvelope,payableDirectionConventions:payableDirectionConventions(payableEnvelope)});
  assert.equal(payable.rows[0].admission,'TRANSACTION_CANDIDATE');assert.equal(payable.rows[0].receipt_required_for_persistence,undefined);assert.equal(payable.rows[0].can_post,false);assert.equal(payable.receipt_required_for_persistence,true);assert.deepEqual(payable.optional_trace_fields,['source_detail_source','source_detail_type','source_detail_come_from']);
  assert.deepEqual(payable.rows[0].payable_trace,{ap_long_id:'AP-LONG-1',ap_type:'AUTOC',match_status:'MATCHED',payable_no:'P-1',business_status:'PAID',pay_status:'CLEARED',pay_type:'ACH',status:'POSTED',vendor_ref:'V-1',account_code:'6000',account_name:'Expense',invoice_no:'I-1',invoice_description:'Invoice',invoice_date:'2026-07-31',posting_date:'2026-08-01',incurred_date:'2026-07-30',pay_due_date:'2026-08-15',rolling_date:'2026-08-04',journal_code:'AP',journal_no:'J-1',check_system:'CHECKS',check_no:'CHK-1',check_date:'2026-08-02',check_amount:'100',clear_date:'2026-08-03',bank_relation_ref:'CB-1',owner_code:'OWNER',owner_company:'OWNER CO',company_code:'COMPANY-A',company_name:'Company A',division:'DIV',project_code:'PROJECT',activity_no:'ACT',description:'Description',faster_yardi_code:'FAST',unit_code:'UNIT',cost_code:'COST',cost_name:'Cost Name',cost_account_name:'Cost Account',cost_state:'ACTIVE',create_mode:'AUTO',remarks:'Remark',bj_team_remarks:'Bank remark',aging:'CURRENT'});assert.deepEqual(payable.rows[0].payable_source_detail,{observation:'RECEIPT_BOUND_DISPLAY_TRACE',source:'PAYABLE',source_type:'payable',come_from:'EXPA',long_id:'AP-LONG-1',missing:[],can_use_as_source_key:false,can_match:false,can_transition:false,can_post:false});assert.equal(payable.rows[0].can_use_trace_as_key,false);assert.equal(payable.rows[0].can_use_trace_as_posting_authority,false);
  const blockedPayable=mapWbsMcpEnvelopeToInbound({envelope:payableEnvelope});
  assert.deepEqual({admission:blockedPayable.rows[0].admission,code:blockedPayable.rows[0].exception_code,direction:blockedPayable.rows[0].direction},{admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_PAYABLE_DIRECTION_CONVENTION_REQUIRED',direction:null});
  const bankEnvelope=envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',currency:'USD',account_code:'BANK-1',account_name:'Operating Cash',debtor:'100',lender:'0',set_date:'2026-08-01',posting_date:'2026-08-01',payee:'Vendor A',payee_no:'V-1',description:'Bank memo',ref_no:'REF-1',deposit:'0',payment:'100',pj_code:'PROJECT',department:'DEPT',cost_code:'COST',brief_description:'Brief',invoice_receipt_evidence:'ATTACHMENT-1',user_ref:'USER-1',review:'REVIEWED',reviewer:'REVIEWER-1',comments_log_ref:'LOG-1',come_from:'AUTOC',child_come_from:'PAYABLE'}]);
  const bank=mapWbsMcpEnvelopeToInbound({envelope:bankEnvelope,bankDirectionConventions:bankDirectionConventions(bankEnvelope)});
  assert.deepEqual({direction:bank.rows[0].direction,amount:bank.rows[0].amount,post:bank.rows[0].can_post},{direction:'DEBIT',amount:-100,post:false});
  const blockedBank=mapWbsMcpEnvelopeToInbound({envelope:bankEnvelope});
  assert.deepEqual({admission:blockedBank.rows[0].admission,code:blockedBank.rows[0].exception_code,direction:blockedBank.rows[0].direction},{admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_BANK_DIRECTION_CONVENTION_REQUIRED',direction:null});
  assert.deepEqual(bank.rows[0].bank_trace,{transaction_date:'2026-08-01',posting_date:'2026-08-01',account_code:'BANK-1',account_name:'Operating Cash',payee:'Vendor A',payee_no:'V-1',memo:'Bank memo',ref_no:'REF-1',deposit:'0',payment:'100',project_code:'PROJECT',department:'DEPT',cost_code:'COST',brief_description:'Brief',invoice_receipt_evidence:'ATTACHMENT-1',user_ref:'USER-1',review_status:'REVIEWED',reviewer_ref:'REVIEWER-1',comments_log_ref:'LOG-1',come_from:'AUTOC',child_come_from:'PAYABLE'});assert.equal(bank.rows[0].can_use_trace_as_key,false);
  const detailEnvelope=envelope('list_autorec_details',[{pd_guid:'D-1',company_code:'COMPANY-A',currency:'USD',deposit:'0',payment:'100',cb_id:'B-1',pd_pv_guid:'PB-1',batch_guid:'BATCH-1',biz_type:'WB',clear_date:'2026-08-02',incurred_date:'2026-08-01',posting_date:'2026-08-01',released_date:'2026-08-01',released_by:'USER-MASKED',status:'INCURRED',match_status:'MATCHED',match_guid:'MATCH-1',project_guid:'PROJECT-1',cost_code:'COST-1',vendor_no:'V-1'}]);
  const detail=mapWbsMcpEnvelopeToInbound({envelope:detailEnvelope,autoRecDetailDirectionConventions:detailDirectionConventions(detailEnvelope)});
  assert.equal(detail.rows[0].admission,'AUTOREC_REVIEW_EVIDENCE');assert.equal(detail.rows[0].direction,'DEBIT');assert.equal(detail.rows[0].can_create_draft,false);
  const blockedDetail=mapWbsMcpEnvelopeToInbound({envelope:detailEnvelope});
  assert.deepEqual({admission:blockedDetail.rows[0].admission,code:blockedDetail.rows[0].exception_code,direction:blockedDetail.rows[0].direction},{admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_AUTOREC_DIRECTION_CONVENTION_REQUIRED',direction:null});
  assert.deepEqual(detail.rows[0].autorc_detail_trace,{batch_guid:'BATCH-1',biz_type:'WB',clear_date:'2026-08-02',incurred_date:'2026-08-01',posting_date:'2026-08-01',released_date:'2026-08-01',released_by:'USER-MASKED',status:'INCURRED',match_status:'MATCHED',match_ref:'MATCH-1',bank_relation_ref:'B-1',autoc_relation_ref:'PB-1',vendor_ref:'V-1',project_ref:'PROJECT-1',cost_code_ref:'COST-1'});assert.equal(detail.rows[0].can_use_trace_as_state_authority,false);assert.equal(detail.rows[0].can_use_trace_as_posting_authority,false);
});

test('observed Payable source-detail routes remain unbound trace when the provider did not supply all relation labels',()=>{
  const payableEnvelope=envelope('list_payables',[{ap_guid:'A-TRACE',ap_type:'AUTOC',company_code:'COMPANY-A',currency:'USD',amount:'100',posting_date:'2026-08-01',ap_long_id:'AP-LONG-TRACE'}]);
  const row=mapWbsMcpEnvelopeToInbound({envelope:payableEnvelope,payableDirectionConventions:payableDirectionConventions(payableEnvelope)}).rows[0];
  assert.deepEqual(row.payable_source_detail,{observation:'PAGE_OBSERVED_UNBOUND_TRACE',source:null,source_type:null,come_from:null,long_id:'AP-LONG-TRACE',missing:['source','source_type','come_from'],can_use_as_source_key:false,can_match:false,can_transition:false,can_post:false});
});

test('MCP direction ambiguity becomes an exception and report/control views cannot become transactions',()=>{
  const ambiguousEnvelope=envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',currency:'USD',account_code:'BANK-1',debtor:'1',lender:'1',set_date:'2026-08-01',posting_date:'2026-08-01'}]);
  const ambiguous=mapWbsMcpEnvelopeToInbound({envelope:ambiguousEnvelope,bankDirectionConventions:bankDirectionConventions(ambiguousEnvelope)});
  assert.deepEqual({admission:ambiguous.rows[0].admission,code:ambiguous.rows[0].exception_code,draft:ambiguous.can_create_draft},{admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_AMOUNT_DIRECTION_REQUIRED',draft:false});
  const control=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_control_totals',[{company:'COMPANY-A',period:'2026-08',total_balance:'100'}])});
  assert.equal(control.rows[0].admission,'CONTROL_OR_TRACE_ONLY');assert.equal(control.rows[0].source_record_id,null);assert.equal(control.can_post,false);
});

test('Bank Journal cb_id remains a relation locator and cannot substitute for a bank transaction key',()=>{
  const missingKey=envelope('list_bank_transactions',[{bank_transaction_id:'',cb_id:'RELATION-ONLY',company_code:'COMPANY-A',currency:'USD',account_code:'BANK-1',debtor:'100',lender:'0',set_date:'2026-08-01',posting_date:'2026-08-01'}]);
  assert.throws(()=>mapWbsMcpEnvelopeToInbound({envelope:missingKey}),error=>error.code==='WBS_MCP_ENVELOPE_INVALID');
});

test('AutoRec Detail requires exactly one nonzero Deposit or Payment before it can be review evidence',()=>{
  const detailEnvelope=envelope('list_autorec_details',[
    {pd_guid:'D-1',company_code:'COMPANY-A',currency:'USD',biz_type:'WB',deposit:'25',payment:'25',clear_date:'2026-08-01',posting_date:'2026-08-01'},
    {pd_guid:'D-2',company_code:'COMPANY-A',currency:'USD',biz_type:'WB',deposit:'0',payment:'0',clear_date:'2026-08-01',posting_date:'2026-08-01'}
  ]);
  const mapped=mapWbsMcpEnvelopeToInbound({envelope:detailEnvelope,autoRecDetailDirectionConventions:detailDirectionConventions(detailEnvelope)});
  assert.deepEqual(mapped.rows.map(row=>({admission:row.admission,code:row.exception_code,draft:row.can_create_draft,post:row.can_post})),[
    {admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_AMOUNT_DIRECTION_REQUIRED',draft:false,post:false},
    {admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_AMOUNT_DIRECTION_REQUIRED',draft:false,post:false}
  ]);
});

test('AutoRec Detail business date is receipt-bound and never falls back between Incurred and Clear Date',()=>{
  const detailEnvelope=envelope('list_autorec_details',[{pd_guid:'D-DATE',company_code:'COMPANY-A',currency:'USD',biz_type:'WB',deposit:'0',payment:'100',clear_date:'2026-08-02',posting_date:'2026-08-03'}]);
  const convention=detailDirectionConventions(detailEnvelope);
  const row=mapWbsMcpEnvelopeToInbound({envelope:detailEnvelope,autoRecDetailDirectionConventions:convention}).rows[0];
  assert.deepEqual({admission:row.admission,code:row.exception_code,missing:row.missing,businessDate:row.business_date},{admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_TRANSACTION_FIELDS_REQUIRED',missing:['business_date'],businessDate:null});
  const clearConvention=convention.map(item=>({...item,business_date_field:'clear_date'}));
  const clearRow=mapWbsMcpEnvelopeToInbound({envelope:detailEnvelope,autoRecDetailDirectionConventions:clearConvention}).rows[0];
  assert.deepEqual({admission:clearRow.admission,businessDate:clearRow.business_date,dateField:clearRow.autorc_direction_rule.business_date_field},{admission:'AUTOREC_REVIEW_EVIDENCE',businessDate:'2026-08-02',dateField:'clear_date'});
  assert.throws(()=>mapWbsMcpEnvelopeToInbound({envelope:detailEnvelope,autoRecDetailDirectionConventions:convention.map(item=>({...item,business_date_field:'posting_date'}))}),error=>error.code==='WBS_MCP_AUTOREC_DIRECTION_CONVENTION_INVALID');
});

test('a Payable snapshot preserves a missing Incurred Date as an exception instead of borrowing Posting Date',async()=>{
  const payableEnvelope=envelope('list_payables',[{ap_guid:'44444444-4444-4444-8444-444444444445',ap_type:'AUTOC',company_code:'COMPANY-A',currency:'USD',amount:'100',posting_date:'2026-08-03'}]);
  const snapshot=buildWbsMcpReadonlySnapshot({envelopes:[payableEnvelope],snapshotId:'44444444-4444-4444-8444-444444444444',dictionaryVersion:'WBS-MCP-V1',payableDirectionConventions:payableDirectionConventions(payableEnvelope)});
  const result=await createWbsInboundDataAdapter({snapshotReader:{readOnly:true,readSnapshot:async()=>snapshot}}).pull();
  assert.deepEqual({staging:result.staging.length,exceptions:result.exceptions.length,code:result.exceptions[0].exception.code,hasInvoiceDate:Object.hasOwn(result.exceptions[0].raw_trace,'invoice_date')},{staging:0,exceptions:1,code:'WBS_RECEIPT_FIELD_MISSING',hasInvoiceDate:false});
});

test('transaction candidates require exact company scope and all monetary admission facts',()=>{
  const incompleteEnvelope=envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',account_code:'BANK-1',debtor:'100',lender:'0',posting_date:'2026-08-01'}]);
  const incomplete=mapWbsMcpEnvelopeToInbound({envelope:incompleteEnvelope,bankDirectionConventions:bankDirectionConventions(incompleteEnvelope)});
  assert.equal(incomplete.rows[0].admission,'EXCEPTION_REVIEW_REQUIRED');
  assert.deepEqual(incomplete.rows[0].missing,['currency','business_date']);
  const payableWithoutPosting=envelope('list_payables',[{ap_guid:'A-POSTING',ap_type:'AUTOC',company_code:'COMPANY-A',currency:'USD',amount:'100',incurred_date:'2026-08-01'}]);
  const payableAdmission=mapWbsMcpEnvelopeToInbound({envelope:payableWithoutPosting,payableDirectionConventions:payableDirectionConventions(payableWithoutPosting)}).rows[0];
  assert.deepEqual({admission:payableAdmission.admission,code:payableAdmission.exception_code,missing:payableAdmission.missing},{admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_PAYABLE_POSTING_DATE_REQUIRED',missing:['posting_date']});
  const payableWithoutBusinessDate=envelope('list_payables',[{ap_guid:'A-BUSINESS',ap_type:'AUTOC',company_code:'COMPANY-A',currency:'USD',amount:'100',posting_date:'2026-08-01'}]);
  const payableBusinessAdmission=mapWbsMcpEnvelopeToInbound({envelope:payableWithoutBusinessDate,payableDirectionConventions:payableDirectionConventions(payableWithoutBusinessDate)}).rows[0];
  assert.deepEqual({admission:payableBusinessAdmission.admission,code:payableBusinessAdmission.exception_code,missing:payableBusinessAdmission.missing,businessDate:payableBusinessAdmission.business_date},{admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_TRANSACTION_FIELDS_REQUIRED',missing:['business_date'],businessDate:null});
  const bankWithoutPosting=envelope('list_bank_transactions',[{cb_id:'B-POSTING',company_code:'COMPANY-A',currency:'USD',account_code:'BANK-1',debtor:'100',lender:'0',set_date:'2026-08-01'}]);
  const bankAdmission=mapWbsMcpEnvelopeToInbound({envelope:bankWithoutPosting,bankDirectionConventions:bankDirectionConventions(bankWithoutPosting)}).rows[0];
  assert.deepEqual({admission:bankAdmission.admission,code:bankAdmission.exception_code,missing:bankAdmission.missing},{admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_BANK_POSTING_DATE_REQUIRED',missing:['posting_date']});
  const detailWithoutPosting=envelope('list_autorec_details',[{pd_guid:'D-POSTING',company_code:'COMPANY-A',currency:'USD',biz_type:'WB',deposit:'0',payment:'100',incurred_date:'2026-08-01'}]);
  const detailAdmission=mapWbsMcpEnvelopeToInbound({envelope:detailWithoutPosting,autoRecDetailDirectionConventions:detailDirectionConventions(detailWithoutPosting)}).rows[0];
  assert.deepEqual({admission:detailAdmission.admission,code:detailAdmission.exception_code,missing:detailAdmission.missing},{admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_AUTOREC_POSTING_DATE_REQUIRED',missing:['posting_date']});
  assert.throws(()=>mapWbsMcpEnvelopeToInbound({envelope:envelope('list_payables',[{ap_guid:'A-1',company_code:'COMPANY-B',currency:'USD',amount:'100',posting_date:'2026-08-01'}])}),error=>error.code==='WBS_MCP_ENVELOPE_SCOPE_MISMATCH');
});

test('a control-character Payable type is an Exception even before a direction convention can be applied',()=>{
  const payableEnvelope=envelope('list_payables',[{ap_guid:'A-TYPE-INVALID',ap_type:'\u0000',company_code:'COMPANY-A',currency:'USD',amount:'100',incurred_date:'2026-08-01',posting_date:'2026-08-01'}]);
  const mapped=mapWbsMcpEnvelopeToInbound({envelope:payableEnvelope});
  assert.deepEqual({admission:mapped.rows[0].admission,code:mapped.rows[0].exception_code,missing:mapped.rows[0].missing,draft:mapped.rows[0].can_create_draft,post:mapped.rows[0].can_post},{admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_PAYABLE_TYPE_INVALID',missing:['nonzero_amount','unambiguous_direction','ap_type'],draft:false,post:false});
  const forgedConvention=[{...payableDirectionConventions(payableEnvelope)[0],ap_type:'\u0000'}];
  assert.throws(()=>mapWbsMcpEnvelopeToInbound({envelope:payableEnvelope,payableDirectionConventions:forgedConvention}),error=>error.code==='WBS_MCP_PAYABLE_DIRECTION_CONVENTION_INVALID');
});

test('a validated scoped currency can supply a missing row currency but never override a mismatch',()=>{
  const bankEnvelope=envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',account_code:'BANK-1',debtor:'100',lender:'0',set_date:'2026-08-01',posting_date:'2026-08-01'}],{company:'COMPANY-A',currency:'USD'});
  const bank=mapWbsMcpEnvelopeToInbound({envelope:bankEnvelope,bankDirectionConventions:bankDirectionConventions(bankEnvelope)});
  assert.deepEqual({admission:bank.rows[0].admission,currency:bank.rows[0].currency},{admission:'TRANSACTION_CANDIDATE',currency:'USD'});
  assert.throws(()=>mapWbsMcpEnvelopeToInbound({envelope:envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',currency:'CAD',account_code:'BANK-1',debtor:'100',lender:'0',set_date:'2026-08-01',posting_date:'2026-08-01'}],{company:'COMPANY-A',currency:'USD'})}),error=>error.code==='WBS_MCP_ENVELOPE_SCOPE_MISMATCH');
});

test('AutoRec Bank summary remains receipt-bound observed control evidence',()=>{
  const summary=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_autorec_banks',[{pb_guid:'PB-1',company_code:'COMPANY-A',ah_id:'BANK-1',ah_name:'Operating',quantity:'10',released_quantity:'8',pay_amount:'100',released:'80',incurred:'60',debit_amount:'40',reconciliation_start_date:'2026-08-01',status:'OPEN'}])});
  const row=summary.rows[0];
  assert.deepEqual({admission:row.admission,controlType:row.control_type,semantics:row.control_semantics,quantity:row.quantity,released:row.released_amount,incurred:row.incurred_amount,reconcile:row.can_reconcile,post:row.can_post},{admission:'CONTROL_EVIDENCE_ONLY',controlType:'WBS_AUTOREC_BANK_SUMMARY',semantics:'OBSERVED_UNVERIFIED',quantity:10,released:80,incurred:60,reconcile:false,post:false});
  assert.match(row.receipt_hash,/^sha256:/);
});

test('AutoRec Bank control totals require a receipt-bound provider ROW_SUM formula and exact scope',()=>{
  const bankEnvelope=envelope('list_autorec_banks',[
    {pb_guid:'PB-1',company_code:'COMPANY-A',ah_id:'BANK-1',quantity:'1',released_quantity:'1',pay_amount:'100',released:'100',incurred:'80',debit_amount:'20'},
    {pb_guid:'PB-2',company_code:'COMPANY-A',ah_id:'BANK-1',quantity:'2',released_quantity:'1',pay_amount:'50',released:'50',incurred:'30',debit_amount:'10'}
  ],{company:'COMPANY-A',currency:'USD'});
  const control={scope:{company_key:'COMPANY-A',currency:'USD',period:'2026-08',bank_account_ref:'BANK-1'},receipt:{hash:`sha256:${bankEnvelope.content_sha256}`,ref:'object://wbs/autorec/PB',version:'v1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'ES256',verified_on:'2026-08-09T12:00:00.000Z'},formula:{formula_id:'WBS-PB-ROW-SUM',version:'1',aggregation:'ROW_SUM'},totals:{quantity:'3',released_quantity:'2',pay_amount:'150',released_amount:'150',incurred_amount:'110',debit_amount:'30'}};
  const result=buildWbsAutoRecBankControlEvidence({envelope:bankEnvelope,control});
  assert.deepEqual({status:result.status,pay:result.control_totals.pay_amount,post:result.can_post},{status:'CONTROL_EVIDENCE_READY',pay:150,post:false});
  assert.equal(result.reverse_trace.source_row_keys.length,2);
  assert.throws(()=>buildWbsAutoRecBankControlEvidence({envelope:bankEnvelope,control:{...control,formula:{...control.formula,aggregation:'UNSPECIFIED'}}}),error=>error.code==='WBS_MCP_CONTROL_FORMULA_REQUIRED');
  assert.throws(()=>buildWbsAutoRecBankControlEvidence({envelope:bankEnvelope,control:{...control,totals:{...control.totals,incurred_amount:'111'}}}),error=>error.code==='WBS_MCP_CONTROL_TOTALS_INVALID');
  assert.throws(()=>buildWbsAutoRecBankControlEvidence({envelope:bankEnvelope,control:{...control,receipt:{...control.receipt,hash:'sha256:'+'0'.repeat(64)}}}),error=>error.code==='WBS_MCP_CONTROL_RECEIPT_REQUIRED');
});

test('MCP blank, null, boolean, and display-style amounts never become zero control totals',()=>{
  const malformedValues=['', '  ', null, true, '0x10'];
  for(const invalidValue of malformedValues){
    const bankEnvelope=envelope('list_autorec_banks',[
      {pb_guid:'PB-1',company_code:'COMPANY-A',ah_id:'BANK-1',quantity:'1',released_quantity:'0',pay_amount:invalidValue,released:'0',incurred:'0',debit_amount:'0'}
    ],{company:'COMPANY-A',currency:'USD'});
    const control={scope:{company_key:'COMPANY-A',currency:'USD',period:'2026-08',bank_account_ref:'BANK-1'},receipt:{hash:`sha256:${bankEnvelope.content_sha256}`,ref:'object://wbs/autorec/PB',version:'v1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'ES256',verified_on:'2026-08-09T12:00:00.000Z'},formula:{formula_id:'WBS-PB-ROW-SUM',version:'1',aggregation:'ROW_SUM'},totals:{quantity:'1',released_quantity:'0',pay_amount:'0',released_amount:'0',incurred_amount:'0',debit_amount:'0'}};
    assert.throws(()=>buildWbsAutoRecBankControlEvidence({envelope:bankEnvelope,control}),error=>error.code==='WBS_MCP_CONTROL_TOTALS_INVALID');
  }
});

test('MCP monetary rows reject implicit JavaScript and over-precision amounts before they become transaction candidates',()=>{
  for(const invalidAmount of ['',true,'0x64','1e2','100.00001']){
    const payable=envelope('list_payables',[{ap_guid:'A-1',ap_type:'AUTOC',company_code:'COMPANY-A',currency:'USD',amount:invalidAmount,posting_date:'2026-08-09'}]);
    const result=mapWbsMcpEnvelopeToInbound({envelope:payable,payableDirectionConventions:payableDirectionConventions(payable)});
    assert.deepEqual({admission:result.rows[0].admission,amount:result.rows[0].amount},{admission:'EXCEPTION_REVIEW_REQUIRED',amount:null});
  }
});

test('WBS journal entries supply trace evidence but cannot create accounting transactions',()=>{
  const journals=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_journal_entries',[{id:91,company:'COMPANY-A',journal_no:'JE-100',posting_date:'2026-08-01',account:'291001',lender:'0',debtor:'100',cb_id:'BANK-1',bill_no:'AP-1',pj_code:'PROJECT-1',cost_code:'COST-1',come_from:'AUTOC',review:'REVIEWED',reviewer:'USER-MASKED'}])});
  const row=journals.rows[0];
  assert.deepEqual({admission:row.admission,type:row.trace_type,complete:row.trace_completeness,direction:row.direction,amount:row.amount,bank:row.bank_source_ref,payable:row.payable_ref,draft:row.can_create_draft,post:row.can_post},{admission:'TRACE_EVIDENCE_ONLY',type:'WBS_JOURNAL_LEDGER_EVIDENCE',complete:'TRACE_COMPLETE',direction:'DEBIT',amount:-100,bank:'BANK-1',payable:'AP-1',draft:false,post:false});
  assert.match(row.receipt_hash,/^sha256:/);
});

test('multiple journal lines sharing a cb_id remain separate trace evidence, never a bank transaction',()=>{
  const journals=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_journal_entries',[
    {id:91,company:'COMPANY-A',journal_no:'JE-100',posting_date:'2026-08-01',account:'291001',lender:'0',debtor:'100',cb_id:'BANK-1'},
    {id:92,company:'COMPANY-A',journal_no:'JE-100',posting_date:'2026-08-01',account:'600100',lender:'100',debtor:'0',cb_id:'BANK-1'}
  ])});
  assert.deepEqual(journals.rows.map(row=>({id:row.source_record_id,source:row.source_type,bank:row.bank_source_ref,admission:row.admission,draft:row.can_create_draft})),[
    {id:'91',source:'WBS_JOURNAL_EVIDENCE',bank:'BANK-1',admission:'TRACE_EVIDENCE_ONLY',draft:false},
    {id:'92',source:'WBS_JOURNAL_EVIDENCE',bank:'BANK-1',admission:'TRACE_EVIDENCE_ONLY',draft:false}
  ]);
});

test('snapshot diff is scope-bound and never treats a missing row as a deletion without a provider tombstone',()=>{
  const previous=envelope('list_payables',[{ap_guid:'A-1',currency:'USD'},{ap_guid:'A-2',currency:'USD'}]);
  const current=envelope('list_payables',[{ap_guid:'A-1',currency:'USD'}]);
  const plan=planWbsMcpSnapshotDiff({previous,current});
  assert.deepEqual(plan.changes.find(row=>row.stable_key==='A-2'),{stable_key:'A-2',kind:'ABSENT_UNCONFIRMED',requires_recheck:true,can_delete:false});
  assert.throws(()=>planWbsMcpSnapshotDiff({previous,current:envelope('list_payables',[{ap_guid:'A-1',currency:'USD'}],{company:'COMPANY-B'})}),error=>error instanceof WbsMcpLineageError&&error.code==='WBS_MCP_SNAPSHOT_SCOPE_MISMATCH');
  assert.throws(()=>planWbsMcpSnapshotDiff({current:envelope('list_payables',[{ap_guid:'B-2',currency:'USD'},{ap_guid:'A-1',currency:'USD'}])}),error=>error?.code==='WBS_MCP_ROWS_NOT_SORTED');
});

test('unchanged WBS source rows keep their observed version when another row changes the envelope receipt',()=>{
  const first=envelope('list_payables',[{ap_guid:'A-1',company_code:'COMPANY-A',currency:'USD',amount:'100',posting_date:'2026-08-01'}]);
  const second=envelope('list_payables',[{ap_guid:'A-1',company_code:'COMPANY-A',currency:'USD',amount:'100',posting_date:'2026-08-01'},{ap_guid:'A-2',company_code:'COMPANY-A',currency:'USD',amount:'200',posting_date:'2026-08-01'}]);
  const firstRow=mapWbsMcpEnvelopeToInbound({envelope:first}).rows[0];
  const unchanged=mapWbsMcpEnvelopeToInbound({envelope:second}).rows.find(row=>row.source_record_id==='A-1');
  assert.equal(firstRow.source_version,unchanged.source_version);
  assert.notEqual(firstRow.receipt_hash,unchanged.receipt_hash);
  assert.match(firstRow.source_version,/^observed:[0-9a-f]{64}$/);
});

test('formal MCP transaction views enter the existing Raw/Normalized/Staging adapter with upstream receipt provenance',async()=>{
  const scope={company:'COMPANY-A',snapshot_token:'snapshot-trace-1'};
  const payable=envelope('list_payables',[{ap_guid:'11111111-1111-4111-8111-111111111111',ap_type:'AUTOC',company_code:'COMPANY-A',currency:'USD',amount:'100',incurred_date:'2026-08-09',posting_date:'2026-08-09',journal_no:'J-1',check_no:'CHK-1',clear_date:'2026-08-10'}],scope);
  const bank=envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',currency:'USD',account_code:'BANK-1',debtor:'100',lender:'0',set_date:'2026-08-09',posting_date:'2026-08-09',payee:'Vendor A',description:'Bank memo',come_from:'AUTOC'}],scope);
  const detail=envelope('list_autorec_details',[{pd_guid:'22222222-2222-4222-8222-222222222222',company_code:'COMPANY-A',currency:'USD',biz_type:'WB',deposit:'0',payment:'100',pd_pv_guid:'RELATION-ONLY',batch_guid:'UNVERIFIED-BATCH-RELATION',incurred_date:'2026-08-09',posting_date:'2026-08-09',clear_date:'2026-08-10',status:'INCURRED',match_status:'MATCHED'}],scope);
  const snapshot=buildWbsMcpReadonlySnapshot({envelopes:[payable,bank,detail],snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1',bankDirectionConventions:bankDirectionConventions(bank),payableDirectionConventions:payableDirectionConventions(payable),autoRecDetailDirectionConventions:detailDirectionConventions(detail)});
  const result=await createWbsInboundDataAdapter({snapshotReader:{readOnly:true,readSnapshot:async()=>snapshot}}).pull();
  assert.equal(result.raw.length,3);assert.equal(result.staging.length,2);assert.equal(result.exceptions.length,1);
  const raw=result.staging.find(item=>item.raw_trace.source_type==='PAYABLE').raw_trace;
  assert.equal(raw.upstream_mcp_tool,'list_payables');assert.equal(raw.upstream_mcp_snapshot_token,'snapshot-trace-1');assert.match(raw.upstream_mcp_content_hash,/^sha256:/);
  assert.deepEqual(raw.external_trace,{ap_type:'AUTOC',posting_date:'2026-08-09',incurred_date:'2026-08-09',journal_no:'J-1',check_no:'CHK-1',clear_date:'2026-08-10',company_code:'COMPANY-A'});assert.equal(raw.can_use_trace_as_key,false);assert.equal(raw.can_use_trace_as_posting_authority,false);
  const bankRaw=result.staging.find(item=>item.raw_trace.source_type==='BANK_TRANSACTION').raw_trace;
  assert.deepEqual(bankRaw.external_trace,{transaction_date:'2026-08-09',posting_date:'2026-08-09',account_code:'BANK-1',payee:'Vendor A',memo:'Bank memo',come_from:'AUTOC'});assert.equal(bankRaw.can_use_trace_as_key,false);assert.equal(bankRaw.can_use_trace_as_posting_authority,false);
  const detailRaw=result.exceptions.find(item=>item.raw_trace.source_type==='AUTOREC_PAYMENT_DETAIL').raw_trace;
  assert.deepEqual(detailRaw.external_trace,{batch_guid:'UNVERIFIED-BATCH-RELATION',biz_type:'WB',clear_date:'2026-08-10',incurred_date:'2026-08-09',posting_date:'2026-08-09',status:'INCURRED',match_status:'MATCHED',autoc_relation_ref:'RELATION-ONLY'});assert.equal(detailRaw.can_use_trace_as_state_authority,false);assert.equal(detailRaw.can_use_trace_as_posting_authority,false);
  assert.equal(Object.hasOwn(detailRaw,'pbGuId'),false);
  assert.equal(result.exceptions[0].raw_trace.source_type,'AUTOREC_PAYMENT_DETAIL');assert.match(result.exceptions[0].exception.message,/pbGuId/);
  assert.throws(()=>buildWbsMcpReadonlySnapshot({envelopes:[payable,bank,detail],snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1',payableDirectionConventions:payableDirectionConventions(payable),autoRecDetailDirectionConventions:detailDirectionConventions(detail)}),error=>error.code==='WBS_MCP_BANK_DIRECTION_CONVENTION_REQUIRED');
  assert.throws(()=>buildWbsMcpReadonlySnapshot({envelopes:[payable],snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1',environment:'PRODUCTION',payableDirectionConventions:payableDirectionConventions(payable)}),error=>error.code==='WBS_MCP_SNAPSHOT_TOKEN_REQUIRED');
});

test('production MCP snapshot package carries per-view primary-key delivery evidence and excludes detached signature from its hash',()=>{
  const payable={...envelope('list_payables',[{ap_guid:'11111111-1111-4111-8111-111111111111',ap_type:'AUTOC',company_code:'COMPANY-A',currency:'USD',amount:'100',posting_date:'2026-08-09'}]),scope:{company:'COMPANY-A',snapshot_token:'snapshot-1'}};
  const delivery={mode:'SIGNED_SNAPSHOT_PACKAGE',snapshot_token:'snapshot-1',extract_started_at:'2026-08-09T11:59:00.000Z',extract_completed_at:'2026-08-09T12:01:00.000Z',consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'};
  const snapshot=buildWbsMcpReadonlySnapshot({envelopes:[payable],snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1',environment:'PRODUCTION',delivery,detachedSignature:{key_id:'WBS-PROD-1',algorithm:'Ed25519',value:'placeholder-signature'},payableDirectionConventions:payableDirectionConventions(payable)});
  const receipt=validateWbsSnapshotPackage(snapshot);
  assert.equal(receipt.environment,'PRODUCTION');assert.equal(receipt.delivery.snapshot_token,'snapshot-1');assert.equal(receipt.receipts[0].provider_snapshot_token,'snapshot-1');assert.equal(receipt.delivery_attestation.views[0].first_primary_key,'11111111-1111-4111-8111-111111111111');assert.equal(receipt.receipt_count,1);
  assert.throws(()=>buildWbsMcpReadonlySnapshot({envelopes:[payable],snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1',environment:'PRODUCTION',delivery:{...delivery,snapshot_token:'other'},detachedSignature:{key_id:'WBS-PROD-1',algorithm:'Ed25519',value:'placeholder-signature'},payableDirectionConventions:payableDirectionConventions(payable)}),error=>error.code==='WBS_MCP_SNAPSHOT_TOKEN_REQUIRED');
});
