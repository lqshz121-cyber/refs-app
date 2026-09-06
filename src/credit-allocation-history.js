import {accountingApiConfig,authoritativeBearerHeaders,readAuthoritativeJournalEntryDetail} from './accounting-api.js';
import {validCreditHistorySelection,validCreditHistory} from './credit-allocation-history-contract.js';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const fail=message=>({ok:false,message});
export async function readCreditAllocationHistory({config,subjectId,kind,afterId=null,limit=25,fetcher=globalThis.fetch}={}){
  const selection={entityId:config?.entityId,subjectId,subjectKind:kind,afterId,limit};
  if(!accountingApiConfig({__REFS_ACCOUNTING_API__:config})||!uuid(subjectId)||!validCreditHistorySelection(selection))return fail('Choose a company and credit or document.');
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('Sign in to read credit history.');
  const resource=['AP_VENDOR_CREDIT','AR_CREDIT_MEMO'].includes(kind)?'business-adjustments':'business-documents',query=new URLSearchParams({subjectKind:kind,limit:String(limit)});if(afterId!==null)query.set('afterId',afterId);
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/${resource}/${subjectId}/credit-allocations?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return fail('Credit history could not be loaded. Refresh to retry.');
    const body=await response.json();if(body?.ok!==true||!validCreditHistory(body.data,selection))return fail('Credit history did not match this record. Refresh to retry.');return {ok:true,data:body.data};
  }catch{return fail('Credit history could not be confirmed. Refresh to retry.');}
}
export async function readCreditAllocationJournal({config,row,fetcher=globalThis.fetch}={}){
  if(!uuid(row?.journal_entry_id)||!uuid(row?.journal_period_id)||row?.journal_status!=='POSTED')return fail('This allocation has no posted journal link.');
  const targetConfig={...config,periodId:row.journal_period_id,scopePresentation:{...config?.scopePresentation,periodLabel:'Source journal period',periodStart:null,periodEnd:null}};
  const result=await readAuthoritativeJournalEntryDetail({config:targetConfig,journalEntryId:row.journal_entry_id,fetcher});if(!result.ok)return result;
  const journal=result.journal;if(String(journal.revision)!==row.journal_revision||journal.currency!==row.currency||journal.status!=='POSTED')return fail('The journal changed. Refresh history before opening it again.');
  return {ok:true,config:{...targetConfig,scopePresentation:{...targetConfig.scopePresentation,periodLabel:journal.journal_date.slice(0,7)}},journal};
}
