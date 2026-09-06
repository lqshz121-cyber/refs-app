import {accountingApiConfig,authoritativeBearerHeaders,readAuthoritativeJournalEntryDetail} from './accounting-api.js';
import {validSettlementHistorySelection,validSettlementHistory} from './document-settlement-history-contract.js';
const fail=message=>({ok:false,message});
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export async function readDocumentSettlementHistory({config,businessDocumentId,kind,afterId=null,limit=25,fetcher=globalThis.fetch}={}){
  if(!accountingApiConfig({__REFS_ACCOUNTING_API__:config})||!uuid(businessDocumentId)||!validSettlementHistorySelection({settlementKind:kind,afterId,limit}))return fail('Choose a company and source document.');
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('Sign in to read settlement history.');
  const query=new URLSearchParams({kind,limit:String(limit)});if(afterId!==null)query.set('afterId',afterId);
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/business-documents/${businessDocumentId}/settlements?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return fail('Settlement history could not be loaded. Refresh to retry.');
    const body=await response.json();if(body?.ok!==true||!validSettlementHistory(body.data,{entityId:config.entityId,businessDocumentId,settlementKind:kind,afterId,limit}))return fail('Settlement history did not match this document. Refresh to retry.');
    return {ok:true,data:body.data};
  }catch{return fail('Settlement history could not be confirmed. Refresh to retry.');}
}
export async function readSettlementJournal({config,row,fetcher=globalThis.fetch}={}){
  const journalEntryId=row?.posted_journal_entry_id||row?.draft_journal_entry_id;
  if(!uuid(journalEntryId)||!uuid(row?.period_id))return fail('This record has no available journal link.');
  const targetConfig={...config,periodId:row.period_id,scopePresentation:{...config?.scopePresentation,periodLabel:row.period_code,periodStart:null,periodEnd:null}};
  const result=await readAuthoritativeJournalEntryDetail({config:targetConfig,journalEntryId,fetcher});if(!result.ok)return result;
  const journal=result.journal;
  if(String(journal.revision)!==row.journal_revision||journal.currency!==row.currency||journal.status!==row.journal_status)return fail('The journal changed. Refresh history before opening it again.');
  return {ok:true,config:targetConfig,journal};
}
