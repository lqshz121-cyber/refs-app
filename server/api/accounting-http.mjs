import {createServer} from 'node:http';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_BODY_KEYS=new Set(['actor','actorId','actor_id','tenantId','tenant_id','entityId','entity_id','requestHash','request_hash']);

export class AccountingApiError extends Error{
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}

const header=(headers,name)=>{
  if(typeof headers?.get==='function')return headers.get(name);
  const key=Object.keys(headers||{}).find(candidate=>candidate.toLowerCase()===name.toLowerCase());
  const value=key?headers[key]:null;return Array.isArray(value)?value[0]:value;
};
const requireUuid=(value,name)=>{if(!UUID.test(value||''))throw new AccountingApiError(400,'INVALID_PATH_PARAMETER',`${name} must be a UUID`);return value;};
const requireIdempotency=headers=>{const value=header(headers,'idempotency-key');if(typeof value!=='string'||value.length<8||value.length>200)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_REQUIRED','Idempotency-Key must be 8-200 characters');return value;};
const requireRevision=headers=>{const raw=header(headers,'if-match');if(raw==null)throw new AccountingApiError(428,'IF_MATCH_REQUIRED','If-Match is required');const cleaned=String(raw).replace(/^W\//,'').replace(/^"|"$/g,'');if(!/^\d+$/.test(cleaned))throw new AccountingApiError(400,'INVALID_IF_MATCH','If-Match must contain a non-negative revision');return Number(cleaned);};
const validateBody=body=>{if(!body||typeof body!=='object'||Array.isArray(body))throw new AccountingApiError(400,'JSON_OBJECT_REQUIRED','Request body must be a JSON object');for(const key of Object.keys(body))if(FORBIDDEN_BODY_KEYS.has(key))throw new AccountingApiError(400,'IDENTITY_FIELD_FORBIDDEN',`${key} must come from authenticated context`);return body;};
const allowOnly=(body,allowed)=>{const unexpected=Object.keys(body).filter(key=>!allowed.includes(key));if(unexpected.length)throw new AccountingApiError(400,'UNEXPECTED_FIELD',`Unexpected request field: ${unexpected[0]}`);return body;};

function statusFor(error){
  if(error instanceof AccountingApiError)return error.status;
  if(error?.code==='42501')return 403;if(error?.code==='P0002')return 404;
  if(['23505','40001'].includes(error?.code))return 409;if(error?.code==='55000')return 423;
  if(['22023','23503','23514'].includes(error?.code))return 422;return 500;
}

export function createAccountingApi({authenticate,kernelFactory,attachmentServiceFactory}={}){
  if(typeof authenticate!=='function'||typeof kernelFactory!=='function')throw new Error('Accounting API requires authenticate and kernelFactory');
  return async function dispatch({method,url,headers={},body=null}){
    try{
      const principal=await authenticate({method,url,headers});
      if(!principal||principal.trusted!==true||!UUID.test(principal.tenantId||'')||!principal.actorId)throw new AccountingApiError(401,'AUTHENTICATION_REQUIRED','Authenticated principal is required');
      const pathname=new URL(url,'http://refs.local').pathname;const parts=pathname.split('/').filter(Boolean);
      if(parts[0]!=='api'||parts[1]!=='v1'||parts[2]!=='entities')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
      if(method!=='POST')throw new AccountingApiError(405,'METHOD_NOT_ALLOWED','Only POST is supported on this command API');
      const entityId=requireUuid(parts[3],'entityId');const payload=validateBody(body);const idempotencyKey=requireIdempotency(headers);
      let result;
      if(parts.length===6&&parts[4]==='attachments'&&parts[5]==='reservations'){
        if(typeof attachmentServiceFactory!=='function')throw new AccountingApiError(503,'ATTACHMENT_SERVICE_UNAVAILABLE','Attachment service is unavailable');
        allowOnly(payload,['name','mediaType','sizeBytes','contentHash']);const service=await attachmentServiceFactory(principal);result=await service.reserve(principal,{...payload,tenantId:principal.tenantId,entityId,idempotencyKey});
      }else if(parts.length===7&&parts[4]==='attachments'&&parts[6]==='finalize'){
        if(typeof attachmentServiceFactory!=='function')throw new AccountingApiError(503,'ATTACHMENT_SERVICE_UNAVAILABLE','Attachment service is unavailable');
        allowOnly(payload,[]);const service=await attachmentServiceFactory(principal);
        try{result=await service.finalize(principal,{tenantId:principal.tenantId,entityId,attachmentId:requireUuid(parts[5],'attachmentId'),idempotencyKey});}
        catch(error){if(['42501','P0002','ATTACHMENT_NOT_FOUND'].includes(error?.code))throw new AccountingApiError(404,'ATTACHMENT_NOT_FOUND','Attachment was not found');throw error;}
      }else if(parts.length===6&&parts[4]==='journal-entries'&&parts[5]==='manual'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.createManualJournal({...payload,tenantId:principal.tenantId,entityId,idempotencyKey});
      }else if(parts.length===6&&parts[4]==='journal-entries'&&parts[5]==='auto'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.createAutoJournal({...payload,tenantId:principal.tenantId,entityId,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='journal-entries'&&parts[6]==='transitions'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.transitionJournal({tenantId:principal.tenantId,entityId,journalEntryId:requireUuid(parts[5],'journalEntryId'),action:parts[7].toUpperCase(),expectedRevision:requireRevision(headers),reason:payload.reason??null,idempotencyKey});
      }else if(parts.length===7&&parts[4]==='journal-entries'&&parts[6]==='post'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.postJournal({tenantId:principal.tenantId,entityId,journalEntryId:requireUuid(parts[5],'journalEntryId'),periodId:requireUuid(payload.periodId,'periodId'),expectedRevision:requireRevision(headers),idempotencyKey});
      }else if(parts.length===8&&parts[4]==='journal-entries'&&parts[6]==='adjustments'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.createJournalAdjustment({...payload,action:parts[7].toUpperCase(),tenantId:principal.tenantId,entityId,originalJournalEntryId:requireUuid(parts[5],'journalEntryId'),idempotencyKey});
      }else throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
      return {status:result?.idempotent?200:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
    }catch(error){const status=statusFor(error);return {status,headers:{'content-type':'application/problem+json','cache-control':'no-store'},body:{ok:false,code:error.code||'INTERNAL_ERROR',message:status===500?'Internal server error':error.message}};}
  };
}

export function createAccountingHttpServer({authenticate,kernelFactory,attachmentServiceFactory,maxBodyBytes=1024*1024,healthCheck}={}){
  const dispatch=createAccountingApi({authenticate,kernelFactory,attachmentServiceFactory});
  return createServer(async(req,res)=>{
    const chunks=[];let size=0;
    try{
      const pathname=new URL(req.url,'http://refs.local').pathname;
      if(req.method==='GET'&&pathname==='/health/live'){
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end('{"ok":true,"status":"live"}');return;
      }
      if(req.method==='GET'&&pathname==='/health/ready'){
        let ready=false;try{ready=typeof healthCheck==='function'&&await healthCheck()===true;}catch{}
        res.writeHead(ready?200:503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok:ready,status:ready?'ready':'not_ready'}));return;
      }
      for await(const chunk of req){size+=chunk.length;if(size>maxBodyBytes)throw new AccountingApiError(413,'BODY_TOO_LARGE','Request body exceeds limit');chunks.push(chunk);}
      let body={};if(chunks.length){try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AccountingApiError(400,'INVALID_JSON','Request body is not valid JSON');}}
      const response=await dispatch({method:req.method,url:req.url,headers:req.headers,body});res.writeHead(response.status,response.headers);res.end(JSON.stringify(response.body));
    }catch(error){const status=statusFor(error);res.writeHead(status,{'content-type':'application/problem+json','cache-control':'no-store'});res.end(JSON.stringify({ok:false,code:error.code||'INTERNAL_ERROR',message:status===500?'Internal server error':error.message}));}
  });
}
