import {accountingApiConfig,authoritativeBearerHeaders,readAuthoritativeJournalEntryDetail} from './accounting-api.js';
import {validBusinessRecordKind,validBusinessRecord} from './business-record-detail-contract.js';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const fail=message=>({ok:false,message});
export async function readRelatedBusinessRecord({config,row,target,fetcher=globalThis.fetch}={}){
  const creditKind=row?.adjustment_kind,credit=target==='CREDIT',recordId=credit?row?.business_adjustment_id:row?.business_document_id;
  const recordKind=credit?creditKind:creditKind==='AP_VENDOR_CREDIT'?'AP_BILL':'AR_INVOICE';
  if(!accountingApiConfig({__REFS_ACCOUNTING_API__:config})||!['CREDIT','DOCUMENT'].includes(target)||!['AP_VENDOR_CREDIT','AR_CREDIT_MEMO'].includes(creditKind)||!uuid(recordId)||!validBusinessRecordKind(recordKind)||typeof row.currency!=='string'||!/^[A-Z]{3}$/.test(row.currency))return fail('This allocation has no valid business record link.');
  return readBusinessRecord({config,recordId,recordKind,currency:row.currency,fetcher});
}
export async function readBusinessRecord({config,recordId,recordKind,currency,fetcher=globalThis.fetch}={}){
  if(!accountingApiConfig({__REFS_ACCOUNTING_API__:config})||!uuid(recordId)||!validBusinessRecordKind(recordKind)||typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))return fail('This record has no valid scoped link.');
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('Sign in to read this record.');
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/business-records/${recordId}?${new URLSearchParams({recordKind})}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return fail('The linked record could not be loaded. Refresh history and retry.');
    const body=await response.json();if(body?.ok!==true||!validBusinessRecord(body.data,{entityId:config.entityId,recordId,recordKind})||body.data.record.currency!==currency)return fail('The linked record did not match the selection. Refresh and retry.');
    return {ok:true,record:body.data.record};
  }catch{return fail('The linked record could not be confirmed. Retry.');}
}
export async function readListedBusinessRecordJournal({config,row,recordKind,fetcher=globalThis.fetch}={}){
  const document=['AP_BILL','AR_INVOICE'].includes(recordKind),recordId=document?row?.business_document_id:row?.business_adjustment_id,revision=String(document?row?.revision:row?.version);
  if(!uuid(row?.period_id)||row.period_id!==config?.periodId||!/^(0|[1-9]\d{0,18})$/.test(revision))return fail('Return to the list and reopen this record.');
  const result=await readBusinessRecord({config,recordId,recordKind,currency:row?.currency,fetcher});
  if(!result.ok)return result;
  const record=result.record;
  if(record.revision!==revision||record.status!==row.status||record.period_id!==row.period_id)return fail('This record changed. Refresh the list before opening its journal.');
  return readBusinessRecordJournal({config,record,fetcher});
}
export async function readBusinessRecordJournal({config,record,fetcher=globalThis.fetch}={}){
  if(!uuid(record?.journal_entry_id)||!uuid(record?.period_id))return fail('This record has no available journal link.');
  const targetConfig={...config,periodId:record.period_id,scopePresentation:{...config?.scopePresentation,periodLabel:'Source journal period',periodStart:null,periodEnd:null}};
  const result=await readAuthoritativeJournalEntryDetail({config:targetConfig,journalEntryId:record.journal_entry_id,fetcher});if(!result.ok)return result;
  const journal=result.journal;if(String(journal.revision)!==record.journal_revision||journal.currency!==record.currency||journal.status!==record.journal_status)return fail('The linked journal changed. Return to history and reopen the record.');
  return {ok:true,config:{...targetConfig,scopePresentation:{...targetConfig.scopePresentation,periodLabel:journal.journal_date.slice(0,7)}},journal};
}
