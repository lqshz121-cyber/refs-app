import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {buildWbsMcpReadonlySnapshot,mapWbsMcpEnvelopeToInbound,planWbsMcpSnapshotDiff,WbsMcpLineageError} from '../runtime/wbs-mcp-inbound-lineage.mjs';
import {createWbsInboundDataAdapter} from '../runtime/wbs-inbound-data-adapter.mjs';
import {validateWbsSnapshotPackage} from '../runtime/wbs-snapshot-package.mjs';

const envelope=(tool,rows,scope={company:'COMPANY-A'})=>({contract_version:'WBS-REFS-MCP-V1',tool,environment:'production',captured_at:'2026-08-09T12:00:00.000Z',source:{system:'WBS'},scope,record_count:rows.length,content_sha256:canonicalRequestHash(rows).slice(7),cursor_next:null,etl_notice:'Snapshot comparison required',rows});

test('formal WBS Payable, Bank Journal, and AutoRec detail envelopes map to read-only typed lineage',()=>{
  const payable=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_payables',[{ap_guid:'A-1',company_code:'COMPANY-A',currency:'USD',amount:'100',posting_date:'2026-08-01',vendor_no:'V-1',ap_long_id:'AP-LONG-1',business_status:'PAID',pay_status:'CLEARED',pay_type:'ACH',journal_no:'J-1',check_no:'CHK-1',check_date:'2026-08-02',clear_date:'2026-08-03',cb_id:'CB-1'}])});
  assert.equal(payable.rows[0].admission,'TRANSACTION_CANDIDATE');assert.equal(payable.rows[0].receipt_required_for_persistence,undefined);assert.equal(payable.rows[0].can_post,false);assert.equal(payable.receipt_required_for_persistence,true);
  assert.deepEqual(payable.rows[0].payable_trace,{ap_long_id:'AP-LONG-1',business_status:'PAID',pay_status:'CLEARED',pay_type:'ACH',posting_date:'2026-08-01',journal_no:'J-1',check_no:'CHK-1',check_date:'2026-08-02',clear_date:'2026-08-03',bank_relation_ref:'CB-1'});assert.equal(payable.rows[0].can_use_trace_as_key,false);assert.equal(payable.rows[0].can_use_trace_as_posting_authority,false);
  const bank=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',currency:'USD',account_code:'BANK-1',debtor:'100',lender:'0',set_date:'2026-08-01',payee:'Vendor A',payee_no:'V-1',description:'Bank memo',come_from:'AUTOC',child_come_from:'PAYABLE',review:'REVIEWED'}])});
  assert.deepEqual({direction:bank.rows[0].direction,amount:bank.rows[0].amount,post:bank.rows[0].can_post},{direction:'DEBIT',amount:-100,post:false});
  assert.deepEqual(bank.rows[0].bank_trace,{transaction_date:'2026-08-01',account_code:'BANK-1',payee:'Vendor A',payee_no:'V-1',memo:'Bank memo',come_from:'AUTOC',child_come_from:'PAYABLE',review_status:'REVIEWED'});assert.equal(bank.rows[0].can_use_trace_as_key,false);
  const detail=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_autorec_details',[{pd_guid:'D-1',company_code:'COMPANY-A',currency:'USD',deposit:'0',payment:'100',cb_id:'B-1',pd_pv_guid:'PB-1',batch_guid:'BATCH-1',biz_type:'WB',clear_date:'2026-08-02',incurred_date:'2026-08-01',released_date:'2026-08-01',released_by:'USER-MASKED',status:'INCURRED',match_status:'MATCHED',match_guid:'MATCH-1',project_guid:'PROJECT-1',cost_code:'COST-1',vendor_no:'V-1'}])});
  assert.equal(detail.rows[0].admission,'AUTOREC_REVIEW_EVIDENCE');assert.equal(detail.rows[0].direction,'DEBIT');assert.equal(detail.rows[0].can_create_draft,false);
  assert.deepEqual(detail.rows[0].autorc_detail_trace,{batch_guid:'BATCH-1',biz_type:'WB',clear_date:'2026-08-02',incurred_date:'2026-08-01',released_date:'2026-08-01',released_by:'USER-MASKED',status:'INCURRED',match_status:'MATCHED',match_ref:'MATCH-1',bank_relation_ref:'B-1',autoc_relation_ref:'PB-1',vendor_ref:'V-1',project_ref:'PROJECT-1',cost_code_ref:'COST-1'});assert.equal(detail.rows[0].can_use_trace_as_state_authority,false);assert.equal(detail.rows[0].can_use_trace_as_posting_authority,false);
});

