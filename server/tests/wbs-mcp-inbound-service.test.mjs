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

test('AutoRec Bank control pull requires an exact provider formula and stays evidence-only',async()=>{
  const control=raw('list_autorec_banks',[{pb_guid:'PB-1',company_code:'COMPANY-A',ah_id:'BANK-1',quantity:10,released_quantity:8,pay_amount:100,released:80,incurred:60,debit_amount:40}]);
  const service=createWbsMcpInboundService({client:{readView:async()=>structuredClone(control)}});
  const attestation={scope:{company_key:'COMPANY-A',currency:'USD',period:'2026-08',bank_account_ref:'BANK-1'},receipt:{hash:`sha256:${control.content_sha256}`,ref:'object://wbs/pb/1',version:'v1',verification_id:'verify-1',key_id:'wbs-k1',algorithm:'ES256',verified_on:'2026-08-09T12:00:00.000Z'},formula:{formula_id:'WBS-PB-ROW-SUM',version:'1',aggregation:'ROW_SUM'},totals:{quantity:10,released_quantity:8,pay_amount:100,released_amount:80,incurred_amount:60,debit_amount:40}};
  const result=await service.pullAutoRecBankControlEvidence({companyKey:'COMPANY-A',args:{company:'COMPANY-A'},control:attestation});
  assert.deepEqual({status:result.status,amount:result.evidence.control_totals.pay_amount,release:result.can_release,post:result.can_post},{status:'WBS_MCP_AUTOREC_BANK_CONTROL_READY',amount:100,release:false,post:false});
  await assert.rejects(()=>service.pullAutoRecBankControlEvidence({companyKey:'COMPANY-A',args:{company:'COMPANY-A'},control:{...attestation,scope:{...attestation.scope,period:'2026-13'}}}),error=>error.code==='WBS_MCP_CONTROL_SCOPE_INVALID');
});

test('reverse trace lookup permits only a persisted immutable producer key and stays relation evidence',async()=>{
  const trace=raw('trace_by_key',[{relation_type:'AUTOC',relation_value:'masked'}]);
  const calls=[],identity={tenant_id:'tenant-1',entity_id:'entity-1',company_key:'COMPANY-A',source_type:'PAYABLE',source_record_id:'11111111-1111-4111-8111-111111111111',source_version:'observed:'+'a'.repeat(64),receipt_hash:'sha256:'+'b'.repeat(64)};
  const service=createWbsMcpInboundService({client:{readView:async request=>(calls.push(request),structuredClone(trace))},persistedSourceReader:{readOnly:true,getPersistedSource:async request=>({...identity,...request})}});
  const result=await service.pullTraceByPersistedSource({tenantId:'tenant-1',entityId:'entity-1',companyKey:'COMPANY-A',sourceType:'PAYABLE',sourceRecordId:'11111111-1111-4111-8111-111111111111',sourceVersion:'observed:'+'a'.repeat(64),receiptHash:'sha256:'+'b'.repeat(64)});
  assert.deepEqual(calls,[{toolName:'trace_by_key',args:{key_type:'ap_guid',key_value:'11111111-1111-4111-8111-111111111111'}}]);
  assert.deepEqual({status:result.status,tenant:result.lookup.tenant_id,source:result.lookup.source_record_id,key:result.lookup.wbs_key_type,relationKey:result.lookup.can_use_relation_as_key,post:result.can_post},{status:'WBS_MCP_REVERSE_TRACE_EVIDENCE_READY',tenant:'tenant-1',source:'11111111-1111-4111-8111-111111111111',key:'ap_guid',relationKey:false,post:false});
  await assert.rejects(()=>service.pullTraceByPersistedSource({tenantId:'tenant-1',entityId:'entity-1',companyKey:'COMPANY-A',sourceType:'PAYABLE',sourceRecordId:'REF-NO-ONLY',sourceVersion:'',receiptHash:'sha256:'+'b'.repeat(64)}),error=>error.code==='WBS_MCP_TRACE_SELECTION_REQUIRED');
  const missingReader=createWbsMcpInboundService({client:{readView:async()=>structuredClone(trace)}});
  await assert.rejects(()=>missingReader.pullTraceByPersistedSource({tenantId:'tenant-1',entityId:'entity-1',companyKey:'COMPANY-A',sourceType:'PAYABLE',sourceRecordId:'A-1',sourceVersion:'v1',receiptHash:'sha256:'+'b'.repeat(64)}),error=>error.code==='WBS_MCP_PERSISTED_SOURCE_READER_REQUIRED');
  const mismatch=createWbsMcpInboundService({client:{readView:async()=>structuredClone(trace)},persistedSourceReader:{readOnly:true,getPersistedSource:async()=>({...identity,entity_id:'other-entity'})}});
  await assert.rejects(()=>mismatch.pullTraceByPersistedSource({tenantId:'tenant-1',entityId:'entity-1',companyKey:'COMPANY-A',sourceType:'PAYABLE',sourceRecordId:identity.source_record_id,sourceVersion:identity.source_version,receiptHash:identity.receipt_hash}),error=>error.code==='WBS_MCP_PERSISTED_SOURCE_MISMATCH');
  const crossScope=createWbsMcpInboundService({client:{readView:async()=>structuredClone(trace)},persistedSourceReader:{readOnly:true,getPersistedSource:async request=>({...identity,...request})}});
  await assert.rejects(()=>crossScope.pullTraceByPersistedSource({tenantId:'tenant-1',entityId:'entity-1',companyKey:'COMPANY-B',sourceType:'PAYABLE',sourceRecordId:'A-1',sourceVersion:'v1',receiptHash:'sha256:'+'b'.repeat(64)}),error=>error.code==='WBS_MCP_RESPONSE_SCOPE_INVALID');
});
