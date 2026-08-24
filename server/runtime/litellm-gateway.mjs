import {randomUUID} from 'node:crypto';

const SECRET_KEY=/(?:authorization|api[_-]?key|secret|password|token|cookie|private[_-]?key|credential)/i;
const text=value=>typeof value==='string'?value.trim():'';
const safeJson=value=>value&&typeof value==='object'&&!Array.isArray(value);

export class LiteLlmGatewayError extends Error {constructor(code,message){super(message);this.code=code;}}

export function redactAiFacts(value,{depth=0}={}){
  if(depth>8)throw new LiteLlmGatewayError('AI_FACTS_DEPTH_EXCEEDED','AI facts exceed the maximum nesting depth');
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return value.length>12000?`${value.slice(0,12000)} [TRUNCATED]`:value;
  if(Array.isArray(value)){if(value.length>100)throw new LiteLlmGatewayError('AI_FACTS_ARRAY_LIMIT','AI facts exceed the maximum array length');return value.map(item=>redactAiFacts(item,{depth:depth+1}));}
  if(!safeJson(value))throw new LiteLlmGatewayError('AI_FACTS_INVALID','AI facts must be JSON-compatible');
  const output={};for(const [key,item] of Object.entries(value)){output[key]=SECRET_KEY.test(key)?'[REDACTED]':redactAiFacts(item,{depth:depth+1});}return Object.freeze(output);
}

export function liteLlmConfig({baseUrl,apiKey,model='gpt-4.1-mini',timeoutMs=45000}={}){
  const raw=text(baseUrl),key=text(apiKey),selected=text(model);let endpoint;
  try{endpoint=new URL(raw);}catch{throw new LiteLlmGatewayError('LITELLM_BASE_URL_INVALID','LITELLM_BASE_URL must be an absolute HTTPS URL');}
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new LiteLlmGatewayError('LITELLM_BASE_URL_INVALID','LITELLM_BASE_URL must be a credential-free HTTPS URL');
  if(!key||key.length<12)throw new LiteLlmGatewayError('LITELLM_API_KEY_INVALID','LITELLM_API_KEY is required and must not be logged');
  if(!/^[A-Za-z0-9._:/-]{2,160}$/.test(selected))throw new LiteLlmGatewayError('LITELLM_MODEL_INVALID','LITELLM_MODEL is invalid');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw new LiteLlmGatewayError('LITELLM_TIMEOUT_INVALID','LITELLM_TIMEOUT_MS must be between 1000 and 120000');
  const basePath=endpoint.pathname.replace(/\/+$/,'').replace(/^\/$/,'');endpoint.pathname=`${basePath.endsWith('/v1')?basePath:`${basePath}/v1`}/chat/completions`.replace(/^\/\//,'/');
  return Object.freeze({endpoint:endpoint.toString(),apiKey:key,model:selected,timeoutMs});
}

export class LiteLlmGateway {
  constructor({config,fetcher=globalThis.fetch,clock=()=>Date.now()}={}){if(!config||typeof fetcher!=='function')throw new LiteLlmGatewayError('LITELLM_GATEWAY_INVALID','LiteLLM gateway requires configuration and fetch');this.config=config;this.fetcher=fetcher;this.clock=clock;}
  async analyzeJson({traceId=`refs-ai-${randomUUID()}`,traceName='refs-accounting-analysis',actorId,facts,systemInstruction,jsonSchema}={}){
    if(!text(actorId)||!safeJson(facts)||!text(systemInstruction)||!safeJson(jsonSchema)||!text(jsonSchema.name)||!safeJson(jsonSchema.schema))throw new LiteLlmGatewayError('AI_ANALYSIS_REQUEST_INVALID','AI analysis requires actor identity, facts, system instruction, and JSON schema');
    const safeFacts=redactAiFacts(facts),serializedFacts=JSON.stringify({facts:safeFacts});if(Buffer.byteLength(serializedFacts,'utf8')>1_000_000)throw new LiteLlmGatewayError('AI_FACTS_SIZE_LIMIT','AI facts exceed the maximum serialized byte length');
    const startedAt=this.clock(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);
    const payload={model:this.config.model,temperature:0,messages:[{role:'system',content:systemInstruction},{role:'user',content:serializedFacts}],response_format:{type:'json_schema',json_schema:{name:text(jsonSchema.name),strict:true,schema:jsonSchema.schema}},metadata:{trace_id:traceId,trace_name:traceName,trace_user_id:text(actorId)}};
    try{const response=await this.fetcher(this.config.endpoint,{method:'POST',signal:controller.signal,headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${this.config.apiKey}`},body:JSON.stringify(payload)});if(!response?.ok)throw new LiteLlmGatewayError('LITELLM_UNAVAILABLE','The configured AI gateway did not accept the analysis request');let body;try{body=await response.json();}catch{throw new LiteLlmGatewayError('LITELLM_PROTOCOL_INVALID','The configured AI gateway returned unreadable JSON');}const content=body?.choices?.[0]?.message?.content;if(typeof content!=='string'||content.length>50000)throw new LiteLlmGatewayError('LITELLM_PROTOCOL_INVALID','The configured AI gateway returned no bounded structured response');let result;try{result=JSON.parse(content);}catch{throw new LiteLlmGatewayError('LITELLM_PROTOCOL_INVALID','The configured AI gateway returned non-JSON structured output');}if(!safeJson(result))throw new LiteLlmGatewayError('LITELLM_PROTOCOL_INVALID','The configured AI gateway returned a non-object analysis');return Object.freeze({result:Object.freeze(result),traceId,providerRequestId:typeof body.id==='string'?body.id:null,model:this.config.model,elapsedMs:this.clock()-startedAt});}catch(error){if(error instanceof LiteLlmGatewayError)throw error;throw new LiteLlmGatewayError('LITELLM_UNAVAILABLE','The configured AI gateway could not be reached');}finally{clearTimeout(timer);}
  }
}

export function createLiteLlmGateway(options={}){return new LiteLlmGateway({config:liteLlmConfig(options),fetcher:options.fetcher,clock:options.clock});}
