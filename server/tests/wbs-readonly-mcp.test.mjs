import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {createReadOnlyWbsMcpClient,validateWbsMcpCatalogPreflight,validateWbsReadEnvelope,verifyWbsMcpCatalogV2Evidence,wbsMcpCatalogSemanticHash,WbsMcpError,WBS_MCP_CATALOG_V2_REVIEWED_PINS,WBS_MCP_PRODUCTION_PAGE_LIMIT,WBS_MCP_PILOT_LIMIT,WBS_MCP_PROTOCOL_VERSION,WBS_READONLY_ROW_FIELDS,WBS_READONLY_OPTIONAL_TRACE_FIELDS,WBS_READONLY_TOOLS} from '../runtime/wbs-readonly-mcp.mjs';

const endpoint='https://refs-mcp.wbm3.com/mcp';
const auth=async()=>({'CF-Access-Client-Id':'test-client-id','CF-Access-Client-Secret':'test-client-secret','X-REFS-Auth':'test-refs-auth'});
const json=(body,{status=200,headers={}}={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const eventStream=(events,{status=200,headers={}}={})=>new Response(events.map(event=>`event: message\ndata: ${JSON.stringify(event)}\n\n`).join(''),{status,headers:{'content-type':'text/event-stream',...headers}});
const nullableString=Object.freeze({anyOf:Object.freeze([{type:'string'},{type:'null'}]),default:null});
const cursorAndLimit=Object.freeze({cursor:nullableString,limit:Object.freeze({type:'integer',default:100})});
// Mirrors the reviewed V2 input contract.  Deliberately do not manufacture a
// snapshot_token or row fields from the catalog's open output schema.
const schemas=Object.freeze({
  get_meta:{type:'object',properties:{section:nullableString}},
  list_payables:{type:'object',properties:{company_code:nullableString,ap_type:nullableString,incurred_date_from:nullableString,incurred_date_to:nullableString,posting_date_from:nullableString,posting_date_to:nullableString,...cursorAndLimit}},
  list_bank_transactions:{type:'object',properties:{company_code:nullableString,account_code:nullableString,set_date_from:nullableString,set_date_to:nullableString,come_from:nullableString,unmatched_only:{type:'boolean',default:false},...cursorAndLimit}},
  list_autorec_details:{type:'object',properties:{biz_type:{type:'string',default:'AUTOC'},pb_guid:nullableString,status:nullableString,match_status:nullableString,clear_date_from:nullableString,clear_date_to:nullableString,...cursorAndLimit}},
  list_autorec_banks:{type:'object',properties:{company_code:nullableString,...cursorAndLimit}},
  list_journal_entries:{type:'object',properties:{company:nullableString,come_from:nullableString,posting_date_from:nullableString,posting_date_to:nullableString,review:nullableString,...cursorAndLimit}},
  list_control_totals:{type:'object',properties:{company:nullableString,period:nullableString,kind:{type:'string',default:'balance'}}},
  list_insurance:{type:'object',properties:{...cursorAndLimit}},
  trace_by_key:{type:'object',properties:{key_type:{type:'string'},key_value:{type:'string'}},required:['key_type','key_value']}
});
const descriptor=(name,overrides={})=>({name,description:`Read-only ${name}`,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true},inputSchema:schemas[name],...overrides});
const toolCatalog=(replace={})=>WBS_READONLY_TOOLS.map(name=>replace[name]??descriptor(name));
const readEnvelope=({tool='list_payables',rows=[{ap_guid:'AP-1',currency:'USD'}],etl_notice=null}={})=>({
  contract_version:'WBS-REFS-MCP-V1',tool,environment:'production',captured_at:'2026-08-05T12:00:00.000Z',source:{system:'WBS'},scope:{company:'COMPANY-A'},record_count:rows.length,content_sha256:canonicalRequestHash(rows).slice('sha256:'.length),cursor_next:null,etl_notice,rows
});
const rpcFetcher=({catalog=toolCatalog(),callEnvelope=readEnvelope(),protocolVersion=WBS_MCP_PROTOCOL_VERSION}={})=>async(_url,request)=>{
  const {id,method}=JSON.parse(request.body);
  if(method==='initialize')return json({jsonrpc:'2.0',id,result:{protocolVersion,serverInfo:{name:'WBS'}}},{headers:{'mcp-session-id':'session-12345678'}});
  if(method==='tools/list')return json({jsonrpc:'2.0',id,result:{tools:catalog}});
  return json({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(callEnvelope)}]}});
};

