const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_CODE=/^[A-Za-z0-9._-]{1,64}$/;

export const accountingApiConfig=(environment=globalThis)=>{
  const source=environment?.__REFS_ACCOUNTING_API__;
  if(!source||typeof source!=='object'||!UUID.test(source.entityId||'')||!UUID.test(source.periodId||''))return null;
  let baseUrl;try{baseUrl=new URL(source.baseUrl);}catch{return null;}
  if(baseUrl.protocol!=='https:'||baseUrl.username||baseUrl.password)return null;
  const cashAccountCode=typeof source.cashAccountCode==='string'&&ACCOUNT_CODE.test(source.cashAccountCode)?source.cashAccountCode:null;
  return {baseUrl:baseUrl.toString().replace(/\/$/,''),entityId:source.entityId,periodId:source.periodId,cashAccountCode};
};

const documentRow=(row,kind)=>({
  ...(kind==='AP_BILL'?{bill_id:row.business_document_id,bill_no:row.document_number,invoice_no:row.document_number,vendor_id:row.counterparty_ref,vendor_name:row.counterparty_name,bill_date:row.accounting_date}:{inv_id:row.business_document_id,inv_no:row.document_number,customer_id:row.counterparty_ref,customer_name:row.counterparty_name,inv_date:row.accounting_date}),
  due_date:row.due_date,amount:Number(row.gross_amount),open_balance:Number(row.open_balance),currency:row.currency,status:row.status,je_number:row.posted_journal_entry_id||null,revision:row.version,journal_entry_id:row.journal_entry_id,journal_status:row.journal_status,journal_revision:row.journal_revision,period_id:row.period_id,account_code:row.offset_account_code,description:row.description,
});

export async function refreshAuthoritativeDocuments({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function')return {ok:false,code:'ACCOUNTING_API_UNAVAILABLE',message:'No authoritative accounting API is configured.'};
  const read=async path=>{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json'}});if(!response.ok)return null;const body=await response.json();return body?.ok===true&&Array.isArray(body.data)?body.data:null;};
  try{const [bills,invoices]=await Promise.all([read('/ap/bills'),read('/ar/invoices')]);if(!bills||!invoices)return {ok:false,code:'ACCOUNTING_API_UNAVAILABLE',message:'Authoritative accounting refresh failed.'};return {ok:true,ap:{bills:bills.map(row=>documentRow(row,'AP_BILL')),dupBlocked:0},ar:{invoices:invoices.map(row=>documentRow(row,'AR_INVOICE'))}};}catch{return {ok:false,code:'ACCOUNTING_API_UNAVAILABLE',message:'Authoritative accounting refresh failed.'};}
}

const failure=async response=>{let body;try{body=await response.json();}catch{}return {ok:false,code:typeof body?.code==='string'?body.code:'ACCOUNTING_API_UNAVAILABLE',message:response.status>=500?'Authoritative accounting command failed.':typeof body?.message==='string'?body.message:'Authoritative accounting command was rejected.'};};

export async function createAuthoritativeBusinessDocument({config,kind,document,idempotencyKey,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!['AP_BILL','AR_INVOICE'].includes(kind)||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Authoritative command configuration is invalid.'};
  const path=kind==='AP_BILL'?'/ap/bills':'/ar/invoices';
  const body={periodId:config.periodId,documentNumber:document.documentNumber,counterpartyRef:String(document.counterpartyRef),counterpartyName:document.counterpartyName,currency:document.currency,accountingDate:document.accountingDate,dueDate:document.dueDate,amount:document.amount,offsetAccountCode:document.offsetAccountCode,description:document.description||null,attachmentIds:[]};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey},body:JSON.stringify(body)});if(!response.ok)return await failure(response);const result=await response.json();if(result?.ok!==true||!result.data)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid command envelope.'};return {ok:true,data:result.data,idempotent:response.status===200};}catch{return {ok:false,code:'ACCOUNTING_API_UNAVAILABLE',message:'Authoritative accounting command failed.'};}
}

