import {accountingApiConfig,authoritativeBearerHeaders,readAuthoritativeSourceDocumentDetail} from './accounting-api.js';
import {validMappingExceptionSelection,validMappingExceptionRegister} from './mapping-exception-register-contract.js';
const fail=message=>({ok:false,message});
export async function readMappingExceptionRegister({config,fetcher=globalThis.fetch}={}){
  const selection={periodId:config?.periodId};
  if(!accountingApiConfig({__REFS_ACCOUNTING_API__:config})||!validMappingExceptionSelection(selection))return fail('Choose a company and accounting period.');
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('Sign in to read Mapping Exceptions.');
  const query=new URLSearchParams({periodId:selection.periodId});
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/mapping-exceptions?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return fail('Mapping Exceptions could not be loaded. Refresh to retry.');
    const body=await response.json();if(body?.ok!==true||!validMappingExceptionRegister(body.data,{entityId:config.entityId,...selection}))return fail('Mapping Exceptions did not match this company and period. Refresh to retry.');
    return {ok:true,data:body.data};
  }catch{return fail('Mapping Exceptions could not be confirmed. Refresh to retry.');}
}
export async function readMappingExceptionSource({config,row,fetcher=globalThis.fetch}={}){
  const result=await readAuthoritativeSourceDocumentDetail({config,sourceDocumentId:row?.source_document_id,fetcher});if(!result.ok)return result;
  if(result.detail.source_document_id!==row.source_document_id||result.detail.source_document_revision!==row.source_document_revision||result.detail.payload_hash!==row.payload_hash)return fail('The Source Document changed from this exception. Refresh to retry.');
  return {ok:true,detail:result.detail};
}
