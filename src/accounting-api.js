const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_CODE=/^[A-Za-z0-9._-]{1,64}$/;
const BANK_ACCOUNT_REF=/^[^\u0000-\u001f\u007f]{1,128}$/;
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY4=/^-?[0-9]+\.[0-9]{4}$/;
const REPORT_MONEY4=/^-?(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$/;
const PERIOD_CODE=/^[0-9]{4}-(?:0[1-9]|1[0-2])$/;
const UNSIGNED_INTEGER=/^[0-9]+$/;

export const accountingApiConfig=(environment=globalThis)=>{
  const source=environment?.__REFS_ACCOUNTING_API__;
  if(!source||typeof source!=='object'||!UUID.test(source.entityId||'')||!UUID.test(source.periodId||'')||typeof source.getAccessToken!=='function')return null;
  let baseUrl;try{baseUrl=new URL(source.baseUrl);}catch{return null;}
  if(baseUrl.protocol!=='https:'||baseUrl.username||baseUrl.password)return null;
  const cashAccountCode=typeof source.cashAccountCode==='string'&&ACCOUNT_CODE.test(source.cashAccountCode)?source.cashAccountCode:null;
  return {baseUrl:baseUrl.toString().replace(/\/$/,''),entityId:source.entityId,periodId:source.periodId,cashAccountCode,getAccessToken:source.getAccessToken};
};

export const authoritativeBearerHeaders=async config=>{try{const token=await config?.getAccessToken?.();return typeof token==='string'&&/^[A-Za-z0-9._~-]{16,8192}$/.test(token)?{authorization:`Bearer ${token}`} : null;}catch{return null;}};
const authenticationRequired=()=>({ok:false,code:'AUTHENTICATION_REQUIRED',message:'An OIDC access token is required for the authoritative accounting API.'});

// ---------------------------------------------------------------------------
// Failure classification.
//
// A caller must be able to tell these apart, because the honest response to
// each is different: no HTTP response at all (a transport failure), an HTTP
// status the API chose, or a response whose shape the read contract rejects.
// Collapsing them into a single "unavailable" code states a cause the browser
// cannot observe. For 401 and 403 the status line is decisive and overrides any
// code in the body, so an authentication failure is never surfaced as an
// authorization failure or the reverse. A 403 body message is not echoed: an
// authorization refusal must not describe what the caller cannot see.
// ---------------------------------------------------------------------------
const httpFailureCode=status=>status===401?'AUTHENTICATION_REQUIRED':status===403?'AUTHORIZATION_DENIED':status===404?'ACCOUNTING_API_SCOPE_NOT_FOUND':status===429?'ACCOUNTING_API_RATE_LIMITED':status>=500?'ACCOUNTING_API_SERVER_ERROR':'ACCOUNTING_API_REQUEST_REJECTED';
const httpFailureMessage=(status,code)=>code==='AUTHENTICATION_REQUIRED'?'The accounting API did not accept the current session.':code==='AUTHORIZATION_DENIED'?'The accounting API refused this request for the configured entity and tenant.':code==='ACCOUNTING_API_SCOPE_NOT_FOUND'?'The accounting API does not hold the configured entity, period, or record.':code==='ACCOUNTING_API_RATE_LIMITED'?'The accounting API is rate limiting this client.':code==='ACCOUNTING_API_SERVER_ERROR'?`The accounting API reported a server error (HTTP ${status}).`:`The accounting API rejected the request (HTTP ${status}).`;
const notConfigured=()=>({ok:false,code:'CONFIGURATION_REQUIRED',message:'No authoritative accounting API is configured for this deployment.'});
const unreachable=detail=>({ok:false,code:'ACCOUNTING_API_UNREACHABLE',message:detail});
const validDate=value=>{if(!ISO_DATE.test(String(value||'')))return false;const parsed=new Date(`${value}T00:00:00.000Z`);return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;};

const TEXT_TOKEN=/^[^\u0000-\u001f\u007f]{1,255}$/;
const STATUS_TOKEN=/^[A-Z][A-Z0-9_]{0,63}$/;
const nullableUuid=value=>value===null||value===undefined||UUID.test(value||'');
const nullableRevision=value=>value===null||value===undefined||(UNSIGNED_INTEGER.test(String(value))&&Number.isSafeInteger(Number(value)));
const validTimestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&!Number.isNaN(new Date(value).valueOf());
const JOURNAL_TYPES=new Set(['MANUAL','AUTO','REVERSAL','RECLASS']);
const JOURNAL_STATUSES=new Set(['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED']);
const BANK_MATCH_STATUSES=new Set(['ACTIVE','UNMATCHED','REVERSED']);
const RECONCILIATION_STATUSES=new Set(['DRAFT','IN_REVIEW','RECONCILED','REOPENED']);

const journalRow=row=>{
  if(!row||!UUID.test(row.journal_entry_id||'')||!TEXT_TOKEN.test(row.journal_number||'')||!JOURNAL_TYPES.has(row.journal_type)||!JOURNAL_STATUSES.has(row.status)||!validDate(row.journal_date)||!/^[A-Z]{3}$/.test(row.currency||'')||row.description!==null&&row.description!==undefined&&(typeof row.description!=='string'||row.description.length>2000)||!UNSIGNED_INTEGER.test(String(row.revision??''))||!validTimestamp(row.created_at)||row.posted_at!==null&&row.posted_at!==undefined&&!validTimestamp(row.posted_at)||!UNSIGNED_INTEGER.test(String(row.ledger_line_count??'')))return null;
  const revision=Number(row.revision),ledgerLineCount=Number(row.ledger_line_count);
  if(!Number.isSafeInteger(revision)||revision<0||!Number.isSafeInteger(ledgerLineCount)||ledgerLineCount<0||(row.status==='POSTED')!==(row.posted_at!==null&&row.posted_at!==undefined))return null;
  return {journal_entry_id:row.journal_entry_id,journal_number:row.journal_number,journal_type:row.journal_type,status:row.status,journal_date:row.journal_date,currency:row.currency,description:row.description??null,revision,created_at:row.created_at,posted_at:row.posted_at??null,ledger_line_count:ledgerLineCount};
};

const documentRow=(row,kind)=>{
  if(!row||!UUID.test(row.business_document_id||'')||!TEXT_TOKEN.test(row.document_number||'')||!TEXT_TOKEN.test(row.counterparty_ref||'')||!TEXT_TOKEN.test(row.counterparty_name||'')||!/^[A-Z]{3}$/.test(row.currency||'')||!validDate(row.accounting_date)||row.due_date!==null&&row.due_date!==undefined&&!validDate(row.due_date)||!MONEY4.test(String(row.gross_amount??''))||!MONEY4.test(String(row.open_balance??''))||!STATUS_TOKEN.test(row.status||'')||!nullableUuid(row.posted_journal_entry_id)||!UNSIGNED_INTEGER.test(String(row.version??''))||!nullableUuid(row.journal_entry_id)||row.journal_status!==null&&row.journal_status!==undefined&&!STATUS_TOKEN.test(row.journal_status)||!nullableRevision(row.journal_revision)||!nullableUuid(row.period_id)||row.offset_account_code!==null&&row.offset_account_code!==undefined&&!ACCOUNT_CODE.test(row.offset_account_code)||row.description!==null&&row.description!==undefined&&typeof row.description!=='string')return null;
  const version=Number(row.version),journalRevision=row.journal_revision===null||row.journal_revision===undefined?null:Number(row.journal_revision),grossAmount=Number(row.gross_amount),openBalance=Number(row.open_balance);
  if(!Number.isSafeInteger(version)||version<0||journalRevision!==null&&(!Number.isSafeInteger(journalRevision)||journalRevision<0)||!Number.isFinite(grossAmount)||!Number.isFinite(openBalance))return null;
  return {
    business_document_id:row.business_document_id,
    ...(kind==='AP_BILL'?{bill_id:row.business_document_id,bill_no:row.document_number,invoice_no:row.document_number,vendor_id:row.counterparty_ref,vendor_name:row.counterparty_name,bill_date:row.accounting_date}:{inv_id:row.business_document_id,inv_no:row.document_number,customer_id:row.counterparty_ref,customer_name:row.counterparty_name,inv_date:row.accounting_date}),
    due_date:row.due_date??null,amount:grossAmount,open_balance:openBalance,currency:row.currency,status:row.status,je_number:row.posted_journal_entry_id||null,revision:version,journal_entry_id:row.journal_entry_id??null,journal_status:row.journal_status??null,journal_revision:journalRevision,period_id:row.period_id??null,account_code:row.offset_account_code??null,description:row.description??null,
  };
};

const adjustmentRow=(row,side)=>{
  if(!row||!UUID.test(row.business_adjustment_id||'')||!STATUS_TOKEN.test(row.adjustment_kind||'')||!row.adjustment_kind.startsWith(`${side}_`)||!nullableUuid(row.business_document_id)||!nullableUuid(row.source_adjustment_id)||!MONEY4.test(String(row.amount??''))||!/^[A-Z]{3}$/.test(row.currency||'')||!validDate(row.accounting_date)||!UUID.test(row.period_id||'')||typeof row.reason!=='string'||!STATUS_TOKEN.test(row.status||'')||!UNSIGNED_INTEGER.test(String(row.version??''))||!nullableUuid(row.journal_entry_id)||row.journal_status!==null&&row.journal_status!==undefined&&!STATUS_TOKEN.test(row.journal_status)||!nullableRevision(row.journal_revision)||!validTimestamp(row.created_at))return null;
  const version=Number(row.version),journalRevision=row.journal_revision===null||row.journal_revision===undefined?null:Number(row.journal_revision),amount=Number(row.amount);
  if(!Number.isSafeInteger(version)||version<0||journalRevision!==null&&(!Number.isSafeInteger(journalRevision)||journalRevision<0)||!Number.isFinite(amount))return null;
  return {...row,amount,version,journal_revision:journalRevision};
};

const bankTransactionRow=(row,account)=>{
  if(!row||!UUID.test(row.bank_source_id||'')||row.bank_account_ref!==account||!TEXT_TOKEN.test(row.external_bank_line_id||'')||!validDate(row.transaction_date)||!/^[A-Z]{3}$/.test(row.currency||'')||!MONEY4.test(String(row.amount??''))||!UNSIGNED_INTEGER.test(String(row.version??''))||!UUID.test(row.source_document_id||'')||!TEXT_TOKEN.test(row.source_ref||'')||!TEXT_TOKEN.test(row.document_type||''))return null;
  const matchId=row.bank_match_id??null;
  const matchValues=['match_status','business_source_document_id','journal_entry_id','journal_line_id','candidate_rule_code','amount_delta','currency_match','date_delta_days','matched_by','matched_at','match_version'];
  if(matchId===null){if(matchValues.some(field=>row[field]!==null&&row[field]!==undefined))return null;}
  else if(!UUID.test(matchId)||!BANK_MATCH_STATUSES.has(row.match_status)||!UUID.test(row.business_source_document_id||'')||!nullableUuid(row.journal_entry_id)||!nullableUuid(row.journal_line_id)||row.journal_line_id&&!row.journal_entry_id||row.candidate_rule_code!==null&&row.candidate_rule_code!==undefined&&!STATUS_TOKEN.test(row.candidate_rule_code)||!MONEY4.test(String(row.amount_delta??''))||typeof row.currency_match!=='boolean'||row.date_delta_days!==null&&row.date_delta_days!==undefined&&(!Number.isSafeInteger(row.date_delta_days)||row.date_delta_days<0)||!TEXT_TOKEN.test(row.matched_by||'')||!validTimestamp(row.matched_at)||!UNSIGNED_INTEGER.test(String(row.match_version??'')))return null;
  const version=Number(row.version),matchVersion=matchId===null?null:Number(row.match_version),amount=Number(row.amount),amountDelta=matchId===null?null:Number(row.amount_delta);
  if(!Number.isSafeInteger(version)||version<0||matchVersion!==null&&(!Number.isSafeInteger(matchVersion)||matchVersion<0)||!Number.isFinite(amount)||amountDelta!==null&&!Number.isFinite(amountDelta))return null;
  return {bank_source_id:row.bank_source_id,bank_account_ref:row.bank_account_ref,external_bank_line_id:row.external_bank_line_id,transaction_date:row.transaction_date,currency:row.currency,amount,version,source_document_id:row.source_document_id,source_ref:row.source_ref,document_type:row.document_type,bank_match_id:matchId,match_status:row.match_status??null,business_source_document_id:row.business_source_document_id??null,journal_entry_id:row.journal_entry_id??null,journal_line_id:row.journal_line_id??null,candidate_rule_code:row.candidate_rule_code??null,amount_delta:amountDelta,currency_match:row.currency_match??null,date_delta_days:row.date_delta_days??null,matched_by:row.matched_by??null,matched_at:row.matched_at??null,match_version:matchVersion};
};

const bankMatchCandidateRow=row=>{
  if(!row||!UUID.test(row.payment_occurrence_id||'')||!UNSIGNED_INTEGER.test(String(row.occurrence_version??''))||!['AP_PAYMENT','AR_RECEIPT'].includes(row.occurrence_kind)||!UUID.test(row.business_source_document_id||'')||!validDate(row.accounting_date)||!/^[A-Z]{3}$/.test(row.currency||'')||!MONEY4.test(String(row.amount??''))||!UUID.test(row.journal_entry_id||'')||!UUID.test(row.journal_line_id||'')||!UUID.test(row.ledger_line_id||'')||!Number.isSafeInteger(row.date_delta_days)||row.date_delta_days<-31||row.date_delta_days>31)return null;
  const occurrenceVersion=Number(row.occurrence_version),amount=Number(row.amount);
  if(!Number.isSafeInteger(occurrenceVersion)||occurrenceVersion<0||!Number.isFinite(amount))return null;
  return {payment_occurrence_id:row.payment_occurrence_id,occurrence_version:occurrenceVersion,occurrence_kind:row.occurrence_kind,business_source_document_id:row.business_source_document_id,accounting_date:row.accounting_date,currency:row.currency,amount,journal_entry_id:row.journal_entry_id,journal_line_id:row.journal_line_id,ledger_line_id:row.ledger_line_id,date_delta_days:row.date_delta_days};
};

const reconciliationRow=(row,account,statementEndingDate)=>{
  if(!row||!UUID.test(row.reconciliation_id||'')||row.bank_account_ref!==account||row.statement_ending_date!==statementEndingDate||!MONEY4.test(String(row.statement_ending_balance??''))||!MONEY4.test(String(row.difference??''))||!RECONCILIATION_STATUSES.has(row.status)||!UNSIGNED_INTEGER.test(String(row.version??''))||!UNSIGNED_INTEGER.test(String(row.bank_transaction_count??''))||!UNSIGNED_INTEGER.test(String(row.active_match_count??''))||!UNSIGNED_INTEGER.test(String(row.unmatched_transaction_count??''))||!MONEY4.test(String(row.statement_activity_amount??'')))return null;
  const reconciledBy=row.reconciled_by??null,reconciledAt=row.reconciled_at??null,reopenedBy=row.reopened_by??null,reopenedAt=row.reopened_at??null;
  if((reconciledBy===null)!==(reconciledAt===null)||(reopenedBy===null)!==(reopenedAt===null)||reconciledBy!==null&&!TEXT_TOKEN.test(reconciledBy)||reconciledAt!==null&&!validTimestamp(reconciledAt)||reopenedBy!==null&&!TEXT_TOKEN.test(reopenedBy)||reopenedAt!==null&&!validTimestamp(reopenedAt)||row.status==='RECONCILED'&&(reconciledBy===null||row.difference!=='0.0000')||row.status==='REOPENED'&&reopenedBy===null)return null;
  const version=Number(row.version),bankTransactionCount=Number(row.bank_transaction_count),activeMatchCount=Number(row.active_match_count),unmatchedTransactionCount=Number(row.unmatched_transaction_count);
  if(![version,bankTransactionCount,activeMatchCount,unmatchedTransactionCount].every(value=>Number.isSafeInteger(value)&&value>=0)||activeMatchCount+unmatchedTransactionCount!==bankTransactionCount)return null;
  return {reconciliation_id:row.reconciliation_id,bank_account_ref:row.bank_account_ref,statement_ending_date:row.statement_ending_date,statement_ending_balance:Number(row.statement_ending_balance),difference:Number(row.difference),status:row.status,version,reconciled_by:reconciledBy,reconciled_at:reconciledAt,reopened_by:reopenedBy,reopened_at:reopenedAt,bank_transaction_count:bankTransactionCount,active_match_count:activeMatchCount,unmatched_transaction_count:unmatchedTransactionCount,statement_activity_amount:Number(row.statement_activity_amount)};
};

export async function refreshAuthoritativeDocuments({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function')return notConfigured();
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const read=async(path,operation)=>{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,operation);const body=await response.json();return body?.ok===true&&Array.isArray(body.data)?{ok:true,data:body.data}:{ok:false,code:'ACCOUNTING_API_PROTOCOL',message:`Accounting API returned an invalid ${operation} read envelope.`};};
  try{const [bills,invoices,apAdjustments,arAdjustments]=await Promise.all([read('/ap/bills','AP_BILLS'),read('/ar/invoices','AR_INVOICES'),read('/ap/adjustments','AP_ADJUSTMENTS'),read('/ar/adjustments','AR_ADJUSTMENTS')]);const refused=[bills,invoices,apAdjustments,arAdjustments].find(result=>!result.ok);if(refused)return refused;const apBills=bills.data.map(row=>documentRow(row,'AP_BILL')),arInvoices=invoices.data.map(row=>documentRow(row,'AR_INVOICE')),apRows=apAdjustments.data.map(row=>adjustmentRow(row,'AP')),arRows=arAdjustments.data.map(row=>adjustmentRow(row,'AR')),documentIds=[...apBills,...arInvoices].map(row=>row?.business_document_id),adjustmentIds=[...apRows,...arRows].map(row=>row?.business_adjustment_id);if([...apBills,...arInvoices,...apRows,...arRows].some(row=>row===null)||new Set(documentIds).size!==documentIds.length||new Set(adjustmentIds).size!==adjustmentIds.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate AP/AR evidence row.'};return {ok:true,ap:{bills:apBills,adjustments:apRows,dupBlocked:0},ar:{invoices:arInvoices,adjustments:arRows}};}catch{return unreachable('The browser could not complete the authoritative accounting read; no HTTP response was produced.');}
}

export async function refreshAuthoritativeJournalEntries({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function')return notConfigured();
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/journal-entries`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response,'JOURNAL_ENTRIES');
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid Journal Entry read envelope.'};
    const journals=body.data.map(journalRow),ids=journals.map(row=>row?.journal_entry_id),numbers=journals.map(row=>row?.journal_number);
    if(journals.some(row=>row===null)||new Set(ids).size!==ids.length||new Set(numbers).size!==numbers.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate Journal Entry row.'};
    return {ok:true,journals};
  }catch{return unreachable('The browser could not complete the authoritative Journal Entry read; no HTTP response was produced.');}
}

export async function refreshAuthoritativeBankTransactions({config,bankAccountRef,from=null,through=null,limit=100,fetcher=globalThis.fetch}={}){
  const account=String(bankAccountRef||'').trim();
  if(!config||typeof fetcher!=='function'||!BANK_ACCOUNT_REF.test(account)||from!==null&&!validDate(from)||through!==null&&!validDate(through)||from&&through&&from>through||!Number.isSafeInteger(limit)||limit<1||limit>200)return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Bank transaction scope requires a valid account, date range, and row limit.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({bankAccountRef:account,limit:String(limit)});if(from)query.set('from',from);if(through)query.set('through',through);
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/bank/transactions?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid bank transaction envelope.'};
    const rows=body.data.map(row=>bankTransactionRow(row,account)),bankSourceIds=rows.map(row=>row?.bank_source_id),externalLineIds=rows.map(row=>row?.external_bank_line_id);
    if(rows.some(row=>row===null)||new Set(bankSourceIds).size!==bankSourceIds.length||new Set(externalLineIds).size!==externalLineIds.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate bank transaction row.'};
    return {ok:true,rows,scope:{entityId:config.entityId,bankAccountRef:account,from,through,limit}};
  }catch{return unreachable('The browser could not complete the authoritative bank transaction read; no HTTP response was produced.');}
}

export async function refreshAuthoritativeBankMatchCandidates({config,bankSourceId,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(bankSourceId||''))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Bank match candidates require one authoritative bank transaction.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/bank/transactions/${bankSourceId}/match-candidates`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid bank match candidate envelope.'};
    const candidates=body.data.map(bankMatchCandidateRow),ids=candidates.map(row=>row?.payment_occurrence_id),evidenceIds=candidates.map(row=>row?`${row.journal_entry_id}:${row.journal_line_id}:${row.ledger_line_id}`:null);
    if(candidates.some(row=>row===null)||new Set(ids).size!==ids.length||new Set(evidenceIds).size!==evidenceIds.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate bank match candidate.'};
    return {ok:true,candidates};
  }catch{return unreachable('The browser could not complete the authoritative bank match candidate read; no HTTP response was produced.');}
}

const bankCommandReason=value=>typeof value==='string'&&value.trim().length>=8&&value.trim().length<=2000?value.trim():null;
const bankCommandResult=async({config,path,revision,idempotencyKey,body,fetcher,operation})=>{
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(revision)||revision<0||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:`${operation} command configuration is invalid.`};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,'if-match':`"${revision}"`,...authorization},body:JSON.stringify(body)});
    if(!response.ok)return await failure(response,operation);
    const result=await response.json();if(result?.ok!==true||!result.data||typeof result.data!=='object')return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:`Accounting API returned an invalid ${operation} command envelope.`};
    return {ok:true,data:result.data,idempotent:response.status===200};
  }catch{return unreachable(`The browser could not complete the authoritative ${operation} command; no HTTP response was produced.`);}
};

