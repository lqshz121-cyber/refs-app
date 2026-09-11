import {accountingApiConfig,authoritativeBearerHeaders,readAuthoritativeJournalEntryDetail} from './accounting-api.js';
import {validBillPaymentRegisterSelection,validBillPaymentRegister} from './bill-payment-register-contract.js';
const fail=message=>({ok:false,message});
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export async function readBillPaymentRegister({config,afterId=null,limit=25,fetcher=globalThis.fetch}={}){
  const selection={periodId:config?.periodId,afterId,limit};
  if(!accountingApiConfig({__REFS_ACCOUNTING_API__:config})||!validBillPaymentRegisterSelection(selection))return fail('Choose a company and accounting period.');
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('Sign in to read Bill Payments.');
  const query=new URLSearchParams({periodId:selection.periodId,limit:String(limit)});if(afterId!==null)query.set('afterId',afterId);
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ap/bill-payments?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return fail('Bill Payments could not be loaded. Refresh to retry.');
    const body=await response.json();if(body?.ok!==true||!validBillPaymentRegister(body.data,{entityId:config.entityId,...selection}))return fail('Bill Payments did not match this company and period. Refresh to retry.');
    return {ok:true,data:body.data};
  }catch{return fail('Bill Payments could not be confirmed. Refresh to retry.');}
}
export async function readBillPaymentJournal({config,row,fetcher=globalThis.fetch}={}){
  if(!uuid(row?.journal_entry_id)||row?.journal_revision==null)return fail('This payment has no available journal link.');
  const result=await readAuthoritativeJournalEntryDetail({config,journalEntryId:row.journal_entry_id,fetcher});if(!result.ok)return result;
  const journal=result.journal;
  if(String(journal.revision)!==row.journal_revision||journal.currency!==row.currency||journal.status!==row.journal_status)return fail('The journal changed. Refresh Bill Payments before opening it again.');
  return {ok:true,journal};
}
