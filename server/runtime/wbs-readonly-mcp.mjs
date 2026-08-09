import {createHash,timingSafeEqual} from 'node:crypto';
import {canonicalRequestBody} from './request-hash.mjs';

const WBS_MCP_ORIGIN='https://refs-mcp.wbm3.com';
export const WBS_MCP_PROTOCOL_VERSION='2025-06-18';
export const WBS_READONLY_TOOLS=Object.freeze(['get_meta','list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries','list_control_totals','trace_by_key']);
export const WBS_MCP_PILOT_LIMIT=10;
export const WBS_MCP_MAX_CONCURRENCY=2;
const WBS_CURSOR_READ_TOOLS=new Set(['list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries','list_control_totals','trace_by_key']);
export const WBS_READONLY_ROW_FIELDS=Object.freeze({
  list_payables:Object.freeze(['amount','ap_guid','ap_long_id','ap_type','business_status','cb_id','check_date','check_no','clear_date','company_code','company_name','cost_id','cost_ledger_id','description','incurred_date','journal_no','pay_status','pay_type','pj_code','pj_name','posting_date','project_guid','review_status','vendor_name','vendor_no']),
  list_bank_transactions:Object.freeze(['account_code','bank_transaction_id','cb_id','child_come_from','child_count','come_from','company_code','debtor','description','lender','payee','payee_no','posting_date','review','set_date','statistical_business','sys_id','turn_flag']),
  list_autorec_details:Object.freeze(['batch_guid','biz_type','cb_id','clear_date','cost_code','data_source','deposit','incurred_date','match_guid','match_status','payment','pd_guid','pd_pv_guid','posting_date','project_guid','released_by','released_date','status','vendor_no']),
  list_autorec_banks:Object.freeze(['ah_id','ah_name','company_code','company_name','debit_amount','incurred','pay_amount','pb_guid','quantity','reconciliation_start_date','released','released_quantity','status']),
  list_journal_entries:Object.freeze(['account','bill_no','cb_id','closed','come_from','company','cost_code','debtor','id','journal_no','lender','pj_code','posting_date','project','reverse','review','reviewer','set_date','sys_id']),
  list_control_totals:Object.freeze(['cell_count','company','formula','period','quality','total_balance','total_credit','total_debit'])
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
const MAX_EVENT_STREAM_BYTES=1024*1024;

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

function safeArguments(args){
  if(!plainObject(args))throw new WbsMcpError('WBS_MCP_ARGUMENTS_INVALID','WBS view arguments must be an object.');
  for(const [key,value] of Object.entries(args)){
    if(/(?:sql|query|statement|command)/i.test(key)||typeof value==='function'||typeof value==='symbol')throw new WbsMcpError('WBS_MCP_ARGUMENTS_INVALID','WBS raw query arguments are forbidden.');
  }
  if(Object.hasOwn(args,'limit')&&(!Number.isSafeInteger(args.limit)||args.limit<1||args.limit>WBS_MCP_PILOT_LIMIT))throw new WbsMcpError('WBS_MCP_ARGUMENTS_INVALID','WBS pilot page limit must be between 1 and 10.');
  return structuredClone(args);
}

// cb_id is an accounting/relation locator.  It is not the immutable bank-row
// key: one accounting relationship can span several source rows.  Bank input
// remains fail-closed until the provider supplies its own immutable key.
const stableKeyByTool=Object.freeze({list_payables:'ap_guid',list_bank_transactions:'bank_transaction_id',list_autorec_details:'pd_guid',list_autorec_banks:'pb_guid',list_journal_entries:'id'});
export function validateWbsReadEnvelope({toolName,envelope}={}){
  if(!WBS_READONLY_TOOLS.includes(toolName)||!plainObject(envelope)||!Array.isArray(envelope.rows)||!/^[0-9a-f]{64}$/.test(envelope.content_sha256)||typeof envelope.contract_version!=='string'||!envelope.contract_version.trim()||envelope.tool!==toolName||typeof envelope.environment!=='string'||envelope.environment.toLowerCase()!=='production'||typeof envelope.captured_at!=='string'||Number.isNaN(Date.parse(envelope.captured_at))||!plainObject(envelope.source)||!plainObject(envelope.scope)||!Number.isSafeInteger(envelope.record_count)||envelope.record_count!==envelope.rows.length||(envelope.cursor_next!==null&&typeof envelope.cursor_next!=='string')||(envelope.etl_notice!==null&&typeof envelope.etl_notice!=='string'))throw new WbsMcpError('WBS_MCP_ENVELOPE_INVALID','WBS production read envelope, scope, count, hash, or cursor is invalid.');
  const scopeCompany=scopedText(envelope.scope.company);
  const scopeCurrency=scopedText(envelope.scope.currency).toUpperCase();
  const snapshotToken=envelope.scope.snapshot_token;
  if(snapshotToken!==undefined&&(typeof snapshotToken!=='string'||!/^[A-Za-z0-9._~:-]{1,256}$/.test(snapshotToken)))throw new WbsMcpError('WBS_MCP_ENVELOPE_INVALID','WBS provider snapshot_token must be an opaque bounded token without control characters.');
  if(envelope.cursor_next!==null&&!snapshotToken)throw new WbsMcpError('WBS_MCP_PAGINATION_SNAPSHOT_TOKEN_REQUIRED','Every cursor-paged WBS response must echo its immutable provider snapshot token.');
  if(scopeCurrency&&scopeCurrency!=='USD')throw new WbsMcpError('WBS_MCP_CURRENCY_UNSUPPORTED','WBS pilot accepts USD scope only.');
  if(scopeCompany&&envelope.rows.some(row=>plainObject(row)&&row.company_code!=null&&scopedText(row.company_code)!==scopeCompany||plainObject(row)&&row.company!=null&&scopedText(row.company)!==scopeCompany))throw new WbsMcpError('WBS_MCP_ENVELOPE_SCOPE_MISMATCH','WBS row company does not match the requested company scope.');
  if(scopeCurrency&&envelope.rows.some(row=>plainObject(row)&&row.currency!=null&&scopedText(row.currency).toUpperCase()!==scopeCurrency))throw new WbsMcpError('WBS_MCP_ENVELOPE_SCOPE_MISMATCH','WBS row currency does not match the requested currency scope.');
  const stableKey=stableKeyByTool[toolName];
  if(stableKey&&envelope.rows.some(row=>!plainObject(row)||(stableKey==='id'?!Number.isSafeInteger(row[stableKey]):typeof row[stableKey]!=='string'||!row[stableKey].trim())))throw new WbsMcpError('WBS_MCP_ENVELOPE_INVALID',`WBS ${toolName} rows require stable ${stableKey}.`);
  // The content hash preserves array order.  Require the provider's stable
  // source key to be strictly ascending so a repeated row cannot silently
  // inflate a later control total or appear as two source facts.
  if(stableKey&&!envelope.rows.every((row,index)=>index===0||envelope.rows[index-1][stableKey]<row[stableKey]))throw new WbsMcpError('WBS_MCP_ROWS_NOT_SORTED','WBS rows must be strictly ascending and unique by their stable source key.');
  if(envelope.rows.some(row=>plainObject(row)&&row.currency!=null&&row.currency!=='USD'))throw new WbsMcpError('WBS_MCP_CURRENCY_UNSUPPORTED','WBS pilot accepts USD rows only.');
  const expectedHash=createHash('sha256').update(canonicalRequestBody(envelope.rows),'utf8').digest('hex');
  if(!timingSafeEqual(Buffer.from(envelope.content_sha256,'hex'),Buffer.from(expectedHash,'hex')))throw new WbsMcpError('WBS_MCP_CONTENT_HASH_MISMATCH','WBS content_sha256 does not match canonical sorted compact rows.');
  return Object.freeze({tool_name:toolName,contract_version:envelope.contract_version,environment:envelope.environment,captured_at:envelope.captured_at,source:Object.freeze(structuredClone(envelope.source)),scope:Object.freeze(structuredClone(envelope.scope)),record_count:envelope.record_count,content_sha256:envelope.content_sha256,cursor_next:envelope.cursor_next,etl_notice:envelope.etl_notice,rows:Object.freeze(structuredClone(envelope.rows)),requires_snapshot_diff:true,has_revision_contract:false,has_cdc_contract:false,has_tombstone_contract:false});
}

export function createReadOnlyWbsMcpClient({endpoint,getAuthHeaders,allowedReadTools=[],fetcher=globalThis.fetch,timeoutMs=15000}={}){
  const url=endpointUrl(endpoint);
  if(typeof getAuthHeaders!=='function'||typeof fetcher!=='function')throw new WbsMcpError('WBS_MCP_CONFIG_INVALID','WBS MCP requires an injected credential-header provider and fetch implementation.');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)throw new WbsMcpError('WBS_MCP_CONFIG_INVALID','WBS MCP timeout is invalid.');
  const allowed=new Set(allowedReadTools);
  if([...allowed].some(name=>!safeToolName(name)||!WBS_READONLY_TOOLS.includes(name)))throw new WbsMcpError('WBS_MCP_CONFIG_INVALID','WBS read-tool allowlist must use only the eight approved tools.');
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
      tools=result.tools.map(toolMetadata);
      const names=tools.map(tool=>tool.name).sort();
      if(JSON.stringify(names)!==JSON.stringify([...WBS_READONLY_TOOLS].sort())||tools.some(tool=>!tool.readOnly||tool.destructive||!tool.idempotent))throw new WbsMcpError('WBS_MCP_TOOL_CATALOG_INVALID','WBS MCP tool catalog is not the exact read-only idempotent contract.');
      // REFS never accepts a first page as a final control/trace population.
      // Every data view must therefore advertise the opaque token that REFS
      // echoes on cursor reads; otherwise a provider could return page one but
      // reject the safe completion request after a partial view was accepted.
      if(tools.some(tool=>{
        if(!WBS_CURSOR_READ_TOOLS.has(tool.name))return false;
        const properties=plainObject(tool.inputSchema?.properties)?tool.inputSchema.properties:{};
        return !plainObject(properties.cursor)||properties.cursor.type!=='string'||!plainObject(properties.snapshot_token)||properties.snapshot_token.type!=='string';
      }))throw new WbsMcpError('WBS_MCP_TOOL_CATALOG_INVALID','Every WBS cursor-readable tool must publish string cursor and snapshot_token arguments.');
      return tools.map(tool=>({...tool}));
    },
    async readView({toolName,args}={}){
      if(!initialized||!tools)throw new WbsMcpError('WBS_MCP_NOT_READY','Initialize and inspect WBS MCP tools before reading a view.');
      if(!allowed.has(toolName))throw new WbsMcpError('WBS_MCP_TOOL_FORBIDDEN','WBS tool is not allowlisted for read-only use.');
      const tool=tools.find(candidate=>candidate.name===toolName);
      if(!tool||!tool.readOnly||tool.destructive||!tool.idempotent)throw new WbsMcpError('WBS_MCP_TOOL_FORBIDDEN','WBS tool is not declared read-only and idempotent by the MCP server.');
      const safe=safeArguments(args),properties=plainObject(tool.inputSchema?.properties)?tool.inputSchema.properties:{};
      if(Object.keys(safe).some(key=>!Object.hasOwn(properties,key)))throw new WbsMcpError('WBS_MCP_ARGUMENTS_INVALID','WBS tool arguments must match the published input schema.');
      const result=await rpc('tools/call',{name:toolName,arguments:safe});
      if(!plainObject(result)||!Array.isArray(result.content)||result.isError===true)throw new WbsMcpError('WBS_MCP_REMOTE_REJECTED','WBS read-only tool rejected the request.');
      const text=result.content.find(item=>plainObject(item)&&item.type==='text'&&typeof item.text==='string')?.text;
      let payload;try{payload=text?JSON.parse(text):result.structuredContent;}catch{throw new WbsMcpError('WBS_MCP_ENVELOPE_INVALID','WBS tool returned invalid envelope JSON.');}
      return validateWbsReadEnvelope({toolName,envelope:payload});
    }
  });
}
