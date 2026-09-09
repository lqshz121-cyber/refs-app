import {accountingApiConfig,authoritativeBearerHeaders,readAuthoritativeJournalEntryDetail} from './accounting-api.js';
import {validConstructionLoanRegisterSelection,validConstructionLoanRegister} from './construction-loan-register-contract.js';
const fail=message=>({ok:false,message});
export async function readConstructionLoanRegister({config,fetcher=globalThis.fetch}={}){
  const selection={periodId:config?.periodId};
  if(!accountingApiConfig({__REFS_ACCOUNTING_API__:config})||!validConstructionLoanRegisterSelection(selection))return fail('Choose a company and accounting period.');
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('Sign in to read the Loan Register.');
  const query=new URLSearchParams({periodId:selection.periodId});
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/reports/construction-loan-register?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return fail('The Loan Register could not be loaded. Refresh to retry.');
    const body=await response.json();if(body?.ok!==true||!validConstructionLoanRegister(body.data,{entityId:config.entityId,...selection}))return fail('The Loan Register did not match this company and period. Refresh to retry.');
    return {ok:true,data:body.data};
  }catch{return fail('The Loan Register could not be confirmed. Refresh to retry.');}
}
export async function readConstructionLoanJournal({config,journalEntryId,currency,fetcher=globalThis.fetch}={}){
  const result=await readAuthoritativeJournalEntryDetail({config,journalEntryId,fetcher});if(!result.ok)return result;
  if(result.journal.status!=='POSTED'||result.journal.currency!==currency)return fail('The posted Journal no longer matches this Loan Register row. Refresh to retry.');
  return {ok:true,journal:result.journal};
}