test('MCP direction ambiguity becomes an exception and report/control views cannot become transactions',()=>{
  const ambiguous=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',currency:'USD',account_code:'BANK-1',debtor:'1',lender:'1'}])});
  assert.deepEqual({admission:ambiguous.rows[0].admission,code:ambiguous.rows[0].exception_code,draft:ambiguous.can_create_draft},{admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_AMOUNT_DIRECTION_REQUIRED',draft:false});
  const control=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_control_totals',[{company:'COMPANY-A',period:'2026-08',total_balance:'100'}])});
  assert.equal(control.rows[0].admission,'CONTROL_OR_TRACE_ONLY');assert.equal(control.rows[0].source_record_id,null);assert.equal(control.can_post,false);
});

test('transaction candidates require exact company scope and all monetary admission facts',()=>{
  const incomplete=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',account_code:'BANK-1',debtor:'100',lender:'0'}])});
  assert.equal(incomplete.rows[0].admission,'EXCEPTION_REVIEW_REQUIRED');
  assert.deepEqual(incomplete.rows[0].missing,['currency','business_date']);
  assert.throws(()=>mapWbsMcpEnvelopeToInbound({envelope:envelope('list_payables',[{ap_guid:'A-1',company_code:'COMPANY-B',currency:'USD',amount:'100',posting_date:'2026-08-01'}])}),error=>error.code==='WBS_MCP_ENVELOPE_SCOPE_MISMATCH');
});

test('a validated scoped currency can supply a missing row currency but never override a mismatch',()=>{
  const bank=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',account_code:'BANK-1',debtor:'100',lender:'0',set_date:'2026-08-01'}],{company:'COMPANY-A',currency:'USD'})});
  assert.deepEqual({admission:bank.rows[0].admission,currency:bank.rows[0].currency},{admission:'TRANSACTION_CANDIDATE',currency:'USD'});
  assert.throws(()=>mapWbsMcpEnvelopeToInbound({envelope:envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',currency:'CAD',account_code:'BANK-1',debtor:'100',lender:'0',set_date:'2026-08-01'}],{company:'COMPANY-A',currency:'USD'})}),error=>error.code==='WBS_MCP_ENVELOPE_SCOPE_MISMATCH');
});

test('AutoRec Bank summary remains receipt-bound observed control evidence',()=>{
  const summary=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_autorec_banks',[{pb_guid:'PB-1',company_code:'COMPANY-A',ah_id:'BANK-1',ah_name:'Operating',quantity:'10',released_quantity:'8',pay_amount:'100',released:'80',incurred:'60',debit_amount:'40',reconciliation_start_date:'2026-08-01',status:'OPEN'}])});
  const row=summary.rows[0];
  assert.deepEqual({admission:row.admission,controlType:row.control_type,semantics:row.control_semantics,quantity:row.quantity,released:row.released_amount,incurred:row.incurred_amount,reconcile:row.can_reconcile,post:row.can_post},{admission:'CONTROL_EVIDENCE_ONLY',controlType:'WBS_AUTOREC_BANK_SUMMARY',semantics:'OBSERVED_UNVERIFIED',quantity:10,released:80,incurred:60,reconcile:false,post:false});
  assert.match(row.receipt_hash,/^sha256:/);
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
  assert.throws(()=>planWbsMcpSnapshotDiff({current:envelope('list_payables',[{ap_guid:'B-2',currency:'USD'},{ap_guid:'A-1',currency:'USD'}])}),error=>error instanceof WbsMcpLineageError&&error.code==='WBS_MCP_ROWS_NOT_SORTED');
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
  const payable=envelope('list_payables',[{ap_guid:'11111111-1111-4111-8111-111111111111',company_code:'COMPANY-A',currency:'USD',amount:'100',posting_date:'2026-08-09',journal_no:'J-1',check_no:'CHK-1',clear_date:'2026-08-10'}]);
  const bank=envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',currency:'USD',account_code:'BANK-1',debtor:'100',lender:'0',set_date:'2026-08-09',payee:'Vendor A',description:'Bank memo',come_from:'AUTOC'}]);
  const detail=envelope('list_autorec_details',[{pd_guid:'22222222-2222-4222-8222-222222222222',company_code:'COMPANY-A',currency:'USD',deposit:'0',payment:'100',pd_pv_guid:'RELATION-ONLY',batch_guid:'UNVERIFIED-BATCH-RELATION',incurred_date:'2026-08-09',clear_date:'2026-08-10',status:'INCURRED',match_status:'MATCHED'}]);
  const snapshot=buildWbsMcpReadonlySnapshot({envelopes:[payable,bank,detail],snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1'});
  const result=await createWbsInboundDataAdapter({snapshotReader:{readOnly:true,readSnapshot:async()=>snapshot}}).pull();
  assert.equal(result.raw.length,3);assert.equal(result.staging.length,2);assert.equal(result.exceptions.length,1);
  const raw=result.staging.find(item=>item.raw_trace.source_type==='PAYABLE').raw_trace;
  assert.equal(raw.upstream_mcp_tool,'list_payables');assert.match(raw.upstream_mcp_content_hash,/^sha256:/);
  assert.deepEqual(raw.external_trace,{posting_date:'2026-08-09',journal_no:'J-1',check_no:'CHK-1',clear_date:'2026-08-10'});assert.equal(raw.can_use_trace_as_key,false);assert.equal(raw.can_use_trace_as_posting_authority,false);
  const bankRaw=result.staging.find(item=>item.raw_trace.source_type==='BANK_TRANSACTION').raw_trace;
  assert.deepEqual(bankRaw.external_trace,{transaction_date:'2026-08-09',account_code:'BANK-1',payee:'Vendor A',memo:'Bank memo',come_from:'AUTOC'});assert.equal(bankRaw.can_use_trace_as_key,false);assert.equal(bankRaw.can_use_trace_as_posting_authority,false);
  const detailRaw=result.exceptions.find(item=>item.raw_trace.source_type==='AUTOREC_PAYMENT_DETAIL').raw_trace;
  assert.deepEqual(detailRaw.external_trace,{batch_guid:'UNVERIFIED-BATCH-RELATION',clear_date:'2026-08-10',incurred_date:'2026-08-09',status:'INCURRED',match_status:'MATCHED',autoc_relation_ref:'RELATION-ONLY'});assert.equal(detailRaw.can_use_trace_as_state_authority,false);assert.equal(detailRaw.can_use_trace_as_posting_authority,false);
  assert.equal(Object.hasOwn(detailRaw,'pbGuId'),false);
  assert.equal(result.exceptions[0].raw_trace.source_type,'AUTOREC_PAYMENT_DETAIL');assert.match(result.exceptions[0].exception.message,/pbGuId/);
  assert.throws(()=>buildWbsMcpReadonlySnapshot({envelopes:[payable],snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1',environment:'PRODUCTION'}),error=>error.code==='WBS_MCP_SNAPSHOT_SIGNATURE_REQUIRED');
});

test('production MCP snapshot package carries per-view primary-key delivery evidence and excludes detached signature from its hash',()=>{
  const payable=envelope('list_payables',[{ap_guid:'11111111-1111-4111-8111-111111111111',company_code:'COMPANY-A',currency:'USD',amount:'100',posting_date:'2026-08-09'}]);
  const snapshot=buildWbsMcpReadonlySnapshot({envelopes:[payable],snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1',environment:'PRODUCTION',delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',extract_started_at:'2026-08-09T11:59:00.000Z',extract_completed_at:'2026-08-09T12:01:00.000Z',consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'},detachedSignature:{key_id:'WBS-PROD-1',algorithm:'Ed25519',value:'placeholder-signature'}});
  const receipt=validateWbsSnapshotPackage(snapshot);
  assert.equal(receipt.environment,'PRODUCTION');assert.equal(receipt.delivery_attestation.views[0].first_primary_key,'11111111-1111-4111-8111-111111111111');assert.equal(receipt.receipt_count,1);
});
