const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const TOKEN=/^[A-Za-z0-9._~+/=-]{16,4096}$/;
const EVENT_KEYS=['aggregate_id','aggregate_type','attempt_count','available_at','created_at','entity_id','event_type','last_error','locked_at','locked_by','outbox_event_id','payload','payload_hash','published_at','status','tenant_id'];
const RECEIPT_KEYS=['accepted','outbox_event_id','payload_hash','schema_version'];
const SECRET_KEY=/(^|_)(authorization|api_key|access_token|refresh_token|private_key|password|credential|client_secret|session_token)($|_)/i;
const SECRET_VALUE=/(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,})/i;
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify(keys);
const fail=(code,message,{retryable=false}={})=>{const error=new Error(message);error.code=code;error.retryable=retryable;throw error;};
const canonicalTime=value=>{const date=value instanceof Date?value:new Date(value);if(!Number.isFinite(date.valueOf()))return null;return date.toISOString();};
const containsSecret=value=>{if(typeof value==='string')return SECRET_VALUE.test(value);if(Array.isArray(value))return value.some(containsSecret);if(value&&typeof value==='object')return Object.entries(value).some(([key,nested])=>SECRET_KEY.test(key)||containsSecret(nested));return false;};

export function validateClaimedOutboxEvent(value,{tenantId}={}){
  if(!exactKeys(value,EVENT_KEYS))fail('OUTBOX_EVENT_CONTRACT_INVALID','Claimed outbox event has an open or incomplete shape.');
  if(!UUID.test(value.outbox_event_id)||!UUID.test(value.tenant_id)||!UUID.test(value.entity_id)||!UUID.test(value.aggregate_id)||value.tenant_id!==tenantId)fail('OUTBOX_EVENT_SCOPE_INVALID','Claimed outbox event scope is invalid.');
  if(typeof value.aggregate_type!=='string'||!value.aggregate_type||typeof value.event_type!=='string'||!value.event_type||!SHA.test(value.payload_hash)||!value.payload||typeof value.payload!=='object'||Array.isArray(value.payload))fail('OUTBOX_EVENT_CONTRACT_INVALID','Claimed outbox event evidence is invalid.');
  if(containsSecret(value.payload))fail('OUTBOX_EVENT_SECRET_DENIED','Claimed outbox event contains credential-shaped material.');
  if(value.status!=='PENDING'||!Number.isSafeInteger(value.attempt_count)||value.attempt_count<1||typeof value.locked_by!=='string'||!value.locked_by||!canonicalTime(value.locked_at)||!canonicalTime(value.available_at)||!canonicalTime(value.created_at)||value.published_at!==null)fail('OUTBOX_EVENT_STATE_INVALID','Claimed outbox event state is invalid.');
  return Object.freeze({schema_version:'REFS_OUTBOX_EVENT_V1',outbox_event_id:value.outbox_event_id,tenant_id:value.tenant_id,entity_id:value.entity_id,aggregate_type:value.aggregate_type,aggregate_id:value.aggregate_id,event_type:value.event_type,payload:value.payload,payload_hash:value.payload_hash,attempt_count:value.attempt_count,created_at:canonicalTime(value.created_at)});
}

