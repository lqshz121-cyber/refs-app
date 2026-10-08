import {accountingApiConfig,authoritativeBearerHeaders} from './accounting-api.js';
import {validReceiptRow} from './receipt-register-contract.js';
const fail=message=>({ok:false,message});
export async function readReceiptFile({config,row,fetcher=globalThis.fetch}={}){
  if(!accountingApiConfig({__REFS_ACCOUNTING_API__:config})||!validReceiptRow(row))return fail('Choose one immutable receipt.');
  if(!row.storage_ref.startsWith('s3://')||/^(pending:|test-only:)/i.test(row.storage_version))return fail('This receipt has no retained provider file. Test-only evidence is not a real attachment.');
  const expected=Number(row.size_bytes);
  if(!Number.isSafeInteger(expected)||expected>25*1024*1024)return fail('Receipt exceeds the download limit.');
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('Sign in to download receipt evidence.');
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/receipts/${row.receipt_id}/file`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/octet-stream',...authorization}});
    if(!response.ok)return fail(response.status===403?'Receipt file access is denied.':response.status===503?'Retained receipt file storage is unavailable.':'Receipt file could not be confirmed.');
    if(response.headers.get('content-type')!=='application/octet-stream'||response.headers.get('x-receipt-id')!==row.receipt_id||response.headers.get('x-receipt-attachment-id')!==row.attachment_id||response.headers.get('x-receipt-content-hash')!==row.content_hash||response.headers.get('x-receipt-object-version')!==encodeURIComponent(row.storage_version)){await response.body?.cancel?.();return fail('Receipt file identity changed. Refresh to retry.');}
    const reader=response.body?.getReader();if(!reader)return fail('Receipt file stream is unavailable.');
    const chunks=[];let length=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array)||(length+=value.byteLength)>expected)throw new Error('Receipt size mismatch');chunks.push(value);}if(length!==expected)throw new Error('Receipt size mismatch');}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const digest=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),hash='sha256:'+Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==row.content_hash)return fail('Receipt file hash does not match retained evidence.');
    return {ok:true,bytes,filename:row.attachment_name.replace(/[\x00-\x1f\x7f"\\/]/g,'_')};
  }catch{return fail('Receipt file could not be verified. No file was saved.');}
}