test('read-only MCP client permits only the approved HTTPS endpoint and an injected credential-header provider',()=>{
  for(const bad of ['http://refs-mcp.wbm3.com/mcp','https://evil.example/mcp','https://refs-mcp.wbm3.com/mcp?x=1','https://refs-mcp.wbm3.com/other'])assert.throws(()=>createReadOnlyWbsMcpClient({endpoint:bad,getAuthHeaders:auth}),error=>error.code==='WBS_MCP_CONFIG_INVALID');
  for(const timeoutMs of [0,999,60001,NaN])assert.throws(()=>createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,timeoutMs}),error=>error.code==='WBS_MCP_CONFIG_INVALID');
  assert.throws(()=>createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,allowedReadTools:['database.query']}),error=>error.code==='WBS_MCP_CONFIG_INVALID');
});

test('initialize and exact nine-tool inventory use protocol 2025-06-18, correlation, auth, session and read-only annotations',async()=>{
  const calls=[];
  const base=rpcFetcher();
  const client=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:async(url,request)=>{calls.push(request);return base(url,request);}});
  assert.deepEqual(await client.initialize(),{protocolVersion:'2025-06-18',serverName:'WBS'});
  const tools=await client.listTools();
  assert.deepEqual(tools.map(tool=>tool.name),WBS_READONLY_TOOLS);
  assert(tools.every(tool=>tool.readOnly&&tool.idempotent&&!tool.destructive));
  assert.equal(calls[0].headers['CF-Access-Client-Id'],'test-client-id');
  assert.equal(calls[0].headers['CF-Access-Client-Secret'],'test-client-secret');
  assert.equal(calls[0].headers['X-REFS-Auth'],'test-refs-auth');
  assert.equal(calls[0].headers.authorization,undefined);
  assert.equal(calls[1].headers['mcp-session-id'],'session-12345678');
  assert.equal(calls[0].headers['mcp-protocol-version'],'2025-06-18');
  assert.equal(JSON.parse(calls[0].body).params.protocolVersion,'2025-06-18');
});

test('client accepts one correlated JSON-RPC response from a bounded Streamable HTTP event stream',async()=>{
  const client=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:async(_url,request)=>{const {id,method}=JSON.parse(request.body);return method==='initialize'?eventStream([{jsonrpc:'2.0',method:'notifications/progress',params:{}},{jsonrpc:'2.0',id,result:{protocolVersion:WBS_MCP_PROTOCOL_VERSION,serverInfo:{name:'WBS'}}}]):eventStream([{jsonrpc:'2.0',id,result:{tools:toolCatalog()}}]);}});
  assert.deepEqual(await client.initialize(),{protocolVersion:WBS_MCP_PROTOCOL_VERSION,serverName:'WBS'});
  assert.equal((await client.listTools()).length,9);
  const ambiguous=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:async(_url,request)=>{const {id}=JSON.parse(request.body);return eventStream([{jsonrpc:'2.0',id,result:{}},{jsonrpc:'2.0',id,result:{}}]);}});
  await assert.rejects(ambiguous.initialize(),error=>error.code==='WBS_MCP_PROTOCOL_INVALID');
  const oversized=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:async(_url,request)=>{const {id}=JSON.parse(request.body);return eventStream([{jsonrpc:'2.0',id,result:{padding:'x'.repeat(1024*1024)}}]);}});
  await assert.rejects(oversized.initialize(),error=>error.code==='WBS_MCP_PROTOCOL_INVALID');
});

test('client bounds JSON responses and fails closed on authentication, protocol version and malformed correlation',async()=>{
  const unauthenticated=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:async()=>json({error:'secret remote detail'},{status:401})});
  await assert.rejects(unauthenticated.initialize(),error=>error instanceof WbsMcpError&&error.code==='WBS_MCP_AUTHENTICATION_REQUIRED'&&!error.message.includes('secret'));
  const wrongProtocol=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:rpcFetcher({protocolVersion:'2024-11-05'})});
  await assert.rejects(wrongProtocol.initialize(),error=>error.code==='WBS_MCP_PROTOCOL_INVALID');
  const malformed=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:async()=>json({jsonrpc:'2.0',id:999,result:{}})});
  await assert.rejects(malformed.initialize(),error=>error.code==='WBS_MCP_PROTOCOL_INVALID');
  const oversizedJson=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:async(_url,request)=>{const {id}=JSON.parse(request.body);return json({jsonrpc:'2.0',id,result:{protocolVersion:WBS_MCP_PROTOCOL_VERSION,padding:'x'.repeat(1024*1024)}});}});
  await assert.rejects(oversizedJson.initialize(),error=>error.code==='WBS_MCP_PROTOCOL_INVALID');
});

