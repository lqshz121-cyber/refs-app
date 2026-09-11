import {accountingApiConfig,authoritativeBearerHeaders,readAuthoritativeJournalEntryDetail,readAuthoritativeSourceDocumentDetail} from './accounting-api.js';
import {validAccountingStagingSelection,validAccountingStagingRegister} from './accounting-staging-register-contract.js';
const fail=message=>({ok:false,message});
export async function readAccountingStagingRegister({config,fetcher=globalThis.fetch}={}){
  const selection={periodId:config?.periodId};
  if(!accountingApiConfig({__REFS_ACCOUNTING_API__:config})||!validAccountingStagingSelection(selection))return fail('Choose a company and accounting period.');
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('Sign in to read Accounting Staging.');
  const query=new URLSearchParams({periodId:selection.periodId});
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/staging?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return fail('Accounting Staging could not be loaded. Refresh to retry.');
    const body=await response.json();if(body?.ok!==true||!validAccountingStagingRegister(body.data,{entityId:config.entityId,...selection}))return fail('Accounting Staging did not match this company and period. Refresh to retry.');
    return {ok:true,data:body.data};
  }catch{return fail('Accounting Staging could not be confirmed. Refresh to retry.');}
}
export async function readAccountingStagingSource({config,row,fetcher=globalThis.fetch}={}){
  const result=await readAuthoritativeSourceDocumentDetail({config,sourceDocumentId:row?.source_document_id,fetcher});if(!result.ok)return result;
  if(result.detail.source_document_id!==row.source_document_id||result.detail.source_document_revision!==row.source_document_revision||result.detail.payload_hash!==row.payload_hash)return fail('The Source Document changed from this staging row. Refresh to retry.');
  return {ok:true,detail:result.detail};
}
export async function readAccountingStagingJournal({config,evidence,fetcher=globalThis.fetch}={}){
  const result=await readAuthoritativeJournalEntryDetail({config,journalEntryId:evidence?.journal_entry_id,fetcher});if(!result.ok)return result;
  if(result.journal.journal_entry_id!==evidence.journal_entry_id||result.journal.status!==evidence.status||result.journal.revision!==evidence.revision)return fail('The Journal changed from this staging row. Refresh to retry.');
  return {ok:true,journal:result.journal};
}