export async function createAuthoritativeSettlement({config,kind,businessDocumentId,accountingDate,amount,idempotencyKey,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(businessDocumentId||'')||!['AP_PAYMENT','AR_RECEIPT'].includes(kind)||typeof config.cashAccountCode!=='string'||!config.cashAccountCode.trim()||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Settlement requires authoritative cash-account configuration.'};
  const path=kind==='AP_PAYMENT'?`/ap/bills/${businessDocumentId}/payments`:`/ar/invoices/${businessDocumentId}/receipts`;
  const body=kind==='AP_PAYMENT'?{periodId:config.periodId,paymentNumber:idempotencyKey,paymentDate:accountingDate,cashAccountCode:config.cashAccountCode,bankMemberRef:null,amount,reason:'UI-authoritative AP payment'}:{periodId:config.periodId,receiptNumber:idempotencyKey,receiptDate:accountingDate,cashAccountCode:config.cashAccountCode,bankMemberRef:null,amount,reason:'UI-authoritative AR receipt'};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey},body:JSON.stringify(body)});if(!response.ok)return await failure(response);const result=await response.json();if(result?.ok!==true||!result.data)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid settlement envelope.'};return {ok:true,data:result.data,idempotent:response.status===200};}catch{return {ok:false,code:'ACCOUNTING_API_UNAVAILABLE',message:'Authoritative settlement command failed.'};}
}

export async function createAuthoritativeAdjustment({config,kind,adjustment,idempotencyKey,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!['AP_VENDOR_CREDIT','AR_CREDIT_MEMO','AR_REFUND'].includes(kind)||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Adjustment command configuration is invalid.'};
  const common={periodId:config.periodId,amount:adjustment?.amount,reason:adjustment?.reason};
  let path,body;
  if(kind==='AP_VENDOR_CREDIT'){path='/ap/vendor-credits';body={...common,creditNumber:adjustment?.number,creditDate:adjustment?.date,vendorRef:String(adjustment?.counterpartyRef||''),vendorName:adjustment?.counterpartyName,lines:adjustment?.lines};}
  else if(kind==='AR_CREDIT_MEMO'){path='/ar/credit-memos';body={...common,memoNumber:adjustment?.number,memoDate:adjustment?.date,customerRef:String(adjustment?.counterpartyRef||''),customerName:adjustment?.counterpartyName,lines:adjustment?.lines};}
  else {if(typeof config.cashAccountCode!=='string'||!config.cashAccountCode)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Refund requires authoritative cash-account configuration.'};path='/ar/refunds';body={...common,sourceAdjustmentId:adjustment?.sourceAdjustmentId,refundNumber:adjustment?.number,refundDate:adjustment?.date,cashAccountCode:config.cashAccountCode};}
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey},body:JSON.stringify(body)});if(!response.ok)return await failure(response);const result=await response.json();if(result?.ok!==true||!result.data)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid adjustment envelope.'};return {ok:true,data:result.data,idempotent:response.status===200};}catch{return {ok:false,code:'ACCOUNTING_API_UNAVAILABLE',message:'Authoritative accounting adjustment failed.'};}
}

export async function applyAuthoritativeCredit({config,kind,businessAdjustmentId,businessDocumentId,amount,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(businessAdjustmentId||'')||!UUID.test(businessDocumentId||'')||!['AP_VENDOR_CREDIT','AR_CREDIT_MEMO'].includes(kind)||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Credit allocation command configuration is invalid.'};
  const path=kind==='AP_VENDOR_CREDIT'?`/ap/vendor-credits/${businessAdjustmentId}/allocations`:`/ar/credit-memos/${businessAdjustmentId}/allocations`;
  const body={businessDocumentId,amount,reason};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey},body:JSON.stringify(body)});if(!response.ok)return await failure(response);const result=await response.json();if(result?.ok!==true||!result.data)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid allocation envelope.'};return {ok:true,data:result.data,idempotent:response.status===200};}catch{return {ok:false,code:'ACCOUNTING_API_UNAVAILABLE',message:'Authoritative credit allocation failed.'};}
}

export async function transitionAuthoritativeJournal({config,journalEntryId,revision,action,fetcher=globalThis.fetch}={}){
  const command=String(action||'').toUpperCase();
  if(!config||typeof fetcher!=='function'||!UUID.test(journalEntryId||'')||!Number.isSafeInteger(revision)||revision<0||!['SUBMIT','REVIEW','APPROVE','POST'].includes(command))return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Journal workflow command is invalid.'};
  const post=command==='POST',path=post?`/journal-entries/${journalEntryId}/post`:`/journal-entries/${journalEntryId}/transitions/${command.toLowerCase()}`,body=post?{periodId:config.periodId}:{};
  const idempotencyKey=`UI-JE-${journalEntryId}-${revision}-${command}`;
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,'if-match':`"${revision}"`},body:JSON.stringify(body)});if(!response.ok)return await failure(response);const result=await response.json();if(result?.ok!==true||!result.data)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid workflow envelope.'};return {ok:true,data:result.data,idempotent:response.status===200};}catch{return {ok:false,code:'ACCOUNTING_API_UNAVAILABLE',message:'Authoritative journal workflow command failed.'};}
}
