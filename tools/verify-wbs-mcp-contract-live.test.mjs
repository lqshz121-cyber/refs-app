import assert from 'node:assert/strict';
import { sha256SortedCompact, verifyWbsMcpContractLive, WBS_MCP_TOOLS } from './verify-wbs-mcp-contract-live.mjs';

const stableKeys = {
  list_payables: ['ap_guid', 'AP-1'],
  list_bank_transactions: ['cb_id', 'CB-1'],
  list_autorec_details: ['pd_guid', 'PD-1'],
  list_autorec_banks: ['pb_guid', 'PB-1'],
  list_journal_entries: ['id', 1],
};

const tools = WBS_MCP_TOOLS.map(name => ({
  name,
  inputSchema: {type: 'object', properties: name.startsWith('list_') ? {limit:{type:'integer'}} : {}},
  annotations: {readOnlyHint:true, destructiveHint:false, idempotentHint:true},
}));

const environment = {
  WBS_MCP_ENDPOINT: 'https://refs-mcp.wbm3.com/mcp',
  WBS_CF_ACCESS_CLIENT_ID: 'not-logged-client-id',
  WBS_CF_ACCESS_CLIENT_SECRET: 'not-logged-client-secret',
  WBS_REFS_AUTH: 'not-logged-refs-auth',
};

const response = (payload, headers = {}) => ({
  ok: true,
  status: 200,
  headers: {get: name => headers[name.toLowerCase()] || (name.toLowerCase()==='content-type'?'application/json':null)},
  text: async () => payload === null ? '' : JSON.stringify(payload),
});

const requests = [];
const fetchImpl = async (_url, options) => {
  const request = JSON.parse(options.body);
  requests.push({request, options});
  if (request.method === 'initialize') return response({jsonrpc:'2.0',id:request.id,result:{protocolVersion:'2025-06-18',capabilities:{}}},{'mcp-session-id':'session-safe'});
  if (request.method === 'notifications/initialized') return response(null);
  if (request.method === 'tools/list') return response({jsonrpc:'2.0',id:request.id,result:{tools}});
  if (request.method === 'tools/call') {
    assert.deepEqual(request.params.arguments,{limit:1});
    const keySpec = stableKeys[request.params.name];
    const rows = keySpec ? [{[keySpec[0]]:keySpec[1], company_code:'TEST'}] : [{control_name:'AP_CONTROL',company_code:'TEST'}];
    const envelope = {
      contract_version:'0.1', tool:request.params.name, environment:'PRODUCTION', captured_at:'2026-08-05T00:00:00Z',
      source:{mode:'READ_ONLY'}, scope:{company_codes:['TEST'],date_range:null}, record_count:1,
      content_sha256:sha256SortedCompact(rows), cursor_next:null, etl_notice:'read only', rows,
    };
    return response({jsonrpc:'2.0',id:request.id,result:{content:[{type:'text',text:JSON.stringify(envelope)}]}});
  }
  throw new Error('unexpected request');
};

const logs=[];
const result = await verifyWbsMcpContractLive({environment,fetchImpl,log:value=>logs.push(value)});
assert.equal(result.ok,true);
assert.equal(result.toolCount,8);
assert.equal(result.samples.length,5);
assert.equal(requests.filter(row=>row.request.method==='tools/call').length,5);
assert.ok(requests.slice(1).every(row=>row.options.headers['mcp-session-id']==='session-safe'));
const output=logs.join('\n');
assert.doesNotMatch(output,/not-logged|AP-1|CB-1|PD-1|PB-1/,'sanitized output must not expose credentials or business row values');

await assert.rejects(
  verifyWbsMcpContractLive({environment:{...environment,WBS_MCP_ENDPOINT:'https://example.invalid/mcp'},fetchImpl,log:()=>{}}),
  error=>error?.code==='WBS_MCP_ENDPOINT_NOT_APPROVED',
  'credentials must never be sent to an unapproved endpoint',
);

const badFetch = async (_url, options) => {
  const request=JSON.parse(options.body);
  if(request.method==='initialize') return response({jsonrpc:'2.0',id:request.id,result:{protocolVersion:'2025-06-18'}},{'mcp-session-id':'safe'});
  if(request.method==='notifications/initialized') return response(null);
  if(request.method==='tools/list') return response({jsonrpc:'2.0',id:request.id,result:{tools:tools.filter(tool=>tool.name!=='trace_by_key')}});
  throw new Error('must fail before tool calls');
};
await assert.rejects(
  verifyWbsMcpContractLive({environment,fetchImpl:badFetch,log:()=>{}}),
  error=>error?.code==='WBS_MCP_TOOL_ALLOWLIST_MISMATCH',
);

console.log('WBS MCP live contract smoke verifier self-test passed.');