export class HttpOutboxPublisher{
  constructor({endpoint,token,fetcher=globalThis.fetch,timeoutMs=10000,nodeEnv=process.env.NODE_ENV}={}){
    let url;try{url=new URL(endpoint);}catch{fail('OUTBOX_PUBLISHER_CONFIG_INVALID','Outbox publisher endpoint is invalid.');}
    if(url.username||url.password||url.hash||(nodeEnv==='production'&&url.protocol!=='https:')||!['https:','http:'].includes(url.protocol))fail('OUTBOX_PUBLISHER_CONFIG_INVALID','Outbox publisher endpoint must be credential-free HTTPS in production.');
    if(typeof token!=='string'||!TOKEN.test(token))fail('OUTBOX_PUBLISHER_CONFIG_INVALID','Outbox publisher token is invalid.');
    if(typeof fetcher!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)fail('OUTBOX_PUBLISHER_CONFIG_INVALID','Outbox publisher transport configuration is invalid.');
    this.endpoint=url.toString();this.token=token;this.fetcher=fetcher;this.timeoutMs=timeoutMs;
  }
  async publish(event){
    const body=JSON.stringify(event);if(new TextEncoder().encode(body).byteLength>1000000)fail('OUTBOX_EVENT_TOO_LARGE','Outbox event exceeds the publisher request limit.');
    const controller=new AbortController();let timer,response,reader,consumed=false;
    // Keep one deadline through headers AND the full bounded receipt. A peer
    // that sends headers and then stalls must not pin the dispatch loop forever.
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Object.assign(new Error('Outbox publisher transport failed.'),{code:'OUTBOX_PUBLISH_TRANSPORT_FAILED',retryable:true}));controller.abort();},this.timeoutMs);});
    try{
      return await Promise.race([deadline,(async()=>{
        response=await this.fetcher(this.endpoint,{method:'POST',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json','idempotency-key':event.outbox_event_id,'x-refs-payload-hash':event.payload_hash},body,signal:controller.signal,redirect:'error'});
        if(controller.signal.aborted){response.body?.cancel().catch(()=>{});fail('OUTBOX_PUBLISH_TRANSPORT_FAILED','Outbox publisher transport failed.',{retryable:true});}
        if(!response.ok)fail(response.status===408||response.status===425||response.status===429||response.status>=500?'OUTBOX_PUBLISH_RETRYABLE':'OUTBOX_PUBLISH_REJECTED','Outbox publisher rejected the event.',{retryable:response.status===408||response.status===425||response.status===429||response.status>=500});
        if(!/\bno-store\b/i.test(response.headers.get('cache-control')||''))fail('OUTBOX_PUBLISH_RECEIPT_INVALID','Outbox publisher receipt is cacheable.');
        if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))fail('OUTBOX_PUBLISH_RECEIPT_INVALID','Outbox publisher receipt content type is invalid.');
        if(!response.body?.getReader)fail('OUTBOX_PUBLISH_RECEIPT_INVALID','Outbox publisher receipt body is unavailable.');
        reader=response.body.getReader();const bytes=new Uint8Array(4096);let length=0;
        while(true){
          const {done,value}=await reader.read();if(done){consumed=true;break;}
          if(value.byteLength>bytes.length-length)fail('OUTBOX_PUBLISH_RECEIPT_INVALID','Outbox publisher receipt is too large.');
          bytes.set(value,length);length+=value.byteLength;
        }
        let receipt;try{receipt=JSON.parse(new TextDecoder().decode(bytes.subarray(0,length)));}catch{fail('OUTBOX_PUBLISH_RECEIPT_INVALID','Outbox publisher receipt is not JSON.');}
        if(!exactKeys(receipt,RECEIPT_KEYS)||receipt.schema_version!=='REFS_OUTBOX_PUBLISH_RECEIPT_V1'||receipt.accepted!==true||receipt.outbox_event_id!==event.outbox_event_id||receipt.payload_hash!==event.payload_hash)fail('OUTBOX_PUBLISH_RECEIPT_INVALID','Outbox publisher receipt does not bind the event.');
        return Object.freeze({...receipt});
      })()]);
    }catch(error){
      if(['OUTBOX_PUBLISH_TRANSPORT_FAILED','OUTBOX_PUBLISH_RETRYABLE','OUTBOX_PUBLISH_REJECTED','OUTBOX_PUBLISH_RECEIPT_INVALID'].includes(error?.code))throw error;
      fail('OUTBOX_PUBLISH_TRANSPORT_FAILED','Outbox publisher transport failed.',{retryable:true});
    }finally{
      clearTimeout(timer);
      if(!consumed){controller.abort();try{(reader?reader.cancel():response?.body?.cancel())?.catch(()=>{});}catch{}}
      try{reader?.releaseLock();}catch{}
    }
  }
}