test('tool catalog fails closed when a tool is missing, extra, destructive, non-read-only or non-idempotent',async()=>{
  const invalidCatalogs=[
    toolCatalog().slice(1),
    [...toolCatalog(),descriptor('unexpected_tool')],
    toolCatalog({list_payables:descriptor('list_payables',{annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}})}),
    toolCatalog({list_payables:descriptor('list_payables',{annotations:{readOnlyHint:true,destructiveHint:true,idempotentHint:true}})}),
    toolCatalog({list_payables:descriptor('list_payables',{annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:false}})}),
    toolCatalog({list_payables:descriptor('list_payables',{inputSchema:{type:'object',properties:{company_code:{type:'string'},cursor:{type:'string'}},additionalProperties:false}})})
  ];
  for(const catalog of invalidCatalogs){
    const client=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,fetcher:rpcFetcher({catalog})});
    await client.initialize();
    await assert.rejects(client.listTools(),error=>error.code==='WBS_MCP_TOOL_CATALOG_INVALID');
  }
});

test('data reads enforce the local allowlist and published argument schema, then parse and validate the JSON text envelope',async()=>{
  let calls=0;
  const base=rpcFetcher();
  const client=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,allowedReadTools:['list_payables'],fetcher:async(url,request)=>{calls++;return base(url,request);}});
  await client.initialize();await client.listTools();
  await assert.rejects(client.readView({toolName:'database.query',args:{}}),error=>error.code==='WBS_MCP_TOOL_FORBIDDEN');
  await assert.rejects(client.readView({toolName:'list_payables',args:{sql:'select *'}}),error=>error.code==='WBS_MCP_ARGUMENTS_INVALID');
  await assert.rejects(client.readView({toolName:'list_payables',args:{limit:WBS_MCP_PILOT_LIMIT+1}}),error=>error.code==='WBS_MCP_ARGUMENTS_INVALID');
  await assert.rejects(client.readView({toolName:'list_payables',args:{companyGuid:'legacy-alias'}}),error=>error.code==='WBS_MCP_ARGUMENTS_INVALID');
  const result=await client.readView({toolName:'list_payables',args:{company_code:'COMPANY-A',limit:10}});
  assert.equal(result.tool_name,'list_payables');
  assert.equal(result.rows[0].ap_guid,'AP-1');
  assert.equal(result.etl_notice,null);
  assert.equal(result.admission_status,'NOT_ADMITTED');assert.equal(result.can_persist,false);
  assert.equal(calls,3);
});

test('direct MCP is unsigned Pilot-only; signed-package pagination policy is a separate 500-row formal envelope boundary',async()=>{
  const insurance=readEnvelope({tool:'list_insurance',rows:[{id:1,policy_id:'POL-1',company_code:null,currency:'USD'}]});
  const client=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,allowedReadTools:['list_insurance'],fetcher:rpcFetcher({callEnvelope:insurance})});
  await client.initialize();await client.listTools();
  await assert.rejects(client.readView({toolName:'list_insurance',args:{limit:WBS_MCP_PILOT_LIMIT+1}}),error=>error.code==='WBS_MCP_ARGUMENTS_INVALID');
  const observed=await client.readView({toolName:'list_insurance',args:{limit:WBS_MCP_PILOT_LIMIT}});
  assert.equal(observed.admission_status,'NOT_ADMITTED');assert.equal(observed.can_persist,false);
  assert.throws(()=>createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,pilotObservationMode:false}),error=>error.code==='WBS_MCP_CONFIG_INVALID');
  const page500=readEnvelope({rows:Array.from({length:WBS_MCP_PRODUCTION_PAGE_LIMIT},(_,index)=>({ap_guid:`AP-${String(index).padStart(4,'0')}`,currency:'USD'}))});
  assert.equal(validateWbsReadEnvelope({toolName:'list_payables',envelope:page500}).record_count,WBS_MCP_PRODUCTION_PAGE_LIMIT);
});

