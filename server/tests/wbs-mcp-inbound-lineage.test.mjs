import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {mapWbsMcpEnvelopeToInbound,planWbsMcpSnapshotDiff,WbsMcpLineageError} from '../runtime/wbs-mcp-inbound-lineage.mjs';

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