export async function createAuthoritativeBankPaymentMatch({config,bankSourceId,bankRevision,candidate,reason,fetcher=globalThis.fetch}={}){
  const approvedReason=bankCommandReason(reason);
  const scaled=typeof candidate?.amount==='number'?candidate.amount*10000:NaN;
  const normalizedCandidate=Number.isSafeInteger(scaled)?bankMatchCandidateRow({...candidate,amount:candidate.amount.toFixed(4)}):null;
  if(!UUID.test(bankSourceId||'')||!Number.isSafeInteger(bankRevision)||bankRevision<0||!approvedReason||!normalizedCandidate)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Bank Match requires one validated exact candidate, current bank revision, and review reason.'};
  const idempotencyKey=`UI-BANK-MATCH-${bankSourceId}-${bankRevision}-${normalizedCandidate.payment_occurrence_id}-${normalizedCandidate.occurrence_version}`;
  return bankCommandResult({config,path:`/bank/transactions/${bankSourceId}/matches`,revision:bankRevision,idempotencyKey,body:{paymentOccurrenceId:normalizedCandidate.payment_occurrence_id,expectedOccurrenceRevision:normalizedCandidate.occurrence_version,reason:approvedReason},fetcher,operation:'BANK_MATCH'});
}

export async function unmatchAuthoritativeBankPayment({config,bankSourceId,bankMatchId,bankMatchRevision,reason,fetcher=globalThis.fetch}={}){
  const approvedReason=bankCommandReason(reason);
  if(!UUID.test(bankSourceId||'')||!UUID.test(bankMatchId||'')||!Number.isSafeInteger(bankMatchRevision)||bankMatchRevision<0||!approvedReason)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Bank Unmatch requires one active match, current match revision, and review reason.'};
  const idempotencyKey=`UI-BANK-UNMATCH-${bankSourceId}-${bankMatchId}-${bankMatchRevision}`;
  return bankCommandResult({config,path:`/bank/transactions/${bankSourceId}/matches/${bankMatchId}/unmatch`,revision:bankMatchRevision,idempotencyKey,body:{reason:approvedReason},fetcher,operation:'BANK_UNMATCH'});
}

