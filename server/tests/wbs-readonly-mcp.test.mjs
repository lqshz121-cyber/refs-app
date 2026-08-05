import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {createReadOnlyWbsMcpClient,validateWbsReadEnvelope,WbsMcpError,WBS_MCP_PILOT_LIMIT,WBS_MCP_PROTOCOL_VERSION,WBS_READONLY_ROW_FIELDS,WBS_READONLY_TOOLS} from '../runtime/wbs-readonly-mcp.mjs';

const endpoint='https://refs-mcp.wbm3.com/mcp';
const auth=async()=>({'CF-Access-Client-Id':'test-client-id','CF-Access-Client-Secret':'test-client-secret','X-REFS-Auth':'test-refs-auth'});
const json=(body,{status=200,headers={}}={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const eventStream=(events,{status=200,headers={}}={})=>new Response(events.map(event=>`event: message\ndata: ${JSON.stringify(event)}\n\n`).join(''),{status,headers:{'content-type':'text/event-stream',...headers}});

test('read-only MCP client permits only the approved HTTPS endpoint and an injected credential-header provider',()=>{
  for(const bad of ['http://refs-mcp.wbm3.com/mcp','https://evil.example/mcp','https://refs-mcp.wbm3.com/mcp?x=1','https://refs-mcp.wbm3.com/other'])assert.throws(()=>createReadOnlyWbsMcpClient({endpoint:bad,getAuthHeaders:auth}),error=>error.code==='WBS_MCP_CONFIG_INVALID');
  for(const timeoutMs of [0,999,60001,NaN])assert.throws(()=>createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,timeoutMs}),error=>error.code==='WBS_MCP_CONFIG_INVALID');
  assert.throws(()=>createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,allowedReadTools:['database.query']}),error=>error.code==='WBS_MCP_CONFIG_INVALID');
});

test('initialize and tool inventory use MCP correlation, injected three-header auth and the session identifier',async()=>{
  const calls=[];
  const client=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:async(_url,request)=>{calls.push(request);const body=JSON.parse(request.body);if(body.method==='initialize')return json({jsonrpc:'2.0',id:1,result:{protocolVersion:WBS_MCP_PROTOCOL_VERSION,serverInfo:{name:'WBS'}}},{headers:{'mcp-session-id':'session-12345678'}});return json({jsonrpc:'2.0',id:2,result:{tools:[]}});}});
  assert.deepEqual(await client.initialize(),{protocolVersion:WBS_MCP_PROTOCOL_VERSION,serverName:'WBS'});
  assert.deepEqual(await client.listTools(),[]);
  assert.equal(calls[0].headers['CF-Access-Client-Id'],'test-client-id');assert.equal(calls[0].headers['CF-Access-Client-Secret'],'test-client-secret');assert.equal(calls[0].headers['X-REFS-Auth'],'test-refs-auth');assert.equal(calls[0].headers.authorization,undefined);
  assert.equal(calls[1].headers['mcp-session-id'],'session-12345678');
  assert.equal(calls[0].headers['mcp-protocol-version'],WBS_MCP_PROTOCOL_VERSION);
});

test('client accepts one correlated JSON-RPC response from a bounded Streamable HTTP event stream',async()=>{
  const client=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:async(_url,request)=>{const {id,method}=JSON.parse(request.body);return method==='initialize'?eventStream([{jsonrpc:'2.0',method:'notifications/progress',params:{}},{jsonrpc:'2.0',id,result:{protocolVersion:WBS_MCP_PROTOCOL_VERSION,serverInfo:{name:'WBS'}}}]):eventStream([{jsonrpc:'2.0',id,result:{tools:[]}}]);}});
  assert.deepEqual(await client.initialize(),{protocolVersion:WBS_MCP_PROTOCOL_VERSION,serverName:'WBS'});
  assert.deepEqual(await client.listTools(),[]);
  const ambiguous=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:async(_url,request)=>{const {id}=JSON.parse(request.body);return eventStream([{jsonrpc:'2.0',id,result:{}},{jsonrpc:'2.0',id,result:{}}]);}});
  await assert.rejects(ambiguous.initialize(),error=>error.code==='WBS_MCP_PROTOCOL_INVALID');
  const oversized=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:async(_url,request)=>{const {id}=JSON.parse(request.body);return eventStream([{jsonrpc:'2.0',id,result:{padding:'x'.repeat(1024*1024)}}]);}});
  await assert.rejects(oversized.initialize(),error=>error.code==='WBS_MCP_PROTOCOL_INVALID');
});

