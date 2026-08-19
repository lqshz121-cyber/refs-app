import {createHash,timingSafeEqual} from 'node:crypto';
import {canonicalRequestBody} from './request-hash.mjs';

const WBS_MCP_ORIGIN='https://refs-mcp.wbm3.com';
// The one endpoint `endpointUrl` will accept. Exported so callers can default to it
// instead of re-typing the host, which is the only way a second, drifting copy of the
// origin could appear in the tree. `endpointUrl` still validates whatever it is given.
export const WBS_MCP_APPROVED_ENDPOINT=`${WBS_MCP_ORIGIN}/mcp`;
export const WBS_MCP_PROTOCOL_VERSION='2025-06-18';
export const WBS_READONLY_TOOLS=Object.freeze(['get_meta','list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries','list_control_totals','list_insurance','trace_by_key']);
export const WBS_MCP_CATALOG_V2_REVIEWED_PINS=Object.freeze({request_raw_sha256:'sha256:0d18bb3d0d57bc64e4a045303fa794569b2fa1bcec2bf5902f2db809200b3d73',response_raw_sha256:'sha256:9d89f8da2b427681eae4e5de8ac02a67620fd261cc575da8664efa5097a412ea',canonical_tools_sha256:'sha256:cad2dc4ec796cf2b528310a17e5bf7bf1bbd9fdd52b944feffea909a048b982b',semantic_v1_sha256:'sha256:cb39c51f000598e67e94aee4f2fc1afb005d6a67220733ba461c417eb605195f'});
export const WBS_MCP_PILOT_LIMIT=10;
// Production MCP pagination is capped uniformly.  The unsigned Pilot keeps
// its independent ten-row cap through pilotObservationMode.
export const WBS_MCP_PRODUCTION_PAGE_LIMIT=500;
export const WBS_MCP_MAX_CONCURRENCY=2;
const WBS_CURSOR_READ_TOOLS=new Set(['list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries','list_insurance']);
export const WBS_READONLY_ROW_FIELDS=Object.freeze({
  // bank_account_ref is a future receipt-bound relation field. It is never
  // synthesized from the Payable Account Code, Journal No., cb_id, or another
  // display field; without it the REFS AutoRec candidate remains blocked.
  list_payables:Object.freeze(['amount','ap_guid','ap_long_id','ap_type','bank_account_ref','business_id','business_status','cb_id','charge_code','check_date','check_no','clear_date','company_code','company_name','contract_id','cost_id','cost_ledger_id','description','incurred_date','invoice_date','invoice_no','journal_no','obligation_status','pay_status','pay_type','pj_code','pj_name','posting_date','project_guid','recurring_obligation_id','review_status','service_frequency','service_period_end','service_period_start','vendor_name','vendor_no']),
  list_bank_transactions:Object.freeze(['account_code','cb_id','child_come_from','child_count','come_from','company_code','debtor','description','lender','payee','payee_no','posting_date','review','set_date','statistical_business','sys_id','turn_flag']),
  list_autorec_details:Object.freeze(['batch_guid','biz_type','cb_id','clear_date','cost_code','data_source','deposit','incurred_date','match_guid','match_status','payment','pd_guid','pd_pv_guid','posting_date','project_guid','released_by','released_date','status','vendor_no']),
  list_autorec_banks:Object.freeze(['ah_id','ah_name','company_code','company_name','debit_amount','incurred','pay_amount','pb_guid','quantity','reconciliation_start_date','released','released_quantity','status']),
  list_journal_entries:Object.freeze(['account','bill_no','cb_id','closed','come_from','company','cost_code','debtor','id','journal_no','lender','pj_code','posting_date','project','reverse','review','reviewer','set_date','sys_id']),
  list_control_totals:Object.freeze(['cell_count','company','formula','period','quality','total_balance','total_credit','total_debit']),
  list_insurance:Object.freeze(['approval_status','attachment_count','carrier','company_code','currency','data_source','deleted','expire_date','final_premium','id','insurance_status','insurance_type','pc_code','policy_attachment_id','policy_id','policy_number','property_code','start_date','unit_code','update_time'])
});
// These fields preserve a page-level WBS drill-down only after a provider
// includes them in the signed row. They are intentionally not admission
// fields: losing a display route must not force an importer to invent it, and
// having one must not make it a transaction, matching, or posting key.
export const WBS_READONLY_OPTIONAL_TRACE_FIELDS=Object.freeze({
  list_payables:Object.freeze(['source_detail_source','source_detail_type','source_detail_come_from'])
});

