import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {createWbsMcpInboundService,WbsMcpInboundServiceError} from '../runtime/wbs-mcp-inbound-service.mjs';

const raw=(tool,rows,capturedAt='2026-08-09T12:00:00.000Z')=>({tool_name:tool,contract_version:'WBS-REFS-MCP-V1',environment:'production',captured_at:capturedAt,source:{system:'WBS'},scope:{company:'COMPANY-A'},record_count:rows.length,content_sha256:canonicalRequestHash(rows).slice(7),cursor_next:null,etl_notice:'snapshot required',rows});
const values={
  list_payables:raw('list_payables',[{ap_guid:'11111111-1111-4111-8111-111111111111',company_code:'COMPANY-A',currency:'USD',amount:100,posting_date:'2026-08-09'}]),
  list_bank_transactions:raw('list_bank_transactions',[{cb_id:'BANK-1',company_code:'COMPANY-A',currency:'USD',account_code:'BANK-1',debtor:100,lender:0,set_date:'2026-08-09'}]),
  list_autorec_details:raw('list_autorec_details',[{pd_guid:'22222222-2222-4222-8222-222222222222',company_code:'COMPANY-A',currency:'USD',deposit:0,payment:100,incurred_date:'2026-08-09'}])
};
const args={list_payables:{company:'COMPANY-A'},list_bank_transactions:{company:'COMPANY-A'},list_autorec_details:{company:'COMPANY-A'}};

test('service reads only the three producer views and prepares a receipt-gated snapshot without accounting dispatch',async()=>{
  const calls=[],service=createWbsMcpInboundService({client:{readView:async request=>(calls.push(request),structuredClone(values[request.toolName]))}});
  const result=await service.pullTransactionSnapshot({companyKey:'COMPANY-A',argsByTool:args,snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1'});
  assert.deepEqual(calls.map(item=>item.toolName),['list_payables','list_bank_transactions','list_autorec_details']);assert.equal(result.snapshot.views.length,3);assert.deepEqual({persist:result.can_persist,draft:result.can_create_draft,post:result.can_post},{persist:false,draft:false,post:false});
});

test('scope mismatch, malformed selections, failed reads, or unequal capture times fail before a snapshot can be persisted',async()=>{
  const service=createWbsMcpInboundService({client:{readView:async({toolName})=>structuredClone(values[toolName])}});
  await assert.rejects(()=>service.pullTransactionSnapshot({companyKey:'COMPANY-B',argsByTool:args,snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1'}),error=>error instanceof WbsMcpInboundServiceError&&error.code==='WBS_MCP_RESPONSE_SCOPE_INVALID');
  await assert.rejects(()=>service.pullTransactionSnapshot({companyKey:'COMPANY-A',argsByTool:{list_payables:{}},snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1'}),error=>error.code==='WBS_MCP_SELECTION_REQUIRED');
  const failing=createWbsMcpInboundService({client:{readView:async()=>{throw new Error('network');}}});await assert.rejects(()=>failing.pullTransactionSnapshot({companyKey:'COMPANY-A',argsByTool:args,snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1'}),error=>error.code==='WBS_MCP_READ_FAILED');
  const unequal=createWbsMcpInboundService({client:{readView:async({toolName})=>toolName==='list_autorec_details'?raw(toolName,values[toolName].rows,'2026-08-09T12:01:00.000Z'):structuredClone(values[toolName])}});await assert.rejects(()=>unequal.pullTransactionSnapshot({companyKey:'COMPANY-A',argsByTool:args,snapshotId:'33333333-3333-4333-8333-333333333333',dictionaryVersion:'WBS-MCP-V1'}),error=>error.code==='WBS_MCP_SNAPSHOT_SCOPE_INVALID');
});

test('control and trace views are read separately and cannot enter a transaction path',async()=>{
  const control=raw('list_autorec_banks',[{pb_guid:'PB-1',company_code:'COMPANY-A',quantity:10,released_quantity:8,pay_amount:100,released:80,incurred:60}]);
  const calls=[],service=createWbsMcpInboundService({client:{readView:async request=>(calls.push(request),structuredClone(control))}});
  const result=await service.pullControlOrTraceEvidence({companyKey:'COMPANY-A',toolName:'list_autorec_banks',args:{company:'COMPANY-A'}});
  assert.deepEqual(calls.map(call=>call.toolName),['list_autorec_banks']);
  assert.deepEqual({status:result.status,admission:result.evidence.rows[0].admission,transaction:result.can_create_transaction,draft:result.can_create_draft,post:result.can_post},{status:'WBS_MCP_CONTROL_EVIDENCE_READY',admission:'CONTROL_EVIDENCE_ONLY',transaction:false,draft:false,post:false});
  await assert.rejects(()=>service.pullControlOrTraceEvidence({companyKey:'COMPANY-A',toolName:'list_payables',args:{company:'COMPANY-A'}}),error=>error.code==='WBS_MCP_CONTROL_SELECTION_REQUIRED');
});