test('formal provider envelope validates stable string keys, integer journal ids, nullable ETL notice and canonical hash',()=>{
  assert.deepEqual(WBS_READONLY_TOOLS,['get_meta','list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries','list_control_totals','list_insurance','trace_by_key']);
  assert(WBS_READONLY_ROW_FIELDS.list_payables.includes('ap_guid'));assert(WBS_READONLY_ROW_FIELDS.list_payables.includes('invoice_no'));assert(WBS_READONLY_ROW_FIELDS.list_payables.includes('invoice_date'));assert(WBS_READONLY_ROW_FIELDS.list_payables.includes('business_id'));assert(WBS_READONLY_ROW_FIELDS.list_journal_entries.includes('id'));assert(WBS_READONLY_ROW_FIELDS.list_control_totals.includes('total_balance'));assert.deepEqual(WBS_READONLY_OPTIONAL_TRACE_FIELDS.list_payables,['source_detail_source','source_detail_type','source_detail_come_from']);
  assert.deepEqual(WBS_READONLY_ROW_FIELDS.list_insurance.includes('final_premium'),true);
  const envelope=readEnvelope();
  const accepted=validateWbsReadEnvelope({toolName:'list_payables',envelope});assert.equal(accepted.requires_snapshot_diff,true);assert.equal(accepted.has_revision_contract,false);assert.equal(accepted.etl_notice,null);
  const journal=readEnvelope({tool:'list_journal_entries',rows:[{id:7,currency:'USD'}],etl_notice:'Snapshot comparison required'});
  assert.equal(validateWbsReadEnvelope({toolName:'list_journal_entries',envelope:journal}).rows[0].id,7);
  const bank=readEnvelope({tool:'list_bank_transactions',rows:[{cb_id:'CB-0001',currency:'USD'}]});
  assert.equal(validateWbsReadEnvelope({toolName:'list_bank_transactions',envelope:bank}).rows[0].cb_id,'CB-0001');
  assert.equal(WBS_READONLY_ROW_FIELDS.list_bank_transactions.includes('bank_transaction_id'),false);
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_bank_transactions',envelope:readEnvelope({tool:'list_bank_transactions',rows:[{bank_transaction_id:'LEGACY-ONLY',currency:'USD'}]})}),error=>error.code==='WBS_MCP_ENVELOPE_INVALID');
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_journal_entries',envelope:readEnvelope({tool:'list_journal_entries',rows:[{id:'7',currency:'USD'}]})}),error=>error.code==='WBS_MCP_ENVELOPE_INVALID');
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_payables',envelope:{...envelope,rows:[{currency:'USD'}]}}),error=>error.code==='WBS_MCP_ENVELOPE_INVALID');
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_payables',envelope:readEnvelope({rows:[{ap_guid:'AP-\u0001',currency:'USD'}]})}),error=>error.code==='WBS_MCP_ENVELOPE_INVALID');
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_payables',envelope:{...envelope,content_sha256:'caller-value'}}),error=>error.code==='WBS_MCP_ENVELOPE_INVALID');
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_payables',envelope:{...envelope,rows:[{ap_guid:'AP-1',currency:'USD',amount:'1.00'}]}}),error=>error.code==='WBS_MCP_CONTENT_HASH_MISMATCH');
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_payables',envelope:{...envelope,rows:[{ap_guid:'AP-1',currency:'CAD'}]}}),error=>error.code==='WBS_MCP_CURRENCY_UNSUPPORTED');
  const duplicateRows=[{ap_guid:'AP-1',currency:'USD'},{ap_guid:'AP-1',currency:'USD'}];
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_payables',envelope:readEnvelope({rows:duplicateRows})}),error=>error.code==='WBS_MCP_ROWS_NOT_SORTED');
  const unorderedRows=[{ap_guid:'AP-2',currency:'USD'},{ap_guid:'AP-1',currency:'USD'}];
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_payables',envelope:readEnvelope({rows:unorderedRows})}),error=>error.code==='WBS_MCP_ROWS_NOT_SORTED');
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_payables',envelope:{...envelope,cursor_next:'next-page'}}),error=>error.code==='WBS_MCP_PAGINATION_SNAPSHOT_TOKEN_REQUIRED');
  const paged={...envelope,scope:{...envelope.scope,snapshot_token:'snapshot-2026.08:1'},cursor_next:'next-page'};
  assert.equal(validateWbsReadEnvelope({toolName:'list_payables',envelope:paged}).scope.snapshot_token,'snapshot-2026.08:1');
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_payables',envelope:{...envelope,scope:{...envelope.scope,snapshot_token:'bad token'}}}),error=>error.code==='WBS_MCP_ENVELOPE_INVALID');
  const insuranceRows=[{id:2,policy_id:'POL-2',company_code:null,currency:'USD'},{id:10,policy_id:'POL-10',company_code:null,currency:'USD'}];
  assert.equal(validateWbsReadEnvelope({toolName:'list_insurance',envelope:readEnvelope({tool:'list_insurance',rows:insuranceRows})}).rows.length,2);
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_insurance',envelope:readEnvelope({tool:'list_insurance',rows:[{id:2,policy_id:'POL-A',company_code:null,currency:'USD'},{id:10,policy_id:'POL-A',company_code:null,currency:'USD'}]})}),error=>error.code==='WBS_MCP_ROWS_NOT_SORTED');
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_insurance',envelope:readEnvelope({tool:'list_insurance',rows:[{id:2,policy_id:'POL-A',company_code:null,currency:'USD'},{id:2,policy_id:'POL-B',company_code:null,currency:'USD'}]})}),error=>error.code==='WBS_MCP_ROWS_NOT_SORTED');
  assert.throws(()=>validateWbsReadEnvelope({toolName:'list_insurance',envelope:readEnvelope({tool:'list_insurance',rows:[{id:2,policy_id:'POL-A',company_code:'WBPA',currency:'USD'}]})}),error=>error.code==='WBS_MCP_ENVELOPE_SCOPE_MISMATCH');
});