export class OutboxDispatchService{
  constructor({kernelFactory,publisher,maxAttempts=8,retryBaseSeconds=5,leaseSeconds=300}={}){
    if(typeof kernelFactory!=='function'||typeof publisher?.publish!=='function'||!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>100||!Number.isSafeInteger(retryBaseSeconds)||retryBaseSeconds<1||retryBaseSeconds>3600||!Number.isSafeInteger(leaseSeconds)||leaseSeconds<5||leaseSeconds>3600)fail('OUTBOX_DISPATCH_CONFIG_INVALID','Outbox dispatch service configuration is invalid.');
    this.kernelFactory=kernelFactory;this.publisher=publisher;this.maxAttempts=maxAttempts;this.retryBaseSeconds=retryBaseSeconds;this.leaseSeconds=leaseSeconds;
  }
  async runOnce(principal,{tenantId,scopes,limit=100}={}){
    if(!principal?.trusted||typeof principal.actorId!=='string'||!principal.actorId||!UUID.test(tenantId)||!Array.isArray(scopes)||scopes.length===0||scopes.length>100||scopes.some(scope=>!exactKeys(scope,['entityId','grantSetVersion'])||!UUID.test(scope.entityId)||!Number.isSafeInteger(scope.grantSetVersion)||scope.grantSetVersion<1)||new Set(scopes.map(scope=>scope.entityId)).size!==scopes.length||!Number.isSafeInteger(limit)||limit<1||limit>500)fail('OUTBOX_DISPATCH_SCOPE_INVALID','Outbox dispatch requires a trusted service identity and exact entity/grant-revision scopes.');
    const allowedEntities=new Set(scopes.map(scope=>scope.entityId));
    const kernel=await this.kernelFactory(principal,{tenantId}),claimed=await kernel.claimOutboxV3({tenantId,scopes,limit,leaseSeconds:this.leaseSeconds});
    if(!Array.isArray(claimed)||claimed.length>limit)fail('OUTBOX_CLAIM_CONTRACT_INVALID','Outbox claim result is invalid.');
    const results=[];
    for(const row of claimed){
      if(!allowedEntities.has(row?.entity_id))fail('OUTBOX_EVENT_SCOPE_INVALID','Claimed outbox event entity is outside the configured release scope.');
      let event;
      try{event=validateClaimedOutboxEvent(row,{tenantId});}catch(error){
        if(!UUID.test(row?.outbox_event_id||'')||row?.tenant_id!==tenantId)throw error;
        const errorCode=/^[A-Z][A-Z0-9_]{2,79}$/.test(error?.code||'')?error.code:'OUTBOX_EVENT_CONTRACT_INVALID',completion=await kernel.completeOutboxV2({tenantId,eventId:row.outbox_event_id,success:false,retryable:false,errorCode,maxAttempts:this.maxAttempts,retryBaseSeconds:this.retryBaseSeconds});
        results.push(Object.freeze({outbox_event_id:row.outbox_event_id,status:completion.status,error_code:errorCode,attempt_count:row.attempt_count,completion}));continue;
      }
      let receipt;
      try{
        receipt=await this.publisher.publish(event);
      }catch(error){
        const errorCode=/^[A-Z][A-Z0-9_]{2,79}$/.test(error?.code||'')?error.code:'OUTBOX_PUBLISH_INTERNAL';
        const completion=await kernel.completeOutboxV2({tenantId,eventId:event.outbox_event_id,success:false,retryable:error?.retryable===true,errorCode,maxAttempts:this.maxAttempts,retryBaseSeconds:this.retryBaseSeconds});
        results.push(Object.freeze({outbox_event_id:event.outbox_event_id,status:completion.status,error_code:errorCode,attempt_count:event.attempt_count,completion}));
        continue;
      }
      const completion=await kernel.completeOutboxV2({tenantId,eventId:event.outbox_event_id,success:true,maxAttempts:this.maxAttempts,retryBaseSeconds:this.retryBaseSeconds});
      results.push(Object.freeze({outbox_event_id:event.outbox_event_id,status:'PUBLISHED',attempt_count:event.attempt_count,receipt,completion}));
    }
    return Object.freeze(results);
  }
}