export class WbsMcpError extends Error {
  constructor(code,message){super(message);this.name='WbsMcpError';this.code=code;}
}

const plainObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const safeToolName=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(value);
const scopedText=value=>typeof value==='string'?value.trim():'';
const safeProviderKey=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=512&&!/[\u0000-\u001f\u007f]/.test(value);
const MAX_EVENT_STREAM_BYTES=1024*1024;
const SHA256=/^sha256:[0-9a-f]{64}$/;

async function boundedText(response){
  if(!response.body?.getReader){const text=await response.text();if(text.length>MAX_EVENT_STREAM_BYTES)throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP event stream exceeded the response limit.');return text;}
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_EVENT_STREAM_BYTES){await reader.cancel();throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP event stream exceeded the response limit.');}text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}
  finally{reader.releaseLock();}
}

async function responseEnvelope(response,requestId){
  const contentType=response.headers.get('content-type')||'';
  if(/application\/json/i.test(contentType)){
    let text;try{text=await boundedText(response);}catch(error){if(error instanceof WbsMcpError)throw error;throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP returned an unreadable JSON response.');}
    try{return JSON.parse(text);}catch{throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP returned invalid JSON.');}
  }
  if(!/text\/event-stream/i.test(contentType))throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP returned an unsupported response format.');
  let text;try{text=await boundedText(response);}catch(error){if(error instanceof WbsMcpError)throw error;throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP returned an unreadable event stream.');}
  const matches=[];
  for(const event of text.replace(/\r\n/g,'\n').split(/\n\n+/)){
    const payload=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!payload)continue;
    let candidate;try{candidate=JSON.parse(payload);}catch{throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP event stream contained invalid JSON.');}
    if(plainObject(candidate)&&candidate.id===requestId)matches.push(candidate);
  }
  if(matches.length!==1)throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP event stream did not contain one correlated response.');
  return matches[0];
}

function endpointUrl(value){
  let url;try{url=new URL(value);}catch{throw new WbsMcpError('WBS_MCP_CONFIG_INVALID','WBS MCP endpoint is invalid.');}
  if(url.origin!==WBS_MCP_ORIGIN||url.pathname!=='/mcp'||url.search||url.hash||url.username||url.password)throw new WbsMcpError('WBS_MCP_CONFIG_INVALID','WBS MCP endpoint is not the approved read-only endpoint.');
  return url.toString();
}

function toolMetadata(tool){
  if(!plainObject(tool)||!safeToolName(tool.name))throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP returned an invalid tool descriptor.');
  return {name:tool.name,description:typeof tool.description==='string'?tool.description:'',readOnly:tool.annotations?.readOnlyHint===true,destructive:tool.annotations?.destructiveHint===true,idempotent:tool.annotations?.idempotentHint===true,inputSchema:plainObject(tool.inputSchema)?tool.inputSchema:{}};
}

// The Provider supplies the reviewed raw catalog digest only after deploying
// the nine-tool artifact.  REFS never hard-codes an invented future hash.
// The semantic digest is calculated over the exact safe contract surface so
// an old eight-tool catalog (or a catalog with altered input semantics) fails
// before any read is attempted.
export function wbsMcpCatalogSemanticHash(catalog){
  if(!Array.isArray(catalog))throw new WbsMcpError('WBS_MCP_TOOL_CATALOG_INVALID','WBS MCP catalog must be an array.');
  const semantic=catalog.map(tool=>{
    const value=toolMetadata(tool);
    return {name:value.name,readOnly:value.readOnly,destructive:value.destructive,idempotent:value.idempotent,inputSchema:value.inputSchema};
  }).sort((left,right)=>left.name.localeCompare(right.name));
  return `sha256:${createHash('sha256').update(canonicalRequestBody({schema_version:'WBS_MCP_CATALOG_SEMANTICS_V1',protocol_version:WBS_MCP_PROTOCOL_VERSION,tools:semantic}),'utf8').digest('hex')}`;
}

export function wbsMcpCatalogCanonicalToolsHash(catalog){
  if(!Array.isArray(catalog))throw new WbsMcpError('WBS_MCP_TOOL_CATALOG_INVALID','WBS MCP catalog must be an array.');
  return `sha256:${createHash('sha256').update(canonicalRequestBody(catalog),'utf8').digest('hex')}`;
}

export function validateWbsMcpCatalogPreflight({request_raw_sha256,response_raw_sha256,canonical_tools_sha256,semantic_v1_sha256,catalog}={}){
  if(!SHA256.test(request_raw_sha256||'')||!SHA256.test(response_raw_sha256||'')||!SHA256.test(canonical_tools_sha256||'')||!SHA256.test(semantic_v1_sha256||''))throw new WbsMcpError('WBS_MCP_CATALOG_PIN_INVALID','Reviewed request, response, canonical, and semantic catalog SHA-256 pins are required.');
  if(request_raw_sha256!==WBS_MCP_CATALOG_V2_REVIEWED_PINS.request_raw_sha256||response_raw_sha256!==WBS_MCP_CATALOG_V2_REVIEWED_PINS.response_raw_sha256||canonical_tools_sha256!==WBS_MCP_CATALOG_V2_REVIEWED_PINS.canonical_tools_sha256||semantic_v1_sha256!==WBS_MCP_CATALOG_V2_REVIEWED_PINS.semantic_v1_sha256)throw new WbsMcpError('WBS_MCP_CATALOG_PIN_INVALID','WBS MCP catalog pins do not equal the reviewed V2 artifact.');
  const names=Array.isArray(catalog)?catalog.map(tool=>tool?.name).sort():[];
  if(JSON.stringify(names)!==JSON.stringify([...WBS_READONLY_TOOLS].sort()))throw new WbsMcpError('WBS_MCP_TOOL_CATALOG_INVALID','WBS MCP catalog must be the exact nine-tool contract.');
  const semantic=wbsMcpCatalogSemanticHash(catalog),canonical=wbsMcpCatalogCanonicalToolsHash(catalog);
  if(semantic!==semantic_v1_sha256||canonical!==canonical_tools_sha256)throw new WbsMcpError('WBS_MCP_CATALOG_PIN_INVALID','Reviewed WBS MCP catalog semantic or canonical hash differs from the exact nine-tool artifact.');
  return Object.freeze({request_raw_sha256,response_raw_sha256,canonical_tools_sha256:canonical,semantic_v1_sha256:semantic,tool_count:WBS_READONLY_TOOLS.length});
}

const CATALOG_REDACTED_HEADERS=new Set(['cf-access-client-id','cf-access-client-secret','x-refs-auth','authorization','proxy-authorization','cookie','set-cookie','x-api-key','x-auth-token']);
function parseCatalogHttpRaw(raw,{request}={}){
  const separator=raw.indexOf(Buffer.from('\r\n\r\n'));
  if(separator<0)throw new WbsMcpError('WBS_MCP_CATALOG_RAW_INVALID','Reviewed catalog raw HTTP message lacks a header/body boundary.');
  const head=raw.subarray(0,separator).toString('utf8'),body=raw.subarray(separator+4);
  if(Buffer.from(head,'utf8').toString('utf8')!==head)throw new WbsMcpError('WBS_MCP_CATALOG_RAW_INVALID','Reviewed catalog HTTP headers must be UTF-8.');
  const [start,...lines]=head.split('\r\n');const headers={};
  for(const line of lines){const colon=line.indexOf(':');if(colon<1)throw new WbsMcpError('WBS_MCP_CATALOG_RAW_INVALID','Reviewed catalog HTTP header is malformed.');const name=line.slice(0,colon).trim().toLowerCase(),value=line.slice(colon+1).trim();if(Object.hasOwn(headers,name))throw new WbsMcpError('WBS_MCP_CATALOG_RAW_INVALID','Reviewed catalog HTTP headers must not repeat.');headers[name]=value;}
  if(!/^\d+$/.test(headers['content-length']||'')||Number(headers['content-length'])!==body.length)throw new WbsMcpError('WBS_MCP_CATALOG_RAW_INVALID','Reviewed catalog Content-Length does not equal the exact raw body length.');
  for(const [name,value] of Object.entries(headers))if(CATALOG_REDACTED_HEADERS.has(name)&&value!=='[REDACTED]')throw new WbsMcpError('WBS_MCP_CATALOG_RAW_INVALID','Reviewed catalog credential headers must be exactly [REDACTED].');
  let json;try{json=JSON.parse(body.toString('utf8'));}catch{throw new WbsMcpError('WBS_MCP_CATALOG_RAW_INVALID','Reviewed catalog HTTP body is not JSON.');}
  if(request){if(start!=='POST /mcp HTTP/1.1'||headers['content-type']!=='application/json'||json?.jsonrpc!=='2.0'||!Number.isSafeInteger(json.id)||json.method!=='tools/list'||JSON.stringify(json.params)!=='{}')throw new WbsMcpError('WBS_MCP_CATALOG_RAW_INVALID','Reviewed catalog request is not the exact JSON-RPC tools/list request.');}
  else if(!/^HTTP\/1\.1 200 /.test(start)||headers['content-type']!=='application/json'||json?.jsonrpc!=='2.0'||!Number.isSafeInteger(json.id)||!Array.isArray(json?.result?.tools))throw new WbsMcpError('WBS_MCP_CATALOG_RAW_INVALID','Reviewed catalog response is not the exact JSON-RPC tools/list response.');
  return Object.freeze({headers:Object.freeze(headers),json});
}

export function verifyWbsMcpCatalogV2Evidence({requestRaw,responseRaw,catalog}={}){
  if(!Buffer.isBuffer(requestRaw)||!Buffer.isBuffer(responseRaw)||!Array.isArray(catalog))throw new WbsMcpError('WBS_MCP_CATALOG_PIN_INVALID','Catalog request, response raw bytes, and parsed tools are required.');
  const request=parseCatalogHttpRaw(requestRaw,{request:true}),response=parseCatalogHttpRaw(responseRaw,{request:false});
  if(request.json.id!==response.json.id||canonicalRequestBody(response.json.result.tools)!==canonicalRequestBody(catalog))throw new WbsMcpError('WBS_MCP_CATALOG_RAW_INVALID','Reviewed catalog request/response identity or response tools differ from the parsed artifact.');
  return validateWbsMcpCatalogPreflight({
    request_raw_sha256:`sha256:${createHash('sha256').update(requestRaw).digest('hex')}`,
    response_raw_sha256:`sha256:${createHash('sha256').update(responseRaw).digest('hex')}`,
    canonical_tools_sha256:wbsMcpCatalogCanonicalToolsHash(catalog),
    semantic_v1_sha256:wbsMcpCatalogSemanticHash(catalog),catalog
  });
}

function safeArguments(args,toolName,{pilotObservationMode=false}={}){
  if(!plainObject(args))throw new WbsMcpError('WBS_MCP_ARGUMENTS_INVALID','WBS view arguments must be an object.');
  for(const [key,value] of Object.entries(args)){
    if(/(?:sql|query|statement|command)/i.test(key)||typeof value==='function'||typeof value==='symbol')throw new WbsMcpError('WBS_MCP_ARGUMENTS_INVALID','WBS raw query arguments are forbidden.');
  }
  const limit=pilotObservationMode?WBS_MCP_PILOT_LIMIT:WBS_MCP_PRODUCTION_PAGE_LIMIT;
  if(Object.hasOwn(args,'limit')&&(!WBS_CURSOR_READ_TOOLS.has(toolName)||!Number.isSafeInteger(args.limit)||args.limit<1||args.limit>limit))throw new WbsMcpError('WBS_MCP_ARGUMENTS_INVALID',pilotObservationMode?'WBS pilot page limit must be between 1 and 10.':'WBS production page limit must be between 1 and 500.');
  return structuredClone(args);
}

// The production WBS tool catalogue defines cb_id as the immutable Bank row
// key.  REFS must not silently fall back to a legacy bank_transaction_id: it
// would make pagination and replay checks disagree with the signed provider
// population.
const stableKeyByTool=Object.freeze({list_payables:['ap_guid'],list_bank_transactions:['cb_id'],list_autorec_details:['pd_guid'],list_autorec_banks:['pb_guid'],list_journal_entries:['id']});
const validStablePart=(name,value)=>name==='id'?Number.isSafeInteger(value):safeProviderKey(value);
const stableTuple=(row,parts)=>parts.map(part=>String(row[part])).join('\u0000');
export function validateWbsReadEnvelope({toolName,envelope}={}){
  if(!WBS_READONLY_TOOLS.includes(toolName)||!plainObject(envelope)||!Array.isArray(envelope.rows)||!/^[0-9a-f]{64}$/.test(envelope.content_sha256)||typeof envelope.contract_version!=='string'||!envelope.contract_version.trim()||envelope.tool!==toolName||typeof envelope.environment!=='string'||envelope.environment.toLowerCase()!=='production'||typeof envelope.captured_at!=='string'||Number.isNaN(Date.parse(envelope.captured_at))||!plainObject(envelope.source)||!plainObject(envelope.scope)||!Number.isSafeInteger(envelope.record_count)||envelope.record_count!==envelope.rows.length||(envelope.cursor_next!==null&&typeof envelope.cursor_next!=='string')||(envelope.etl_notice!==null&&typeof envelope.etl_notice!=='string'))throw new WbsMcpError('WBS_MCP_ENVELOPE_INVALID','WBS production read envelope, scope, count, hash, or cursor is invalid.');
  if(WBS_CURSOR_READ_TOOLS.has(toolName)&&envelope.rows.length>WBS_MCP_PRODUCTION_PAGE_LIMIT)throw new WbsMcpError('WBS_MCP_ENVELOPE_INVALID','WBS production pagination returned more than 500 rows in one page.');
  const scopeCompany=scopedText(envelope.scope.company);
  const scopeCurrency=scopedText(envelope.scope.currency).toUpperCase();
  const snapshotToken=envelope.scope.snapshot_token;
  if(snapshotToken!==undefined&&(typeof snapshotToken!=='string'||!/^[A-Za-z0-9._~:-]{1,256}$/.test(snapshotToken)))throw new WbsMcpError('WBS_MCP_ENVELOPE_INVALID','WBS provider snapshot_token must be an opaque bounded token without control characters.');
  if(envelope.cursor_next!==null&&!snapshotToken)throw new WbsMcpError('WBS_MCP_PAGINATION_SNAPSHOT_TOKEN_REQUIRED','Every cursor-paged WBS response must echo its immutable provider snapshot token.');
  if(scopeCurrency&&scopeCurrency!=='USD')throw new WbsMcpError('WBS_MCP_CURRENCY_UNSUPPORTED','WBS pilot accepts USD scope only.');
  // Catalog V2 intentionally provides no insurance company parameter.  An
  // insurance row therefore carries a raw null company_code and is resolved
  // later only through a signed pc_code Controller decision; never infer it
  // from the page scope or the property label.
  if(toolName==='list_insurance'&&envelope.rows.some(row=>!plainObject(row)||row.company_code!==null))throw new WbsMcpError('WBS_MCP_ENVELOPE_SCOPE_MISMATCH','WBS Insurance rows must retain raw company_code null pending signed pc_code mapping.');
  if(scopeCompany&&envelope.rows.some(row=>plainObject(row)&&row.company_code!=null&&scopedText(row.company_code)!==scopeCompany||plainObject(row)&&row.company!=null&&scopedText(row.company)!==scopeCompany))throw new WbsMcpError('WBS_MCP_ENVELOPE_SCOPE_MISMATCH','WBS row company does not match the requested company scope.');
  if(scopeCurrency&&envelope.rows.some(row=>plainObject(row)&&row.currency!=null&&scopedText(row.currency).toUpperCase()!==scopeCurrency))throw new WbsMcpError('WBS_MCP_ENVELOPE_SCOPE_MISMATCH','WBS row currency does not match the requested currency scope.');
  const stableKey=stableKeyByTool[toolName];
  if(stableKey&&envelope.rows.some(row=>!plainObject(row)||stableKey.some(part=>!validStablePart(part,row[part]))))throw new WbsMcpError('WBS_MCP_ENVELOPE_INVALID',`WBS ${toolName} rows require bounded, control-character-free stable ${stableKey.join('+')}.`);
  // The content hash preserves array order.  Require the provider's stable
  // source key to be strictly ascending so a repeated row cannot silently
  // inflate a later control total or appear as two source facts.
  if(stableKey&&!envelope.rows.every((row,index)=>index===0||stableTuple(envelope.rows[index-1],stableKey)<stableTuple(row,stableKey)))throw new WbsMcpError('WBS_MCP_ROWS_NOT_SORTED','WBS rows must be strictly ascending and unique by their stable source key.');
  if(toolName==='list_insurance'){
    const policyIds=new Set();
    if(!envelope.rows.every((row,index)=>plainObject(row)&&Number.isSafeInteger(row.id)&&row.id>0&&safeProviderKey(row.policy_id)&&!policyIds.has(row.policy_id)&&(policyIds.add(row.policy_id),index===0||envelope.rows[index-1].id<row.id)))throw new WbsMcpError('WBS_MCP_ROWS_NOT_SORTED','WBS Insurance rows require strictly ascending unique numeric id and separately unique nonempty policy_id.');
  }
  if(envelope.rows.some(row=>plainObject(row)&&row.currency!=null&&row.currency!=='USD'))throw new WbsMcpError('WBS_MCP_CURRENCY_UNSUPPORTED','WBS pilot accepts USD rows only.');
  const expectedHash=createHash('sha256').update(canonicalRequestBody(envelope.rows),'utf8').digest('hex');
  if(!timingSafeEqual(Buffer.from(envelope.content_sha256,'hex'),Buffer.from(expectedHash,'hex')))throw new WbsMcpError('WBS_MCP_CONTENT_HASH_MISMATCH','WBS content_sha256 does not match canonical sorted compact rows.');
  return Object.freeze({tool_name:toolName,contract_version:envelope.contract_version,environment:envelope.environment,captured_at:envelope.captured_at,source:Object.freeze(structuredClone(envelope.source)),scope:Object.freeze(structuredClone(envelope.scope)),record_count:envelope.record_count,content_sha256:envelope.content_sha256,cursor_next:envelope.cursor_next,etl_notice:envelope.etl_notice,rows:Object.freeze(structuredClone(envelope.rows)),requires_snapshot_diff:true,has_revision_contract:false,has_cdc_contract:false,has_tombstone_contract:false});
}

// A live pilot observation is deliberately weaker than an admissible WBS
// snapshot, but cursor pagination still uses the provider's published
// scope.snapshot_token and stable source keys.  Reuse the strict envelope
// validator, then apply the independent ten-row Pilot ceiling.
export function validateWbsPilotObservationEnvelope({toolName,envelope}={}){
  const validated=validateWbsReadEnvelope({toolName,envelope});
  if(validated.rows.length>WBS_MCP_PILOT_LIMIT)throw new WbsMcpError('WBS_MCP_ENVELOPE_INVALID','WBS pilot returned more than ten rows.');
  return Object.freeze({...validated,admission_status:'NOT_ADMITTED',signature_verified:false,requires_snapshot_token:true,can_persist:false,can_allocate:false,can_create_draft:false,can_post:false});
}

export function createReadOnlyWbsMcpClient({endpoint,getAuthHeaders,allowedReadTools=[],fetcher=globalThis.fetch,timeoutMs=15000,pilotObservationMode=true,reviewedCatalog=null}={}){
  const url=endpointUrl(endpoint);
  if(typeof getAuthHeaders!=='function'||typeof fetcher!=='function')throw new WbsMcpError('WBS_MCP_CONFIG_INVALID','WBS MCP requires an injected credential-header provider and fetch implementation.');
  if(pilotObservationMode!==true)throw new WbsMcpError('WBS_MCP_CONFIG_INVALID','Direct WBS MCP is unsigned Pilot-only; signed provider packages use the Final-1 extractor path.');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)throw new WbsMcpError('WBS_MCP_CONFIG_INVALID','WBS MCP timeout is invalid.');
  const allowed=new Set(allowedReadTools);
  if([...allowed].some(name=>!safeToolName(name)||!WBS_READONLY_TOOLS.includes(name)))throw new WbsMcpError('WBS_MCP_CONFIG_INVALID','WBS read-tool allowlist must use only the nine approved tools.');
  let requestId=0,sessionId=null,initialized=false,tools=null,activeRequests=0;

  async function rpc(method,params){
    if(activeRequests>=WBS_MCP_MAX_CONCURRENCY)throw new WbsMcpError('WBS_MCP_CONCURRENCY_LIMIT','WBS pilot permits at most two concurrent reads.');
    activeRequests++;
    try{
    const credentials=await getAuthHeaders();
    const required=['CF-Access-Client-Id','CF-Access-Client-Secret','X-REFS-Auth'];
    if(!plainObject(credentials)||required.some(name=>typeof credentials[name]!=='string'||credentials[name].length<8||credentials[name].length>8192)||Object.keys(credentials).some(name=>!required.includes(name)))throw new WbsMcpError('WBS_MCP_AUTHENTICATION_REQUIRED','WBS MCP authentication headers are required.');
    const headers={accept:'application/json, text/event-stream','content-type':'application/json','user-agent':'REFS-WBS-ReadOnly/1.0','mcp-protocol-version':WBS_MCP_PROTOCOL_VERSION,...credentials};
    if(sessionId)headers['mcp-session-id']=sessionId;
    const id=++requestId;
    const controller=typeof AbortController==='function'?new AbortController():null,timeout=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
    try{
      let response;try{response=await fetcher(url,{method:'POST',headers,redirect:'error',cache:'no-store',signal:controller?.signal,body:JSON.stringify({jsonrpc:'2.0',id,method,params})});}
      catch{throw new WbsMcpError('WBS_MCP_UNAVAILABLE','WBS MCP is unavailable.');}
      if(response.status===401||response.status===403)throw new WbsMcpError('WBS_MCP_AUTHENTICATION_REQUIRED','WBS MCP authentication is required.');
      if(!response.ok)throw new WbsMcpError('WBS_MCP_UNAVAILABLE','WBS MCP request was rejected.');
      const envelope=await responseEnvelope(response,id);
      if(!plainObject(envelope)||envelope.jsonrpc!=='2.0'||envelope.id!==id)throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP response correlation failed.');
      if(envelope.error)throw new WbsMcpError('WBS_MCP_REMOTE_REJECTED','WBS MCP rejected the request.');
      if(!Object.hasOwn(envelope,'result'))throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP response has no result.');
      const receivedSession=response.headers.get('mcp-session-id');
      if(receivedSession){if(!/^[A-Za-z0-9._~-]{8,512}$/.test(receivedSession))throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP returned an invalid session identifier.');sessionId=receivedSession;}
      return envelope.result;
    }finally{if(timeout)clearTimeout(timeout);}
    }finally{activeRequests--;}
  }

  return Object.freeze({
    async initialize(){
      const result=await rpc('initialize',{protocolVersion:WBS_MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'refs-wbs-readonly-connector',version:'0.1.0'}});
      if(!plainObject(result)||result.protocolVersion!==WBS_MCP_PROTOCOL_VERSION)throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP initialize protocol version is invalid.');
      initialized=true;return {protocolVersion:result.protocolVersion,serverName:typeof result.serverInfo?.name==='string'?result.serverInfo.name:null};
    },
    async listTools(){
      if(!initialized)throw new WbsMcpError('WBS_MCP_NOT_INITIALIZED','Initialize WBS MCP before listing tools.');
      const result=await rpc('tools/list',{});
      if(!plainObject(result)||!Array.isArray(result.tools))throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP tool list is invalid.');
      const rawTools=result.tools;tools=rawTools.map(toolMetadata);
      const names=tools.map(tool=>tool.name).sort();
      if(JSON.stringify(names)!==JSON.stringify([...WBS_READONLY_TOOLS].sort())||tools.some(tool=>!tool.readOnly||tool.destructive||!tool.idempotent))throw new WbsMcpError('WBS_MCP_TOOL_CATALOG_INVALID','WBS MCP tool catalog is not the exact read-only idempotent contract.');
      if(reviewedCatalog!==null)validateWbsMcpCatalogPreflight({...reviewedCatalog,catalog:rawTools});
      // Catalog V2 proves only tool/input semantics. It has no snapshot token
      // and open output schemas, so it cannot be row evidence or a formal
      // admission cursor contract. Direct MCP remains UNSIGNED_PILOT only.
      if(tools.some(tool=>{
        if(!WBS_CURSOR_READ_TOOLS.has(tool.name))return false;
        const properties=plainObject(tool.inputSchema?.properties)?tool.inputSchema.properties:{};
        const nullableCursor=properties.cursor?.type==='string'||Array.isArray(properties.cursor?.anyOf)&&properties.cursor.anyOf.some(value=>value?.type==='string');
        return !nullableCursor||!plainObject(properties.limit)||properties.limit.type!=='integer';
      }))throw new WbsMcpError('WBS_MCP_TOOL_CATALOG_INVALID','Every paginated WBS list tool must publish nullable cursor and integer limit arguments.');
      return tools.map(tool=>({...tool}));
    },
    async readView({toolName,args}={}){
      if(!initialized||!tools)throw new WbsMcpError('WBS_MCP_NOT_READY','Initialize and inspect WBS MCP tools before reading a view.');
      if(!allowed.has(toolName))throw new WbsMcpError('WBS_MCP_TOOL_FORBIDDEN','WBS tool is not allowlisted for read-only use.');
      const tool=tools.find(candidate=>candidate.name===toolName);
      if(!tool||!tool.readOnly||tool.destructive||!tool.idempotent)throw new WbsMcpError('WBS_MCP_TOOL_FORBIDDEN','WBS tool is not declared read-only and idempotent by the MCP server.');
      const safe=safeArguments(args,toolName,{pilotObservationMode}),properties=plainObject(tool.inputSchema?.properties)?tool.inputSchema.properties:{};
      const snapshotContinuation=typeof safe.snapshot_token==='string'&&/^[A-Za-z0-9._~:-]{1,256}$/.test(safe.snapshot_token)&&typeof safe.cursor==='string'&&safe.cursor.length>0;
      if(Object.keys(safe).some(key=>!Object.hasOwn(properties,key)&&!(key==='snapshot_token'&&snapshotContinuation)))throw new WbsMcpError('WBS_MCP_ARGUMENTS_INVALID','WBS tool arguments must match the published input schema and exact snapshot continuation contract.');
      const result=await rpc('tools/call',{name:toolName,arguments:safe});
      if(!plainObject(result)||!Array.isArray(result.content)||result.isError===true)throw new WbsMcpError('WBS_MCP_REMOTE_REJECTED','WBS read-only tool rejected the request.');
      const text=result.content.find(item=>plainObject(item)&&item.type==='text'&&typeof item.text==='string')?.text;
      let payload;try{payload=text?JSON.parse(text):result.structuredContent;}catch{throw new WbsMcpError('WBS_MCP_ENVELOPE_INVALID','WBS tool returned invalid envelope JSON.');}
      return pilotObservationMode?validateWbsPilotObservationEnvelope({toolName,envelope:payload}):validateWbsReadEnvelope({toolName,envelope:payload});
    }
  });
}