test('catalog preflight requires all four reviewed V2 pins and rejects an old eight-tool or semantic drift',()=>{
  const catalog=toolCatalog();
  assert.throws(()=>validateWbsMcpCatalogPreflight({...WBS_MCP_CATALOG_V2_REVIEWED_PINS,catalog}),error=>error.code==='WBS_MCP_CATALOG_PIN_INVALID');
  assert.throws(()=>validateWbsMcpCatalogPreflight({...WBS_MCP_CATALOG_V2_REVIEWED_PINS,catalog:catalog.slice(0,8)}),error=>error.code==='WBS_MCP_TOOL_CATALOG_INVALID');
  assert.throws(()=>validateWbsMcpCatalogPreflight({...WBS_MCP_CATALOG_V2_REVIEWED_PINS,semantic_v1_sha256:`sha256:${'b'.repeat(64)}`,catalog}),error=>error.code==='WBS_MCP_CATALOG_PIN_INVALID');
});

test('reviewed V2 fixture always pins exact redacted HTTP/JSON-RPC bytes without becoming Final-1 evidence',()=>{
  const fixture=name=>{
    const encoded=readFileSync(new URL(`./fixtures/wbs/mcp-catalog-v2/${name}.b64`,import.meta.url),'utf8');
    assert.match(encoded,/^[A-Za-z0-9+/]+={0,2}\n$/);assert.equal(encoded.length%4,1);
    const compact=encoded.slice(0,-1),decoded=Buffer.from(compact,'base64');
    assert.equal(decoded.toString('base64'),compact);return decoded;
  };
  const requestRaw=fixture('request.raw'),responseRaw=fixture('response.raw'),catalogRaw=fixture('catalog.json'),catalogDocument=JSON.parse(catalogRaw.toString('utf8')),catalog=catalogDocument.tools;
  const fixtureHash=value=>createHash('sha256').update(value).digest('hex');
  assert.equal(requestRaw.length,357);assert.equal(responseRaw.length,9343);assert.equal(catalogRaw.length,17369);
  assert.equal(fixtureHash(requestRaw),'0d18bb3d0d57bc64e4a045303fa794569b2fa1bcec2bf5902f2db809200b3d73');
  assert.equal(fixtureHash(responseRaw),'9d89f8da2b427681eae4e5de8ac02a67620fd261cc575da8664efa5097a412ea');
  assert.equal(fixtureHash(catalogRaw),'950745b69488ec0dc6227f066381921b546c89ef13f4f552a66795f5e19b354e');
  assert.equal(catalogDocument.tool_count,9);
  const verified=verifyWbsMcpCatalogV2Evidence({requestRaw,responseRaw,catalog});
  assert.deepEqual(verified,{...WBS_MCP_CATALOG_V2_REVIEWED_PINS,tool_count:9});
  const insuranceInput=catalog.find(tool=>tool.name==='list_insurance').inputSchema.properties;
  assert.deepEqual(Object.keys(insuranceInput).sort(),['cursor','limit']);assert.equal(insuranceInput.limit.type,'integer');assert(insuranceInput.cursor.anyOf.some(value=>value.type==='string'));
  assert.throws(()=>verifyWbsMcpCatalogV2Evidence({requestRaw,responseRaw:Buffer.concat([responseRaw,Buffer.from(' ')]),catalog}),error=>error.code==='WBS_MCP_CATALOG_RAW_INVALID'||error.code==='WBS_MCP_CATALOG_PIN_INVALID');
  for(const encoded of [' '+readFileSync(new URL('./fixtures/wbs/mcp-catalog-v2/request.raw.b64',import.meta.url),'utf8'),readFileSync(new URL('./fixtures/wbs/mcp-catalog-v2/request.raw.b64',import.meta.url),'utf8').replace(/\n$/,''),readFileSync(new URL('./fixtures/wbs/mcp-catalog-v2/request.raw.b64',import.meta.url),'utf8').replace('A','*')])assert.doesNotMatch(encoded,/^[A-Za-z0-9+/]+={0,2}\n$/);
});