test('client fails closed on authentication and malformed protocol responses',async()=>{
  const unauthenticated=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:async()=>json({error:'secret remote detail'},{status:401})});
  await assert.rejects(unauthenticated.initialize(),error=>error instanceof WbsMcpError&&error.code==='WBS_MCP_AUTHENTICATION_REQUIRED'&&!error.message.includes('secret'));
  const malformed=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:async()=>json({jsonrpc:'2.0',id:999,result:{}})});
  await assert.rejects(malformed.initialize(),error=>error.code==='WBS_MCP_PROTOCOL_INVALID');
});

test('data reads require both a local allowlist and the remote read-only declaration',async()=>{
  let calls=0;
  const client=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,allowedReadTools:['list_payables'],fetcher:async(_url,request)=>{calls++;const {id,method}=JSON.parse(request.body);if(method==='initialize')return json({jsonrpc:'2.0',id,result:{protocolVersion:WBS_MCP_PROTOCOL_VERSION}});if(method==='tools/list')return json({jsonrpc:'2.0',id,result:{tools:[{name:'list_payables',annotations:{readOnlyHint:true},inputSchema:{type:'object'}},{name:'database.query',annotations:{readOnlyHint:false}}]}});return json({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'masked snapshot receipt'}]}});}});
  await client.initialize();await client.listTools();
  await assert.rejects(client.readView({toolName:'database.query',args:{}}),error=>error.code==='WBS_MCP_TOOL_FORBIDDEN');
  await assert.rejects(client.readView({toolName:'list_payables',args:{sql:'select *'}}),error=>error.code==='WBS_MCP_ARGUMENTS_INVALID');
  await assert.rejects(client.readView({toolName:'list_payables',args:{limit:WBS_MCP_PILOT_LIMIT+1}}),error=>error.code==='WBS_MCP_ARGUMENTS_INVALID');
  const result=await client.readView({toolName:'list_payables',args:{companyGuid:'11111111-1111-4111-8111-111111111111',limit:10}});
  assert.equal(result.content[0].text,'masked snapshot receipt');assert.equal(calls,3);
});

test('formal provider contract accepts only eight tools and uniform hash/cursor envelopes with stable keys',()=>{
  assert.deepEqual(WBS_READONLY_TOOLS,['get_meta','list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries','list_control_totals','trace_by_key']);
  assert(WBS_READONLY_ROW_FIELDS.list_payables.includes('ap_guid'));assert(WBS_READONLY_ROW_FIELDS.list_journal_entries.includes('id'));assert(WBS_READONLY_ROW_FIELDS.list_control_totals.includes('total_balance'));
  const rows=[{currency:'USD',ap_guid:'AP-1'}];
  const envelope={contract_version:'WBS-REFS-MCP-V1',tool:'list_payables',environment:'production',captured_at:'2026-08-05T12:00:00.000Z',source:{system:'WBS'},scope:{company:'COMPANY-A'},record_count:1,content_sha256:canonicalRequestHash(rows).slice('sha256:'.length),cursor_next:null,etl_notice:'Snapshot comparison required',rows};
  const accepted=validateWbsReadEnvelope({toolName:'list_payables',envelope});assert.equal(accepted.requires_snapshot_diff,true);assert.equal(accepted.has_revision_contract,false);
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_payables',envelope:{...envelope,rows:[{currency:'USD'}]}}),error=>error.code==='WBS_MCP_ENVELOPE_INVALID');
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_payables',envelope:{...envelope,content_sha256:'caller-value'}}),error=>error.code==='WBS_MCP_ENVELOPE_INVALID');
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_payables',envelope:{...envelope,rows:[{ap_guid:'AP-1',currency:'USD',amount:'1.00'}]}}),error=>error.code==='WBS_MCP_CONTENT_HASH_MISMATCH');
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_payables',envelope:{...envelope,rows:[{ap_guid:'AP-1',currency:'CAD'}]}}),error=>error.code==='WBS_MCP_CURRENCY_UNSUPPORTED');
});

test('pilot rejects a third concurrent request before credential or network access',async()=>{
  let release;const credentialGate=new Promise(resolve=>{release=resolve;});
  const client=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:()=>credentialGate,fetcher:async(_url,request)=>{const {id}=JSON.parse(request.body);return json({jsonrpc:'2.0',id,result:{protocolVersion:WBS_MCP_PROTOCOL_VERSION}});}});
  const first=client.initialize(),second=client.initialize();
  await assert.rejects(client.initialize(),error=>error.code==='WBS_MCP_CONCURRENCY_LIMIT');
  release(await auth());await Promise.all([first,second]);
});
