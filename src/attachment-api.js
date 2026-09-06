import {accountingApiConfig, authoritativeBearerHeaders} from './accounting-api.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedMediaTypes=new Set(['application/pdf','image/png','image/jpeg','text/csv']);
const fail=(code,message)=>({ok:false,code,message});
const cleanText=value=>typeof value==='string'?value.trim():'';
const validIdempotency=value=>typeof value==='string'&&value.length>=8&&value.length<=180;
const hex=buffer=>[...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const responseFailure=async response=>{let body;try{body=await response.json();}catch{}return fail(typeof body?.code==='string'?body.code:'ATTACHMENT_API_UNAVAILABLE',response.status>=500?'Attachment service failed.':typeof body?.message==='string'?body.message:'Attachment request was rejected.');};
const normalizeConfig=config=>accountingApiConfig({__REFS_ACCOUNTING_API__:config});
export const validateAttachmentReservation=(result,{mediaType,contentHash}={})=>{
  if(!UUID.test(result?.attachment_id||'')||typeof result?.upload_url!=='string'||!result.upload_url||!result?.required_headers||typeof result.required_headers!=='object'||Array.isArray(result.required_headers))return null;
  let uploadUrl;try{uploadUrl=new URL(result.upload_url);}catch{return null;}
  if(uploadUrl.protocol!=='https:'||uploadUrl.username||uploadUrl.password)return null;
  const headers={};for(const [name,value] of Object.entries(result.required_headers)){const normalizedName=name.toLowerCase();if(!['content-type','x-amz-meta-sha256'].includes(normalizedName)||typeof value!=='string'||value.length>1024||headers[normalizedName]!=null)return null;headers[normalizedName]=value;}
  if(Object.keys(headers).length!==2||headers['content-type']!==mediaType||headers['x-amz-meta-sha256']!==contentHash)return null;
  return {attachmentId:result.attachment_id,uploadUrl:uploadUrl.toString(),requiredHeaders:headers};
};

export const validateAttachmentFile=file=>{
  const name=cleanText(file?.name),mediaType=cleanText(file?.type).toLowerCase(),sizeBytes=Number(file?.size);
  if(!name||name.length>255||/[\\/]/.test(name)||!allowedMediaTypes.has(mediaType)||!Number.isSafeInteger(sizeBytes)||sizeBytes<=0||sizeBytes>52428800||typeof file?.arrayBuffer!=='function')return null;
  return {name,mediaType,sizeBytes};
};

export async function uploadVerifiedAttachment({config=accountingApiConfig(),file,idempotencyKey,wbsInboundRowId=null,fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
  const metadata=validateAttachmentFile(file);
  const authoritativeConfig=normalizeConfig(config);
  if(!authoritativeConfig||typeof fetcher!=='function'||!cryptoApi?.subtle||!validIdempotency(idempotencyKey)||!metadata||wbsInboundRowId!==null&&!UUID.test(wbsInboundRowId))return fail('ATTACHMENT_UPLOAD_INVALID','Attachment name, type, size, row purpose, or command configuration is invalid.');
  let bytes,contentHash;try{bytes=await file.arrayBuffer();if(bytes.byteLength!==metadata.sizeBytes)return fail('ATTACHMENT_SIZE_MISMATCH','Attachment size changed before upload.');contentHash=`sha256:${hex(await cryptoApi.subtle.digest('SHA-256',bytes))}`;}catch{return fail('ATTACHMENT_HASH_UNAVAILABLE','Attachment content could not be hashed.');}
  const authorization=await authoritativeBearerHeaders(authoritativeConfig);if(!authorization)return fail('AUTHENTICATION_REQUIRED','An OIDC access token is required for the authoritative accounting API.');
  let reservationResponse,reservationBody;
  const reservationPath=wbsInboundRowId?`/wbs/inbound/payables/${wbsInboundRowId}/attachments/reservations`:'/attachments/reservations';
  try{reservationResponse=await fetcher(`${authoritativeConfig.baseUrl}/api/v1/entities/${authoritativeConfig.entityId}${reservationPath}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify({...metadata,contentHash})});if(!reservationResponse.ok)return await responseFailure(reservationResponse);reservationBody=await reservationResponse.json();}catch{return fail('ATTACHMENT_API_UNAVAILABLE','Attachment reservation failed.');}
  const retained=reservationBody?.ok===true?reservationBody.data:null;
  if(!wbsInboundRowId&&retained?.status==='VERIFIED_CLEAN'){
    const fields=['attachment_id','entity_id','status','name','media_type','size_bytes','content_hash','idempotent'];
    const size=typeof retained.size_bytes==='number'||typeof retained.size_bytes==='string'&&/^\d+$/.test(retained.size_bytes)?Number(retained.size_bytes):null;
    if(Object.keys(retained).length!==fields.length||fields.some(field=>!Object.hasOwn(retained,field))||reservationResponse.status!==200||retained.idempotent!==true||!UUID.test(retained.attachment_id||'')||retained.entity_id!==authoritativeConfig.entityId||retained.name!==metadata.name||retained.media_type!==metadata.mediaType||size!==metadata.sizeBytes||retained.content_hash!==contentHash)return fail('ATTACHMENT_API_PROTOCOL','The retained attachment did not match the selected file and company.');
    return {ok:true,attachmentId:retained.attachment_id,status:'VERIFIED_CLEAN',idempotent:true};
  }
  const reservation=reservationBody?.ok===true?validateAttachmentReservation(reservationBody.data,{mediaType:metadata.mediaType,contentHash}):null;if(!reservation)return fail('ATTACHMENT_API_PROTOCOL','Attachment reservation returned an invalid upload contract.');
  let uploadResponse;try{uploadResponse=await fetcher(reservation.uploadUrl,{method:'PUT',credentials:'omit',cache:'no-store',redirect:'error',headers:reservation.requiredHeaders,body:file});if(!uploadResponse.ok)return fail('ATTACHMENT_UPLOAD_FAILED','Object storage rejected the attachment upload.');}catch{return fail('ATTACHMENT_UPLOAD_FAILED','Object storage upload failed.');}
  const finalizeAuthorization=await authoritativeBearerHeaders(authoritativeConfig);if(!finalizeAuthorization)return fail('AUTHENTICATION_REQUIRED','A fresh OIDC access token is required to finalize the authoritative attachment.');
  let finalizeResponse,finalizeBody;try{finalizeResponse=await fetcher(`${authoritativeConfig.baseUrl}/api/v1/entities/${authoritativeConfig.entityId}/attachments/${reservation.attachmentId}/finalize`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':`${idempotencyKey}:final`,...finalizeAuthorization},body:'{}'});if(!finalizeResponse.ok)return await responseFailure(finalizeResponse);finalizeBody=await finalizeResponse.json();}catch{return fail('ATTACHMENT_FINALIZE_UNAVAILABLE','Attachment finalization failed.');}
  const finalized=finalizeBody?.ok===true?finalizeBody.data:null;if(!UUID.test(finalized?.attachment_id||'')||finalized.attachment_id!==reservation.attachmentId||finalized.status!=='VERIFIED_CLEAN')return fail('ATTACHMENT_FINALIZE_REJECTED','Attachment was not verified clean by the authoritative service.');
  return {ok:true,attachmentId:reservation.attachmentId,status:finalized.status,idempotent:reservationResponse.status===200&&finalizeResponse.status===200};
}