test('actual reviewed V2 descriptors traverse the direct MCP listTools preflight, while old eight tools fail closed',async()=>{
  const encoded=readFileSync(new URL('./fixtures/wbs/mcp-catalog-v2/catalog.json.b64',import.meta.url),'utf8');assert.match(encoded,/^[A-Za-z0-9+/]+={0,2}\n$/);const catalog=JSON.parse(Buffer.from(encoded.slice(0,-1),'base64').toString('utf8')).tools;
  const client=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,reviewedCatalog:WBS_MCP_CATALOG_V2_REVIEWED_PINS,fetcher:rpcFetcher({catalog})});
  await client.initialize();assert.equal((await client.listTools()).length,9);
  const old=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,reviewedCatalog:WBS_MCP_CATALOG_V2_REVIEWED_PINS,fetcher:rpcFetcher({catalog:catalog.slice(0,8)})});
  await old.initialize();await assert.rejects(old.listTools(),error=>error.code==='WBS_MCP_TOOL_CATALOG_INVALID');
});

test('tool call fails closed on invalid JSON text, invalid hash and remote error',async()=>{
  const variants=[
    {result:{content:[{type:'text',text:'not-json'}]},code:'WBS_MCP_ENVELOPE_INVALID'},
    {result:{content:[{type:'text',text:JSON.stringify({...readEnvelope(),content_sha256:'0'.repeat(64)})}]},code:'WBS_MCP_CONTENT_HASH_MISMATCH'},
    {result:{isError:true,content:[]},code:'WBS_MCP_REMOTE_REJECTED'}
  ];
  for(const variant of variants){
    const client=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:auth,allowedReadTools:['list_payables'],fetcher:async(_url,request)=>{
      const {id,method}=JSON.parse(request.body);
      if(method==='initialize')return json({jsonrpc:'2.0',id,result:{protocolVersion:WBS_MCP_PROTOCOL_VERSION}});
      if(method==='tools/list')return json({jsonrpc:'2.0',id,result:{tools:toolCatalog()}});
      return json({jsonrpc:'2.0',id,result:variant.result});
    }});
    await client.initialize();await client.listTools();
    await assert.rejects(client.readView({toolName:'list_payables',args:{limit:1}}),error=>error.code===variant.code);
  }
});

test('pilot rejects a third concurrent request before credential or network access',async()=>{
  let release;const credentialGate=new Promise(resolve=>{release=resolve;});
  const client=createReadOnlyWbsMcpClient({endpoint,getAuthHeaders:()=>credentialGate,fetcher:async(_url,request)=>{const {id}=JSON.parse(request.body);return json({jsonrpc:'2.0',id,result:{protocolVersion:WBS_MCP_PROTOCOL_VERSION}});}});
  const first=client.initialize(),second=client.initialize();
  await assert.rejects(client.initialize(),error=>error.code==='WBS_MCP_CONCURRENCY_LIMIT');
  release(await auth());await Promise.all([first,second]);
});