export async function refreshAuthoritativeReconciliation({config,bankAccountRef,statementEndingDate,fetcher=globalThis.fetch}={}){
  const account=String(bankAccountRef||'').trim();
  if(!config||typeof fetcher!=='function'||!BANK_ACCOUNT_REF.test(account)||!validDate(statementEndingDate))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Reconciliation scope requires a valid account and statement ending date.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({bankAccountRef:account,statementEndingDate});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/bank/reconciliation?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data)||body.data.length>1)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid reconciliation envelope.'};
    const rows=body.data.map(row=>reconciliationRow(row,account,statementEndingDate));
    if(rows.some(row=>row===null))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid reconciliation row.'};
    return {ok:true,row:rows[0]||null,scope:{entityId:config.entityId,bankAccountRef:account,statementEndingDate}};
  }catch{return unreachable('The browser could not complete the authoritative reconciliation read; no HTTP response was produced.');}
}

export async function refreshAuthoritativeFinancialStatements({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(config.periodId||''))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Financial statements require one authoritative entity and accounting period.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({periodId:config.periodId});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/reports/financial-statements?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid financial statement envelope.'};
    const statements=new Set(['TRIAL_BALANCE','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW']);
    const sections={TRIAL_BALANCE:new Set(['ALL_ACCOUNTS']),BALANCE_SHEET:new Set(['ASSETS','LIABILITIES','EQUITY','CURRENT_EARNINGS']),INCOME_STATEMENT:new Set(['REVENUE','EXPENSES']),CASH_FLOW:new Set(['DIRECT_CASH_MOVEMENT'])};
    const numericFields=['opening_debit','opening_credit','period_debit','period_credit','ending_debit','ending_credit','display_balance'];
    const idFields=['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'];
    if(body.data.some(row=>row?.period_id!==config.periodId||!PERIOD_CODE.test(row.period_code||'')||!validDate(row.period_start)||!validDate(row.period_end)||row.period_start>row.period_end||row.period_start.slice(0,7)!==row.period_code||row.period_end.slice(0,7)!==row.period_code||!statements.has(row.statement_type)||!sections[row.statement_type]?.has(row.statement_section)||row.classification_basis!=='ACCOUNT_CODE_PREFIX_AND_BANK_MEMBER'||!ACCOUNT_CODE.test(row.account_code||'')||typeof row.account_name!=='string'||!row.account_name.trim()||numericFields.some(field=>!REPORT_MONEY4.test(String(row[field]??'')))||idFields.some(field=>!Array.isArray(row[field])||row[field].some(id=>!UUID.test(id||'')))))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid financial statement row.'};
    if(new Set(body.data.map(row=>`${row.statement_type}:${row.account_code}`)).size!==body.data.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned duplicate financial statement rows.'};
    const rows=body.data.map(row=>({...row,...Object.fromEntries(numericFields.map(field=>[field,String(row[field])]))}));
    return {ok:true,rows,scope:{entityId:config.entityId,periodId:config.periodId}};
  }catch{return unreachable('The browser could not complete the authoritative financial statement read; no HTTP response was produced.');}
}

