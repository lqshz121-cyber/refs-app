import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {buildWbsMcpReadonlySnapshot,mapWbsMcpEnvelopeToInbound,planWbsMcpSnapshotDiff,WbsMcpLineageError} from '../runtime/wbs-mcp-inbound-lineage.mjs';
import {createWbsInboundDataAdapter} from '../runtime/wbs-inbound-data-adapter.mjs';
import {validateWbsSnapshotPackage} from '../runtime/wbs-snapshot-package.mjs';

const envelope=(tool,rows,scope={company:'COMPANY-A'})=>({contract_version:'WBS-REFS-MCP-V1',tool,environment:'production',captured_at:'2026-08-09T12:00:00.000Z',source:{system:'WBS'},scope,record_count:rows.length,content_sha256:canonicalRequestHash(rows).slice(7),cursor_next:null,etl_notice:'Snapshot comparison required',rows});

test('formal WBS Payable, Bank Journal, and AutoRec detail envelopes map to read-only typed lineage',()=>{
  const payable=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_payables',[{ap_guid:'A-1',company_code:'COMPANY-A',currency:'USD',amount:'100',posting_date:'2026-08-01',vendor_no:'V-1'}])});
  assert.equal(payable.rows[0].admission,'TRANSACTION_CANDIDATE');assert.equal(payable.rows[0].receipt_required_for_persistence,undefined);assert.equal(payable.rows[0].can_post,false);assert.equal(payable.receipt_required_for_persistence,true);
  const bank=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',currency:'USD',account_code:'BANK-1',debtor:'100',lender:'0'}])});
  assert.deepEqual({direction:bank.rows[0].direction,amount:bank.rows[0].amount,post:bank.rows[0].can_post},{direction:'DEBIT',amount:-100,post:false});
  const detail=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_autorec_details',[{pd_guid:'D-1',company_code:'COMPANY-A',currency:'USD',deposit:'0',payment:'100',cb_id:'B-1',pd_pv_guid:'PB-1'}])});
  assert.equal(detail.rows[0].admission,'AUTOREC_REVIEW_EVIDENCE');assert.equal(detail.rows[0].direction,'DEBIT');assert.equal(detail.rows[0].can_create_draft,false);
});

test('MCP direction ambiguity becomes an exception and report/control views cannot become transactions',()=>{
  const ambiguous=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',currency:'USD',account_code:'BANK-1',debtor:'1',lender:'1'}])});
  assert.deepEqual({admission:ambiguous.rows[0].admission,code:ambiguous.rows[0].exception_code,draft:ambiguous.can_create_draft},{admission:'EXCEPTION_REVIEW_REQUIRED',code:'WBS_MCP_AMOUNT_DIRECTION_REQUIRED',draft:false});
  const control=mapWbsMcpEnvelopeToInbound({envelope:envelope('list_control_totals',[{company:'COMPANY-A',period:'2026-08',total_balance:'100'}])});
  assert.equal(control.rows[0].admission,'CONTROL_OR_TRACE_ONLY');assert.equal(control.rows[0].source_record_id,null);assert.equal(control.can_post,false);
});

test('snapshot diff is scope-bound and never treats a missing row as a deletion without a provider tombstone',()=>{
  const previous=envelope('list_payables',[{ap_guid:'A-1',currency:'USD'},{ap_guid:'A-2',currency:'USD'}]);
  const current=envelope('list_payables',[{ap_guid:'A-1',currency:'USD'}]);
  const plan=planWbsMcpSnapshotDiff({previous,current});
  assert.deepEqual(plan.changes.find(row=>row.stable_key==='A-2'),{stable_key:'A-2',kind:'ABSENT_UNCONFIRMED',requires_recheck:true,can_delete:false});
  assert.throws(()=>planWbsMcpSnapshotDiff({previous,current:envelope('list_payables',[{ap_guid:'A-1',currency:'USD'}],{company:'COMPANY-B'})}),error=>error instanceof WbsMcpLineageError&&error.code==='WBS_MCP_SNAPSHOT_SCOPE_MISMATCH');
  assert.throws(()=>planWbsMcpSnapshotDiff({current:envelope('list_payables',[{ap_guid:'B-2',currency:'USD'},{ap_guid:'A-1',currency:'USD'}])}),error=>error instanceof WbsMcpLineageError&&error.code==='WBS_MCP_ROWS_NOT_SORTED');
});

test('formal MCP transaction views enter the existing Raw/Normalized/Staging adapter with upstream receipt provenance',async()=>{
  const payable=envelope('list_payables',[{ap_guid:'11111111-1111-4111-8111-111111111111',company_code:'COMPANY-A',currency:'USD',amount:'100',posting_date:'2026-08-09'}]);
  const bank=envelope('list_bank_transactions',[{cb_id:'B-1',company_code:'COMPANY-A',currency:'USD',account_code:'BANK-1',debtor:'100',lender:'0',set_date:'2026-08-09'}]);
  const detail=envelope('list_autorec_details',[{pd_guid:'22222222-2222-4222-8222-222222222222',company_code:'COMPANY-A',currency:'USD',deposit:'0',payment:'100',pd_pv_guid:'RELATION-ONLY',incurred_date:'2026-08-09'}]);
  const snapshot=buildWbsMcpReadonlySnapshot({envelopes:[payable,bank,detail],snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1'});
  const result=await createWbsInboundDataAdapter({snapshotReader:{readOnly:true,readSnapshot:async()=>snapshot}}).pull();
  assert.equal(result.raw.length,3);assert.equal(result.staging.length,2);assert.equal(result.exceptions.length,1);
  const raw=result.staging.find(item=>item.raw_trace.source_type==='PAYABLE').raw_trace;
  assert.equal(raw.upstream_mcp_tool,'list_payables');assert.match(raw.upstream_mcp_content_hash,/^sha256:/);
  assert.equal(result.exceptions[0].raw_trace.source_type,'AUTOREC_PAYMENT_DETAIL');assert.match(result.exceptions[0].exception.message,/pbGuId/);
  assert.throws(()=>buildWbsMcpReadonlySnapshot({envelopes:[payable],snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1',environment:'PRODUCTION'}),error=>error.code==='WBS_MCP_SNAPSHOT_SIGNATURE_REQUIRED');
});

test('production MCP snapshot package carries per-view primary-key delivery evidence and excludes detached signature from its hash',()=>{
  const payable=envelope('list_payables',[{ap_guid:'11111111-1111-4111-8111-111111111111',company_code:'COMPANY-A',currency:'USD',amount:'100',posting_date:'2026-08-09'}]);
  const snapshot=buildWbsMcpReadonlySnapshot({envelopes:[payable],snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1',environment:'PRODUCTION',delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',extract_started_at:'2026-08-09T11:59:00.000Z',extract_completed_at:'2026-08-09T12:01:00.000Z',consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'},detachedSignature:{key_id:'WBS-PROD-1',algorithm:'Ed25519',value:'placeholder-signature'}});
  const receipt=validateWbsSnapshotPackage(snapshot);
  assert.equal(receipt.environment,'PRODUCTION');assert.equal(receipt.delivery_attestation.views[0].first_primary_key,'11111111-1111-4111-8111-111111111111');assert.equal(receipt.receipt_count,1);
});
