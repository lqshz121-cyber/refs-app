import {accountingApiConfig,authoritativeBearerHeaders,readAuthoritativeSourceDocumentDetail} from './accounting-api.js';
import {validReceiptSelection,validReceiptRow,validReceiptRegister} from './receipt-register-contract.js';
const fail=message=>({ok:false,message});
export async function readReceiptRegister({config,reviewStatus='FOR_REVIEW',fetcher=globalThis.fetch}={}){
  if(!accountingApiConfig({__REFS_ACCOUNTING_API__:config})||!validReceiptSelection({reviewStatus}))return fail('Choose a company and receipt review status.');
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('Sign in to read Receipts.');
  const query=new URLSearchParams({reviewStatus});
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/receipts?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return fail('Receipts could not be loaded. Refresh to retry.');
    const body=await response.json();if(body?.ok!==true||!validReceiptRegister(body.data,{entityId:config.entityId,reviewStatus}))return fail('Receipts did not match this company and review queue. Refresh to retry.');
    return {ok:true,data:body.data};
  }catch{return fail('Receipts could not be confirmed. Refresh to retry.');}
}
export async function readReceiptDetail({config,row,fetcher=globalThis.fetch}={}){
  if(!accountingApiConfig({__REFS_ACCOUNTING_API__:config})||!validReceiptRow(row))return fail('Choose one immutable receipt.');
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('Sign in to read receipt evidence.');
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/receipts/${row.receipt_id}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return fail('Receipt evidence could not be loaded. Refresh to retry.');
    const body=await response.json(),detail=body?.data;
    if(body?.ok!==true||!validReceiptRow(detail,{receiptId:row.receipt_id})||detail.attachment_id!==row.attachment_id||detail.content_hash!==row.content_hash||detail.storage_version!==row.storage_version||detail.source_document_id!==row.source_document_id||detail.source_document_revision!==row.source_document_revision||detail.source_payload_hash!==row.source_payload_hash||detail.review_status!==row.review_status)return fail('Receipt evidence changed from this queue row. Refresh to retry.');
    return {ok:true,detail};
  }catch{return fail('Receipt evidence could not be confirmed. Refresh to retry.');}
}
export async function readReceiptSource({config,receipt,fetcher=globalThis.fetch}={}){
  const result=await readAuthoritativeSourceDocumentDetail({config,sourceDocumentId:receipt?.source_document_id,fetcher});if(!result.ok)return result;
  if(result.detail.source_document_id!==receipt.source_document_id||result.detail.source_document_revision!==receipt.source_document_revision||result.detail.payload_hash!==receipt.source_payload_hash)return fail('The Source Document changed from this receipt. Refresh to retry.');
  return {ok:true,detail:result.detail};
}