const CURRENCY3=/^[A-Z]{3}$/;
const money4=v=>{if(typeof v==='number'&&Number.isFinite(v))return v.toFixed(4);if(typeof v==='string'&&MONEY4.test(v))return v;return null;};
export async function refreshAuthoritativeAging({config,side,asOfDate,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!['ap','ar'].includes(side)||!validDate(asOfDate))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Aging requires one authoritative entity, an ap or ar side, and a valid as-of date.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({asOf:asOfDate});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/${side}/aging?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid aging envelope.'};
    const fields=['current_amount','days_1_30','days_31_60','days_61_90','days_91_plus','total_open_balance'];
    const rows=[];
    for(const row of body.data){
      if(!row||!CURRENCY3.test(row.currency||''))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid aging row.'};
      const norm={currency:row.currency};
      for(const f of fields){const m=money4(row[f]);if(m===null)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid aging amount.'};norm[f]=m;}
      rows.push(norm);
    }
    if(new Set(rows.map(r=>r.currency)).size!==rows.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned duplicate aging currencies.'};
    return {ok:true,side,rows,scope:{entityId:config.entityId,asOfDate}};
  }catch{return unreachable('The browser could not complete the authoritative aging read; no HTTP response was produced.');}
}
export async function refreshAuthoritativeControlTotals({config,side,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!['ap','ar'].includes(side))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Control totals require one authoritative entity and an ap or ar side.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/${side}/control-totals`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid control-total envelope.'};
    const rows=[];
    for(const row of body.data){
      const open=money4(row?.open_balance),control=money4(row?.control_balance);
      if(!row||!CURRENCY3.test(row.currency||'')||open===null||control===null||typeof row.in_balance!=='boolean')return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid control-total row.'};
      rows.push({currency:row.currency,open_balance:open,control_balance:control,in_balance:row.in_balance});
    }
    if(new Set(rows.map(r=>r.currency)).size!==rows.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned duplicate control-total currencies.'};
    return {ok:true,side,rows,scope:{entityId:config.entityId}};
  }catch{return unreachable('The browser could not complete the authoritative control-total read; no HTTP response was produced.');}
}

const failure=async(response,operation=null)=>{
  const status=Number(response?.status)||0;
  let body;try{body=await response.json();}catch{}
  const derived=status>=100?httpFailureCode(status):null;
  // 401, 403 and 5xx are decided by the status line: whether the caller is
  // authenticated, whether this entity refuses the caller, and whether the
  // service itself failed are not things a response body may relabel. Other
  // statuses keep the domain code the API supplies, which is more specific
  // than anything derivable from the status alone.
  const decisive=derived==='AUTHENTICATION_REQUIRED'||derived==='AUTHORIZATION_DENIED'||derived==='ACCOUNTING_API_SERVER_ERROR';
  const code=decisive?derived:(typeof body?.code==='string'&&body.code?body.code:(derived||'ACCOUNTING_API_REQUEST_REJECTED'));
  const reported=typeof body?.message==='string'&&body.message?body.message:null;
  const baseMessage=derived==='AUTHORIZATION_DENIED'||status>=500||!reported?httpFailureMessage(status,derived||'ACCOUNTING_API_REQUEST_REJECTED'):reported;
  const message=operation?`${baseMessage} Read: ${operation}.`:baseMessage;
  return {ok:false,code,status,message};
};

export async function createAuthoritativeBusinessDocument({config,kind,document,idempotencyKey,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!['AP_BILL','AR_INVOICE'].includes(kind)||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Authoritative command configuration is invalid.'};
  const attachmentIds=Array.isArray(document?.attachmentIds)?document.attachmentIds:null;
  if(!attachmentIds?.length||attachmentIds.some(attachmentId=>!UUID.test(attachmentId||'')))return {ok:false,code:'ATTACHMENT_REQUIRED',message:'An authoritative business document requires at least one verified attachment.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();const path=kind==='AP_BILL'?'/ap/bills':'/ar/invoices';
  const body={periodId:config.periodId,documentNumber:document.documentNumber,counterpartyRef:String(document.counterpartyRef),counterpartyName:document.counterpartyName,currency:document.currency,accountingDate:document.accountingDate,dueDate:document.dueDate,amount:document.amount,offsetAccountCode:document.offsetAccountCode,description:document.description||null,attachmentIds};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response);const result=await response.json();if(result?.ok!==true||!result.data)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid command envelope.'};return {ok:true,data:result.data,idempotent:response.status===200};}catch{return unreachable('The browser could not complete the authoritative accounting command; no HTTP response was produced.');}
}

export async function createAuthoritativeSettlement({config,kind,businessDocumentId,accountingDate,amount,idempotencyKey,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(businessDocumentId||'')||!['AP_PAYMENT','AR_RECEIPT'].includes(kind)||typeof config.cashAccountCode!=='string'||!config.cashAccountCode.trim()||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Settlement requires authoritative cash-account configuration.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();const path=kind==='AP_PAYMENT'?`/ap/bills/${businessDocumentId}/payments`:`/ar/invoices/${businessDocumentId}/receipts`;
  const body=kind==='AP_PAYMENT'?{periodId:config.periodId,paymentNumber:idempotencyKey,paymentDate:accountingDate,cashAccountCode:config.cashAccountCode,bankMemberRef:null,amount,reason:'UI-authoritative AP payment'}:{periodId:config.periodId,receiptNumber:idempotencyKey,receiptDate:accountingDate,cashAccountCode:config.cashAccountCode,bankMemberRef:null,amount,reason:'UI-authoritative AR receipt'};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response);const result=await response.json();if(result?.ok!==true||!result.data)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid settlement envelope.'};return {ok:true,data:result.data,idempotent:response.status===200};}catch{return unreachable('The browser could not complete the authoritative settlement command; no HTTP response was produced.');}
}

export async function createAuthoritativeAdjustment({config,kind,adjustment,idempotencyKey,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!['AP_VENDOR_CREDIT','AR_CREDIT_MEMO','AR_REFUND'].includes(kind)||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Adjustment command configuration is invalid.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();const common={periodId:config.periodId,amount:adjustment?.amount,reason:adjustment?.reason};
  let path,body;
  if(kind==='AP_VENDOR_CREDIT'){path='/ap/vendor-credits';body={...common,creditNumber:adjustment?.number,creditDate:adjustment?.date,vendorRef:String(adjustment?.counterpartyRef||''),vendorName:adjustment?.counterpartyName,lines:adjustment?.lines};}
  else if(kind==='AR_CREDIT_MEMO'){path='/ar/credit-memos';body={...common,memoNumber:adjustment?.number,memoDate:adjustment?.date,customerRef:String(adjustment?.counterpartyRef||''),customerName:adjustment?.counterpartyName,lines:adjustment?.lines};}
  else {if(typeof config.cashAccountCode!=='string'||!config.cashAccountCode)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Refund requires authoritative cash-account configuration.'};path='/ar/refunds';body={...common,sourceAdjustmentId:adjustment?.sourceAdjustmentId,refundNumber:adjustment?.number,refundDate:adjustment?.date,cashAccountCode:config.cashAccountCode};}
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response);const result=await response.json();if(result?.ok!==true||!result.data)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid adjustment envelope.'};return {ok:true,data:result.data,idempotent:response.status===200};}catch{return unreachable('The browser could not complete the authoritative adjustment command; no HTTP response was produced.');}
}

export async function applyAuthoritativeCredit({config,kind,businessAdjustmentId,businessDocumentId,amount,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(businessAdjustmentId||'')||!UUID.test(businessDocumentId||'')||!['AP_VENDOR_CREDIT','AR_CREDIT_MEMO'].includes(kind)||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Credit allocation command configuration is invalid.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();const path=kind==='AP_VENDOR_CREDIT'?`/ap/vendor-credits/${businessAdjustmentId}/allocations`:`/ar/credit-memos/${businessAdjustmentId}/allocations`;
  const body={businessDocumentId,amount,reason};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response);const result=await response.json();if(result?.ok!==true||!result.data)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid allocation envelope.'};return {ok:true,data:result.data,idempotent:response.status===200};}catch{return unreachable('The browser could not complete the authoritative credit allocation; no HTTP response was produced.');}
}

export async function transitionAuthoritativeJournal({config,journalEntryId,revision,action,fetcher=globalThis.fetch}={}){
  const command=String(action||'').toUpperCase();
  if(!config||typeof fetcher!=='function'||!UUID.test(journalEntryId||'')||!Number.isSafeInteger(revision)||revision<0||!['SUBMIT','REVIEW','APPROVE','POST'].includes(command))return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Journal workflow command is invalid.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();const post=command==='POST',path=post?`/journal-entries/${journalEntryId}/post`:`/journal-entries/${journalEntryId}/transitions/${command.toLowerCase()}`,body=post?{periodId:config.periodId}:{};
  const idempotencyKey=`UI-JE-${journalEntryId}-${revision}-${command}`;
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,'if-match':`"${revision}"`,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response);const result=await response.json();if(result?.ok!==true||!result.data)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid workflow envelope.'};return {ok:true,data:result.data,idempotent:response.status===200};}catch{return unreachable('The browser could not complete the authoritative journal workflow command; no HTTP response was produced.');}
}
