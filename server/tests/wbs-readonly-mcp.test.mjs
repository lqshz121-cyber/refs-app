import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadOnlyWbsMcpClient,WbsMcpError,WBS_MCP_PROTOCOL_VERSION} from '../runtime/wbs-readonly-mcp.mjs';

const endpoint='https://db-mcp.wbm3.com/mcp';
const token=async()=>'test-access-token-that-is-never-logged';
const json=(body,{status=200,headers={}}={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const eventStream=(events,{status=200,headers={}}={})=>new Response(events.map(event=>`event: message\ndata: ${JSON.stringify(event)}\n\n`).join(''),{status,headers:{'content-type':'text/event-stream',...headers}});

test('read-only MCP client permits only the approved HTTPS endpoint and an authenticated token provider',()=>{
  for(const bad of ['http://db-mcp.wbm3.com/mcp','https://evil.example/mcp','https://db-mcp.wbm3.com/mcp?x=1','https://db-mcp.wbm3.com/other'])assert.throws(()=>createReadOnlyWbsMcpClient({endpoint:bad,getAccessToken:token}),error=>error.code==='WBS_MCP_CONFIG_INVALID');
  for(const timeoutMs of [0,999,60001,NaN])assert.throws(()=>createReadOnlyWbsMcpClient({endpoint,getAccessToken:token,timeoutMs}),error=>error.code==='WBS_MCP_CONFIG_INVALID');
});

test('initialize and tool inventory use MCP correlation, bearer auth and the session identifier without exposing a token',async()=>{
  const calls=[];
  const client=createReadOnlyWbsMcpClient({endpoint,getAccessToken:token,fetcher:async(_url,request)=>{calls.push(request);const body=JSON.parse(request.body);if(body.method==='initialize')return json({jsonrpc:'2.0',id:1,result:{protocolVersion:WBS_MCP_PROTOCOL_VERSION,serverInfo:{name:'WBS'}}},{headers:{'mcp-session-id':'session-12345678'}});return json({jsonrpc:'2.0',id:2,result:{tools:[]}});}});
  assert.deepEqual(await client.initialize(),{protocolVersion:WBS_MCP_PROTOCOL_VERSION,serverName:'WBS'});
  assert.deepEqual(await client.listTools(),[]);
  assert.equal(calls[0].headers.authorization,'Bearer test-access-token-that-is-never-logged');
  assert.equal(calls[1].headers['mcp-session-id'],'session-12345678');
  assert.equal(calls[0].headers['mcp-protocol-version'],WBS_MCP_PROTOCOL_VERSION);
});

test('client accepts one correlated JSON-RPC response from a bounded Streamable HTTP event stream',async()=>{
  const client=createReadOnlyWbsMcpClient({endpoint,getAccessToken:token,fetcher:async(_url,request)=>{const {id,method}=JSON.parse(request.body);return method==='initialize'?eventStream([{jsonrpc:'2.0',method:'notifications/progress',params:{}},{jsonrpc:'2.0',id,result:{protocolVersion:WBS_MCP_PROTOCOL_VERSION,serverInfo:{name:'WBS'}}}]):eventStream([{jsonrpc:'2.0',id,result:{tools:[]}}]);}});
  assert.deepEqual(await client.initialize(),{protocolVersion:WBS_MCP_PROTOCOL_VERSION,serverName:'WBS'});
  assert.deepEqual(await client.listTools(),[]);
  const ambiguous=createReadOnlyWbsMcpClient({endpoint,getAccessToken:token,fetcher:async(_url,request)=>{const {id}=JSON.parse(request.body);return eventStream([{jsonrpc:'2.0',id,result:{}},{jsonrpc:'2.0',id,result:{}}]);}});
  await assert.rejects(ambiguous.initialize(),error=>error.code==='WBS_MCP_PROTOCOL_INVALID');
  const oversized=createReadOnlyWbsMcpClient({endpoint,getAccessToken:token,fetcher:async(_url,request)=>{const {id}=JSON.parse(request.body);return eventStream([{jsonrpc:'2.0',id,result:{padding:'x'.repeat(1024*1024)}}]);}});
  await assert.rejects(oversized.initialize(),error=>error.code==='WBS_MCP_PROTOCOL_INVALID');
});

test('client fails closed on authentication and malformed protocol responses',async()=>{
  const unauthenticated=createReadOnlyWbsMcpClient({endpoint,getAccessToken:token,fetcher:async()=>json({error:'secret remote detail'},{status:401})});
  await assert.rejects(unauthenticated.initialize(),error=>error instanceof WbsMcpError&&error.code==='WBS_MCP_AUTHENTICATION_REQUIRED'&&!error.message.includes('secret'));
  const malformed=createReadOnlyWbsMcpClient({endpoint,getAccessToken:token,fetcher:async()=>json({jsonrpc:'2.0',id:999,result:{}})});
  await assert.rejects(malformed.initialize(),error=>error.code==='WBS_MCP_PROTOCOL_INVALID');
});

test('data reads require both a local allowlist and the remote read-only declaration',async()=>{
  let calls=0;
  const client=createReadOnlyWbsMcpClient({endpoint,getAccessToken:token,allowedReadTools:['wbs.payable.snapshot'],fetcher:async(_url,request)=>{calls++;const {id,method}=JSON.parse(request.body);if(method==='initialize')return json({jsonrpc:'2.0',id,result:{protocolVersion:WBS_MCP_PROTOCOL_VERSION}});if(method==='tools/list')return json({jsonrpc:'2.0',id,result:{tools:[{name:'wbs.payable.snapshot',annotations:{readOnlyHint:true},inputSchema:{type:'object'}},{name:'database.query',annotations:{readOnlyHint:false}}]}});return json({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'masked snapshot receipt'}]}});}});
  await client.initialize();await client.listTools();
  await assert.rejects(client.readView({toolName:'database.query',args:{}}),error=>error.code==='WBS_MCP_TOOL_FORBIDDEN');
  await assert.rejects(client.readView({toolName:'wbs.payable.snapshot',args:{sql:'select *'}}),error=>error.code==='WBS_MCP_ARGUMENTS_INVALID');
  const result=await client.readView({toolName:'wbs.payable.snapshot',args:{companyGuid:'11111111-1111-4111-8111-111111111111'}});
  assert.equal(result.content[0].text,'masked snapshot receipt');assert.equal(calls,3);
});
