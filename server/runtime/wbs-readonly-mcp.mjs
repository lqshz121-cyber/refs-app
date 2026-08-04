const WBS_MCP_ORIGIN='https://db-mcp.wbm3.com';
export const WBS_MCP_PROTOCOL_VERSION='2025-03-26';

export class WbsMcpError extends Error {
  constructor(code,message){super(message);this.name='WbsMcpError';this.code=code;}
}

const plainObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const safeToolName=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(value);
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
    try{return await response.json();}catch{throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP returned invalid JSON.');}
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
  return {name:tool.name,description:typeof tool.description==='string'?tool.description:'',readOnly:tool.annotations?.readOnlyHint===true,inputSchema:plainObject(tool.inputSchema)?tool.inputSchema:{}};
}

function safeArguments(args){
  if(!plainObject(args))throw new WbsMcpError('WBS_MCP_ARGUMENTS_INVALID','WBS view arguments must be an object.');
  for(const [key,value] of Object.entries(args)){
    if(/(?:sql|query|statement|command)/i.test(key)||typeof value==='function'||typeof value==='symbol')throw new WbsMcpError('WBS_MCP_ARGUMENTS_INVALID','WBS raw query arguments are forbidden.');
  }
  return structuredClone(args);
}

export function createReadOnlyWbsMcpClient({endpoint,getAccessToken,allowedReadTools=[],fetcher=globalThis.fetch,timeoutMs=15000}={}){
  const url=endpointUrl(endpoint);
  if(typeof getAccessToken!=='function'||typeof fetcher!=='function')throw new WbsMcpError('WBS_MCP_CONFIG_INVALID','WBS MCP requires an access-token provider and fetch implementation.');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)throw new WbsMcpError('WBS_MCP_CONFIG_INVALID','WBS MCP timeout is invalid.');
  const allowed=new Set(allowedReadTools);
  if([...allowed].some(name=>!safeToolName(name)))throw new WbsMcpError('WBS_MCP_CONFIG_INVALID','WBS read-tool allowlist is invalid.');
  let requestId=0,sessionId=null,initialized=false,tools=null;

  async function rpc(method,params){
    const token=await getAccessToken();
    if(typeof token!=='string'||token.length<16||token.length>8192)throw new WbsMcpError('WBS_MCP_AUTHENTICATION_REQUIRED','WBS MCP authentication is required.');
    const headers={accept:'application/json, text/event-stream','content-type':'application/json',authorization:`Bearer ${token}`,'mcp-protocol-version':WBS_MCP_PROTOCOL_VERSION};
    if(sessionId)headers['mcp-session-id']=sessionId;
    const controller=typeof AbortController==='function'?new AbortController():null,timeout=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
    try{
      let response;try{response=await fetcher(url,{method:'POST',headers,redirect:'error',cache:'no-store',signal:controller?.signal,body:JSON.stringify({jsonrpc:'2.0',id:++requestId,method,params})});}
      catch{throw new WbsMcpError('WBS_MCP_UNAVAILABLE','WBS MCP is unavailable.');}
      if(response.status===401||response.status===403)throw new WbsMcpError('WBS_MCP_AUTHENTICATION_REQUIRED','WBS MCP authentication is required.');
      if(!response.ok)throw new WbsMcpError('WBS_MCP_UNAVAILABLE','WBS MCP request was rejected.');
      const envelope=await responseEnvelope(response,requestId);
      if(!plainObject(envelope)||envelope.jsonrpc!=='2.0'||envelope.id!==requestId)throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP response correlation failed.');
      if(envelope.error)throw new WbsMcpError('WBS_MCP_REMOTE_REJECTED','WBS MCP rejected the request.');
      if(!Object.hasOwn(envelope,'result'))throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP response has no result.');
      const receivedSession=response.headers.get('mcp-session-id');
      if(receivedSession){if(!/^[A-Za-z0-9._~-]{8,512}$/.test(receivedSession))throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP returned an invalid session identifier.');sessionId=receivedSession;}
      return envelope.result;
    }finally{if(timeout)clearTimeout(timeout);}
  }

  return Object.freeze({
    async initialize(){
      const result=await rpc('initialize',{protocolVersion:WBS_MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'refs-wbs-readonly-connector',version:'0.1.0'}});
      if(!plainObject(result)||typeof result.protocolVersion!=='string')throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP initialize response is invalid.');
      initialized=true;return {protocolVersion:result.protocolVersion,serverName:typeof result.serverInfo?.name==='string'?result.serverInfo.name:null};
    },
    async listTools(){
      if(!initialized)throw new WbsMcpError('WBS_MCP_NOT_INITIALIZED','Initialize WBS MCP before listing tools.');
      const result=await rpc('tools/list',{});
      if(!plainObject(result)||!Array.isArray(result.tools))throw new WbsMcpError('WBS_MCP_PROTOCOL_INVALID','WBS MCP tool list is invalid.');
      tools=result.tools.map(toolMetadata);return tools.map(tool=>({...tool}));
    },
    async readView({toolName,args}={}){
      if(!initialized||!tools)throw new WbsMcpError('WBS_MCP_NOT_READY','Initialize and inspect WBS MCP tools before reading a view.');
      if(!allowed.has(toolName))throw new WbsMcpError('WBS_MCP_TOOL_FORBIDDEN','WBS tool is not allowlisted for read-only use.');
      const tool=tools.find(candidate=>candidate.name===toolName);
      if(!tool||!tool.readOnly)throw new WbsMcpError('WBS_MCP_TOOL_FORBIDDEN','WBS tool is not declared read-only by the MCP server.');
      const result=await rpc('tools/call',{name:toolName,arguments:safeArguments(args)});
      if(!plainObject(result)||!Array.isArray(result.content)||result.isError===true)throw new WbsMcpError('WBS_MCP_REMOTE_REJECTED','WBS read-only tool rejected the request.');
      return structuredClone(result);
    }
  });
}
