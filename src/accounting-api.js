const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_CODE=/^[A-Za-z0-9._-]{1,64}$/;
const BANK_ACCOUNT_REF=/^[^\u0000-\u001f\u007f]{1,128}$/;
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY4=/^-?[0-9]+\.[0-9]{4}$/;
const REPORT_MONEY4=/^-?(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$/;
const PERIOD_CODE=/^[0-9]{4}-(?:0[1-9]|1[0-2])$/;
const UNSIGNED_INTEGER=/^[0-9]+$/;
const SHA256=/^sha256:[0-9a-f]{64}$/i;

export const accountingApiConfig=(environment=globalThis)=>{
  const source=environment?.__REFS_ACCOUNTING_API__;
  if(!source||typeof source!=='object'||!UUID.test(source.entityId||'')||!UUID.test(source.periodId||'')||typeof source.getAccessToken!=='function')return null;
  let baseUrl;try{baseUrl=new URL(source.baseUrl);}catch{return null;}
  if(baseUrl.protocol!=='https:'||baseUrl.username||baseUrl.password)return null;
  const cashAccountCode=typeof source.cashAccountCode==='string'&&ACCOUNT_CODE.test(source.cashAccountCode)?source.cashAccountCode:null;
  const wbsTestImportMode=source.wbsTestImportMode==='ENABLED'?'ENABLED':'DISABLED';
  const deploymentEnvironment=source.deploymentEnvironment==='staging'?'staging':'unknown';
  const controlledTestAiWorkflowMode=deploymentEnvironment==='staging'&&source.controlledTestAiWorkflowMode==='ENABLED'?'ENABLED':'DISABLED';
  return {baseUrl:baseUrl.toString().replace(/\/$/,''),entityId:source.entityId,periodId:source.periodId,cashAccountCode,wbsTestImportMode,deploymentEnvironment,controlledTestAiWorkflowMode,getAccessToken:source.getAccessToken};
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
// The current list contracts do not carry lineage. Preserve a future explicit
// API lineage object verbatim for the presentation layer to validate; never
// synthesize it from list facts or browser state.
const optionalLineage=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:null;
const JOURNAL_TYPES=new Set(['MANUAL','AUTO','REVERSAL','RECLASS']);
const JOURNAL_STATUSES=new Set(['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED']);
const BANK_MATCH_STATUSES=new Set(['ACTIVE','UNMATCHED','REVERSED']);
const RECONCILIATION_STATUSES=new Set(['DRAFT','IN_REVIEW','RECONCILED','REOPENED']);
const RECONCILIATION_SCOPE_FIELDS=new Set(['reconciliation_id','bank_account_ref','statement_ending_date','currency','status','version']);
const ADMITTED_STATEMENT_SELECTION_STATES=new Set(['ALREADY_STARTED','BLOCKED_OPEN_RECONCILIATION','AVAILABLE_FOR_SERVER_VALIDATION']);
const ADMITTED_STATEMENT_FIELDS=new Set(['wbs_bank_statement_receipt_id','bank_account_ref','statement_start_date','statement_end_date','currency','opening_balance','ending_balance','transaction_count','statement_activity_amount','admission_hash','signature_verified','admission_status','admitted_at','reconciliation_id','reconciliation_status','reconciliation_version','selection_state']);

// Journal entry list evidence is deliberately a separate, optional extension
// of the current list contract.  The deployed reader does not return it yet.
// If a future API explicitly does, every row must be exact and self-bound to
// the same Journal Entry; partial rows are not useful evidence and fail the
// complete read rather than being silently presented as a reconstructed line.
const journalLineEvidence=(value,journalEntryId)=>{
  if(value===undefined)return null;
  if(!Array.isArray(value)||value.length===0)return undefined;
  const lineIds=new Set(),ledgerIds=new Set(),lineNos=new Set();
  const lines=[];
  for(const row of value){
    const debit=decimalText(row?.debit_amount),credit=decimalText(row?.credit_amount);
    const sourceDocumentIds=Array.isArray(row?.source_document_ids)?row.source_document_ids:null;
    if(!row||row.journal_entry_id!==journalEntryId||!UUID.test(row.journal_line_id||'')||!UUID.test(row.ledger_line_id||'')||!Number.isSafeInteger(row.line_no)||row.line_no<1||!ACCOUNT_CODE.test(row.account_code||'')||debit===null||credit===null||(debit==='0.0000')===(credit==='0.0000')||row.member_ref!==null&&row.member_ref!==undefined&&!TEXT_TOKEN.test(row.member_ref)||row.description!==null&&row.description!==undefined&&typeof row.description!=='string'||!sourceDocumentIds||sourceDocumentIds.some(id=>!UUID.test(id||''))||new Set(sourceDocumentIds).size!==sourceDocumentIds.length||lineIds.has(row.journal_line_id)||ledgerIds.has(row.ledger_line_id)||lineNos.has(row.line_no))return undefined;
    lineIds.add(row.journal_line_id);ledgerIds.add(row.ledger_line_id);lineNos.add(row.line_no);
    lines.push({journal_entry_id:journalEntryId,journal_line_id:row.journal_line_id,ledger_line_id:row.ledger_line_id,line_no:row.line_no,account_code:row.account_code,debit_amount:debit,credit_amount:credit,member_ref:row.member_ref??null,description:row.description??null,source_document_ids:[...sourceDocumentIds]});
  }
  return lines.sort((a,b)=>a.line_no-b.line_no);
};

const journalRow=row=>{
  if(!row||!UUID.test(row.journal_entry_id||'')||!TEXT_TOKEN.test(row.journal_number||'')||!JOURNAL_TYPES.has(row.journal_type)||!JOURNAL_STATUSES.has(row.status)||!validDate(row.journal_date)||!/^[A-Z]{3}$/.test(row.currency||'')||row.description!==null&&row.description!==undefined&&(typeof row.description!=='string'||row.description.length>2000)||!UNSIGNED_INTEGER.test(String(row.revision??''))||!validTimestamp(row.created_at)||row.posted_at!==null&&row.posted_at!==undefined&&!validTimestamp(row.posted_at)||!UNSIGNED_INTEGER.test(String(row.ledger_line_count??'')))return null;
  const revision=Number(row.revision),ledgerLineCount=Number(row.ledger_line_count),lineEvidence=journalLineEvidence(row.line_evidence,row.journal_entry_id);
  if(!Number.isSafeInteger(revision)||revision<0||!Number.isSafeInteger(ledgerLineCount)||ledgerLineCount<0||(row.status==='POSTED')!==(row.posted_at!==null&&row.posted_at!==undefined)||lineEvidence===undefined||lineEvidence!==null&&lineEvidence.length!==ledgerLineCount)return null;
  return {journal_entry_id:row.journal_entry_id,journal_number:row.journal_number,journal_type:row.journal_type,status:row.status,journal_date:row.journal_date,currency:row.currency,description:row.description??null,revision,created_at:row.created_at,posted_at:row.posted_at??null,ledger_line_count:ledgerLineCount,line_evidence:lineEvidence};
};

const documentRow=(row,kind)=>{
  if(!row||!UUID.test(row.business_document_id||'')||!TEXT_TOKEN.test(row.document_number||'')||!TEXT_TOKEN.test(row.counterparty_ref||'')||!TEXT_TOKEN.test(row.counterparty_name||'')||!/^[A-Z]{3}$/.test(row.currency||'')||!validDate(row.accounting_date)||row.due_date!==null&&row.due_date!==undefined&&!validDate(row.due_date)||!MONEY4.test(String(row.gross_amount??''))||!MONEY4.test(String(row.open_balance??''))||!STATUS_TOKEN.test(row.status||'')||!nullableUuid(row.posted_journal_entry_id)||!UNSIGNED_INTEGER.test(String(row.version??''))||!nullableUuid(row.journal_entry_id)||row.journal_status!==null&&row.journal_status!==undefined&&!STATUS_TOKEN.test(row.journal_status)||!nullableRevision(row.journal_revision)||!nullableUuid(row.period_id)||row.offset_account_code!==null&&row.offset_account_code!==undefined&&!ACCOUNT_CODE.test(row.offset_account_code)||row.description!==null&&row.description!==undefined&&typeof row.description!=='string')return null;
  const version=Number(row.version),journalRevision=row.journal_revision===null||row.journal_revision===undefined?null:Number(row.journal_revision),grossAmount=Number(row.gross_amount),openBalance=Number(row.open_balance);
  if(!Number.isSafeInteger(version)||version<0||journalRevision!==null&&(!Number.isSafeInteger(journalRevision)||journalRevision<0)||!Number.isFinite(grossAmount)||!Number.isFinite(openBalance))return null;
  return {
    business_document_id:row.business_document_id,
    ...(kind==='AP_BILL'?{bill_id:row.business_document_id,bill_no:row.document_number,invoice_no:row.document_number,vendor_id:row.counterparty_ref,vendor_name:row.counterparty_name,bill_date:row.accounting_date}:{inv_id:row.business_document_id,inv_no:row.document_number,customer_id:row.counterparty_ref,customer_name:row.counterparty_name,inv_date:row.accounting_date}),
    due_date:row.due_date??null,amount:grossAmount,open_balance:openBalance,currency:row.currency,status:row.status,je_number:row.posted_journal_entry_id||null,posted_journal_entry_id:row.posted_journal_entry_id??null,revision:version,journal_entry_id:row.journal_entry_id??null,journal_status:row.journal_status??null,journal_revision:journalRevision,period_id:row.period_id??null,account_code:row.offset_account_code??null,description:row.description??null,lineage:optionalLineage(row.lineage),
  };
};

const adjustmentRow=(row,side)=>{
  if(!row||!UUID.test(row.business_adjustment_id||'')||!STATUS_TOKEN.test(row.adjustment_kind||'')||!row.adjustment_kind.startsWith(`${side}_`)||!nullableUuid(row.business_document_id)||!nullableUuid(row.source_adjustment_id)||!MONEY4.test(String(row.amount??''))||!/^[A-Z]{3}$/.test(row.currency||'')||!validDate(row.accounting_date)||!UUID.test(row.period_id||'')||typeof row.reason!=='string'||!STATUS_TOKEN.test(row.status||'')||!UNSIGNED_INTEGER.test(String(row.version??''))||!nullableUuid(row.journal_entry_id)||row.journal_status!==null&&row.journal_status!==undefined&&!STATUS_TOKEN.test(row.journal_status)||!nullableRevision(row.journal_revision)||!validTimestamp(row.created_at))return null;
  const version=Number(row.version),journalRevision=row.journal_revision===null||row.journal_revision===undefined?null:Number(row.journal_revision),amount=Number(row.amount);
  if(!Number.isSafeInteger(version)||version<0||journalRevision!==null&&(!Number.isSafeInteger(journalRevision)||journalRevision<0)||!Number.isFinite(amount))return null;
  return {...row,amount,version,journal_revision:journalRevision,lineage:optionalLineage(row.lineage)};
};

const bankTransactionRow=(row,account)=>{
  if(!row||!UUID.test(row.bank_source_id||'')||row.bank_account_ref!==account||!TEXT_TOKEN.test(row.external_bank_line_id||'')||!validDate(row.transaction_date)||!/^[A-Z]{3}$/.test(row.currency||'')||!MONEY4.test(String(row.amount??''))||!UNSIGNED_INTEGER.test(String(row.version??''))||!UUID.test(row.source_document_id||'')||!TEXT_TOKEN.test(row.source_ref||'')||!TEXT_TOKEN.test(row.document_type||''))return null;
  const matchId=row.bank_match_id??null;
  const matchValues=['match_status','business_source_document_id','journal_entry_id','journal_line_id','candidate_rule_code','amount_delta','currency_match','date_delta_days','matched_by','matched_at','match_version'];
  if(matchId===null){if(matchValues.some(field=>row[field]!==null&&row[field]!==undefined))return null;}
  else if(!UUID.test(matchId)||!BANK_MATCH_STATUSES.has(row.match_status)||!UUID.test(row.business_source_document_id||'')||!nullableUuid(row.journal_entry_id)||!nullableUuid(row.journal_line_id)||row.journal_line_id&&!row.journal_entry_id||row.candidate_rule_code!==null&&row.candidate_rule_code!==undefined&&!STATUS_TOKEN.test(row.candidate_rule_code)||!MONEY4.test(String(row.amount_delta??''))||typeof row.currency_match!=='boolean'||row.date_delta_days!==null&&row.date_delta_days!==undefined&&(!Number.isSafeInteger(row.date_delta_days)||row.date_delta_days<0)||!TEXT_TOKEN.test(row.matched_by||'')||!validTimestamp(row.matched_at)||!UNSIGNED_INTEGER.test(String(row.match_version??'')))return null;
  const version=Number(row.version),matchVersion=matchId===null?null:Number(row.match_version);
  if(!Number.isSafeInteger(version)||version<0||matchVersion!==null&&(!Number.isSafeInteger(matchVersion)||matchVersion<0))return null;
  // Bank evidence is a fixed-scale accounting fact. Keep the validated text
  // intact for presentation and command readback; converting it to a browser
  // Number would silently lose precision for otherwise valid NUMERIC values.
  const amount=String(row.amount),amountDelta=matchId===null?null:String(row.amount_delta);
  return {bank_source_id:row.bank_source_id,bank_account_ref:row.bank_account_ref,external_bank_line_id:row.external_bank_line_id,transaction_date:row.transaction_date,currency:row.currency,amount,version,source_document_id:row.source_document_id,source_ref:row.source_ref,document_type:row.document_type,bank_match_id:matchId,match_status:row.match_status??null,business_source_document_id:row.business_source_document_id??null,journal_entry_id:row.journal_entry_id??null,journal_line_id:row.journal_line_id??null,candidate_rule_code:row.candidate_rule_code??null,amount_delta:amountDelta,currency_match:row.currency_match??null,date_delta_days:row.date_delta_days??null,matched_by:row.matched_by??null,matched_at:row.matched_at??null,match_version:matchVersion};
};

const bankMatchCandidateRow=row=>{
  if(!row||!UUID.test(row.payment_occurrence_id||'')||!UNSIGNED_INTEGER.test(String(row.occurrence_version??''))||!['AP_PAYMENT','AR_RECEIPT'].includes(row.occurrence_kind)||!UUID.test(row.business_source_document_id||'')||!validDate(row.accounting_date)||!/^[A-Z]{3}$/.test(row.currency||'')||!MONEY4.test(String(row.amount??''))||!UUID.test(row.journal_entry_id||'')||!UUID.test(row.journal_line_id||'')||!UUID.test(row.ledger_line_id||'')||!Number.isSafeInteger(row.date_delta_days)||row.date_delta_days<-31||row.date_delta_days>31)return null;
  const occurrenceVersion=Number(row.occurrence_version);
  if(!Number.isSafeInteger(occurrenceVersion)||occurrenceVersion<0)return null;
  const amount=String(row.amount);
  return {payment_occurrence_id:row.payment_occurrence_id,occurrence_version:occurrenceVersion,occurrence_kind:row.occurrence_kind,business_source_document_id:row.business_source_document_id,accounting_date:row.accounting_date,currency:row.currency,amount,amount_text:String(row.amount),journal_entry_id:row.journal_entry_id,journal_line_id:row.journal_line_id,ledger_line_id:row.ledger_line_id,date_delta_days:row.date_delta_days};
};

const reconciliationRow=(row,account,statementEndingDate)=>{
  if(!row||!UUID.test(row.reconciliation_id||'')||row.bank_account_ref!==account||row.statement_ending_date!==statementEndingDate||!MONEY4.test(String(row.statement_ending_balance??''))||!MONEY4.test(String(row.difference??''))||!RECONCILIATION_STATUSES.has(row.status)||!UNSIGNED_INTEGER.test(String(row.version??''))||!UNSIGNED_INTEGER.test(String(row.bank_transaction_count??''))||!UNSIGNED_INTEGER.test(String(row.active_match_count??''))||!UNSIGNED_INTEGER.test(String(row.unmatched_transaction_count??''))||!MONEY4.test(String(row.statement_activity_amount??'')))return null;
  const reconciledBy=row.reconciled_by??null,reconciledAt=row.reconciled_at??null,reopenedBy=row.reopened_by??null,reopenedAt=row.reopened_at??null;
  if((reconciledBy===null)!==(reconciledAt===null)||(reopenedBy===null)!==(reopenedAt===null)||reconciledBy!==null&&!TEXT_TOKEN.test(reconciledBy)||reconciledAt!==null&&!validTimestamp(reconciledAt)||reopenedBy!==null&&!TEXT_TOKEN.test(reopenedBy)||reopenedAt!==null&&!validTimestamp(reopenedAt)||row.status==='RECONCILED'&&(reconciledBy===null||row.difference!=='0.0000')||row.status==='REOPENED'&&reopenedBy===null)return null;
  const version=Number(row.version),bankTransactionCount=Number(row.bank_transaction_count),activeMatchCount=Number(row.active_match_count),unmatchedTransactionCount=Number(row.unmatched_transaction_count);
  if(![version,bankTransactionCount,activeMatchCount,unmatchedTransactionCount].every(value=>Number.isSafeInteger(value)&&value>=0)||activeMatchCount+unmatchedTransactionCount!==bankTransactionCount)return null;
  return {reconciliation_id:row.reconciliation_id,bank_account_ref:row.bank_account_ref,statement_ending_date:row.statement_ending_date,statement_ending_balance:String(row.statement_ending_balance),difference:String(row.difference),status:row.status,version,reconciled_by:reconciledBy,reconciled_at:reconciledAt,reopened_by:reopenedBy,reopened_at:reopenedAt,bank_transaction_count:bankTransactionCount,active_match_count:activeMatchCount,unmatched_transaction_count:unmatchedTransactionCount,statement_activity_amount:String(row.statement_activity_amount)};
};

const reconciliationScopeRow=row=>{
  if(!row||Object.keys(row).length!==RECONCILIATION_SCOPE_FIELDS.size||Object.keys(row).some(field=>!RECONCILIATION_SCOPE_FIELDS.has(field))||!UUID.test(row.reconciliation_id||'')||!BANK_ACCOUNT_REF.test(row.bank_account_ref||'')||!validDate(row.statement_ending_date)||!/^[A-Z]{3}$/.test(row.currency||'')||!RECONCILIATION_STATUSES.has(row.status)||!UNSIGNED_INTEGER.test(String(row.version??'')))return null;
  return {reconciliation_id:row.reconciliation_id,bank_account_ref:row.bank_account_ref,statement_ending_date:row.statement_ending_date,currency:row.currency,status:row.status,version:Number(row.version)};
};

const admittedStatementRow=(row,{account=null,receiptId=null}={})=>{
  if(!row||Object.keys(row).length!==ADMITTED_STATEMENT_FIELDS.size||Object.keys(row).some(field=>!ADMITTED_STATEMENT_FIELDS.has(field))||!UUID.test(row.wbs_bank_statement_receipt_id||'')||receiptId!==null&&row.wbs_bank_statement_receipt_id!==receiptId||!BANK_ACCOUNT_REF.test(row.bank_account_ref||'')||account!==null&&row.bank_account_ref!==account||!validDate(row.statement_start_date)||!validDate(row.statement_end_date)||row.statement_start_date>row.statement_end_date||!/^[A-Z]{3}$/.test(row.currency||'')||!REPORT_MONEY4.test(String(row.opening_balance??''))||!REPORT_MONEY4.test(String(row.ending_balance??''))||!UNSIGNED_INTEGER.test(String(row.transaction_count??''))||Number(row.transaction_count)<1||!REPORT_MONEY4.test(String(row.statement_activity_amount??''))||!/^sha256:[0-9a-f]{64}$/.test(row.admission_hash||'')||row.signature_verified!==true||row.admission_status!=='ADMITTED'||!validTimestamp(row.admitted_at)||!ADMITTED_STATEMENT_SELECTION_STATES.has(row.selection_state))return null;
  const units=value=>{const match=/^(-?)([0-9]{1,16})\.([0-9]{4})$/.exec(String(value));return match?BigInt(`${match[1]}${match[2]}${match[3]}`):null;};
  const opening=units(row.opening_balance),activity=units(row.statement_activity_amount),ending=units(row.ending_balance);
  if(opening===null||activity===null||ending===null||opening+activity!==ending)return null;
  const linked=row.reconciliation_id!==null&&row.reconciliation_id!==undefined;
  if(linked!==UUID.test(row.reconciliation_id||'')||linked!==RECONCILIATION_STATUSES.has(row.reconciliation_status)||linked!==UNSIGNED_INTEGER.test(String(row.reconciliation_version??''))||linked!==(row.selection_state==='ALREADY_STARTED'))return null;
  const transactionCount=Number(row.transaction_count),reconciliationVersion=linked?Number(row.reconciliation_version):null;
  if(!Number.isSafeInteger(transactionCount)||transactionCount<1||linked&&(!Number.isSafeInteger(reconciliationVersion)||reconciliationVersion<0))return null;
  return {...row,opening_balance:String(row.opening_balance),ending_balance:String(row.ending_balance),transaction_count:transactionCount,statement_activity_amount:String(row.statement_activity_amount),reconciliation_id:linked?row.reconciliation_id:null,reconciliation_status:linked?row.reconciliation_status:null,reconciliation_version:reconciliationVersion};
};

export async function refreshAuthoritativeDocuments({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function')return notConfigured();
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const read=async(path,operation)=>{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,operation);const body=await response.json();return body?.ok===true&&Array.isArray(body.data)?{ok:true,data:body.data}:{ok:false,code:'ACCOUNTING_API_PROTOCOL',message:`Accounting API returned an invalid ${operation} read envelope.`};};
  try{const [bills,invoices,apAdjustments,arAdjustments]=await Promise.all([read('/ap/bills','AP_BILLS'),read('/ar/invoices','AR_INVOICES'),read('/ap/adjustments','AP_ADJUSTMENTS'),read('/ar/adjustments','AR_ADJUSTMENTS')]);const refused=[bills,invoices,apAdjustments,arAdjustments].find(result=>!result.ok);if(refused)return refused;const apBills=bills.data.map(row=>documentRow(row,'AP_BILL')),arInvoices=invoices.data.map(row=>documentRow(row,'AR_INVOICE')),apRows=apAdjustments.data.map(row=>adjustmentRow(row,'AP')),arRows=arAdjustments.data.map(row=>adjustmentRow(row,'AR')),documentIds=[...apBills,...arInvoices].map(row=>row?.business_document_id),adjustmentIds=[...apRows,...arRows].map(row=>row?.business_adjustment_id);if([...apBills,...arInvoices,...apRows,...arRows].some(row=>row===null)||new Set(documentIds).size!==documentIds.length||new Set(adjustmentIds).size!==adjustmentIds.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate AP/AR evidence row.'};return {ok:true,ap:{bills:apBills,adjustments:apRows,dupBlocked:0},ar:{invoices:arInvoices,adjustments:arRows}};}catch{return unreachable('The browser could not complete the authoritative accounting read; no HTTP response was produced.');}
}

export async function activateAuthoritativeReadAccess({config,fetcher=globalThis.fetch,idempotencyKey}={}){
  if(!config||typeof fetcher!=='function'||typeof idempotencyKey!=='string'||idempotencyKey.length<8)return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Reader activation requires an authoritative scope.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/access/self-service-read-grant/activate`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:'{}'});
    if(!response.ok)return await failure(response,'AUTHORITATIVE_READ_ACCESS');
    const body=await response.json();
    return body?.ok===true&&body?.data?.activated===true&&body.data.permission_count===5?{ok:true}:{ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Reader activation returned an invalid response.'};
  }catch{return unreachable('The browser could not complete the authoritative reader activation; no HTTP response was produced.');}
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

const JOURNAL_WORKFLOW_CAPABILITY_FIELDS=new Set(['entity_id','can_submit','can_review','can_approve','can_post']);
const journalWorkflowCapabilities=(row,entityId)=>{
  if(!row||Object.keys(row).length!==JOURNAL_WORKFLOW_CAPABILITY_FIELDS.size||Object.keys(row).some(field=>!JOURNAL_WORKFLOW_CAPABILITY_FIELDS.has(field))||row.entity_id!==entityId||['can_submit','can_review','can_approve','can_post'].some(field=>typeof row[field]!=='boolean'))return null;
  return {...row};
};

export async function readAuthoritativeJournalWorkflowCapabilities({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function')return notConfigured();
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/journal-workflow/capabilities`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response,'JOURNAL_WORKFLOW_CAPABILITIES');
    const body=await response.json(),capabilities=body?.ok===true?journalWorkflowCapabilities(body.data,config.entityId):null;
    return capabilities?{ok:true,capabilities}:{ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid Journal workflow capability envelope.'};
  }catch{return unreachable('The browser could not read Journal workflow capabilities; no HTTP response was produced.');}
}

const journalDetailLine=row=>{
  if(!row||!Number.isSafeInteger(row.line_no)||row.line_no<1||!UUID.test(row.journal_line_id||'')||!nullableUuid(row.ledger_line_id)||!ACCOUNT_CODE.test(row.account_code||'')||!MONEY4.test(String(row.debit_amount??''))||!MONEY4.test(String(row.credit_amount??''))||row.member_ref!==null&&row.member_ref!==undefined&&!TEXT_TOKEN.test(row.member_ref)||row.description!==null&&row.description!==undefined&&typeof row.description!=='string'||!row.dimensions||typeof row.dimensions!=='object'||Array.isArray(row.dimensions)||!Array.isArray(row.source_document_ids)||row.source_document_ids.some(id=>!UUID.test(id||''))||new Set(row.source_document_ids).size!==row.source_document_ids.length)return null;
  const debit=String(row.debit_amount),credit=String(row.credit_amount);
  if((debit==='0.0000')===(credit==='0.0000'))return null;
  return {line_no:row.line_no,journal_line_id:row.journal_line_id,ledger_line_id:row.ledger_line_id??null,account_code:row.account_code,debit_amount:debit,credit_amount:credit,member_ref:row.member_ref??null,description:row.description??null,dimensions:{...row.dimensions},source_document_ids:[...row.source_document_ids]};
};

const journalDetailRow=(row,config,journalEntryId)=>{
  if(!row||row.entity_id!==config.entityId||row.period_id!==config.periodId||row.journal_entry_id!==journalEntryId||!TEXT_TOKEN.test(row.journal_number||'')||!JOURNAL_TYPES.has(row.journal_type)||!JOURNAL_STATUSES.has(row.status)||!validDate(row.journal_date)||!/^[A-Z]{3}$/.test(row.currency||'')||row.description!==null&&row.description!==undefined&&(typeof row.description!=='string'||row.description.length>2000)||!UNSIGNED_INTEGER.test(String(row.revision??''))||!validTimestamp(row.created_at)||row.posted_at!==null&&row.posted_at!==undefined&&!validTimestamp(row.posted_at)||!Array.isArray(row.lines)||row.lines.length===0)return null;
  const revision=Number(row.revision),lines=row.lines.map(journalDetailLine);
  if(!Number.isSafeInteger(revision)||revision<0||lines.some(line=>line===null)||(row.status==='POSTED')!==(row.posted_at!==null&&row.posted_at!==undefined)||lines.some(line=>row.status==='POSTED'?!line.ledger_line_id:line.ledger_line_id!==null))return null;
  const lineNos=lines.map(line=>line.line_no),lineIds=lines.map(line=>line.journal_line_id),ledgerIds=lines.map(line=>line.ledger_line_id).filter(Boolean);
  if(new Set(lineNos).size!==lineNos.length||new Set(lineIds).size!==lineIds.length||new Set(ledgerIds).size!==ledgerIds.length||lineNos.some((lineNo,index)=>index>0&&lineNo<=lineNos[index-1]))return null;
  return {entity_id:row.entity_id,period_id:row.period_id,journal_entry_id:row.journal_entry_id,journal_number:row.journal_number,journal_type:row.journal_type,status:row.status,journal_date:row.journal_date,currency:row.currency,description:row.description??null,revision,created_at:row.created_at,posted_at:row.posted_at??null,lines};
};

export async function readAuthoritativeJournalEntryDetail({config,journalEntryId,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(journalEntryId||''))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Journal Entry detail requires an exact entity, period, and Journal Entry identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const query=new URLSearchParams({periodId:config.periodId});
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/journal-entries/${journalEntryId}?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response,'JOURNAL_ENTRY_DETAIL');
    const body=await response.json(),journal=body?.ok===true?journalDetailRow(body.data,config,journalEntryId):null;
    return journal?{ok:true,journal}:{ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid Journal Entry detail envelope.'};
  }catch{return unreachable('The browser could not complete the authoritative Journal Entry detail read; no HTTP response was produced.');}
}

export async function refreshAuthoritativeBankTransactions({config,bankAccountRef,from=null,through=null,limit=100,offset=0,fetcher=globalThis.fetch}={}){
  const account=String(bankAccountRef||'').trim();
  if(!config||typeof fetcher!=='function'||!BANK_ACCOUNT_REF.test(account)||from!==null&&!validDate(from)||through!==null&&!validDate(through)||from&&through&&from>through||!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(offset)||offset<0||offset>10000)return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Bank transaction scope requires a valid account, date range, page size, and offset.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({bankAccountRef:account,limit:String(limit),offset:String(offset)});if(from)query.set('from',from);if(through)query.set('through',through);
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/bank/transactions?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid bank transaction envelope.'};
    const rows=body.data.map(row=>bankTransactionRow(row,account)),bankSourceIds=rows.map(row=>row?.bank_source_id),externalLineIds=rows.map(row=>row?.external_bank_line_id);
    if(rows.some(row=>row===null)||new Set(bankSourceIds).size!==bankSourceIds.length||new Set(externalLineIds).size!==externalLineIds.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate bank transaction row.'};
    return {ok:true,rows,scope:{entityId:config.entityId,bankAccountRef:account,from,through,limit,offset}};
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
const reconciliationCommandKey=async(action,identity)=>{
  if(typeof action!=='string'||!action||typeof globalThis?.crypto?.subtle?.digest!=='function')return null;
  try{
    const bytes=new TextEncoder().encode(JSON.stringify({action,identity}));
    const digest=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
    return `UI-RECONCILIATION-${action}-${Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('')}`;
  }catch{return null;}
};
const bankCreateCommandResult=async({config,path,idempotencyKey,body,fetcher,operation})=>{
  if(!config||typeof fetcher!=='function'||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:`${operation} command configuration is invalid.`};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});
    if(!response.ok)return await failure(response,operation);
    const result=await response.json();if(result?.ok!==true||!result.data||typeof result.data!=='object')return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:`Accounting API returned an invalid ${operation} command envelope.`};
    return {ok:true,data:result.data,idempotent:response.status===200};
  }catch{return unreachable(`The browser could not complete the authoritative ${operation} command; no HTTP response was produced.`);}
};
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

const reconciliationWorksheetRow=(row,reconciliationId)=>{
  if(!row||row.reconciliation_id!==reconciliationId||!UNSIGNED_INTEGER.test(String(row.reconciliation_version??''))||!UUID.test(row.bank_source_id||'')||!UNSIGNED_INTEGER.test(String(row.bank_version??''))||!BANK_ACCOUNT_REF.test(row.bank_account_ref||'')||!TEXT_TOKEN.test(row.external_bank_line_id||'')||!validDate(row.transaction_date)||!/^[A-Z]{3}$/.test(row.currency||'')||!MONEY4.test(String(row.amount??''))||!['NOT_CLEARED','CLEARED','UNCLEARED'].includes(row.clearance_state))return null;
  const reconciliationVersion=Number(row.reconciliation_version),bankVersion=Number(row.bank_version),matchId=row.bank_match_id??null,itemId=row.reconciliation_item_id??null;
  if(![reconciliationVersion,bankVersion].every(value=>Number.isSafeInteger(value)&&value>=0)||matchId!==null&&!UUID.test(matchId)||itemId!==null&&!UUID.test(itemId))return null;
  const amount=String(row.amount);
  if(matchId===null&&['bank_match_version','match_status','business_source_document_id','journal_entry_id','journal_line_id'].some(field=>row[field]!==null&&row[field]!==undefined))return null;
  if(matchId!==null&&(!UNSIGNED_INTEGER.test(String(row.bank_match_version??''))||row.match_status!=='ACTIVE'||!UUID.test(row.business_source_document_id||'')||!UUID.test(row.journal_entry_id||'')||!UUID.test(row.journal_line_id||'')))return null;
  const adjustmentJournalId=row.adjustment_journal_entry_id??null,adjustmentJournalStatus=row.adjustment_journal_status??null,adjustmentEligible=row.adjustment_clearance_eligible??null,adjustmentJournalVersion=row.adjustment_journal_version??null;
  const hasAdjustmentEvidence=[adjustmentJournalId,adjustmentJournalStatus,adjustmentEligible,adjustmentJournalVersion].some(value=>value!==null&&value!==undefined);
  if(hasAdjustmentEvidence&&(!UUID.test(adjustmentJournalId||'')||!UNSIGNED_INTEGER.test(String(adjustmentJournalVersion??''))||!['DRAFT','SUBMITTED','REVIEWED','APPROVED','POSTED','REJECTED'].includes(adjustmentJournalStatus)||typeof adjustmentEligible!=='boolean'))return null;
  if(adjustmentEligible===true&&(adjustmentJournalStatus!=='POSTED'||matchId!==null))return null;
  if(matchId!==null&&hasAdjustmentEvidence)return null;
  if(row.clearance_state==='NOT_CLEARED'&&itemId!==null)return null;
  if(row.clearance_state!=='NOT_CLEARED'&&(!itemId||!UNSIGNED_INTEGER.test(String(row.item_version??''))||!TEXT_TOKEN.test(row.cleared_by||'')||!validTimestamp(row.cleared_at)))return null;
  return {reconciliation_id:reconciliationId,reconciliation_version:reconciliationVersion,bank_source_id:row.bank_source_id,bank_version:bankVersion,bank_account_ref:row.bank_account_ref,external_bank_line_id:row.external_bank_line_id,transaction_date:row.transaction_date,currency:row.currency,amount,amount_text:String(row.amount),bank_match_id:matchId,bank_match_version:matchId===null?null:Number(row.bank_match_version),match_status:row.match_status??null,business_source_document_id:row.business_source_document_id??null,journal_entry_id:row.journal_entry_id??null,journal_line_id:row.journal_line_id??null,clearance_state:row.clearance_state,reconciliation_item_id:itemId,item_version:itemId===null?null:Number(row.item_version),cleared_by:row.cleared_by??null,cleared_at:row.cleared_at??null,uncleared_by:row.uncleared_by??null,uncleared_at:row.uncleared_at??null,adjustment_journal_entry_id:hasAdjustmentEvidence?adjustmentJournalId:null,adjustment_journal_version:hasAdjustmentEvidence?Number(adjustmentJournalVersion):null,adjustment_journal_status:hasAdjustmentEvidence?adjustmentJournalStatus:null,adjustment_clearance_eligible:hasAdjustmentEvidence?adjustmentEligible:null};
};

export async function createAuthoritativeBankPaymentMatch({config,bankSourceId,bankRevision,candidate,reason,fetcher=globalThis.fetch}={}){
  const approvedReason=bankCommandReason(reason);
  const amountText=typeof candidate?.amount_text==='string'?candidate.amount_text:null;
  const normalizedCandidate=amountText===null?null:bankMatchCandidateRow({...candidate,amount:amountText});
  if(normalizedCandidate&&candidate.amount!==normalizedCandidate.amount)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Bank Match requires one validated exact candidate, current bank revision, and review reason.'};
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

export async function refreshAuthoritativeAdmittedBankStatements({config,bankAccountRef,limit=10,fetcher=globalThis.fetch}={}){
  const account=String(bankAccountRef||'').trim();
  if(!config||typeof fetcher!=='function'||!BANK_ACCOUNT_REF.test(account)||!Number.isSafeInteger(limit)||limit<1||limit>50)return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Signed statement selection requires one valid bank account and a bounded result limit.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({bankAccountRef:account,limit:String(limit)});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/bank/reconciliations/admitted-statements?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response,'ADMITTED_WBS_STATEMENTS');
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data)||body.data.length>limit)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid admitted statement list envelope.'};
    const rows=body.data.map(row=>admittedStatementRow(row,{account})),ids=rows.map(row=>row?.wbs_bank_statement_receipt_id);
    if(rows.some(row=>row===null)||new Set(ids).size!==ids.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate admitted statement row.'};
    return {ok:true,rows,scope:{entityId:config.entityId,bankAccountRef:account}};
  }catch{return unreachable('The browser could not complete the admitted signed statement read; no HTTP response was produced.');}
}

export async function readAuthoritativeAdmittedBankStatement({config,statementReceiptId,bankAccountRef=null,fetcher=globalThis.fetch}={}){
  const account=bankAccountRef===null?null:String(bankAccountRef||'').trim();
  if(!config||typeof fetcher!=='function'||!UUID.test(statementReceiptId||'')||account!==null&&!BANK_ACCOUNT_REF.test(account))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Signed statement detail requires one immutable receipt identifier and optional retained bank account scope.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/bank/reconciliations/admitted-statements/${statementReceiptId}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response,'ADMITTED_WBS_STATEMENT_DETAIL');
    const body=await response.json(),row=body?.ok===true?admittedStatementRow(body.data,{receiptId:statementReceiptId,account}):null;
    if(!row)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid admitted statement detail envelope.'};
    return {ok:true,row};
  }catch{return unreachable('The browser could not complete the admitted signed statement detail read; no HTTP response was produced.');}
}

export async function startAuthoritativeReconciliationFromAdmittedStatement({config,statement,reason,fetcher=globalThis.fetch}={}){
  const approvedReason=bankCommandReason(reason),row=admittedStatementRow(statement,{receiptId:statement?.wbs_bank_statement_receipt_id||null});
  if(!row||row.signature_verified!==true||row.admission_status!=='ADMITTED'||row.selection_state!=='AVAILABLE_FOR_SERVER_VALIDATION'||!approvedReason)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Starting from WBS requires one freshly read signature-verified ADMITTED statement that is available for server validation, plus a controller reason.'};
  const statementReceiptId=row.wbs_bank_statement_receipt_id;
  const idempotencyKey=await reconciliationCommandKey('START_ADMITTED_STATEMENT',{statementReceiptId,reason:approvedReason});
  if(!idempotencyKey)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'The browser could not create an admitted statement command identity.'};
  const result=await bankCreateCommandResult({config,path:'/bank/reconciliations/from-admitted-statement',idempotencyKey,body:{statementReceiptId,reason:approvedReason},fetcher,operation:'ADMITTED_STATEMENT_RECONCILIATION_START'});
  if(!result.ok)return result;
  if(!UUID.test(result.data.reconciliation_id||'')||result.data.status!=='DRAFT'||result.data.wbs_bank_statement_receipt_id!==statementReceiptId)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid admitted statement reconciliation result.'};
  return result;
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

export async function refreshAuthoritativeReconciliationScopes({config,limit=100,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>200)return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Reconciliation scope discovery requires one authoritative entity and a limit from 1 to 200.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/bank/reconciliations/scopes?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response,'RECONCILIATION_SCOPES');
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid reconciliation scope envelope.'};
    const rows=body.data.map(reconciliationScopeRow),ids=rows.map(row=>row?.reconciliation_id);
    if(rows.some(row=>row===null)||new Set(ids).size!==ids.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate reconciliation scope row.'};
    return {ok:true,rows,scope:{entityId:config.entityId,limit}};
  }catch{return unreachable('The browser could not complete reconciliation scope discovery; no HTTP response was produced.');}
}

export async function refreshAuthoritativeReconciliationWorksheet({config,reconciliationId,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(reconciliationId||''))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Reconciliation worksheet requires one authoritative reconciliation.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/bank/reconciliations/${reconciliationId}/worksheet`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response,'RECONCILIATION_WORKSHEET');
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid reconciliation worksheet envelope.'};
    const rows=body.data.map(row=>reconciliationWorksheetRow(row,reconciliationId)),ids=rows.map(row=>row?.bank_source_id);
    if(rows.some(row=>row===null)||new Set(ids).size!==ids.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate reconciliation worksheet row.'};
    return {ok:true,rows};
  }catch{return unreachable('The browser could not complete the authoritative reconciliation worksheet read; no HTTP response was produced.');}
}

export async function setAuthoritativeReconciliationClearance({config,reconciliationId,reconciliationRevision,row,clear,reason,fetcher=globalThis.fetch}={}){
  const approvedReason=bankCommandReason(reason);
  if(!UUID.test(reconciliationId||'')||!Number.isSafeInteger(reconciliationRevision)||reconciliationRevision<0||!row||!UUID.test(row.bank_source_id||'')||!Number.isSafeInteger(row.bank_version)||row.bank_version<0||typeof clear!=='boolean'||!approvedReason||clear&&(row.match_status!=='ACTIVE'||!UUID.test(row.bank_match_id||'')))return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Clearance requires current reconciliation and bank revisions, an exact active match to clear, and a review reason.'};
  const idempotencyKey=`UI-RECONCILIATION-${clear?'CLEAR':'UNCLEAR'}-${reconciliationId}-${reconciliationRevision}-${row.bank_source_id}-${row.bank_version}`;
  return bankCommandResult({config,path:`/bank/reconciliations/${reconciliationId}/items/${row.bank_source_id}/clearance`,revision:reconciliationRevision,idempotencyKey,body:{clear,expectedBankRevision:row.bank_version,reason:approvedReason},fetcher,operation:'RECONCILIATION_CLEARANCE'});
}

const adjustmentLinesForBankRow=({row,cashAccountCode,offsetAccountCode,description})=>{
  const amount=String(row?.amount_text??'');
  const offset=String(offsetAccountCode??'').trim();
  if(!row||!UUID.test(row.bank_source_id||'')||!BANK_ACCOUNT_REF.test(row.bank_account_ref||'')||!/^[A-Z]{3}$/.test(row.currency||'')||row.clearance_state!=='NOT_CLEARED'||row.match_status!==null||!MONEY4.test(amount)||amount==='0.0000'||!ACCOUNT_CODE.test(cashAccountCode||'')||!ACCOUNT_CODE.test(offset)||cashAccountCode===offset)return null;
  const isCredit=amount.startsWith('-'),absolute=isCredit?amount.slice(1):amount;
  const zero='0.0000',lineDescription=typeof description==='string'&&description.trim()?description.trim():null;
  return [
    {lineNo:1,accountCode:cashAccountCode,debitAmount:isCredit?zero:absolute,creditAmount:isCredit?absolute:zero,memberRef:row.bank_account_ref,description:lineDescription,dimensions:{}},
    {lineNo:2,accountCode:offset,debitAmount:isCredit?absolute:zero,creditAmount:isCredit?zero:absolute,memberRef:null,description:lineDescription,dimensions:{}},
  ];
};

const canonicalAttachmentIds=value=>{
  if(!Array.isArray(value)||!value.length||value.some(id=>!UUID.test(id||'')))return null;
  const ids=[...new Set(value)];
  return ids.length===value.length?ids.sort():null;
};

export async function createAuthoritativeReconciliationAdjustmentDraft({config,reconciliationId,reconciliationRevision,row,journalNumber,journalDate,offsetAccountCode,description=null,attachmentIds,reason,fetcher=globalThis.fetch}={}){
  const approvedReason=bankCommandReason(reason),number=String(journalNumber||'').trim(),date=String(journalDate||''),attachments=canonicalAttachmentIds(attachmentIds);
  const normalizedDescription=description===null||description===undefined||String(description).trim()===''?null:String(description).trim();
  const lines=adjustmentLinesForBankRow({row,cashAccountCode:config?.cashAccountCode,offsetAccountCode,description:normalizedDescription});
  if(!config||!UUID.test(reconciliationId||'')||!Number.isSafeInteger(reconciliationRevision)||reconciliationRevision<0||!UUID.test(config.periodId||'')||!lines||!TEXT_TOKEN.test(number)||!validDate(date)||!attachments||!approvedReason)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Adjustment Draft requires one unresolved bank source, current statement revision, configured cash account, explicit offset account, clean attachment IDs, date, and controller reason.'};
  const identity={reconciliationId,reconciliationRevision,bankSourceId:row.bank_source_id,periodId:config.periodId,journalNumber:number,journalDate:date,currency:row.currency,description:normalizedDescription,lines,attachmentIds:attachments,reason:approvedReason};
  const idempotencyKey=await reconciliationCommandKey('ADJUSTMENT_DRAFT',identity);
  if(!idempotencyKey)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'The browser could not create an adjustment Draft command identity.'};
  return bankCommandResult({config,path:`/bank/reconciliations/${reconciliationId}/adjustment-drafts`,revision:reconciliationRevision,idempotencyKey,body:{bankSourceId:row.bank_source_id,periodId:config.periodId,journalNumber:number,journalDate:date,currency:row.currency,description:normalizedDescription,lines,attachmentIds:attachments,reason:approvedReason},fetcher,operation:'RECONCILIATION_ADJUSTMENT_DRAFT'});
}

export async function setAuthoritativeReconciliationAdjustmentClearance({config,reconciliationId,reconciliationRevision,row,clear,reason,fetcher=globalThis.fetch}={}){
  const approvedReason=bankCommandReason(reason);
  if(!UUID.test(reconciliationId||'')||!Number.isSafeInteger(reconciliationRevision)||reconciliationRevision<0||!row||!UUID.test(row.bank_source_id||'')||!Number.isSafeInteger(row.bank_version)||row.bank_version<0||typeof clear!=='boolean'||!approvedReason||row.adjustment_clearance_eligible!==true||row.adjustment_journal_status!=='POSTED'||!UUID.test(row.adjustment_journal_entry_id||'')||!Number.isSafeInteger(row.adjustment_journal_version)||row.adjustment_journal_version<0||clear&&(row.match_status!==null||row.clearance_state!=='NOT_CLEARED'))return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Adjustment clearance requires server-verified Posted adjustment evidence, current revisions, explicit state, and controller reason.'};
  const idempotencyKey=`UI-RECONCILIATION-ADJUSTMENT-${clear?'CLEAR':'UNCLEAR'}-${reconciliationId}-${reconciliationRevision}-${row.bank_source_id}-${row.bank_version}`;
  return bankCommandResult({config,path:`/bank/reconciliations/${reconciliationId}/adjustment-items/${row.bank_source_id}/clearance`,revision:reconciliationRevision,idempotencyKey,body:{clear,expectedBankRevision:row.bank_version,reason:approvedReason},fetcher,operation:'RECONCILIATION_ADJUSTMENT_CLEARANCE'});
}

export async function startAuthoritativeReconciliation({config,bankAccountRef,statementEndingDate,statementOpeningBalance,statementEndingBalance,reason,fetcher=globalThis.fetch}={}){
  const account=String(bankAccountRef||'').trim(),opening=String(statementOpeningBalance||''),ending=String(statementEndingBalance||''),approvedReason=bankCommandReason(reason);
  if(!config||typeof fetcher!=='function'||!BANK_ACCOUNT_REF.test(account)||!validDate(statementEndingDate)||!REPORT_MONEY4.test(opening)||!REPORT_MONEY4.test(ending)||!approvedReason)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Starting reconciliation requires one valid account, statement cutoff, four-decimal balances, and controller reason.'};
  const idempotencyKey=await reconciliationCommandKey('START',{account,statementEndingDate,opening,ending,reason:approvedReason});
  if(!idempotencyKey)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'The browser could not create a reconciliation command identity.'};
  return bankCreateCommandResult({config,path:'/bank/reconciliations',idempotencyKey,body:{bankAccountRef:account,statementEndingDate,statementOpeningBalance:opening,statementEndingBalance:ending,reason:approvedReason},fetcher,operation:'RECONCILIATION_START'});
}

export async function transitionAuthoritativeReconciliation({config,reconciliationId,revision,action,reason,fetcher=globalThis.fetch}={}){
  const transition=String(action||'').toUpperCase(),approvedReason=bankCommandReason(reason);
  if(!UUID.test(reconciliationId||'')||!Number.isSafeInteger(revision)||revision<0||!['REVIEW','SIGN_OFF','REOPEN'].includes(transition)||!approvedReason)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'Reconciliation transition requires the current statement revision, an allowed action, and controller reason.'};
  const idempotencyKey=await reconciliationCommandKey(transition,{reconciliationId,revision,reason:approvedReason});
  if(!idempotencyKey)return {ok:false,code:'ACCOUNTING_API_COMMAND_INVALID',message:'The browser could not create a reconciliation command identity.'};
  return bankCommandResult({config,path:`/bank/reconciliations/${reconciliationId}/transitions/${transition.toLowerCase()}`,revision,idempotencyKey,body:{reason:approvedReason},fetcher,operation:`RECONCILIATION_${transition}`});
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

export async function refreshAuthoritativeFinancialStatementSnapshot({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(config.entityId||'')||!UUID.test(config.periodId||''))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Financial-statement snapshots require one authoritative entity and accounting period.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({periodId:config.periodId});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/reports/financial-statement-snapshot?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid financial-statement snapshot envelope.'};
    const statementTypes=new Set(['TRIAL_BALANCE','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW']),numericFields=['opening_debit','opening_credit','period_debit','period_credit','ending_debit','ending_credit','display_balance'],idFields=['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'];
    const invalid=row=>!UUID.test(row?.financial_statement_snapshot_id||'')||!/^[1-9][0-9]*$/.test(String(row?.version??''))||!CURRENCY3.test(row?.currency||'')||!SHA256.test(row?.snapshot_hash||'')||!SHA256.test(row?.ledger_evidence_hash||'')||typeof row?.prepared_by!=='string'||!row.prepared_by.trim()||typeof row?.approved_by!=='string'||!row.approved_by.trim()||row.prepared_by===row.approved_by||!validTimestamp(row?.approved_at)||!validTimestamp(row?.captured_at)||!statementTypes.has(row?.statement_type)||typeof row?.statement_section!=='string'||!row.statement_section.trim()||typeof row?.classification_basis!=='string'||!row.classification_basis.trim()||!ACCOUNT_CODE.test(row?.account_code||'')||typeof row?.account_name!=='string'||!row.account_name.trim()||numericFields.some(field=>!REPORT_MONEY4.test(String(row?.[field]??'')))||idFields.some(field=>!Array.isArray(row?.[field])||row[field].some(id=>!UUID.test(id||'')))||!SHA256.test(row?.row_hash||'');
    if(body.data.some(invalid)||new Set(body.data.map(row=>`${row.financial_statement_snapshot_id}:${row.statement_type}:${row.account_code}`)).size!==body.data.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate financial-statement snapshot row.'};
    const snapshotIds=new Set(body.data.map(row=>row.financial_statement_snapshot_id)),versions=new Set(body.data.map(row=>String(row.version)));
    if(snapshotIds.size>1||versions.size>1)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned mixed financial-statement snapshot versions.'};
    return {ok:true,rows:body.data.map(row=>({...row,...Object.fromEntries(numericFields.map(field=>[field,String(row[field])]))})),scope:{entityId:config.entityId,periodId:config.periodId},snapshotId:body.data[0]?.financial_statement_snapshot_id||null,version:body.data[0]?String(body.data[0].version):null};
  }catch{return unreachable('The browser could not complete the authoritative financial-statement snapshot read; no HTTP response was produced.');}
}

export async function refreshAuthoritativeFinancialStatementPeriodComparison({config,priorPeriodId,fetcher=globalThis.fetch}={}){
  const prior=String(priorPeriodId||'');
  if(!config||typeof fetcher!=='function'||!UUID.test(config.periodId||'')||!UUID.test(prior)||prior===config.periodId)return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Period comparison requires two distinct authoritative accounting-period identifiers.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({currentPeriodId:config.periodId,priorPeriodId:prior});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/reports/financial-statement-period-comparison?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid financial statement comparison envelope.'};
    const statements=new Set(['TRIAL_BALANCE','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW']);
    const statuses=new Set(['COMPARABLE_POSTED_EVIDENCE','MISSING_CURRENT_EVIDENCE','MISSING_PRIOR_EVIDENCE']);
    const idSets=['current_journal_entry_ids','current_journal_line_ids','current_ledger_line_ids','current_source_document_ids','prior_journal_entry_ids','prior_journal_line_ids','prior_ledger_line_ids','prior_source_document_ids'];
    const invalid=row=>{
      const currentPresent=row?.comparison_status!=='MISSING_CURRENT_EVIDENCE',priorPresent=row?.comparison_status!=='MISSING_PRIOR_EVIDENCE';
      const validIds=field=>row?.[field]===null
        ? (field.startsWith('current_')?!currentPresent:!priorPresent)
        : Array.isArray(row?.[field])&&row[field].every(id=>UUID.test(id||''));
      return row?.current_period_id!==config.periodId||row?.prior_period_id!==prior||!PERIOD_CODE.test(row?.current_period_code||'')||!PERIOD_CODE.test(row?.prior_period_code||'')||!validDate(row?.current_period_start)||!validDate(row?.current_period_end)||!validDate(row?.prior_period_start)||!validDate(row?.prior_period_end)||row.current_period_start>row.current_period_end||row.prior_period_start>row.prior_period_end||row.prior_period_end>=row.current_period_start||!statements.has(row?.statement_type)||typeof row?.statement_section!=='string'||!row.statement_section||row?.classification_basis!=='ACCOUNT_CODE_PREFIX_AND_BANK_MEMBER'||!ACCOUNT_CODE.test(row?.account_code||'')||typeof row?.account_name!=='string'||!row.account_name.trim()||!statuses.has(row?.comparison_status)||currentPresent!==REPORT_MONEY4.test(String(row?.current_display_balance??''))||priorPresent!==REPORT_MONEY4.test(String(row?.prior_display_balance??''))||idSets.some(field=>!validIds(field));
    };
    if(body.data.some(invalid))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or incomplete financial statement comparison row.'};
    if(new Set(body.data.map(row=>`${row.statement_type}:${row.account_code}`)).size!==body.data.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned duplicate financial statement comparison evidence.'};
    return {ok:true,rows:body.data.map(row=>({...row,current_display_balance:row.current_display_balance===null?null:String(row.current_display_balance),prior_display_balance:row.prior_display_balance===null?null:String(row.prior_display_balance)})),scope:{entityId:config.entityId,currentPeriodId:config.periodId,priorPeriodId:prior}};
  }catch{return unreachable('The browser could not complete the authoritative financial statement comparison read; no HTTP response was produced.');}
}

export async function refreshAuthoritativeDimensionProfitability({config,dimensionType,dimensionRef,fetcher=globalThis.fetch}={}){
  const type=String(dimensionType||''),ref=String(dimensionRef||'');
  if(!config||typeof fetcher!=='function'||!UUID.test(config.periodId||'')||!['PROPERTY','PROJECT','UNIT','LOT'].includes(type)||!ref||ref!==ref.trim()||ref.length>160||/[\u0000-\u001f\u007f]/.test(ref))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Dimension profitability requires one authoritative entity and period plus a canonical Property, Project, Unit, or Lot reference.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({periodId:config.periodId,dimensionType:type,dimensionRef:ref});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/reports/dimension-profitability?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid dimension profitability envelope.'};
    const statementType={PROPERTY:'PROPERTY_PNL',PROJECT:'PROJECT_PNL',UNIT:'UNIT_PROFITABILITY',LOT:'LOT_PROFITABILITY'}[type];
    const numericFields=['period_debit','period_credit','display_balance'],idFields=['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'];
    if(body.data.some(row=>row?.period_id!==config.periodId||!PERIOD_CODE.test(row.period_code||'')||!validDate(row.period_start)||!validDate(row.period_end)||row.period_start>row.period_end||row.period_start.slice(0,7)!==row.period_code||row.period_end.slice(0,7)!==row.period_code||row.dimension_type!==type||row.dimension_ref!==ref||row.statement_type!==statementType||!['REVENUE','EXPENSES'].includes(row.statement_section)||row.classification_basis!=='POSTED_LEDGER_DIMENSION_EXACT'||!ACCOUNT_CODE.test(row.account_code||'')||typeof row.account_name!=='string'||!row.account_name.trim()||numericFields.some(field=>!REPORT_MONEY4.test(String(row[field]??'')))||idFields.some(field=>!Array.isArray(row[field])||row[field].some(id=>!UUID.test(id||'')))))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid dimension profitability row.'};
    if(new Set(body.data.map(row=>`${row.statement_section}:${row.account_code}`)).size!==body.data.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned duplicate dimension profitability rows.'};
    return {ok:true,rows:body.data.map(row=>({...row,...Object.fromEntries(numericFields.map(field=>[field,String(row[field])]))})),scope:{entityId:config.entityId,periodId:config.periodId,dimensionType:type,dimensionRef:ref}};
  }catch{return unreachable('The browser could not complete the authoritative dimension profitability read; no HTTP response was produced.');}
}

export async function refreshAuthoritativeCashFlowClassification({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(config.periodId||''))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'The cash flow statement requires one authoritative entity and accounting period.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({periodId:config.periodId});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/reports/cash-flow-classification?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid cash flow statement envelope.'};
    const sections=new Set(['OPERATING','INVESTING','FINANCING','BLOCKED']);
    const statuses=new Set(['CLASSIFIED','BLOCKED_MAPPING_REQUIRED','BLOCKED_MAPPING_AMBIGUOUS','BLOCKED_MAPPING_RULE_INVALID','BLOCKED_JOURNAL_SHAPE_REQUIRED']);
    const blocked=new Set([...statuses].filter(value=>value!=='CLASSIFIED'));
    const idFields=['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'];
    const invalidCashFlowRow=row=>{
      const classified=row?.mapping_status==='CLASSIFIED';
      const validMapping=classified
        ? ['OPERATING','INVESTING','FINANCING'].includes(row.classification)&&UUID.test(row.mapping_snapshot_id||'')&&/^[1-9][0-9]*$/.test(String(row.mapping_version??''))&&/^sha256:[0-9a-f]{64}$/.test(row.mapping_snapshot_hash||'')
        : blocked.has(row?.mapping_status)&&row?.classification==='BLOCKED'&&row?.mapping_snapshot_id===null&&row?.mapping_version===null&&row?.mapping_snapshot_hash===null;
      return row?.period_id!==config.periodId||!PERIOD_CODE.test(row?.period_code||'')||!validDate(row?.period_start)||!validDate(row?.period_end)||row.period_start>row.period_end||row.period_start.slice(0,7)!==row.period_code||row.period_end.slice(0,7)!==row.period_code||!sections.has(row?.classification)||!statuses.has(row?.mapping_status)||typeof row?.classification_basis!=='string'||!row.classification_basis.trim()||(!ACCOUNT_CODE.test(row?.cash_account_code||'')&&row?.cash_account_code!=='UNRESOLVED_CASH_ACCOUNT')||typeof row?.counterpart_account_code!=='string'||!row.counterpart_account_code.trim()||!REPORT_MONEY4.test(String(row?.cash_effect??''))||idFields.some(field=>!Array.isArray(row?.[field])||row[field].some(id=>!UUID.test(id||'')))||!validMapping;
    };
    if(body.data.some(invalidCashFlowRow))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid cash flow statement row.'};
    if(new Set(body.data.map(row=>`${row.journal_entry_ids[0]}:${row.cash_account_code}:${row.counterpart_account_code}`)).size!==body.data.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned duplicate cash flow statement evidence.'};
    return {ok:true,rows:body.data.map(row=>({...row,cash_effect:String(row.cash_effect)})),scope:{entityId:config.entityId,periodId:config.periodId},complete:body.data.length>0&&body.data.every(row=>row.mapping_status==='CLASSIFIED')};
  }catch{return unreachable('The browser could not complete the authoritative cash flow statement read; no HTTP response was produced.');}
}

export async function refreshAuthoritativeCwipRollforward({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(config.periodId||''))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'CWIP rollforward requires one authoritative entity and accounting period.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({periodId:config.periodId});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/reports/cwip-rollforward?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid CWIP rollforward envelope.'};
    const statuses=new Set(['MAPPED_CWIP_ACCOUNT','BLOCKED_MAPPING_REQUIRED','BLOCKED_MAPPING_AMBIGUOUS','BLOCKED_MAPPING_RULE_INVALID']);
    const ids=['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'];
    const invalid=row=>{
      const mapped=row?.mapping_status==='MAPPED_CWIP_ACCOUNT';
      const validMapping=mapped?UUID.test(row.mapping_snapshot_id||'')&&/^[1-9][0-9]*$/.test(String(row.mapping_version??''))&&/^sha256:[0-9a-f]{64}$/.test(row.mapping_snapshot_hash||''):row?.mapping_snapshot_id===null&&row?.mapping_version===null&&row?.mapping_snapshot_hash===null;
      const values=['opening_balance','period_debit','period_credit','closing_balance'];
      return row?.period_id!==config.periodId||!PERIOD_CODE.test(row?.period_code||'')||!validDate(row?.period_start)||!validDate(row?.period_end)||row.period_start>row.period_end||row.period_start.slice(0,7)!==row.period_code||row.period_end.slice(0,7)!==row.period_code||!ACCOUNT_CODE.test(row?.account_code||'')||typeof row?.account_name!=='string'||!row.account_name.trim()||!statuses.has(row?.mapping_status)||typeof row?.classification_basis!=='string'||!row.classification_basis.trim()||!validMapping||ids.some(field=>!Array.isArray(row?.[field])||row[field].some(id=>!UUID.test(id||'')))||(mapped?values.some(field=>!REPORT_MONEY4.test(String(row?.[field]??''))):values.some(field=>row?.[field]!==null));
    };
    if(body.data.some(invalid)||new Set(body.data.map(row=>row.account_code)).size!==body.data.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate CWIP rollforward row.'};
    return {ok:true,rows:body.data.map(row=>({...row,...Object.fromEntries(['opening_balance','period_debit','period_credit','closing_balance'].map(field=>[field,row[field]===null?null:String(row[field])]))})),scope:{entityId:config.entityId,periodId:config.periodId},complete:body.data.length>0&&body.data.every(row=>row.mapping_status==='MAPPED_CWIP_ACCOUNT')};
  }catch{return unreachable('The browser could not complete the authoritative CWIP rollforward read; no HTTP response was produced.');}
}

export async function refreshAuthoritativeConstructionLoanRollforward({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(config.periodId||''))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Construction-loan rollforward requires one authoritative entity and accounting period.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({periodId:config.periodId});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/reports/construction-loan-rollforward?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid construction-loan rollforward envelope.'};
    const statuses=new Set(['MAPPED_CONSTRUCTION_LOAN_ACCOUNT','BLOCKED_MAPPING_REQUIRED','BLOCKED_MAPPING_AMBIGUOUS','BLOCKED_MAPPING_RULE_INVALID']);
    const ids=['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'];
    const invalid=row=>{
      const mapped=row?.mapping_status==='MAPPED_CONSTRUCTION_LOAN_ACCOUNT';
      const validMapping=mapped?UUID.test(row.mapping_snapshot_id||'')&&/^[1-9][0-9]*$/.test(String(row.mapping_version??''))&&/^sha256:[0-9a-f]{64}$/.test(row.mapping_snapshot_hash||''):row?.mapping_snapshot_id===null&&row?.mapping_version===null&&row?.mapping_snapshot_hash===null;
      const values=['opening_balance','period_draws','period_repayments','closing_balance'];
      return row?.period_id!==config.periodId||!PERIOD_CODE.test(row?.period_code||'')||!validDate(row?.period_start)||!validDate(row?.period_end)||row.period_start>row.period_end||row.period_start.slice(0,7)!==row.period_code||row.period_end.slice(0,7)!==row.period_code||!ACCOUNT_CODE.test(row?.account_code||'')||typeof row?.account_name!=='string'||!row.account_name.trim()||!statuses.has(row?.mapping_status)||typeof row?.classification_basis!=='string'||!row.classification_basis.trim()||!validMapping||ids.some(field=>!Array.isArray(row?.[field])||row[field].some(id=>!UUID.test(id||'')))||(mapped?values.some(field=>!REPORT_MONEY4.test(String(row?.[field]??''))):values.some(field=>row?.[field]!==null));
    };
    if(body.data.some(invalid)||new Set(body.data.map(row=>row.account_code)).size!==body.data.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate construction-loan rollforward row.'};
    return {ok:true,rows:body.data.map(row=>({...row,...Object.fromEntries(['opening_balance','period_draws','period_repayments','closing_balance'].map(field=>[field,row[field]===null?null:String(row[field])]))})),scope:{entityId:config.entityId,periodId:config.periodId},complete:body.data.length>0&&body.data.every(row=>row.mapping_status==='MAPPED_CONSTRUCTION_LOAN_ACCOUNT')};
  }catch{return unreachable('The browser could not complete the authoritative construction-loan rollforward read; no HTTP response was produced.');}
}

export async function refreshAuthoritativePrepaidRollforward({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(config.periodId||''))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Prepaid rollforward requires one authoritative entity and accounting period.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({periodId:config.periodId});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/reports/prepaid-rollforward?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid prepaid rollforward envelope.'};
    const statuses=new Set(['MAPPED_PREPAID_ACCOUNT','BLOCKED_MAPPING_REQUIRED','BLOCKED_MAPPING_AMBIGUOUS','BLOCKED_MAPPING_RULE_INVALID']);
    const ids=['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'];
    const invalid=row=>{
      const mapped=row?.mapping_status==='MAPPED_PREPAID_ACCOUNT';
      const validMapping=mapped?UUID.test(row.mapping_snapshot_id||'')&&/^[1-9][0-9]*$/.test(String(row.mapping_version??''))&&/^sha256:[0-9a-f]{64}$/.test(row.mapping_snapshot_hash||''):row?.mapping_snapshot_id===null&&row?.mapping_version===null&&row?.mapping_snapshot_hash===null;
      const values=['opening_balance','period_additions','period_amortization','closing_balance'];
      return row?.period_id!==config.periodId||!PERIOD_CODE.test(row?.period_code||'')||!validDate(row?.period_start)||!validDate(row?.period_end)||row.period_start>row.period_end||row.period_start.slice(0,7)!==row.period_code||row.period_end.slice(0,7)!==row.period_code||!ACCOUNT_CODE.test(row?.account_code||'')||typeof row?.account_name!=='string'||!row.account_name.trim()||!statuses.has(row?.mapping_status)||typeof row?.classification_basis!=='string'||!row.classification_basis.trim()||!validMapping||ids.some(field=>!Array.isArray(row?.[field])||row[field].some(id=>!UUID.test(id||'')))||(mapped?values.some(field=>!REPORT_MONEY4.test(String(row?.[field]??''))):values.some(field=>row?.[field]!==null));
    };
    if(body.data.some(invalid)||new Set(body.data.map(row=>row.account_code)).size!==body.data.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate prepaid rollforward row.'};
    return {ok:true,rows:body.data.map(row=>({...row,...Object.fromEntries(['opening_balance','period_additions','period_amortization','closing_balance'].map(field=>[field,row[field]===null?null:String(row[field])]))})),scope:{entityId:config.entityId,periodId:config.periodId},complete:body.data.length>0&&body.data.every(row=>row.mapping_status==='MAPPED_PREPAID_ACCOUNT')};
  }catch{return unreachable('The browser could not complete the authoritative prepaid rollforward read; no HTTP response was produced.');}
}

export async function refreshAuthoritativeIntercompanyReconciliation({config,counterpartyEntityId,counterpartyPeriodId,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(config.periodId||'')||!UUID.test(counterpartyEntityId||'')||!UUID.test(counterpartyPeriodId||'')||counterpartyEntityId===config.entityId)return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Intercompany reconciliation requires two distinct authoritative entities and one period for each entity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({periodId:config.periodId,counterpartyEntityId,counterpartyPeriodId});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/reports/intercompany-reconciliation?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid intercompany reconciliation envelope.'};
    const statuses=new Set(['MAPPED_INTERCOMPANY_PAIR','BLOCKED_MAPPING_AMBIGUOUS','BLOCKED_MAPPING_RULE_INVALID','BLOCKED_COUNTERPARTY_MAPPING_REQUIRED','BLOCKED_COUNTERPARTY_MAPPING_AMBIGUOUS','BLOCKED_COUNTERPARTY_MAPPING_MISMATCH','BLOCKED_CURRENT_POSTED_EVIDENCE_REQUIRED','BLOCKED_COUNTERPARTY_POSTED_EVIDENCE_REQUIRED']);
    const ids=['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids','counterparty_journal_entry_ids','counterparty_journal_line_ids','counterparty_ledger_line_ids','counterparty_source_document_ids'];
    const invalid=row=>{
      const mapped=row?.mapping_status==='MAPPED_INTERCOMPANY_PAIR';
      const amounts=['current_closing_balance','counterparty_closing_balance','difference_amount'];
      const snapshotValid=(id,version,hash)=>id===null&&version===null&&hash===null||UUID.test(id||'')&&/^[1-9][0-9]*$/.test(String(version??''))&&/^sha256:[0-9a-f]{64}$/.test(hash||'');
      const currentMappingValid=snapshotValid(row?.mapping_snapshot_id,row?.mapping_version,row?.mapping_snapshot_hash);
      const counterpartyMappingValid=snapshotValid(row?.counterparty_mapping_snapshot_id,row?.counterparty_mapping_version,row?.counterparty_mapping_snapshot_hash);
      return row?.period_id!==config.periodId||row?.counterparty_period_id!==counterpartyPeriodId||!PERIOD_CODE.test(row?.period_code||'')||!validDate(row?.period_start)||!validDate(row?.period_end)||row.period_start>row.period_end||row.period_start.slice(0,7)!==row.period_code||row.period_end.slice(0,7)!==row.period_code||!ACCOUNT_CODE.test(row?.account_code||'')||!ACCOUNT_CODE.test(row?.counterparty_account_code||'')||typeof row?.account_name!=='string'||!row.account_name.trim()||typeof row?.counterparty_account_name!=='string'||!row.counterparty_account_name.trim()||!statuses.has(row?.mapping_status)||typeof row?.classification_basis!=='string'||!row.classification_basis.trim()||!currentMappingValid||!counterpartyMappingValid||(mapped&&(!UUID.test(row?.mapping_snapshot_id||'')||!UUID.test(row?.counterparty_mapping_snapshot_id||'')))||ids.some(field=>!Array.isArray(row?.[field])||row[field].some(id=>!UUID.test(id||'')))||(mapped?(amounts.some(field=>!REPORT_MONEY4.test(String(row?.[field]??'')))||typeof row.in_balance!=='boolean'):(amounts.some(field=>row?.[field]!==null)||row?.in_balance!==false));
    };
    if(body.data.some(invalid)||new Set(body.data.map(row=>row.account_code)).size!==body.data.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate intercompany reconciliation row.'};
    return {ok:true,rows:body.data.map(row=>({...row,...Object.fromEntries(['current_closing_balance','counterparty_closing_balance','difference_amount'].map(field=>[field,row[field]===null?null:String(row[field])]))})),scope:{entityId:config.entityId,periodId:config.periodId,counterpartyEntityId,counterpartyPeriodId},complete:body.data.length>0&&body.data.every(row=>row.mapping_status==='MAPPED_INTERCOMPANY_PAIR')};
  }catch{return unreachable('The browser could not complete the authoritative intercompany reconciliation read; no HTTP response was produced.');}
}

export async function refreshAuthoritativeBudgetVsActual({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(config.periodId||''))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Budget versus actual requires one authoritative entity and accounting period.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({periodId:config.periodId});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/reports/budget-vs-actual?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid budget-versus-actual envelope.'};
    const statuses=new Set(['APPROVED_BUDGET_VS_ACTUAL','BLOCKED_ACCOUNT_REQUIRED','BLOCKED_BUDGET_CURRENCY_REQUIRED','BLOCKED_POSTED_ACTUAL_EVIDENCE_REQUIRED','BLOCKED_ACTUAL_CURRENCY_REQUIRED']);
    const ids=['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'];
    const invalid=row=>{
      const approved=row?.report_status==='APPROVED_BUDGET_VS_ACTUAL';
      const amounts=['budget_amount','actual_amount','variance_amount'];
      return row?.period_id!==config.periodId||!PERIOD_CODE.test(row?.period_code||'')||!validDate(row?.period_start)||!validDate(row?.period_end)||row.period_start>row.period_end||row.period_start.slice(0,7)!==row.period_code||row.period_end.slice(0,7)!==row.period_code||!ACCOUNT_CODE.test(row?.account_code||'')||typeof row?.account_name!=='string'||!row.account_name.trim()||!CURRENCY3.test(row?.currency||'')||!['DEBIT','CREDIT'].includes(row?.comparison_side)||!statuses.has(row?.report_status)||typeof row?.classification_basis!=='string'||!row.classification_basis.trim()||!UUID.test(row?.budget_snapshot_id||'')||!/^[1-9][0-9]*$/.test(String(row?.budget_version??''))||!/^sha256:[0-9a-f]{64}$/.test(row?.budget_snapshot_hash||'')||!/^sha256:[0-9a-f]{64}$/.test(row?.budget_receipt_hash||'')||typeof row?.budget_source_ref!=='string'||!row.budget_source_ref.trim()||typeof row?.budget_source_version!=='string'||!row.budget_source_version.trim()||ids.some(field=>!Array.isArray(row?.[field])||row[field].some(id=>!UUID.test(id||'')))||(approved?amounts.some(field=>!REPORT_MONEY4.test(String(row?.[field]??''))):amounts.some(field=>row?.[field]!==null));
    };
    if(body.data.some(invalid)||new Set(body.data.map(row=>row.account_code)).size!==body.data.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate budget-versus-actual row.'};
    return {ok:true,rows:body.data.map(row=>({...row,...Object.fromEntries(['budget_amount','actual_amount','variance_amount'].map(field=>[field,row[field]===null?null:String(row[field])]))})),scope:{entityId:config.entityId,periodId:config.periodId},complete:body.data.length>0&&body.data.every(row=>row.report_status==='APPROVED_BUDGET_VS_ACTUAL')};
  }catch{return unreachable('The browser could not complete the authoritative budget-versus-actual read; no HTTP response was produced.');}
}

export async function refreshAuthoritativeConsolidation({config,groupRef,fetcher=globalThis.fetch}={}){
  const group=String(groupRef??'').trim();
  if(!config||typeof fetcher!=='function'||!UUID.test(config.periodId||'')||!group||group.length>160||/[\u0000-\u001f\u007f]/.test(group))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Consolidation requires one authoritative reporting entity, period, and canonical group reference.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({periodId:config.periodId,groupRef:group});
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/reports/consolidation?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response);
    const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid consolidation envelope.'};
    const statuses=new Set(['APPROVED_CONSOLIDATION_SNAPSHOT_AND_POSTED_LEDGER_EXACT','BLOCKED_MEMBER_SCOPE_REQUIRED','BLOCKED_MEMBER_PERIOD_OR_CURRENCY_REQUIRED','BLOCKED_MEMBER_POSTED_EVIDENCE_REQUIRED','BLOCKED_ELIMINATION_EVIDENCE_REQUIRED']);
    const ids=['member_entity_ids','journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'];
    const invalid=row=>{
      const approved=row?.report_status==='APPROVED_CONSOLIDATION_SNAPSHOT_AND_POSTED_LEDGER_EXACT';
      const amounts=['member_actual_amount','elimination_amount','consolidated_amount'];
      return row?.group_ref!==group||row?.period_id!==config.periodId||!PERIOD_CODE.test(row?.period_code||'')||!validDate(row?.period_start)||!validDate(row?.period_end)||row.period_start>row.period_end||row.period_start.slice(0,7)!==row.period_code||row.period_end.slice(0,7)!==row.period_code||!CURRENCY3.test(row?.currency||'')||!ACCOUNT_CODE.test(row?.presentation_account_code||'')||!['DEBIT','CREDIT'].includes(row?.presentation_side)||!statuses.has(row?.report_status)||typeof row?.classification_basis!=='string'||!row.classification_basis.trim()||!Number.isSafeInteger(row?.member_count)||row.member_count<1||!Number.isSafeInteger(row?.evidence_member_count)||row.evidence_member_count<0||row.evidence_member_count>row.member_count||!UUID.test(row?.consolidation_snapshot_id||'')||!/^[1-9][0-9]*$/.test(String(row?.consolidation_version??''))||!/^sha256:[0-9a-f]{64}$/.test(row?.consolidation_snapshot_hash||'')||!/^sha256:[0-9a-f]{64}$/.test(row?.consolidation_receipt_hash||'')||typeof row?.consolidation_source_ref!=='string'||!row.consolidation_source_ref.trim()||typeof row?.consolidation_source_version!=='string'||!row.consolidation_source_version.trim()||ids.some(field=>!Array.isArray(row?.[field])||row[field].some(id=>!UUID.test(id||'')))||!Array.isArray(row?.elimination_refs)||row.elimination_refs.some(ref=>typeof ref!=='string'||!ref.trim())||(approved?amounts.some(field=>!REPORT_MONEY4.test(String(row?.[field]??''))):amounts.some(field=>row?.[field]!==null));
    };
    if(body.data.some(invalid)||new Set(body.data.map(row=>`${row.presentation_account_code}:${row.presentation_side}`)).size!==body.data.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate consolidation row.'};
    return {ok:true,rows:body.data.map(row=>({...row,...Object.fromEntries(['member_actual_amount','elimination_amount','consolidated_amount'].map(field=>[field,row[field]===null?null:String(row[field])]))})),scope:{entityId:config.entityId,periodId:config.periodId,groupRef:group},complete:body.data.length>0&&body.data.every(row=>row.report_status==='APPROVED_CONSOLIDATION_SNAPSHOT_AND_POSTED_LEDGER_EXACT')};
  }catch{return unreachable('The browser could not complete the authoritative consolidation read; no HTTP response was produced.');}
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

const accountCode=value=>ACCOUNT_CODE.test(String(value||''))?String(value):null;
const decimalText=value=>MONEY4.test(String(value??''))?String(value):null;
const registerTimestampDate=value=>validDate(value)?value:null;
const exactMonthlyPeriod=({period_code:code,period_start:start,period_end:end}={})=>PERIOD_CODE.test(code||'')&&validDate(start)&&validDate(end)&&start<=end&&start.slice(0,7)===code&&end.slice(0,7)===code;
const readAuthoritativeRows=async({config,path,operation,fetcher})=>{
  if(!config||typeof fetcher!=='function')return notConfigured();
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response,operation);
    const body=await response.json();
    const cacheControl=typeof response.headers?.get==='function'?String(response.headers.get('cache-control')||''):'';
    return body?.ok===true&&Array.isArray(body.data)?{ok:true,rows:body.data,cacheControl}:{ok:false,code:'ACCOUNTING_API_PROTOCOL',message:`Accounting API returned an invalid ${operation} envelope.`};
  }catch{return unreachable('The browser could not complete the authoritative accounting read; no HTTP response was produced.');}
};

export async function refreshAuthoritativeChartOfAccounts({config,fetcher=globalThis.fetch}={}){
  if(!config)return notConfigured();
  const result=await readAuthoritativeRows({config,path:`/general-ledger/chart-of-accounts?${new URLSearchParams({periodId:config.periodId})}`,operation:'CHART_OF_ACCOUNTS',fetcher});
  if(!result.ok)return result;
  const rows=[];const keys=new Set();
  for(const row of result.rows){
    const code=accountCode(row?.account_code),currency=row?.currency===null?null:(/^[A-Z]{3}$/.test(row?.currency||'')?row.currency:null);
    const periodId=UUID.test(row?.period_id||'')?row.period_id:null;
    const allBalances=['opening_balance','period_debit','period_credit','ending_balance'].map(field=>row?.[field]===null?null:decimalText(row?.[field]));
    const postedLedgerLineCount=UNSIGNED_INTEGER.test(String(row?.posted_ledger_line_count??''))&&Number.isSafeInteger(Number(row.posted_ledger_line_count))?Number(row.posted_ledger_line_count):null;
    if(!code||typeof row?.account_name!=='string'||!row.account_name||typeof row.requires_member!=='boolean'||typeof row.active!=='boolean'||periodId!==config.periodId||!exactMonthlyPeriod(row)||postedLedgerLineCount===null||currency!==null&&allBalances.some(value=>value===null)||currency===null&&!(allBalances.every(value=>value===null)&&postedLedgerLineCount===0))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid Chart of Accounts row.'};
    const key=`${code}\u001f${currency||'NO_POSTED_CURRENCY'}`;if(keys.has(key))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned duplicate Chart of Accounts evidence.'};keys.add(key);
    rows.push({...row,account_code:code,currency,opening_balance:allBalances[0],period_debit:allBalances[1],period_credit:allBalances[2],ending_balance:allBalances[3],posted_ledger_line_count:postedLedgerLineCount});
  }
  return {ok:true,rows,scope:{entityId:config.entityId,periodId:config.periodId}};
}

export async function refreshAuthoritativeScope({config,fetcher=globalThis.fetch}={}){
  if(!config||!UUID.test(config.entityId||'')||!UUID.test(config.periodId||''))return notConfigured();
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/scope?${new URLSearchParams({periodId:config.periodId})}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response,'AUTHORITATIVE_SCOPE');
    const body=await response.json(),row=body?.data;
    if(body?.ok!==true||!row||row.entity_id!==config.entityId||row.period_id!==config.periodId||typeof row.entity_name!=='string'||!row.entity_name.trim()||typeof row.entity_code!=='string'||!row.entity_code.trim()||!/^[A-Z]{3}$/.test(row.base_currency||'')||!exactMonthlyPeriod(row)||!['OPEN','SOFT_CLOSED','CLOSED'].includes(row.period_status))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid authoritative scope.'};
    return {ok:true,row:{...row,entity_name:row.entity_name.trim(),entity_code:row.entity_code.trim()}};
  }catch{return unreachable('The browser could not complete the authoritative scope read; no HTTP response was produced.');}
}

const CURRENT_ACCESS_KEYS=['actor_id','configured_permissions','entity_id','grant_set_version','permissions','session_refresh_required','tenant_id'];
const PERMISSION_CODE=/^(?:\*|[A-Z][A-Z0-9_.]+)$/;
const CONFIGURED_PERMISSION_CODE=/^[A-Z][A-Z0-9_.]+$/;
const exactPermissionList=(value,pattern)=>Array.isArray(value)&&value.every(item=>typeof item==='string'&&pattern.test(item))&&new Set(value).size===value.length;

export async function refreshCurrentActorAccess({config,fetcher=globalThis.fetch}={}){
  if(!config||!UUID.test(config.entityId||''))return notConfigured();
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/access/self`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return await failure(response,'CURRENT_ACTOR_ACCESS');
    const body=await response.json(),row=body?.data;
    const keys=row&&typeof row==='object'&&!Array.isArray(row)?Object.keys(row).sort():[];
    if(body?.ok!==true||!row||keys.length!==CURRENT_ACCESS_KEYS.length||keys.some((key,index)=>key!==CURRENT_ACCESS_KEYS[index])||!UUID.test(row.tenant_id||'')||row.entity_id!==config.entityId||typeof row.actor_id!=='string'||row.actor_id.length<1||row.actor_id.length>200||row.actor_id!==row.actor_id.trim()||/[\u0000-\u001f\u007f]/.test(row.actor_id)||!Number.isSafeInteger(row.grant_set_version)||row.grant_set_version<0||!exactPermissionList(row.permissions,PERMISSION_CODE)||!exactPermissionList(row.configured_permissions,CONFIGURED_PERMISSION_CODE)||typeof row.session_refresh_required!=='boolean')return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid current-user access diagnostic.'};
    return {ok:true,row:{...row,permissions:[...row.permissions],configured_permissions:[...row.configured_permissions]}};
  }catch{return unreachable('The browser could not read the current authenticated access state; no HTTP response was produced.');}
}

export async function refreshAuthoritativeAccountRegister({config,accountCode:requestedAccountCode,fetcher=globalThis.fetch}={}){
  const code=accountCode(requestedAccountCode);if(!config||!code)return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Account register requires one authoritative entity, period, and account code.'};
  const result=await readAuthoritativeRows({config,path:`/general-ledger/account-register?${new URLSearchParams({periodId:config.periodId,accountCode:code})}`,operation:'ACCOUNT_REGISTER',fetcher});
  if(!result.ok)return result;
  const rows=[];const ids=new Set();
  for(const row of result.rows){
    const amounts=['debit_amount','credit_amount','opening_balance','running_balance'].map(field=>decimalText(row?.[field]));
    if(!row||row.account_code!==code||!UUID.test(row.period_id||'')||row.period_id!==config.periodId||!exactMonthlyPeriod(row)||typeof row.account_name!=='string'||!row.account_name||!/^[A-Z]{3}$/.test(row.currency||'')||!registerTimestampDate(row.journal_date)||row.journal_date<row.period_start||row.journal_date>row.period_end||!UUID.test(row.journal_entry_id||'')||typeof row.journal_number!=='string'||!row.journal_number||!UUID.test(row.journal_line_id||'')||!UUID.test(row.ledger_line_id||'')||row.member_ref!==null&&row.member_ref!==undefined&&typeof row.member_ref!=='string'||row.description!==null&&row.description!==undefined&&typeof row.description!=='string'||amounts.some(value=>value===null)||!Array.isArray(row.source_document_ids)||row.source_document_ids.some(id=>!UUID.test(id||''))||ids.has(row.ledger_line_id))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid Account Register row.'};
    ids.add(row.ledger_line_id);rows.push({...row,debit_amount:amounts[0],credit_amount:amounts[1],opening_balance:amounts[2],running_balance:amounts[3],source_document_ids:[...row.source_document_ids]});
  }
  return {ok:true,rows,scope:{entityId:config.entityId,periodId:config.periodId,accountCode:code}};
}

export async function refreshAuthoritativeGeneralLedger({config,accountCode:requestedAccountCode=null,query=null,limit=50,offset=0,fetcher=globalThis.fetch}={}){
  const code=requestedAccountCode===null?null:accountCode(requestedAccountCode);
  if(!config||requestedAccountCode!==null&&!code||typeof query!=='string'&&query!==null||query!==null&&(query!==query.trim()||query.length>160)||!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(offset)||offset<0)return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'General Ledger requires one authoritative entity, period, optional account, bounded query, and page.'};
  const params=new URLSearchParams({periodId:config.periodId,limit:String(limit),offset:String(offset)});if(code)params.set('accountCode',code);if(query)params.set('query',query);
  const result=await readAuthoritativeRows({config,path:`/general-ledger/entries?${params}`,operation:'GENERAL_LEDGER',fetcher});
  if(!result.ok)return result;
  const rows=[];const ids=new Set();let total=null;
  for(const row of result.rows){
    const amounts=['debit_amount','credit_amount'].map(field=>decimalText(row?.[field]));const count=Number(row?.total_count);
    if(!row||!UUID.test(row.period_id||'')||row.period_id!==config.periodId||!PERIOD_CODE.test(row.period_code||'')||!validDate(row.period_start)||!validDate(row.period_end)||!accountCode(row.account_code)||typeof row.account_name!=='string'||!row.account_name||!/^[A-Z]{3}$/.test(row.currency||'')||!validDate(row.journal_date)||!UUID.test(row.journal_entry_id||'')||typeof row.journal_number!=='string'||!row.journal_number||!UUID.test(row.journal_line_id||'')||!UUID.test(row.ledger_line_id||'')||row.member_ref!==null&&row.member_ref!==undefined&&typeof row.member_ref!=='string'||row.description!==null&&row.description!==undefined&&typeof row.description!=='string'||amounts.some(value=>value===null)||!Array.isArray(row.source_document_ids)||row.source_document_ids.some(id=>!UUID.test(id||''))||!Number.isSafeInteger(count)||count<1||ids.has(row.ledger_line_id))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid General Ledger evidence row.'};
    if(total===null)total=count;else if(total!==count)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned inconsistent General Ledger pagination evidence.'};
    ids.add(row.ledger_line_id);rows.push({...row,debit_amount:amounts[0],credit_amount:amounts[1],source_document_ids:[...row.source_document_ids],total_count:count});
  }
  return {ok:true,rows,total:total??0,scope:{entityId:config.entityId,periodId:config.periodId,accountCode:code,query,limit,offset}};
}

const sourceDocumentRow=row=>{
  if(!row||!UUID.test(row.source_document_id||'')||!UNSIGNED_INTEGER.test(String(row.source_document_revision??''))||!UUID.test(row.raw_event_id||'')||!TEXT_TOKEN.test(row.source_system||'')||!TEXT_TOKEN.test(row.source_module||'')||!TEXT_TOKEN.test(row.source_record_id||'')||!TEXT_TOKEN.test(row.source_version||'')||!TEXT_TOKEN.test(row.document_type||'')||row.document_no!==null&&row.document_no!==undefined&&!TEXT_TOKEN.test(row.document_no)||!validDate(row.business_date)||!validDate(row.accounting_date)||!/^[A-Z]{3}$/.test(row.currency||'')||!REPORT_MONEY4.test(String(row.gross_amount??''))||!STATUS_TOKEN.test(row.status||'')||!/^sha256:[0-9a-f]{64}$/.test(row.payload_hash||'')||!Number.isSafeInteger(row.source_line_count)||row.source_line_count<0||!Array.isArray(row.posted_journal_entry_ids)||row.posted_journal_entry_ids.some(id=>!UUID.test(id||''))||!validTimestamp(row.created_at)||!validTimestamp(row.updated_at))return null;
  const revision=Number(row.source_document_revision);if(!Number.isSafeInteger(revision)||revision<0||new Set(row.posted_journal_entry_ids).size!==row.posted_journal_entry_ids.length)return null;
  return {...row,source_document_revision:revision,gross_amount:String(row.gross_amount),posted_journal_entry_ids:[...row.posted_journal_entry_ids]};
};
const PROVIDER_SECRET_SHAPE=/(?:bearer\s+|(?:access[_ -]?token|api[_ -]?key|authorization|secret|password)\s*[:=]|-----BEGIN(?: [A-Z]+)?(?: PRIVATE)? KEY-----|eyJ[A-Za-z0-9_-]{12,}|(?:^|[^A-Za-z0-9_-])(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{16,}(?:$|[^A-Za-z0-9_-]))/i;
const providerTraceText=(value,maxLength=160)=>value===null||value===undefined||(typeof value==='string'&&value.length<=maxLength&&TEXT_TOKEN.test(value)&&!/[<>&]/.test(value)&&!PROVIDER_SECRET_SHAPE.test(value));
const providerTraceIdentifier=(value,maxLength=128)=>value===null||value===undefined||(typeof value==='string'&&value.length<=maxLength&&/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)&&!PROVIDER_SECRET_SHAPE.test(value));
const providerTraceCompany=value=>value===null||value===undefined||(typeof value==='string'&&/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(value));
const providerTraceDate=value=>value===null||value===undefined||validDate(value);
const providerTraceActions=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')==='can_approve|can_create_draft|can_post|can_propose_amortization|can_review'&&['can_propose_amortization','can_review','can_create_draft','can_approve','can_post'].every(field=>value[field]===false));
const providerEvidenceTrace=value=>{
  if(value===undefined||value===null)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const unsupported=()=>Object.freeze({supported:false,reason:'UNSUPPORTED_PROVIDER_TRACE'});
  if(value.trace_version!=='WBS_PROVIDER_SOURCE_TRACE_V1'||!['PAYABLES','INSURANCE'].includes(value.domain))return unsupported();
  if(value.domain==='PAYABLES'){
    const fields=['invoice_no','business_id','service_period_start','service_period_end','recurring_obligation_id','contract_id','charge_code','service_frequency','obligation_status'];
    if(Object.keys(value).sort().join('|')!==['trace_version','domain','source_payload_hash','disposition','action_flags','invoice_no','invoice_date','business_id','accrual'].sort().join('|')||!SHA256.test(value.source_payload_hash||'')||value.disposition!=='RETAINED'||!providerTraceActions(value.action_flags)||!providerTraceIdentifier(value.invoice_no)||!providerTraceIdentifier(value.business_id)||!providerTraceDate(value.invoice_date)||!value.accrual||typeof value.accrual!=='object'||Array.isArray(value.accrual)||Object.keys(value.accrual).sort().join('|')!==fields.slice(2).sort().join('|')||!providerTraceDate(value.accrual.service_period_start)||!providerTraceDate(value.accrual.service_period_end)||!fields.slice(4).every(field=>providerTraceText(value.accrual[field])))return null;
    return Object.freeze({...value,accrual:Object.freeze({...value.accrual})});
  }
  if(value.domain==='INSURANCE'){
    const fields=['policy_id','source_id','pc_code','final_premium','mapping_decision_id','mapping_decision_hash','company_mapping_hash','resolved_company_code','match_count','disposition','coverage_start','coverage_end','coverage_disposition'];
    if(!['RESOLVED','MAPPING_REVIEW_REQUIRED','QUARANTINED','REJECTED'].includes(value.disposition))return unsupported();
    const mappingHashesDistinct=new Set([value.source_payload_hash,value.mapping_decision_hash,value.company_mapping_hash]).size===3;
    const approved=UUID.test(value.mapping_decision_id||'')&&SHA256.test(value.mapping_decision_hash||'')&&SHA256.test(value.company_mapping_hash||'')&&mappingHashesDistinct&&providerTraceCompany(value.resolved_company_code);
    const noResolution=value.mapping_decision_id===null&&value.mapping_decision_hash===null&&value.company_mapping_hash===null&&value.resolved_company_code===null;
    const review=['MAPPING_REVIEW_REQUIRED','QUARANTINED','REJECTED'].includes(value.disposition)&&value.match_count!==1&&noResolution;
    const positiveCoverage=value.coverage_disposition==='POSITIVE_COVERAGE';
    if(Object.keys(value).sort().join('|')!==['trace_version','domain','source_payload_hash','action_flags',...fields].sort().join('|')||!SHA256.test(value.source_payload_hash||'')||!providerTraceActions(value.action_flags)||!['policy_id','source_id','pc_code'].every(field=>providerTraceIdentifier(value[field]))||!['POSITIVE_COVERAGE','EXCEPTION_REVIEW_REQUIRED'].includes(value.coverage_disposition)||!(value.final_premium===null||value.final_premium===undefined||REPORT_MONEY4.test(String(value.final_premium)))||!(value.mapping_decision_id===null||value.mapping_decision_id===undefined||UUID.test(value.mapping_decision_id))||!(value.mapping_decision_hash===null||value.mapping_decision_hash===undefined||SHA256.test(value.mapping_decision_hash))||!(value.company_mapping_hash===null||value.company_mapping_hash===undefined||SHA256.test(value.company_mapping_hash))||!Number.isSafeInteger(value.match_count)||value.match_count<0||!providerTraceDate(value.coverage_start)||!providerTraceDate(value.coverage_end)||(value.disposition==='RESOLVED'&&!(value.match_count===1&&approved&&positiveCoverage))||!((value.disposition==='RESOLVED'&&approved&&positiveCoverage)||(review&&!positiveCoverage)))return null;
    return Object.freeze({...value,final_premium:value.final_premium===null||value.final_premium===undefined?null:String(value.final_premium)});
  }
  return null;
};
const sourceDocumentLine=row=>{
  const nullableText=value=>value===null||value===undefined||TEXT_TOKEN.test(value);
  const trace=providerEvidenceTrace(row?.provider_trace);
  if(!row||!UUID.test(row.source_document_line_id||'')||!TEXT_TOKEN.test(row.source_line_id||'')||!Number.isSafeInteger(row.line_no)||row.line_no<1||!REPORT_MONEY4.test(String(row.amount??''))||!['DEBIT','CREDIT','INFLOW','OUTFLOW','NONE'].includes(row.direction)||!['party_ref','bank_account_ref','project_ref','property_ref','phase_ref','unit_ref','loan_ref','cost_code_ref'].every(field=>nullableText(row[field]))||trace===null)return null;
  const {provider_trace:_providerTrace,...line}=row;
  return {...line,amount:String(row.amount),...(trace===undefined?{}:{provider_trace:trace})};
};

export async function refreshAuthoritativeSourceDocuments({config,fetcher=globalThis.fetch}={}){
  const result=await readAuthoritativeRows({config,path:'/source-documents',operation:'SOURCE_DOCUMENTS',fetcher});
  if(!result.ok)return result;
  const rows=result.rows.map(sourceDocumentRow),ids=rows.map(row=>row?.source_document_id);
  if(rows.some(row=>row===null)||new Set(ids).size!==ids.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid or duplicate Source Document evidence row.'};
  return {ok:true,rows,scope:{entityId:config.entityId}};
}

export async function refreshControlledTestAiSources({config,limit=100,fetcher=globalThis.fetch}={}){
  if(!config||!UUID.test(config.periodId||'')||!Number.isSafeInteger(limit)||limit<1||limit>100)return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Controlled TEST_ONLY AI sources require one configured period and a limit from 1 to 100.'};
  const query=new URLSearchParams({periodId:config.periodId,limit:String(limit)});
  const result=await readAuthoritativeRows({config,path:`/source-documents/controlled-test-ai-eligible?${query}`,operation:'CONTROLLED_TEST_AI_SOURCES',fetcher});
  if(!result.ok)return result;
  if(!/\bno-store\b/i.test(result.cacheControl||''))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Controlled TEST_ONLY AI source evidence must be returned with no-store.'};
  const rows=result.rows.map(sourceDocumentRow),ids=rows.map(row=>row?.source_document_id);
  if(rows.some(row=>row===null)||rows.length>limit||new Set(ids).size!==ids.length||rows.some(row=>!['WBS','REFS_STAGE1'].includes(row.source_system)||row.source_module!=='payable'||row.document_type!=='WBS_TEST_PAYABLE'||row.status!=='POSTED'||row.posted_journal_entry_ids.length<1))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned invalid controlled TEST_ONLY AI source evidence.'};
  return {ok:true,rows,scope:{entityId:config.entityId,periodId:config.periodId}};
}

export async function readAuthoritativeSourceDocumentDetail({config,sourceDocumentId,fetcher=globalThis.fetch}={}){
  if(!config||!UUID.test(sourceDocumentId||''))return {ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'Source Document detail requires one authoritative entity and immutable source-document ID.'};
  const result=await readAuthoritativeRows({config,path:`/source-documents/${sourceDocumentId}`,operation:'SOURCE_DOCUMENT_DETAIL',fetcher});
  if(!result.ok)return result;
  if(result.rows.length!==1)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned an invalid Source Document detail cardinality.'};
  const detail=sourceDocumentRow(result.rows[0]),lines=Array.isArray(result.rows[0]?.lines)?result.rows[0].lines.map(sourceDocumentLine):null;
  if(!detail||detail.source_document_id!==sourceDocumentId||!lines||lines.some(line=>line===null)||lines.length!==detail.source_line_count||new Set(lines.map(line=>line?.source_document_line_id)).size!==lines.length)return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned invalid Source Document detail evidence.'};
  const providerLines=lines.filter(line=>line?.provider_trace);
  if(providerLines.length&& !/\bno-store\b/i.test(result.cacheControl||''))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned provider trace without a no-store response.'};
  if(lines.some(line=>line.provider_trace&&line.provider_trace.supported!==false&&line.provider_trace.source_payload_hash!==detail.payload_hash))return {ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Accounting API returned provider trace detached from its source payload hash.'};
  return {ok:true,detail:{...detail,lines},scope:{entityId:config.entityId,sourceDocumentId}};
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

// This endpoint is intentionally a POST because the provider-signed contract
// is supplied for verification.  It is still evidence-only: it sends no
// command headers, requires all action flags to be false, and the server
// rejects any response that would grant REFS transition or posting authority.
const wbsTransitionEvidence=value=>{
  const text=item=>typeof item==='string'&&item.length>0&&item.length<=255;
  const transition=row=>row&&typeof row==='object'&&text(row.transition_id)&&text(row.operation)&&text(row.from_state)&&text(row.to_state)&&row.from_state!==row.to_state&&row.requires_reason===true&&Array.isArray(row.required_actor_roles)&&row.required_actor_roles.length>0&&row.required_actor_roles.every(text)&&row.segregation_of_duties&&typeof row.segregation_of_duties.review_required==='boolean'&&typeof row.segregation_of_duties.requester_reviewer_must_differ==='boolean'&&row.accounting_guard&&['blocks_when_accounting_reviewed','blocks_when_accounting_approved','blocks_when_accounting_posted'].every(key=>typeof row.accounting_guard[key]==='boolean');
  return value&&typeof value==='object'&&!Array.isArray(value)&&value.schema_version==='WBS_AUTOREC_TRANSITION_CONTRACT_V1'&&value.source_system==='WBS'&&value.environment==='PRODUCTION'&&UUID.test(value.contract_id||'')&&SHA256.test(value.contract_hash||'')&&validTimestamp(value.issued_at)&&validTimestamp(value.valid_from)&&validTimestamp(value.valid_until)&&Date.parse(value.valid_from)<=Date.parse(value.valid_until)&&value.scope&&Array.isArray(value.scope.company_keys)&&value.scope.company_keys.length>0&&value.scope.company_keys.every(text)&&text(value.scope.dictionary_version)&&Array.isArray(value.transitions)&&value.transitions.length>0&&value.transitions.every(transition)&&value.signature&&text(value.signature.key_id)&&value.signature.algorithm==='Ed25519'&&value.signature_verified===true&&value.transition_authority==='WBS_SIGNED_EXTERNAL_EVIDENCE_ONLY'&&value.can_transition_refs===false&&value.can_release===false&&value.can_incur===false&&value.can_reverse===false&&value.can_create_draft===false&&value.can_post===false;
};

const WBS_SCOPE_TEXT=/^[^\u0000-\u001f\u007f]{1,512}$/;
const wbsScopeText=(value,max=512)=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=max&&WBS_SCOPE_TEXT.test(value);
const BARE_SHA256=/^[0-9a-f]{64}$/;
const exactObjectKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('\u0000')===[...keys].sort().join('\u0000');
const wbsEvidenceIsReadOnly=value=>{
  if(value===null||value===undefined)return true;
  if(Array.isArray(value))return value.every(wbsEvidenceIsReadOnly);
  if(typeof value!=='object')return true;
  return Object.entries(value).every(([key,item])=>(!/^can_[a-z0-9_]+$/.test(key)||item===false)&&wbsEvidenceIsReadOnly(item));
};

export const WBS_LIVE_PILOT_VIEWS=Object.freeze({
  list_payables:Object.freeze({label:'Payables',fields:Object.freeze(['source_record_hash','accounting_date','currency','amount','status'])}),
  list_bank_transactions:Object.freeze({label:'Bank transactions',fields:Object.freeze(['source_record_hash','accounting_date','currency','amount','direction','status'])}),
  list_autorec_details:Object.freeze({label:'AutoRec details',fields:Object.freeze(['source_record_hash','accounting_date','currency','payment_amount','deposit_amount','status','match_status'])}),
  list_autorec_banks:Object.freeze({label:'AutoRec banks',fields:Object.freeze(['source_record_hash','currency','pay_amount','debit_amount','quantity','released_amount','released_quantity','incurred_amount','status'])}),
  list_journal_entries:Object.freeze({label:'Journal entries',fields:Object.freeze(['source_record_hash','accounting_date','currency','debit_amount','credit_amount','review_status'])})
});
const WBS_LIVE_PILOT_ENVELOPE_FIELDS=Object.freeze(['schema_version','status','observation_mode','source_system','tool','environment','entity_id','captured_at','provider_content_sha256','observation_hash','record_count','signature_verified','scope','rows','can_import','can_create_transaction','can_match','can_allocate','can_create_draft','can_approve','can_post','can_reverse']);
const WBS_LIVE_PILOT_ACTION_FIELDS=Object.freeze(['can_import','can_create_transaction','can_match','can_allocate','can_create_draft','can_approve','can_post','can_reverse']);
const wbsLivePilotMoneyFields=new Set(['amount','payment_amount','deposit_amount','pay_amount','debit_amount','quantity','released_amount','released_quantity','incurred_amount','credit_amount']);
const wbsLivePilotDateFields=new Set(['accounting_date']);
const wbsLivePilotStatusFields=new Set(['status','match_status','review_status']);
const wbsLivePilotRow=(tool,row)=>{
  const contract=WBS_LIVE_PILOT_VIEWS[tool];
  if(!contract||!exactObjectKeys(row,contract.fields)||!SHA256.test(row.source_record_hash||''))return false;
  for(const field of contract.fields){
    if(field==='source_record_hash')continue;
    if(field==='currency'){if(row[field]!=='USD')return false;continue;}
    if(wbsLivePilotMoneyFields.has(field)){if(tool==='list_autorec_banks'&&row[field]===null)continue;if(!MONEY4.test(row[field]||''))return false;continue;}
    if(wbsLivePilotDateFields.has(field)){if(!validDate(row[field]))return false;continue;}
    if(field==='direction'){if(!['DEBIT','CREDIT','UNKNOWN'].includes(row[field]))return false;continue;}
    if(wbsLivePilotStatusFields.has(field)){if(!STATUS_TOKEN.test(row[field]||''))return false;continue;}
    return false;
  }
  return true;
};
const wbsLivePilotObservation=(value,{entityId,tool,limit})=>{
  if(!exactObjectKeys(value,WBS_LIVE_PILOT_ENVELOPE_FIELDS)||value.schema_version!=='WBS_LIVE_PILOT_OBSERVATION_V1'||value.status!=='NOT_ADMITTED'||value.observation_mode!=='UNSIGNED_PILOT'||value.source_system!=='WBS'||value.tool!==tool||value.environment!=='PRODUCTION'||value.entity_id!==entityId||!validTimestamp(value.captured_at)||!BARE_SHA256.test(value.provider_content_sha256||'')||!SHA256.test(value.observation_hash||'')||value.signature_verified!==false||!Number.isSafeInteger(value.record_count)||value.record_count<0||value.record_count>limit||!Array.isArray(value.rows)||value.rows.length!==value.record_count||WBS_LIVE_PILOT_ACTION_FIELDS.some(field=>value[field]!==false)||!wbsEvidenceIsReadOnly(value))return false;
  if(!exactObjectKeys(value.scope,['company_codes','date_range'])||!Array.isArray(value.scope.company_codes)||value.scope.company_codes.length>50||value.scope.company_codes.some(code=>!wbsScopeText(code,128))||new Set(value.scope.company_codes).size!==value.scope.company_codes.length||!Array.isArray(value.scope.date_range)||value.scope.date_range.length!==2||value.scope.date_range.some(date=>date!==null&&!validDate(date))||value.scope.date_range[0]&&value.scope.date_range[1]&&value.scope.date_range[0]>value.scope.date_range[1])return false;
  return value.rows.every(row=>wbsLivePilotRow(tool,row))&&new Set(value.rows.map(row=>row.source_record_hash)).size===value.rows.length;
};

export async function refreshAuthoritativeWbsLivePilot({config,tool,limit=10,companyCode=null,dateFrom=null,dateTo=null,fetcher=globalThis.fetch}={}){
  const company=companyCode===null||companyCode===undefined||companyCode===''?null:String(companyCode);
  const hasDates=dateFrom!==null||dateTo!==null;
  if(!config||typeof fetcher!=='function'||!Object.hasOwn(WBS_LIVE_PILOT_VIEWS,tool)||!Number.isSafeInteger(limit)||limit<1||limit>10||(company!==null&&!wbsScopeText(company,128))||(hasDates&&(!validDate(dateFrom)||!validDate(dateTo)||dateFrom>dateTo)))return {ok:false,code:'WBS_LIVE_PILOT_SCOPE_INVALID',message:'Production WBS observation requires one approved read-only view, a limit from one to ten, an optional exact company code, and either no dates or one complete valid date range.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const params=new URLSearchParams({tool,limit:String(limit)});
  if(company!==null)params.set('company_code',company);
  if(hasDates){params.set('date_from',dateFrom);params.set('date_to',dateTo);}
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/live-pilot?${params}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'WBS_LIVE_PILOT_OBSERVATION');const contentType=typeof response.headers?.get==='function'?String(response.headers.get('content-type')||'').toLowerCase():'';if(contentType&&!contentType.includes('application/json'))return {ok:false,code:'WBS_LIVE_PILOT_PROTOCOL',message:'The production WBS endpoint returned a non-JSON response; no accounting observation was accepted. Verify the API route and retry.'};let body;try{body=await response.json();}catch{return {ok:false,code:'WBS_LIVE_PILOT_PROTOCOL',message:'The production WBS endpoint returned an unreadable response; no accounting observation was accepted. Verify the API route and retry.'};}if(body?.ok!==true||!wbsLivePilotObservation(body.data,{entityId:config.entityId,tool,limit})||(company!==null&&(body.data.scope.company_codes.length!==1||body.data.scope.company_codes[0]!==company))||(hasDates&&(body.data.scope.date_range[0]!==dateFrom||body.data.scope.date_range[1]!==dateTo)))return {ok:false,code:'WBS_LIVE_PILOT_PROTOCOL',message:'The accounting API returned invalid, identifying, admitted, signed, action-enabled, or scope-mismatched WBS pilot evidence.'};return {ok:true,data:body.data,scope:{entityId:config.entityId,tool,limit,companyCode:company,dateFrom:hasDates?dateFrom:null,dateTo:hasDates?dateTo:null}};}catch{return unreachable('The browser could not read the production WBS pilot observation; no HTTP response was produced.');}
}

const WBS_OPERATOR_ATTESTATION_READ_FIELDS=['wbs_operator_payable_attestation_id','captured_at','company_code','company_codes','company_scope_status','row_count','provenance_mode','signature_verified','evidence_status','can_create_draft','can_post','attested_at'];
const wbsOperatorAttestationReadRow=row=>exactObjectKeys(row,WBS_OPERATOR_ATTESTATION_READ_FIELDS)&&UUID.test(row.wbs_operator_payable_attestation_id||'')&&validTimestamp(row.captured_at)&&(row.company_code===null||wbsScopeText(row.company_code,64))&&Array.isArray(row.company_codes)&&row.company_codes.length<=10&&row.company_codes.every(code=>wbsScopeText(code,64))&&new Set(row.company_codes).size===row.company_codes.length&&['UNASSIGNED_COMPANY','MIXED_COMPANY','SINGLE_COMPANY_UNASSIGNED','ENTITY_SCOPE_MATCHED'].includes(row.company_scope_status)&&((row.company_codes.length===1&&row.company_code===row.company_codes[0])||(row.company_codes.length!==1&&row.company_code===null))&&Number.isSafeInteger(row.row_count)&&row.row_count>=1&&row.row_count<=10&&row.provenance_mode==='OPERATOR_ATTESTED'&&row.signature_verified===false&&row.evidence_status==='EXCEPTION_REVIEW_REQUIRED'&&row.can_create_draft===false&&row.can_post===false&&validTimestamp(row.attested_at)?Object.freeze({...row,company_codes:Object.freeze([...row.company_codes])}):null;

export async function refreshAuthoritativeWbsOperatorPayableAttestations({config,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>50)return {ok:false,code:'WBS_OPERATOR_ATTESTATION_SCOPE_INVALID',message:'Operator-attested evidence requires one authoritative entity and a limit from 1 to 50.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/operator-attested/payables?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'WBS_OPERATOR_ATTESTATION_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'WBS_OPERATOR_ATTESTATION_PROTOCOL',message:'The accounting API returned an invalid operator-attested evidence envelope.'};const rows=body.data.map(wbsOperatorAttestationReadRow);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.wbs_operator_payable_attestation_id)).size!==rows.length)return {ok:false,code:'WBS_OPERATOR_ATTESTATION_PROTOCOL',message:'The accounting API returned duplicate, signed, action-enabled, or invalid operator-attested evidence.'};return {ok:true,rows};}catch{return unreachable('The browser could not read retained operator-attested WBS Payable evidence; no HTTP response was produced.');}
}

const WBS_OPERATOR_EXCEPTION_ROW_FIELDS=['wbs_operator_payable_attestation_id','wbs_operator_payable_evidence_row_id','captured_at','provider_content_hash','observation_hash','company_code','company_scope_status','source_record_id','source_version','row_hash','document_number','accounting_date','currency','observed_amount','provider_status','signed_link_status','signed_wbs_inbound_row_id','next_owner','next_action','evidence_status','signature_verified','can_review','can_create_draft','can_post'];
const nullableBoundedText=(value,max=255)=>value===null||(typeof value==='string'&&value.length>=1&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value));
const wbsOperatorExceptionRow=row=>exactObjectKeys(row,WBS_OPERATOR_EXCEPTION_ROW_FIELDS)&&UUID.test(row.wbs_operator_payable_attestation_id||'')&&UUID.test(row.wbs_operator_payable_evidence_row_id||'')&&validTimestamp(row.captured_at)&&SHA256.test(row.provider_content_hash||'')&&SHA256.test(row.observation_hash||'')&&(row.company_code===null||wbsScopeText(row.company_code,64))&&['UNASSIGNED_COMPANY','MIXED_COMPANY','SINGLE_COMPANY_UNASSIGNED','ENTITY_SCOPE_MATCHED'].includes(row.company_scope_status)&&wbsScopeText(row.source_record_id,128)&&wbsScopeText(row.source_version,128)&&SHA256.test(row.row_hash||'')&&nullableBoundedText(row.document_number,128)&&(row.accounting_date===null||validDate(row.accounting_date))&&(row.currency===null||/^[A-Z]{3}$/.test(row.currency))&&(row.observed_amount===null||/^-?(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,5})?$/.test(row.observed_amount))&&nullableBoundedText(row.provider_status,64)&&['EXCEPTION_REVIEW_REQUIRED','ELIGIBLE_FOR_SIGNED_REVIEW'].includes(row.signed_link_status)&&(row.signed_wbs_inbound_row_id===null||UUID.test(row.signed_wbs_inbound_row_id||''))&&((row.signed_link_status==='ELIGIBLE_FOR_SIGNED_REVIEW')===(row.signed_wbs_inbound_row_id!==null))&&nullableBoundedText(row.next_owner,96)&&nullableBoundedText(row.next_action,512)&&row.evidence_status==='EXCEPTION_REVIEW_REQUIRED'&&row.signature_verified===false&&row.can_review===false&&row.can_create_draft===false&&row.can_post===false?Object.freeze({...row}):null;

export async function refreshAuthoritativeWbsOperatorPayableExceptionRows({config,attestationId,limit=10,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(attestationId||'')||!Number.isSafeInteger(limit)||limit<1||limit>10)return {ok:false,code:'WBS_OPERATOR_EXCEPTION_ROW_SCOPE_INVALID',message:'Retained exception rows require one authoritative evidence ID and a limit from 1 to 10.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/operator-attested/payables/${attestationId}/rows?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'WBS_OPERATOR_EXCEPTION_ROW_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'WBS_OPERATOR_EXCEPTION_ROW_PROTOCOL',message:'The accounting API returned an invalid retained exception-row envelope.'};const rows=body.data.map(wbsOperatorExceptionRow);if(rows.some(row=>row===null)||rows.some(row=>row.wbs_operator_payable_attestation_id!==attestationId)||new Set(rows.map(row=>row.wbs_operator_payable_evidence_row_id)).size!==rows.length)return {ok:false,code:'WBS_OPERATOR_EXCEPTION_ROW_PROTOCOL',message:'The accounting API returned duplicate, cross-evidence, signed, action-enabled, or invalid retained exception rows.'};return {ok:true,rows};}catch{return unreachable('The browser could not read retained WBS Payable exception rows; no HTTP response was produced.');}
}

const AI_WBS_EXCEPTION_FINDING_FIELDS=['ai_finding_id','finding_key','source_evidence_row_id','source_record_id','source_version','source_row_hash','provider_content_hash','observation_hash','rule_id','risk_level','confidence','status','reason','suggested_action','suggested_owner','due_date','due_date_status','created_at','can_create_draft','can_review','can_approve','can_post'];
const aiFindingConfidence=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^(?:0|1)(?:\.[0-9]{1,4})?$/.test(value)?Number(value):null;
const aiWbsExceptionFinding=row=>{const confidence=aiFindingConfidence(row?.confidence);return exactObjectKeys(row,AI_WBS_EXCEPTION_FINDING_FIELDS)&&UUID.test(row.ai_finding_id||'')&&wbsScopeText(row.finding_key,240)&&UUID.test(row.source_evidence_row_id||'')&&wbsScopeText(row.source_record_id,128)&&wbsScopeText(row.source_version,128)&&SHA256.test(row.source_row_hash||'')&&SHA256.test(row.provider_content_hash||'')&&SHA256.test(row.observation_hash||'')&&['WBS_UNSIGNED_SOURCE','WBS_ENTITY_SCOPE_EXCEPTION'].includes(row.rule_id)&&['HIGH','MEDIUM','LOW'].includes(row.risk_level)&&confidence!==null&&confidence>=0&&confidence<=1&&row.status==='OPEN'&&nullableBoundedText(row.reason,2000)&&nullableBoundedText(row.suggested_action,2000)&&nullableBoundedText(row.suggested_owner,128)&&(row.due_date===null||validDate(row.due_date))&&row.due_date_status==='HUMAN_ASSIGNMENT_REQUIRED'&&validTimestamp(row.created_at)&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false?Object.freeze({...row,confidence}):null;};

export async function refreshAuthoritativeAiWbsExceptionFindings({config,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>100)return {ok:false,code:'AI_WBS_EXCEPTION_FINDING_SCOPE_INVALID',message:'AI exception findings require one authoritative entity and a limit from 1 to 100.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/findings/wbs-exceptions?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_WBS_EXCEPTION_FINDING_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'AI_WBS_EXCEPTION_FINDING_PROTOCOL',message:'The accounting API returned an invalid AI exception finding envelope.'};const rows=body.data.map(aiWbsExceptionFinding);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.ai_finding_id)).size!==rows.length||new Set(rows.map(row=>row.finding_key)).size!==rows.length||new Set(rows.map(row=>row.source_evidence_row_id)).size!==rows.length)return {ok:false,code:'AI_WBS_EXCEPTION_FINDING_PROTOCOL',message:'The accounting API returned duplicate, action-enabled, or invalid AI exception findings.'};return {ok:true,rows};}catch{return unreachable('The browser could not read persisted AI WBS exception findings; no HTTP response was produced.');}
}

const AI_PREPAID_COVERAGE_FINDING_FIELDS=['ai_prepaid_coverage_finding_id','source_document_id','source_document_line_id','source_payload_hash','source_document_version','source_line_hash','rule_id','risk_level','confidence','status','reason','suggested_action','suggested_owner','due_date','due_date_status','created_at','can_create_draft','can_review','can_approve','can_post'];
const aiPrepaidCoverageFinding=row=>{const confidence=aiFindingConfidence(row?.confidence);return exactObjectKeys(row,AI_PREPAID_COVERAGE_FINDING_FIELDS)&&UUID.test(row.ai_prepaid_coverage_finding_id||'')&&UUID.test(row.source_document_id||'')&&UUID.test(row.source_document_line_id||'')&&SHA256.test(row.source_payload_hash||'')&&Number.isSafeInteger(Number(row.source_document_version))&&Number(row.source_document_version)>=0&&SHA256.test(row.source_line_hash||'')&&row.rule_id==='PREPAID_COVERAGE_REQUIRED'&&row.risk_level==='MEDIUM'&&confidence===0.95&&row.status==='OPEN'&&nullableBoundedText(row.reason,2000)&&nullableBoundedText(row.suggested_action,2000)&&row.suggested_owner==='CONTROLLER'&&(row.due_date===null||validDate(row.due_date))&&row.due_date_status==='HUMAN_ASSIGNMENT_REQUIRED'&&validTimestamp(row.created_at)&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false?Object.freeze({...row,confidence,source_document_version:Number(row.source_document_version)}):null;};

export async function refreshAuthoritativeAiPrepaidCoverageFindings({config,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>100)return {ok:false,code:'AI_PREPAID_COVERAGE_FINDING_SCOPE_INVALID',message:'AI prepaid coverage findings require one authoritative entity and a limit from 1 to 100.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/findings/prepaid-coverage?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_PREPAID_COVERAGE_FINDING_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'AI_PREPAID_COVERAGE_FINDING_PROTOCOL',message:'The accounting API returned an invalid AI prepaid coverage finding envelope.'};const rows=body.data.map(aiPrepaidCoverageFinding);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.ai_prepaid_coverage_finding_id)).size!==rows.length||new Set(rows.map(row=>row.source_document_line_id)).size!==rows.length)return {ok:false,code:'AI_PREPAID_COVERAGE_FINDING_PROTOCOL',message:'The accounting API returned duplicate, action-enabled, or invalid AI prepaid coverage findings.'};return {ok:true,rows};}catch{return unreachable('The browser could not read persisted AI prepaid coverage findings; no HTTP response was produced.');}
}

const AI_DUPLICATE_PAYABLE_FINDING_FIELDS=['ai_duplicate_payable_finding_id','source_document_id','candidate_source_document_id','source_payload_hash','source_document_version','candidate_payload_hash','candidate_document_version','match_key_hash','rule_id','risk_level','confidence','status','reason','suggested_action','suggested_owner','due_date','due_date_status','created_at','can_create_draft','can_review','can_approve','can_post'];
const aiDuplicatePayableFinding=row=>{const confidence=aiFindingConfidence(row?.confidence);return exactObjectKeys(row,AI_DUPLICATE_PAYABLE_FINDING_FIELDS)&&UUID.test(row.ai_duplicate_payable_finding_id||'')&&UUID.test(row.source_document_id||'')&&UUID.test(row.candidate_source_document_id||'')&&row.source_document_id!==row.candidate_source_document_id&&SHA256.test(row.source_payload_hash||'')&&Number.isSafeInteger(Number(row.source_document_version))&&Number(row.source_document_version)>=0&&SHA256.test(row.candidate_payload_hash||'')&&Number.isSafeInteger(Number(row.candidate_document_version))&&Number(row.candidate_document_version)>=0&&SHA256.test(row.match_key_hash||'')&&row.rule_id==='DUPLICATE_PAYABLE_EXACT'&&row.risk_level==='HIGH'&&confidence===1&&row.status==='OPEN'&&nullableBoundedText(row.reason,2000)&&nullableBoundedText(row.suggested_action,2000)&&row.suggested_owner==='CONTROLLER'&&(row.due_date===null||validDate(row.due_date))&&row.due_date_status==='HUMAN_ASSIGNMENT_REQUIRED'&&validTimestamp(row.created_at)&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false?Object.freeze({...row,confidence,source_document_version:Number(row.source_document_version),candidate_document_version:Number(row.candidate_document_version)}):null;};

export async function refreshAuthoritativeAiDuplicatePayableFindings({config,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>100)return {ok:false,code:'AI_DUPLICATE_PAYABLE_FINDING_SCOPE_INVALID',message:'AI duplicate payable findings require one authoritative entity and a limit from 1 to 100.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/findings/duplicate-payables?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_DUPLICATE_PAYABLE_FINDING_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'AI_DUPLICATE_PAYABLE_FINDING_PROTOCOL',message:'The accounting API returned an invalid AI duplicate payable finding envelope.'};const rows=body.data.map(aiDuplicatePayableFinding);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.ai_duplicate_payable_finding_id)).size!==rows.length||new Set(rows.map(row=>`${row.source_document_id}:${row.candidate_source_document_id}`)).size!==rows.length)return {ok:false,code:'AI_DUPLICATE_PAYABLE_FINDING_PROTOCOL',message:'The accounting API returned duplicate, action-enabled, or invalid AI duplicate payable findings.'};return {ok:true,rows};}catch{return unreachable('The browser could not read persisted AI duplicate payable findings; no HTTP response was produced.');}
}

const AI_UNMATCHED_BANK_PAYMENT_FINDING_FIELDS=['ai_unmatched_bank_payment_finding_id','bank_source_id','source_document_id','source_payload_hash','source_document_version','bank_account_ref','external_bank_line_id','transaction_date','currency','amount','bank_version','rule_id','risk_level','confidence','status','current_match_state','reason','suggested_action','suggested_owner','due_date','due_date_status','created_at','can_create_draft','can_review','can_approve','can_post'];
const aiUnmatchedBankPaymentFinding=row=>{const confidence=aiFindingConfidence(row?.confidence);return exactObjectKeys(row,AI_UNMATCHED_BANK_PAYMENT_FINDING_FIELDS)&&UUID.test(row.ai_unmatched_bank_payment_finding_id||'')&&UUID.test(row.bank_source_id||'')&&UUID.test(row.source_document_id||'')&&SHA256.test(row.source_payload_hash||'')&&Number.isSafeInteger(Number(row.source_document_version))&&Number(row.source_document_version)>=0&&nullableBoundedText(row.bank_account_ref,128)&&nullableBoundedText(row.external_bank_line_id,256)&&validDate(row.transaction_date)&&/^[A-Z]{3}$/.test(row.currency||'')&&MONEY4.test(String(row.amount??''))&&Number(row.amount)<0&&Number.isSafeInteger(Number(row.bank_version))&&Number(row.bank_version)>=0&&row.rule_id==='BANK_PAYMENT_UNMATCHED'&&row.risk_level==='MEDIUM'&&confidence===1&&row.status==='OPEN'&&['OPEN','MATCHED_AFTER_FINDING'].includes(row.current_match_state)&&nullableBoundedText(row.reason,2000)&&nullableBoundedText(row.suggested_action,2000)&&row.suggested_owner==='CONTROLLER'&&(row.due_date===null||validDate(row.due_date))&&row.due_date_status==='HUMAN_ASSIGNMENT_REQUIRED'&&validTimestamp(row.created_at)&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false?Object.freeze({...row,confidence,source_document_version:Number(row.source_document_version),bank_version:Number(row.bank_version),amount:String(row.amount)}):null;};

export async function refreshAuthoritativeAiUnmatchedBankPaymentFindings({config,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>100)return {ok:false,code:'AI_UNMATCHED_BANK_PAYMENT_FINDING_SCOPE_INVALID',message:'AI unmatched bank payment findings require one authoritative entity and a limit from 1 to 100.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/findings/unmatched-bank-payments?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_UNMATCHED_BANK_PAYMENT_FINDING_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'AI_UNMATCHED_BANK_PAYMENT_FINDING_PROTOCOL',message:'The accounting API returned an invalid AI unmatched bank payment finding envelope.'};const rows=body.data.map(aiUnmatchedBankPaymentFinding);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.ai_unmatched_bank_payment_finding_id)).size!==rows.length||new Set(rows.map(row=>row.bank_source_id)).size!==rows.length)return {ok:false,code:'AI_UNMATCHED_BANK_PAYMENT_FINDING_PROTOCOL',message:'The accounting API returned duplicate, action-enabled, or invalid AI unmatched bank payment findings.'};return {ok:true,rows};}catch{return unreachable('The browser could not read persisted AI unmatched bank payment findings; no HTTP response was produced.');}
}

const AI_COST_DIMENSION_FINDING_FIELDS=['ai_cost_dimension_finding_id','source_document_id','source_document_line_id','source_payload_hash','source_document_version','source_line_hash','missing_project','missing_property','rule_id','risk_level','confidence','status','reason','suggested_action','suggested_owner','due_date','due_date_status','created_at','can_create_draft','can_review','can_approve','can_post'];
const aiCostDimensionFinding=row=>{const confidence=aiFindingConfidence(row?.confidence);return exactObjectKeys(row,AI_COST_DIMENSION_FINDING_FIELDS)&&UUID.test(row.ai_cost_dimension_finding_id||'')&&UUID.test(row.source_document_id||'')&&UUID.test(row.source_document_line_id||'')&&SHA256.test(row.source_payload_hash||'')&&Number.isSafeInteger(Number(row.source_document_version))&&Number(row.source_document_version)>=0&&SHA256.test(row.source_line_hash||'')&&typeof row.missing_project==='boolean'&&typeof row.missing_property==='boolean'&&(row.missing_project||row.missing_property)&&row.rule_id==='COST_DIMENSION_REQUIRED'&&row.risk_level==='HIGH'&&confidence===1&&row.status==='OPEN'&&nullableBoundedText(row.reason,2000)&&nullableBoundedText(row.suggested_action,2000)&&row.suggested_owner==='CONTROLLER'&&(row.due_date===null||validDate(row.due_date))&&row.due_date_status==='HUMAN_ASSIGNMENT_REQUIRED'&&validTimestamp(row.created_at)&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false?Object.freeze({...row,confidence,source_document_version:Number(row.source_document_version)}):null;};

export async function refreshAuthoritativeAiCostDimensionFindings({config,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>100)return {ok:false,code:'AI_COST_DIMENSION_FINDING_SCOPE_INVALID',message:'AI cost-dimension findings require one authoritative entity and a limit from 1 to 100.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/findings/cost-dimensions?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_COST_DIMENSION_FINDING_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'AI_COST_DIMENSION_FINDING_PROTOCOL',message:'The accounting API returned an invalid AI cost-dimension finding envelope.'};const rows=body.data.map(aiCostDimensionFinding);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.ai_cost_dimension_finding_id)).size!==rows.length||new Set(rows.map(row=>row.source_document_line_id)).size!==rows.length)return {ok:false,code:'AI_COST_DIMENSION_FINDING_PROTOCOL',message:'The accounting API returned duplicate, action-enabled, inferred, or invalid AI cost-dimension findings.'};return {ok:true,rows};}catch{return unreachable('The browser could not read persisted AI cost-dimension findings; no HTTP response was produced.');}
}

const AI_LOAN_REFERENCE_FINDING_FIELDS=['ai_loan_reference_finding_id','source_document_id','source_document_line_id','source_payload_hash','source_document_version','source_line_hash','rule_id','risk_level','confidence','status','reason','suggested_action','suggested_owner','due_date','due_date_status','created_at','can_create_draft','can_review','can_approve','can_post'];
const aiLoanReferenceFinding=row=>{const confidence=aiFindingConfidence(row?.confidence);return exactObjectKeys(row,AI_LOAN_REFERENCE_FINDING_FIELDS)&&UUID.test(row.ai_loan_reference_finding_id||'')&&UUID.test(row.source_document_id||'')&&UUID.test(row.source_document_line_id||'')&&SHA256.test(row.source_payload_hash||'')&&Number.isSafeInteger(Number(row.source_document_version))&&Number(row.source_document_version)>=0&&SHA256.test(row.source_line_hash||'')&&row.rule_id==='LOAN_REFERENCE_REQUIRED'&&row.risk_level==='HIGH'&&confidence===1&&row.status==='OPEN'&&nullableBoundedText(row.reason,2000)&&nullableBoundedText(row.suggested_action,2000)&&row.suggested_owner==='CONTROLLER'&&(row.due_date===null||validDate(row.due_date))&&row.due_date_status==='HUMAN_ASSIGNMENT_REQUIRED'&&validTimestamp(row.created_at)&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false?Object.freeze({...row,confidence,source_document_version:Number(row.source_document_version)}):null;};

export async function refreshAuthoritativeAiLoanReferenceFindings({config,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>100)return {ok:false,code:'AI_LOAN_REFERENCE_FINDING_SCOPE_INVALID',message:'AI loan-reference findings require one authoritative entity and a limit from 1 to 100.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/findings/loan-references?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_LOAN_REFERENCE_FINDING_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'AI_LOAN_REFERENCE_FINDING_PROTOCOL',message:'The accounting API returned an invalid AI loan-reference finding envelope.'};const rows=body.data.map(aiLoanReferenceFinding);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.ai_loan_reference_finding_id)).size!==rows.length||new Set(rows.map(row=>row.source_document_line_id)).size!==rows.length)return {ok:false,code:'AI_LOAN_REFERENCE_FINDING_PROTOCOL',message:'The accounting API returned duplicate, action-enabled, inferred, or invalid AI loan-reference findings.'};return {ok:true,rows};}catch{return unreachable('The browser could not read persisted AI loan-reference findings; no HTTP response was produced.');}
}

const AI_FINDING_ASSIGNMENT_CANDIDATE_FIELDS=['finding_kind','finding_id','finding_hash','rule_id','risk_level','reason','suggested_action','suggested_owner','created_at','can_create_draft','can_review','can_approve','can_post'];
const aiFindingAssignmentCandidate=row=>exactObjectKeys(row,AI_FINDING_ASSIGNMENT_CANDIDATE_FIELDS)&&AI_ANALYSIS_CATEGORIES.has(row.finding_kind)&&UUID.test(row.finding_id||'')&&SHA256.test(row.finding_hash||'')&&nullableBoundedText(row.rule_id,128)&&['HIGH','MEDIUM','LOW'].includes(row.risk_level)&&nullableBoundedText(row.reason,2000)&&nullableBoundedText(row.suggested_action,2000)&&nullableBoundedText(row.suggested_owner,128)&&validTimestamp(row.created_at)&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false?Object.freeze({...row}):null;
const AI_FINDING_ACTION_FIELDS=['ai_finding_action_id','finding_kind','finding_id','finding_hash','owner','due_date','status','revision','assigned_by','assigned_at','resolution_reason','resolved_by','resolved_at','can_create_draft','can_review','can_approve','can_post'];
const aiFindingAction=row=>{const resolved=row?.status==='RESOLVED';return exactObjectKeys(row,AI_FINDING_ACTION_FIELDS)&&UUID.test(row.ai_finding_action_id||'')&&AI_ANALYSIS_CATEGORIES.has(row.finding_kind)&&UUID.test(row.finding_id||'')&&SHA256.test(row.finding_hash||'')&&nullableBoundedText(row.owner,128)&&validDate(row.due_date)&&['OPEN','RESOLVED'].includes(row.status)&&Number.isSafeInteger(Number(row.revision))&&Number(row.revision)>=0&&nullableBoundedText(row.assigned_by,128)&&validTimestamp(row.assigned_at)&&(!resolved?(row.resolution_reason===null&&row.resolved_by===null&&row.resolved_at===null):(typeof row.resolution_reason==='string'&&row.resolution_reason.length>=8&&row.resolution_reason.length<=2000&&nullableBoundedText(row.resolved_by,128)&&validTimestamp(row.resolved_at)))&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false?Object.freeze({...row,revision:Number(row.revision)}):null;};
const AI_FINDING_ACTION_RESULT_FIELDS=['schema_version','ai_finding_action_id','finding_kind','finding_id','finding_hash','owner','due_date','revision','can_create_draft','can_review','can_approve','can_post','idempotent'];
const aiFindingActionResult=row=>exactObjectKeys(row,AI_FINDING_ACTION_RESULT_FIELDS)&&row.schema_version==='AI_FINDING_ACTION_ASSIGN_V1'&&UUID.test(row.ai_finding_action_id||'')&&AI_ANALYSIS_CATEGORIES.has(row.finding_kind)&&UUID.test(row.finding_id||'')&&SHA256.test(row.finding_hash||'')&&nullableBoundedText(row.owner,128)&&validDate(row.due_date)&&Number.isSafeInteger(Number(row.revision))&&Number(row.revision)>=0&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false&&typeof row.idempotent==='boolean'?Object.freeze({...row,revision:Number(row.revision)}):null;

export async function refreshAuthoritativeAiFindingAssignmentCandidates({config,limit=100,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>100)return {ok:false,code:'AI_FINDING_ASSIGNMENT_CANDIDATE_SCOPE_INVALID',message:'AI finding assignment candidates require one authoritative entity and a limit from 1 to 100.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/findings/assignment-candidates?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_FINDING_ASSIGNMENT_CANDIDATE_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'AI_FINDING_ASSIGNMENT_CANDIDATE_PROTOCOL',message:'The accounting API returned an invalid AI finding assignment-candidate envelope.'};const rows=body.data.map(aiFindingAssignmentCandidate);if(rows.some(row=>row===null)||new Set(rows.map(row=>`${row.finding_kind}:${row.finding_id}`)).size!==rows.length)return {ok:false,code:'AI_FINDING_ASSIGNMENT_CANDIDATE_PROTOCOL',message:'The accounting API returned duplicate, action-enabled, or invalid AI finding assignment candidates.'};return {ok:true,rows};}catch{return unreachable('The browser could not read AI finding assignment candidates; no HTTP response was produced.');}
}

export async function refreshAuthoritativeAiFindingActions({config,limit=100,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>100)return {ok:false,code:'AI_FINDING_ACTION_SCOPE_INVALID',message:'AI finding actions require one authoritative entity and a limit from 1 to 100.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/findings/actions?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_FINDING_ACTION_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'AI_FINDING_ACTION_PROTOCOL',message:'The accounting API returned an invalid AI finding action envelope.'};const rows=body.data.map(aiFindingAction);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.ai_finding_action_id)).size!==rows.length||new Set(rows.map(row=>`${row.finding_kind}:${row.finding_id}`)).size!==rows.length)return {ok:false,code:'AI_FINDING_ACTION_PROTOCOL',message:'The accounting API returned duplicate, action-enabled, or invalid AI finding actions.'};return {ok:true,rows};}catch{return unreachable('The browser could not read persisted AI finding actions; no HTTP response was produced.');}
}

export async function assignAuthoritativeAiFindingAction({config,candidate,owner,dueDate,revision,idempotencyKey,fetcher=globalThis.fetch}={}){
  const canonicalOwner=typeof owner==='string'?owner.trim():'';
  if(!config||typeof fetcher!=='function'||!aiFindingAssignmentCandidate(candidate)||canonicalOwner.length<2||canonicalOwner.length>128||!validDate(dueDate)||!Number.isSafeInteger(revision)||revision<0||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'AI_FINDING_ACTION_COMMAND_INVALID',message:'AI finding assignment requires one retained candidate, bounded human owner, due date, current revision, and stable command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const body={findingKind:candidate.finding_kind,findingId:candidate.finding_id,findingHash:candidate.finding_hash,owner:canonicalOwner,dueDate};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/findings/assignments`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,'if-match':`"${revision}"`,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'AI_FINDING_ACTION_ASSIGN');const envelope=await response.json(),data=aiFindingActionResult(envelope?.data);if(envelope?.ok!==true||data===null||data.finding_kind!==candidate.finding_kind||data.finding_id!==candidate.finding_id||data.finding_hash!==candidate.finding_hash||data.owner!==canonicalOwner||data.due_date!==dueDate)return {ok:false,code:'AI_FINDING_ACTION_PROTOCOL',message:'The accounting API returned invalid, mismatched, or action-enabled AI finding accountability data.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not assign AI finding accountability; no HTTP response was produced.');}
}

const AI_FINDING_ACTION_RESOLUTION_RESULT_FIELDS=['schema_version','ai_finding_action_id','finding_kind','finding_id','finding_hash','status','resolution_reason','revision','can_create_draft','can_review','can_approve','can_post','idempotent'];
const aiFindingActionResolutionResult=row=>exactObjectKeys(row,AI_FINDING_ACTION_RESOLUTION_RESULT_FIELDS)&&row.schema_version==='AI_FINDING_ACTION_RESOLVE_V1'&&UUID.test(row.ai_finding_action_id||'')&&AI_ANALYSIS_CATEGORIES.has(row.finding_kind)&&UUID.test(row.finding_id||'')&&SHA256.test(row.finding_hash||'')&&row.status==='RESOLVED'&&typeof row.resolution_reason==='string'&&row.resolution_reason.length>=8&&row.resolution_reason.length<=2000&&Number.isSafeInteger(Number(row.revision))&&Number(row.revision)>0&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false&&typeof row.idempotent==='boolean'?Object.freeze({...row,revision:Number(row.revision)}):null;

export async function resolveAuthoritativeAiFindingAction({config,action,reason,revision,idempotencyKey,fetcher=globalThis.fetch}={}){
  const canonicalReason=typeof reason==='string'?reason.trim():'';
  if(!config||typeof fetcher!=='function'||!aiFindingAction(action)||action.status!=='OPEN'||canonicalReason.length<8||canonicalReason.length>2000||!Number.isSafeInteger(revision)||revision!==action.revision||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'AI_FINDING_ACTION_RESOLUTION_COMMAND_INVALID',message:'AI finding resolution requires one open retained action, its current revision, a bounded human reason, and stable command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const body={aiFindingActionId:action.ai_finding_action_id,findingHash:action.finding_hash,reason:canonicalReason};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/findings/actions/resolutions`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,'if-match':`\"${revision}\"`,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'AI_FINDING_ACTION_RESOLVE');const envelope=await response.json(),data=aiFindingActionResolutionResult(envelope?.data);if(envelope?.ok!==true||data===null||data.ai_finding_action_id!==action.ai_finding_action_id||data.finding_kind!==action.finding_kind||data.finding_id!==action.finding_id||data.finding_hash!==action.finding_hash||data.resolution_reason!==canonicalReason)return {ok:false,code:'AI_FINDING_ACTION_RESOLUTION_PROTOCOL',message:'The accounting API returned invalid, mismatched, or action-enabled AI finding resolution data.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not retain the AI finding resolution receipt; no HTTP response was produced.');}
}

const AI_ANALYSIS_SUMMARY_FIELDS=['category','total_findings','high_findings','medium_findings','low_findings','latest_materialized_at','can_create_draft','can_review','can_approve','can_post'];
const AI_ANALYSIS_CATEGORIES=new Set(['WBS_EXCEPTION','PREPAID_COVERAGE','DUPLICATE_PAYABLE','UNMATCHED_BANK_PAYMENT','COST_DIMENSION','LOAN_REFERENCE']);
const AI_SKILL_FIELDS=['id','name','status','finding_category','required_evidence','allowed_outputs','prohibited_actions'];
const aiSkill=row=>exactObjectKeys(row,AI_SKILL_FIELDS)&&typeof row.id==='string'&&row.id.length>0&&nullableBoundedText(row.name,128)&&['IMPLEMENTED_FINDING','IMPLEMENTED_REVIEW_CANDIDATE','PLANNED_SOURCE_CONTRACT'].includes(row.status)&&(row.finding_category===null||AI_ANALYSIS_CATEGORIES.has(row.finding_category))&&((row.status==='IMPLEMENTED_FINDING')===AI_ANALYSIS_CATEGORIES.has(row.finding_category))&&Array.isArray(row.required_evidence)&&row.required_evidence.length>0&&row.required_evidence.every(value=>nullableBoundedText(value,128))&&Array.isArray(row.allowed_outputs)&&row.allowed_outputs.length>0&&row.allowed_outputs.every(value=>nullableBoundedText(value,128))&&exactObjectKeys(row.prohibited_actions,['can_create_draft','can_review','can_approve','can_post'])&&Object.values(row.prohibited_actions).every(value=>value===false)?Object.freeze({...row,required_evidence:Object.freeze([...row.required_evidence]),allowed_outputs:Object.freeze([...row.allowed_outputs]),prohibited_actions:Object.freeze({...row.prohibited_actions})}):null;
export async function refreshAuthoritativeAiAccountingSkills({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function')return {ok:false,code:'AI_ACCOUNTING_SKILL_SCOPE_INVALID',message:'AI accounting skills require one authoritative entity context.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/skills`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_ACCOUNTING_SKILL_READ');const body=await response.json(),data=body?.data;if(body?.ok!==true||!data||typeof data.registry_version!=='string'||!Array.isArray(data.skills))return {ok:false,code:'AI_ACCOUNTING_SKILL_PROTOCOL',message:'The accounting API returned an invalid AI skill registry envelope.'};const rows=data.skills.map(aiSkill);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.id)).size!==rows.length)return {ok:false,code:'AI_ACCOUNTING_SKILL_PROTOCOL',message:'The accounting API returned an invalid or duplicate AI skill registry.'};return {ok:true,registryVersion:data.registry_version,rows};}catch{return unreachable('The browser could not read the authoritative AI skill registry; no HTTP response was produced.');}
}
const aiAnalysisSummaryRow=row=>exactObjectKeys(row,AI_ANALYSIS_SUMMARY_FIELDS)&&AI_ANALYSIS_CATEGORIES.has(row.category)&&['total_findings','high_findings','medium_findings','low_findings'].every(field=>Number.isSafeInteger(Number(row[field]))&&Number(row[field])>=0)&&Number(row.total_findings)===Number(row.high_findings)+Number(row.medium_findings)+Number(row.low_findings)&&validTimestamp(row.latest_materialized_at)&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false?Object.freeze({...row,total_findings:Number(row.total_findings),high_findings:Number(row.high_findings),medium_findings:Number(row.medium_findings),low_findings:Number(row.low_findings)}):null;

export async function refreshAuthoritativeAiAccountingAnalysisSummary({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function')return {ok:false,code:'AI_ACCOUNTING_ANALYSIS_SUMMARY_SCOPE_INVALID',message:'AI accounting analysis requires one authoritative entity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/analysis-summary`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_ACCOUNTING_ANALYSIS_SUMMARY_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'AI_ACCOUNTING_ANALYSIS_SUMMARY_PROTOCOL',message:'The accounting API returned an invalid AI accounting analysis summary envelope.'};const rows=body.data.map(aiAnalysisSummaryRow);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.category)).size!==rows.length)return {ok:false,code:'AI_ACCOUNTING_ANALYSIS_SUMMARY_PROTOCOL',message:'The accounting API returned duplicate, action-enabled, or invalid AI accounting analysis summary rows.'};return {ok:true,rows};}catch{return unreachable('The browser could not read the persisted AI accounting analysis summary; no HTTP response was produced.');}
}

const AI_ANALYSIS_EXPLANATION_FIELDS=['traceId','providerRequestId','model','elapsedMs','result'];
const AI_ANALYSIS_EXPLANATION_RESULT_FIELDS=['headline','risk_level','narrative','controller_actions','can_create_draft','can_review','can_approve','can_post'];
const aiAnalysisExplanation=value=>{const result=value?.result;return exactObjectKeys(value,AI_ANALYSIS_EXPLANATION_FIELDS)&&typeof value.traceId==='string'&&value.traceId.length>=8&&value.traceId.length<=200&&(typeof value.providerRequestId==='string'||value.providerRequestId===null)&&nullableBoundedText(value.model,128)&&Number.isSafeInteger(value.elapsedMs)&&value.elapsedMs>=0&&exactObjectKeys(result,AI_ANALYSIS_EXPLANATION_RESULT_FIELDS)&&nullableBoundedText(result.headline,280)&&['HIGH','MEDIUM','LOW','NONE'].includes(result.risk_level)&&nullableBoundedText(result.narrative,4000)&&Array.isArray(result.controller_actions)&&result.controller_actions.length<=6&&result.controller_actions.every(action=>exactObjectKeys(action,['category','finding_ids','action'])&&AI_ANALYSIS_CATEGORIES.has(action.category)&&Array.isArray(action.finding_ids)&&action.finding_ids.length>0&&action.finding_ids.length<=10&&new Set(action.finding_ids).size===action.finding_ids.length&&action.finding_ids.every(id=>UUID.test(id))&&nullableBoundedText(action.action,1000))&&result.can_create_draft===false&&result.can_review===false&&result.can_approve===false&&result.can_post===false?Object.freeze({...value,result:Object.freeze({...result,controller_actions:Object.freeze(result.controller_actions.map(action=>Object.freeze({...action,finding_ids:Object.freeze([...action.finding_ids])})))})}):null;};

const AI_ANALYSIS_REPORT_FIELDS=['idempotency_key','request_hash','actor_id','completed_at','report','can_create_draft','can_review','can_approve','can_post'];
const aiAnalysisReport=row=>exactObjectKeys(row,AI_ANALYSIS_REPORT_FIELDS)&&typeof row.idempotency_key==='string'&&row.idempotency_key.length>=8&&row.idempotency_key.length<=200&&SHA256.test(row.request_hash||'')&&nullableBoundedText(row.actor_id,255)&&validTimestamp(row.completed_at)&&aiAnalysisExplanation(row.report)!==null&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false?Object.freeze({...row,report:aiAnalysisExplanation(row.report)}):null;

export async function refreshAuthoritativeAiAccountingAnalysisReports({config,limit=10,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>50)return {ok:false,code:'AI_ACCOUNTING_ANALYSIS_REPORT_SCOPE_INVALID',message:'AI accounting analysis reports require one authoritative entity and a limit from 1 to 50.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/analysis-reports?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_ACCOUNTING_ANALYSIS_REPORT_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'AI_ACCOUNTING_ANALYSIS_REPORT_PROTOCOL',message:'The accounting API returned an invalid AI accounting analysis report envelope.'};const rows=body.data.map(aiAnalysisReport);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.idempotency_key)).size!==rows.length)return {ok:false,code:'AI_ACCOUNTING_ANALYSIS_REPORT_PROTOCOL',message:'The accounting API returned duplicate, action-enabled, or invalid AI accounting analysis reports.'};return {ok:true,rows};}catch{return unreachable('The browser could not read persisted AI accounting analysis reports; no HTTP response was produced.');}
}

const AI_ACCRUAL_TRACE_FIELDS=['source_document_id','source_document_line_id','source_payload_hash','source_line_hash','accounting_period_id','period_key','service_period_start','service_period_end','recurring_obligation_id','service_frequency','obligation_status','currency','amount'];
const AI_ACCRUAL_CANDIDATE_FIELDS=['status','rule_id','entity_id','accounting_period_id','period_key','recurring_obligation_id','service_frequency','currency','historical_amounts','prior_source_trace','required_human_fields','can_create_draft','can_review','can_approve','can_post'];
const aiAccrualTrace=row=>exactObjectKeys(row,AI_ACCRUAL_TRACE_FIELDS)&&UUID.test(row.source_document_id||'')&&UUID.test(row.source_document_line_id||'')&&SHA256.test(row.source_payload_hash||'')&&SHA256.test(row.source_line_hash||'')&&UUID.test(row.accounting_period_id||'')&&PERIOD_CODE.test(row.period_key||'')&&validDate(row.service_period_start)&&validDate(row.service_period_end)&&row.service_period_start<=row.service_period_end&&nullableBoundedText(row.recurring_obligation_id,128)&&nullableBoundedText(row.service_frequency,32)&&nullableBoundedText(row.obligation_status,32)&&/^[A-Z]{3}$/.test(row.currency||'')&&MONEY4.test(String(row.amount??''))?Object.freeze({...row,amount:String(row.amount)}):null;
const aiAccrualCandidate=row=>exactObjectKeys(row,AI_ACCRUAL_CANDIDATE_FIELDS)&&row.status==='ACCRUAL_CANDIDATE_REVIEW_REQUIRED'&&row.rule_id==='RECURRING_OBLIGATION_MISSING_CURRENT_PERIOD'&&UUID.test(row.entity_id||'')&&UUID.test(row.accounting_period_id||'')&&PERIOD_CODE.test(row.period_key||'')&&nullableBoundedText(row.recurring_obligation_id,128)&&nullableBoundedText(row.service_frequency,32)&&/^[A-Z]{3}$/.test(row.currency||'')&&Array.isArray(row.historical_amounts)&&row.historical_amounts.length===3&&row.historical_amounts.every(value=>MONEY4.test(String(value)))&&Array.isArray(row.prior_source_trace)&&row.prior_source_trace.length===3&&row.prior_source_trace.every(item=>aiAccrualTrace(item)!==null)&&row.prior_source_trace.every(item=>item.recurring_obligation_id===row.recurring_obligation_id&&item.currency===row.currency)&&Array.isArray(row.required_human_fields)&&row.required_human_fields.join('|')==='owner|due_date|accrual_basis|account_mapping|member_trace|reversing_entry_decision'&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false?Object.freeze({...row,historical_amounts:Object.freeze(row.historical_amounts.map(String)),prior_source_trace:Object.freeze(row.prior_source_trace.map(aiAccrualTrace)),required_human_fields:Object.freeze([...row.required_human_fields])}):null;
const AI_ACCRUAL_ANALYSIS_FIELDS=['status','entity_id','accounting_period_id','excluded_explicit_non_accrual_evidence_count','candidates','can_create_draft','can_review','can_approve','can_post'];

export async function refreshAuthoritativeAiAccrualCandidates({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(config.entityId||'')||!UUID.test(config.periodId||''))return {ok:false,code:'AI_ACCRUAL_ANALYSIS_SCOPE_INVALID',message:'AI accrual analysis requires one authoritative entity and accounting period.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/accrual-candidates?periodId=${config.periodId}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_ACCRUAL_ANALYSIS_READ');const body=await response.json(),data=body?.data;if(body?.ok!==true||!exactObjectKeys(data,AI_ACCRUAL_ANALYSIS_FIELDS)||data.status!=='AI_ACCRUAL_ANALYSIS_COMPLETE'||data.entity_id!==config.entityId||data.accounting_period_id!==config.periodId||!Number.isSafeInteger(data.excluded_explicit_non_accrual_evidence_count)||data.excluded_explicit_non_accrual_evidence_count<0||data.excluded_explicit_non_accrual_evidence_count>1000||!Array.isArray(data.candidates)||data.candidates.some(row=>aiAccrualCandidate(row)===null)||new Set(data.candidates.map(row=>row.recurring_obligation_id)).size!==data.candidates.length||data.can_create_draft!==false||data.can_review!==false||data.can_approve!==false||data.can_post!==false)return {ok:false,code:'AI_ACCRUAL_ANALYSIS_PROTOCOL',message:'The accounting API returned invalid or action-enabled accrual analysis evidence.'};return {ok:true,data:Object.freeze({...data,candidates:Object.freeze(data.candidates.map(aiAccrualCandidate))})};}catch{return unreachable('The browser could not read authoritative AI accrual analysis; no HTTP response was produced.');}
}

const AI_INVOICE_CLASSIFICATION_FIELDS=['schema_version','source_document_id','source_document_line_id','source_payload_hash','source_line_hash','classification','reason','confidence','required_human_fields','action_flags'];
const AI_INVOICE_CLASSIFICATION_BATCH_FIELDS=['schema_version','row_count','results','classification_counts','scope','scanned_document_count','eligible_invoice_line_count','action_flags'];
const AI_INVOICE_CLASSIFICATION_NAMES=['EXPENSE','PREPAID_AMORTIZATION','ACCRUAL_REVIEW','CAPITALIZATION_REVIEW','BLOCKED'];
const noInvoiceAccountingActions=value=>exactObjectKeys(value,['can_create_draft','can_review','can_approve','can_post'])&&value.can_create_draft===false&&value.can_review===false&&value.can_approve===false&&value.can_post===false;
const aiInvoiceClassification=row=>exactObjectKeys(row,AI_INVOICE_CLASSIFICATION_FIELDS)&&row.schema_version==='AI_INVOICE_ACCOUNTING_CLASSIFICATION_V1'&&UUID.test(row.source_document_id||'')&&UUID.test(row.source_document_line_id||'')&&SHA256.test(row.source_payload_hash||'')&&SHA256.test(row.source_line_hash||'')&&AI_INVOICE_CLASSIFICATION_NAMES.includes(row.classification)&&nullableBoundedText(row.reason,2000)&&typeof row.confidence==='number'&&Number.isFinite(row.confidence)&&row.confidence>=0&&row.confidence<=1&&Array.isArray(row.required_human_fields)&&row.required_human_fields.length<=20&&row.required_human_fields.every(field=>typeof field==='string'&&nullableBoundedText(field,64))&&noInvoiceAccountingActions(row.action_flags)?Object.freeze({...row,required_human_fields:Object.freeze([...row.required_human_fields]),action_flags:Object.freeze({...row.action_flags})}):null;

export async function refreshAuthoritativeAiInvoiceAccountingClassifications({config,limit=100,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(config.entityId||'')||!UUID.test(config.periodId||'')||!Number.isSafeInteger(limit)||limit<1||limit>500)return {ok:false,code:'AI_INVOICE_CLASSIFICATION_SCOPE_INVALID',message:'AI invoice classification requires one authoritative entity, accounting period, and a limit from 1 to 500.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/invoice-accounting-classifications?periodId=${config.periodId}&limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_INVOICE_CLASSIFICATION_READ');const body=await response.json(),data=body?.data,rows=Array.isArray(data?.results)?data.results.map(aiInvoiceClassification):null,counts=data?.classification_counts;
    if(body?.ok!==true||!exactObjectKeys(data,AI_INVOICE_CLASSIFICATION_BATCH_FIELDS)||data.schema_version!=='AI_INVOICE_ACCOUNTING_CLASSIFICATION_BATCH_V1'||!exactObjectKeys(data.scope,['tenant_id','entity_id','accounting_period_id'])||data.scope.entity_id!==config.entityId||data.scope.accounting_period_id!==config.periodId||!Array.isArray(rows)||rows.some(row=>row===null)||data.row_count!==rows.length||data.eligible_invoice_line_count!==rows.length||!Number.isSafeInteger(data.scanned_document_count)||data.scanned_document_count<0||!exactObjectKeys(counts,AI_INVOICE_CLASSIFICATION_NAMES)||Object.values(counts).some(value=>!Number.isSafeInteger(value)||value<0)||Object.values(counts).reduce((sum,value)=>sum+value,0)!==rows.length||!noInvoiceAccountingActions(data.action_flags))return {ok:false,code:'AI_INVOICE_CLASSIFICATION_PROTOCOL',message:'The accounting API returned invalid, unscoped, or action-enabled invoice classifications.'};
    return {ok:true,data:Object.freeze({...data,results:Object.freeze(rows),classification_counts:Object.freeze({...counts}),scope:Object.freeze({...data.scope}),action_flags:Object.freeze({...data.action_flags})})};
  }catch{return unreachable('The browser could not read authoritative AI invoice classifications; no HTTP response was produced.');}
}

export async function explainAuthoritativeAiAccountingAnalysis({config,idempotencyKey,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'AI_ANALYSIS_EXPLANATION_COMMAND_INVALID',message:'AI analysis explanation requires one authoritative entity and a stable command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/analysis-explanation`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:'{}'});if(!response.ok)return await failure(response,'AI_ANALYSIS_EXPLANATION');const body=await response.json(),data=aiAnalysisExplanation(body?.data);if(body?.ok!==true||data===null)return {ok:false,code:'AI_ANALYSIS_EXPLANATION_PROTOCOL',message:'The accounting API returned an invalid or action-enabled AI analysis explanation.'};return {ok:true,data};}catch{return unreachable('The browser could not request the source-bound AI analysis explanation; no HTTP response was produced.');}
}

const AI_AMORTIZATION_SCHEDULE_FIELDS=['ai_amortization_schedule_id','source_document_id','source_payload_hash','source_document_version','rule_id','analysis_mode','confidence','status','coverage_start','coverage_end','currency','original_amount','prepaid_account_code','expense_account_code','member_trace','proposal_reason','proposal_hash','created_by','created_at','eligible_source_attachment_ids','schedule_lines','can_create_draft','can_review','can_approve','can_post'];
const aiAmortizationMemberTrace=trace=>exactObjectKeys(trace,['project_ref','property_ref','allocation_basis'])&&nullableBoundedText(trace.project_ref,128)&&nullableBoundedText(trace.property_ref,128)&&['ENTITY_ONLY','SOURCE_DIMENSIONED'].includes(trace.allocation_basis)&&!(trace.allocation_basis==='ENTITY_ONLY'&&(trace.project_ref!==null||trace.property_ref!==null));
const aiAmortizationSchedule=row=>{const confidence=aiFindingConfidence(row?.confidence),lines=row?.schedule_lines,attachments=row?.eligible_source_attachment_ids;return exactObjectKeys(row,AI_AMORTIZATION_SCHEDULE_FIELDS)&&UUID.test(row.ai_amortization_schedule_id||'')&&UUID.test(row.source_document_id||'')&&SHA256.test(row.source_payload_hash||'')&&Number.isSafeInteger(Number(row.source_document_version))&&Number(row.source_document_version)>=0&&row.rule_id==='PREPAID_AMORTIZATION_V1'&&row.analysis_mode==='DETERMINISTIC_EVIDENCE_BACKED'&&confidence!==null&&row.status==='PROPOSED'&&validDate(row.coverage_start)&&validDate(row.coverage_end)&&row.coverage_start<=row.coverage_end&&/^[A-Z]{3}$/.test(row.currency||'')&&MONEY4.test(String(row.original_amount??''))&&ACCOUNT_CODE.test(row.prepaid_account_code||'')&&ACCOUNT_CODE.test(row.expense_account_code||'')&&row.prepaid_account_code!==row.expense_account_code&&aiAmortizationMemberTrace(row.member_trace)&&nullableBoundedText(row.proposal_reason,2000)&&SHA256.test(row.proposal_hash||'')&&nullableBoundedText(row.created_by,128)&&validTimestamp(row.created_at)&&Array.isArray(attachments)&&attachments.every(value=>UUID.test(value))&&new Set(attachments).size===attachments.length&&attachments.every((value,index)=>index===0||attachments[index-1]<value)&&Array.isArray(lines)&&lines.length>0&&lines.every((line,index)=>line&&Object.keys(line).length===6&&UUID.test(line.ai_amortization_schedule_line_id||'')&&line.line_no===index+1&&validDate(line.amortization_month)&&MONEY4.test(String(line.amount??''))&&line.status==='PROPOSED'&&SHA256.test(line.source_payload_hash||'')&&line.source_payload_hash===row.source_payload_hash)&&new Set(lines.map(line=>line.ai_amortization_schedule_line_id)).size===lines.length&&row.can_create_draft===false&&row.can_review===false&&row.can_approve===false&&row.can_post===false?Object.freeze({...row,confidence,source_document_version:Number(row.source_document_version),original_amount:String(row.original_amount),eligible_source_attachment_ids:Object.freeze([...attachments]),schedule_lines:Object.freeze(lines.map(line=>Object.freeze({...line,amount:String(line.amount)})))}):null;};

const AI_AMORTIZATION_COVERAGE_EVIDENCE_FIELDS=['schema_version','ai_amortization_coverage_evidence_id','source_document_id','source_payload_hash','source_document_version','coverage_start','coverage_end','evidence_hash','extraction_method','can_create_draft','can_review','can_approve','can_post','idempotent'];
const wholeMonthCoverage=(start,end)=>validDate(start)&&validDate(end)&&start.slice(8)==='01'&&end===new Date(Date.UTC(Number(end.slice(0,4)),Number(end.slice(5,7)),0)).toISOString().slice(0,10)&&start<=end;
const aiAmortizationCoverageEvidence=value=>exactObjectKeys(value,AI_AMORTIZATION_COVERAGE_EVIDENCE_FIELDS)&&value.schema_version==='AI_AMORTIZATION_COVERAGE_EVIDENCE_V1'&&UUID.test(value.ai_amortization_coverage_evidence_id||'')&&UUID.test(value.source_document_id||'')&&SHA256.test(value.source_payload_hash||'')&&Number.isSafeInteger(Number(value.source_document_version))&&Number(value.source_document_version)>=0&&wholeMonthCoverage(value.coverage_start,value.coverage_end)&&SHA256.test(value.evidence_hash||'')&&['SIGNED_SOURCE_FIELD','SIGNED_ATTACHMENT_FIELD','HUMAN_VERIFIED_SOURCE_FIELD'].includes(value.extraction_method)&&value.can_create_draft===false&&value.can_review===false&&value.can_approve===false&&value.can_post===false&&typeof value.idempotent==='boolean'?Object.freeze({...value,source_document_version:Number(value.source_document_version)}):null;
const AI_AMORTIZATION_COVERAGE_EVIDENCE_READ_FIELDS=['ai_amortization_coverage_evidence_id','source_document_id','source_payload_hash','source_document_version','coverage_start','coverage_end','evidence_ref','evidence_hash','extraction_method','coverage_hash','created_by','created_at','can_create_draft','can_review','can_approve','can_post'];
const aiAmortizationCoverageEvidenceRead=value=>exactObjectKeys(value,AI_AMORTIZATION_COVERAGE_EVIDENCE_READ_FIELDS)&&UUID.test(value.ai_amortization_coverage_evidence_id||'')&&UUID.test(value.source_document_id||'')&&SHA256.test(value.source_payload_hash||'')&&Number.isSafeInteger(Number(value.source_document_version))&&Number(value.source_document_version)>=0&&wholeMonthCoverage(value.coverage_start,value.coverage_end)&&nullableBoundedText(value.evidence_ref,512)&&SHA256.test(value.evidence_hash||'')&&['SIGNED_SOURCE_FIELD','SIGNED_ATTACHMENT_FIELD','HUMAN_VERIFIED_SOURCE_FIELD'].includes(value.extraction_method)&&SHA256.test(value.coverage_hash||'')&&nullableBoundedText(value.created_by,128)&&validTimestamp(value.created_at)&&value.can_create_draft===false&&value.can_review===false&&value.can_approve===false&&value.can_post===false?Object.freeze({...value,source_document_version:Number(value.source_document_version)}):null;

export async function recordAuthoritativeAiAmortizationCoverageEvidence({config,sourceDocumentId,sourcePayloadHash,coverageStart,coverageEnd,evidenceRef,evidenceHash,extractionMethod,idempotencyKey,fetcher=globalThis.fetch}={}){
  const canonicalEvidenceRef=typeof evidenceRef==='string'?evidenceRef.trim():'';
  if(!config||typeof fetcher!=='function'||!UUID.test(sourceDocumentId||'')||!SHA256.test(sourcePayloadHash||'')||!wholeMonthCoverage(coverageStart,coverageEnd)||!SHA256.test(evidenceHash||'')||canonicalEvidenceRef.length<1||canonicalEvidenceRef.length>512||/[\u0000-\u001f\u007f]/.test(canonicalEvidenceRef)||!['SIGNED_SOURCE_FIELD','SIGNED_ATTACHMENT_FIELD','HUMAN_VERIFIED_SOURCE_FIELD'].includes(extractionMethod)||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'AI_AMORTIZATION_COVERAGE_EVIDENCE_COMMAND_INVALID',message:'Coverage evidence requires one authoritative source, retained evidence hash, whole-month coverage, approved extraction method, and stable command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const body={sourceDocumentId,sourcePayloadHash,coverageStart,coverageEnd,evidenceRef:canonicalEvidenceRef,evidenceHash,extractionMethod};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/amortization/coverage-evidence`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'AI_AMORTIZATION_COVERAGE_EVIDENCE');const envelope=await response.json(),data=aiAmortizationCoverageEvidence(envelope?.data);if(envelope?.ok!==true||data===null||data.source_document_id!==sourceDocumentId||data.source_payload_hash!==sourcePayloadHash||data.coverage_start!==coverageStart||data.coverage_end!==coverageEnd||data.evidence_hash!==evidenceHash||data.extraction_method!==extractionMethod)return {ok:false,code:'AI_AMORTIZATION_COVERAGE_EVIDENCE_PROTOCOL',message:'The accounting API returned invalid, mismatched, or action-enabled amortization coverage evidence.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not retain amortization coverage evidence; no HTTP response was produced.');}
}

export async function refreshAuthoritativeAiAmortizationCoverageEvidence({config,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>100)return {ok:false,code:'AI_AMORTIZATION_COVERAGE_EVIDENCE_SCOPE_INVALID',message:'AI amortization coverage evidence requires one authoritative entity and a limit from 1 to 100.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/amortization/coverage-evidence?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_AMORTIZATION_COVERAGE_EVIDENCE_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'AI_AMORTIZATION_COVERAGE_EVIDENCE_PROTOCOL',message:'The accounting API returned an invalid amortization coverage evidence envelope.'};const rows=body.data.map(aiAmortizationCoverageEvidenceRead);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.ai_amortization_coverage_evidence_id)).size!==rows.length||new Set(rows.map(row=>`${row.source_document_id}:${row.source_document_version}`)).size!==rows.length)return {ok:false,code:'AI_AMORTIZATION_COVERAGE_EVIDENCE_PROTOCOL',message:'The accounting API returned duplicate, action-enabled, or invalid amortization coverage evidence.'};return {ok:true,rows};}catch{return unreachable('The browser could not read persisted amortization coverage evidence; no HTTP response was produced.');}
}

const AI_AMORTIZATION_PROPOSAL_RESULT_FIELDS=['schema_version','ai_amortization_schedule_id','source_document_id','source_payload_hash','coverage_start','coverage_end','line_count','original_amount','status','can_create_draft','can_review','can_approve','can_post','idempotent'];
const aiAmortizationProposalResult=value=>exactObjectKeys(value,AI_AMORTIZATION_PROPOSAL_RESULT_FIELDS)&&value.schema_version==='AI_AMORTIZATION_PROPOSAL_V1'&&UUID.test(value.ai_amortization_schedule_id||'')&&UUID.test(value.source_document_id||'')&&SHA256.test(value.source_payload_hash||'')&&wholeMonthCoverage(value.coverage_start,value.coverage_end)&&Number.isSafeInteger(Number(value.line_count))&&Number(value.line_count)>=1&&Number(value.line_count)<=120&&MONEY4.test(String(value.original_amount??''))&&value.status==='PROPOSED'&&value.can_create_draft===false&&value.can_review===false&&value.can_approve===false&&value.can_post===false&&typeof value.idempotent==='boolean'?Object.freeze({...value,line_count:Number(value.line_count),original_amount:String(value.original_amount)}):null;

export async function proposeAuthoritativeAiAmortizationSchedule({config,sourceDocumentId,sourcePayloadHash,coverageStart,coverageEnd,prepaidAccountCode,expenseAccountCode,memberTrace,confidence,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  const proposedReason=typeof reason==='string'?reason.trim():'';
  if(!config||typeof fetcher!=='function'||!UUID.test(sourceDocumentId||'')||!SHA256.test(sourcePayloadHash||'')||!wholeMonthCoverage(coverageStart,coverageEnd)||!ACCOUNT_CODE.test(prepaidAccountCode||'')||!ACCOUNT_CODE.test(expenseAccountCode||'')||prepaidAccountCode===expenseAccountCode||!aiAmortizationMemberTrace(memberTrace)||!Number.isFinite(confidence)||confidence<0||confidence>1||proposedReason.length<8||proposedReason.length>2000||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'AI_AMORTIZATION_PROPOSAL_COMMAND_INVALID',message:'An amortization proposal requires retained source evidence, whole-month coverage, distinct active accounts, exact member trace, confidence, reason, and stable command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const body={sourceDocumentId,sourcePayloadHash,coverageStart,coverageEnd,prepaidAccountCode,expenseAccountCode,memberTrace,confidence,reason:proposedReason};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/amortization/proposals`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'AI_AMORTIZATION_PROPOSAL');const envelope=await response.json(),data=aiAmortizationProposalResult(envelope?.data);if(envelope?.ok!==true||data===null||data.source_document_id!==sourceDocumentId||data.source_payload_hash!==sourcePayloadHash||data.coverage_start!==coverageStart||data.coverage_end!==coverageEnd)return {ok:false,code:'AI_AMORTIZATION_PROPOSAL_PROTOCOL',message:'The accounting API returned invalid, mismatched, or action-enabled amortization proposal evidence.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not retain the amortization proposal; no HTTP response was produced.');}
}

export async function refreshAuthoritativeAiAmortizationSchedules({config,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>100)return {ok:false,code:'AI_AMORTIZATION_SCHEDULE_SCOPE_INVALID',message:'AI amortization schedules require one authoritative entity and a limit from 1 to 100.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/amortization/schedules?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_AMORTIZATION_SCHEDULE_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'AI_AMORTIZATION_SCHEDULE_PROTOCOL',message:'The accounting API returned an invalid AI amortization schedule envelope.'};const rows=body.data.map(aiAmortizationSchedule);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.ai_amortization_schedule_id)).size!==rows.length||new Set(rows.map(row=>row.source_document_id)).size!==rows.length)return {ok:false,code:'AI_AMORTIZATION_SCHEDULE_PROTOCOL',message:'The accounting API returned duplicate, action-enabled, or invalid AI amortization schedules.'};return {ok:true,rows};}catch{return unreachable('The browser could not read persisted AI amortization schedules; no HTTP response was produced.');}
}

const AI_AMORTIZATION_DRAFT_RESULT_FIELDS=['journal_entry_id','status','revision','idempotent','ai_amortization_draft_evidence_id','ai_amortization_schedule_id','ai_amortization_schedule_line_id','source_document_id','journal_type','can_create_draft','can_review','can_approve','can_post'];
const aiAmortizationDraftResult=value=>exactObjectKeys(value,AI_AMORTIZATION_DRAFT_RESULT_FIELDS)&&UUID.test(value.journal_entry_id||'')&&value.status==='DRAFT'&&value.revision===0&&typeof value.idempotent==='boolean'&&UUID.test(value.ai_amortization_draft_evidence_id||'')&&UUID.test(value.ai_amortization_schedule_id||'')&&UUID.test(value.ai_amortization_schedule_line_id||'')&&UUID.test(value.source_document_id||'')&&value.journal_type==='MANUAL'&&value.can_create_draft===false&&value.can_review===false&&value.can_approve===false&&value.can_post===false?Object.freeze({...value}):null;

export async function aiAmortizationDraftIdempotencyKey({config,schedule,scheduleLine,attachmentIds,reason,cryptoApi=globalThis.crypto}={}){
  const attachments=Array.isArray(attachmentIds)?[...attachmentIds].map(value=>String(value).trim()).sort():[],approvedReason=typeof reason==='string'?reason.trim():'';
  if(!config||!UUID.test(config.entityId||'')||!UUID.test(config.periodId||'')||aiAmortizationSchedule(schedule)===null||!scheduleLine||!schedule.schedule_lines.some(line=>line.ai_amortization_schedule_line_id===scheduleLine.ai_amortization_schedule_line_id)||attachments.length<1||new Set(attachments).size!==attachments.length||attachments.some(value=>!UUID.test(value))||approvedReason.length<8||approvedReason.length>2000||typeof cryptoApi?.subtle?.digest!=='function')return null;
  const canonical=JSON.stringify({attachment_ids:attachments,entity_id:config.entityId,expected_proposal_hash:schedule.proposal_hash,period_id:config.periodId,reason:approvedReason,schedule_id:schedule.ai_amortization_schedule_id,schedule_line_id:scheduleLine.ai_amortization_schedule_line_id,source_document_id:schedule.source_document_id});
  try{return `ai-amortization-draft:${hex(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))}`;}catch{return null;}
}

export async function createAuthoritativeAiAmortizationDraft({config,schedule,scheduleLine,attachmentIds,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  const approvedReason=typeof reason==='string'?reason.trim():'';
  const attachments=Array.isArray(attachmentIds)?attachmentIds.map(value=>String(value).trim()):[];
  if(!config||typeof fetcher!=='function'||!UUID.test(config.periodId||'')||aiAmortizationSchedule(schedule)===null||!scheduleLine||!schedule.schedule_lines.some(line=>line.ai_amortization_schedule_line_id===scheduleLine.ai_amortization_schedule_line_id)||!UUID.test(scheduleLine.ai_amortization_schedule_line_id||'')||!validDate(scheduleLine.amortization_month)||scheduleLine.status!=='PROPOSED'||scheduleLine.source_payload_hash!==schedule.source_payload_hash||attachments.length<1||new Set(attachments).size!==attachments.length||attachments.some(value=>!UUID.test(value))||approvedReason.length<8||approvedReason.length>2000||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'AI_AMORTIZATION_DRAFT_COMMAND_INVALID',message:'A Draft requires one retained schedule line, the selected OPEN period, exact proposal hash, unique source-bound clean attachments, a maker reason, and stable command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const body={periodId:config.periodId,scheduleLineId:scheduleLine.ai_amortization_schedule_line_id,expectedProposalHash:schedule.proposal_hash,attachmentIds:attachments,reason:approvedReason};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/amortization/schedules/${schedule.ai_amortization_schedule_id}/drafts`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'AI_AMORTIZATION_DRAFT');const envelope=await response.json(),data=aiAmortizationDraftResult(envelope?.data);if(envelope?.ok!==true||data===null||data.ai_amortization_schedule_id!==schedule.ai_amortization_schedule_id||data.ai_amortization_schedule_line_id!==scheduleLine.ai_amortization_schedule_line_id||data.source_document_id!==schedule.source_document_id)return {ok:false,code:'AI_AMORTIZATION_DRAFT_PROTOCOL',message:'The accounting API returned a malformed, mismatched, or action-enabled amortization Draft receipt.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not create the amortization Draft; no HTTP response was produced.');}
}

const AI_WBS_PAYABLE_PROPOSAL_FIELDS=['ai_wbs_payable_draft_proposal_id','wbs_payable_review_evidence_id','source_document_id','staging_item_id','mapping_snapshot_id','model_id','prompt_version','proposal_lines','proposal_hash','created_at','decision','decision_reason','reviewed_by','reviewed_at','can_create_draft','can_submit','can_review','can_approve','can_post'];
const AI_WBS_PAYABLE_PROPOSAL_LINE_FIELDS=['line_no','account_code','debit_amount','credit_amount','source'];
const aiWbsPayableProposalLine=value=>exactObjectKeys(value,AI_WBS_PAYABLE_PROPOSAL_LINE_FIELDS)&&Number.isSafeInteger(value.line_no)&&value.line_no>0&&ACCOUNT_CODE.test(value.account_code||'')&&MONEY4.test(String(value.debit_amount??''))&&MONEY4.test(String(value.credit_amount??''))&&(value.debit_amount==='0.0000')!==(value.credit_amount==='0.0000')&&value.source==='REVIEWED_MAPPING'?Object.freeze({...value}):null;
const money4Units=value=>BigInt(String(value).replace('.',''));
const aiWbsPayableDraftProposal=value=>{
  const lines=Array.isArray(value?.proposal_lines)?value.proposal_lines.map(aiWbsPayableProposalLine):[];
  const pending=value?.decision===null;
  const balanced=lines.length===2&&lines.every(Boolean)&&new Set(lines.map(line=>line.line_no)).size===2&&lines.reduce((sum,line)=>sum+money4Units(line.debit_amount)-money4Units(line.credit_amount),0n)===0n;
  return exactObjectKeys(value,AI_WBS_PAYABLE_PROPOSAL_FIELDS)&&UUID.test(value.ai_wbs_payable_draft_proposal_id||'')&&UUID.test(value.wbs_payable_review_evidence_id||'')&&UUID.test(value.source_document_id||'')&&UUID.test(value.staging_item_id||'')&&UUID.test(value.mapping_snapshot_id||'')&&nullableBoundedText(value.model_id,128)&&nullableBoundedText(value.prompt_version,128)&&balanced&&SHA256.test(value.proposal_hash||'')&&validTimestamp(value.created_at)&&(pending||['ACCEPTED','REJECTED'].includes(value.decision))&&(pending?(value.decision_reason===null&&value.reviewed_by===null&&value.reviewed_at===null):(nullableBoundedText(value.decision_reason,2000)&&nullableBoundedText(value.reviewed_by,128)&&validTimestamp(value.reviewed_at)))&&value.can_create_draft===false&&value.can_submit===false&&value.can_review===false&&value.can_approve===false&&value.can_post===false?Object.freeze({...value,proposal_lines:Object.freeze(lines)}):null;
};

export async function refreshAuthoritativeAiWbsPayableDraftProposals({config,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>100)return {ok:false,code:'AI_WBS_PAYABLE_PROPOSAL_SCOPE_INVALID',message:'AI payable proposals require one authoritative entity and a limit from 1 to 100.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/wbs-payable-draft-proposals?limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'AI_WBS_PAYABLE_PROPOSAL_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'AI_WBS_PAYABLE_PROPOSAL_PROTOCOL',message:'The accounting API returned an invalid AI payable proposal envelope.'};const rows=body.data.map(aiWbsPayableDraftProposal);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.ai_wbs_payable_draft_proposal_id)).size!==rows.length)return {ok:false,code:'AI_WBS_PAYABLE_PROPOSAL_PROTOCOL',message:'The accounting API returned duplicate, unbalanced, action-enabled, or invalid AI payable proposals.'};return {ok:true,rows};}catch{return unreachable('The browser could not read AI payable proposals; no HTTP response was produced.');}
}

const AI_WBS_PAYABLE_PROPOSAL_REVIEW_FIELDS=['schema_version','ai_wbs_payable_draft_proposal_review_id','ai_wbs_payable_draft_proposal_id','wbs_payable_review_evidence_id','decision','can_create_draft','can_submit','can_review','can_approve','can_post','idempotent'];
const aiWbsPayableProposalReview=value=>exactObjectKeys(value,AI_WBS_PAYABLE_PROPOSAL_REVIEW_FIELDS)&&value.schema_version==='AI_WBS_PAYABLE_DRAFT_PROPOSAL_REVIEW_V1'&&UUID.test(value.ai_wbs_payable_draft_proposal_review_id||'')&&UUID.test(value.ai_wbs_payable_draft_proposal_id||'')&&UUID.test(value.wbs_payable_review_evidence_id||'')&&['ACCEPTED','REJECTED'].includes(value.decision)&&value.can_create_draft===false&&value.can_submit===false&&value.can_review===false&&value.can_approve===false&&value.can_post===false&&typeof value.idempotent==='boolean'?Object.freeze({...value}):null;

export async function reviewAuthoritativeAiWbsPayableDraftProposal({config,proposal,decision,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  const approvedReason=typeof reason==='string'?reason.trim():'';
  if(!config||typeof fetcher!=='function'||aiWbsPayableDraftProposal(proposal)===null||proposal.decision!==null||!['ACCEPTED','REJECTED'].includes(decision)||approvedReason.length<8||approvedReason.length>2000||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'AI_WBS_PAYABLE_PROPOSAL_REVIEW_COMMAND_INVALID',message:'AI payable proposal review requires one pending immutable proposal, an accept or reject decision, a bounded human reason, and stable command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const body={decision,reason:approvedReason};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/wbs-payable-draft-proposals/${proposal.ai_wbs_payable_draft_proposal_id}/reviews`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'AI_WBS_PAYABLE_PROPOSAL_REVIEW');const envelope=await response.json(),data=aiWbsPayableProposalReview(envelope?.data);if(envelope?.ok!==true||data===null||data.ai_wbs_payable_draft_proposal_id!==proposal.ai_wbs_payable_draft_proposal_id||data.wbs_payable_review_evidence_id!==proposal.wbs_payable_review_evidence_id||data.decision!==decision)return {ok:false,code:'AI_WBS_PAYABLE_PROPOSAL_REVIEW_PROTOCOL',message:'The accounting API returned a malformed, mismatched, or action-enabled AI payable review receipt.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not retain the AI payable proposal review; no HTTP response was produced.');}
}

const CONTROLLED_TEST_AI_POSTED_FIELDS=['ai_amortization_schedule_id','idempotent','journal_entry_id','parent_source_document_id','posting_batch_id','provenance_mode','source_document_id','status','test_only'];
const CONTROLLED_TEST_AI_PARTIAL_FIELDS=['ai_amortization_schedule_id','completed_stage','idempotency_key','journal_entry_id','parent_source_document_id','posting_batch_id','provenance_mode','retryable','source_document_id','status','test_only'];
const CONTROLLED_TEST_AI_STAGES=new Set(['SOURCE_DERIVED','COVERAGE_RECORDED','PROPOSAL_RECORDED','DRAFT_CREATED','SUBMITTED','REVIEWED','APPROVED']);
const controlledTestAiWorkflowResult=value=>{
  const posted=exactObjectKeys(value,CONTROLLED_TEST_AI_POSTED_FIELDS)&&value.status==='CONTROLLED_TEST_AI_WORKFLOW_POSTED'&&typeof value.idempotent==='boolean'&&[value.ai_amortization_schedule_id,value.journal_entry_id,value.parent_source_document_id,value.posting_batch_id,value.source_document_id].every(item=>UUID.test(item||''));
  const partial=exactObjectKeys(value,CONTROLLED_TEST_AI_PARTIAL_FIELDS)&&value.status==='CONTROLLED_TEST_AI_WORKFLOW_PARTIAL'&&value.retryable===true&&CONTROLLED_TEST_AI_STAGES.has(value.completed_stage)&&typeof value.idempotency_key==='string'&&value.idempotency_key.length>=8&&value.idempotency_key.length<=120&&UUID.test(value.parent_source_document_id||'')&&[value.ai_amortization_schedule_id,value.journal_entry_id,value.source_document_id].every(item=>item===null||UUID.test(item||''))&&value.posting_batch_id===null;
  return (posted||partial)&&value.test_only===true&&value.provenance_mode==='UNSIGNED_TEST_ONLY'?Object.freeze({...value}):null;
};

export async function controlledTestAiWorkflowIdempotencyKey({config,periodId,parentSourceDocumentId,coverageStart,coverageEnd,reason,cryptoApi=globalThis.crypto}={}){
  const approvedReason=typeof reason==='string'?reason.trim():'';
  if(config?.controlledTestAiWorkflowMode!=='ENABLED'||config?.deploymentEnvironment!=='staging'||!UUID.test(config.entityId||'')||!UUID.test(periodId||'')||!UUID.test(parentSourceDocumentId||'')||!wholeMonthCoverage(coverageStart,coverageEnd)||approvedReason.length<8||approvedReason.length>1800||typeof cryptoApi?.subtle?.digest!=='function')return null;
  const canonical=JSON.stringify({coverage_end:coverageEnd,coverage_start:coverageStart,entity_id:config.entityId,parent_source_document_id:parentSourceDocumentId,period_id:periodId,reason:approvedReason});
  try{return `controlled-ai:${hex(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))}`;}catch{return null;}
}

export async function runControlledTestAiWorkflow({config,periodId,parentSourceDocumentId,coverageStart,coverageEnd,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  const approvedReason=typeof reason==='string'?reason.trim():'';
  if(config?.controlledTestAiWorkflowMode!=='ENABLED'||config?.deploymentEnvironment!=='staging'||typeof fetcher!=='function'||!UUID.test(periodId||'')||!UUID.test(parentSourceDocumentId||'')||!wholeMonthCoverage(coverageStart,coverageEnd)||approvedReason.length<8||approvedReason.length>1800||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>120)return {ok:false,code:'CONTROLLED_TEST_AI_COMMAND_INVALID',message:'The staging test runner requires one POSTED WBS TEST_ONLY source, its corresponding OPEN period, whole-month coverage, a reason, and stable command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const body={periodId,parentSourceDocumentId,coverageStart,coverageEnd,reason:approvedReason};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ai/controlled-test-workflow/run`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'CONTROLLED_TEST_AI_WORKFLOW');const contentType=String(response.headers?.get?.('content-type')||'').toLowerCase(),cacheControl=String(response.headers?.get?.('cache-control')||'');if(!contentType.includes('application/json')||!/\bno-store\b/i.test(cacheControl))return {ok:false,code:'CONTROLLED_TEST_AI_PROTOCOL',message:'The controlled test endpoint did not return a no-store JSON receipt.'};const envelope=await response.json(),data=controlledTestAiWorkflowResult(envelope?.data);if(envelope?.ok!==true||data===null||data.parent_source_document_id!==parentSourceDocumentId||(data.status==='CONTROLLED_TEST_AI_WORKFLOW_PARTIAL'&&data.idempotency_key!==idempotencyKey))return {ok:false,code:'CONTROLLED_TEST_AI_PROTOCOL',message:'The controlled test endpoint returned an invalid, mismatched, or non-test receipt.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not run the controlled test AI workflow; no HTTP response was produced.');}
}

export async function attestAuthoritativeWbsPayableObservation({config,observation,expectedCompanyCode=null,dateFrom=null,dateTo=null,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  const approvedReason=typeof reason==='string'?reason.trim():'';
  const company=expectedCompanyCode==null||expectedCompanyCode===''?null:String(expectedCompanyCode),hasDates=dateFrom!=null||dateTo!=null;
  if(!config||typeof fetcher!=='function'||!wbsLivePilotObservation(observation,{entityId:config.entityId,tool:'list_payables',limit:10})||observation.record_count<1||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200||approvedReason.length<8||approvedReason.length>2000||(company!==null&&(!wbsScopeText(company,64)||observation.scope.company_codes.length!==1||observation.scope.company_codes[0]!==company))||(hasDates&&(!validDate(dateFrom)||!validDate(dateTo)||dateFrom>dateTo||observation.scope.date_range[0]!==dateFrom||observation.scope.date_range[1]!==dateTo)))return {ok:false,code:'WBS_OPERATOR_ATTESTATION_COMMAND_INVALID',message:'Operator attestation requires one fresh nonempty WBS Payable observation, its exact requested scope, a reason, and stable command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const body={expectedObservationHash:observation.observation_hash,expectedProviderContentSha256:observation.provider_content_sha256,reason:approvedReason,limit:10};
  if(company!==null)body.expectedCompanyCode=company;
  if(hasDates){body.dateFrom=dateFrom;body.dateTo=dateTo;}
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/operator-attested/payables`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'WBS_OPERATOR_ATTESTATION');const envelope=await response.json(),data=envelope?.data;if(envelope?.ok!==true||!data||!UUID.test(data.wbs_operator_payable_attestation_id||'')||data.status!=='EXCEPTION_REVIEW_REQUIRED'||data.provenance_mode!=='OPERATOR_ATTESTED'||data.signature_verified!==false||!['UNASSIGNED_COMPANY','MIXED_COMPANY','SINGLE_COMPANY_UNASSIGNED','ENTITY_SCOPE_MATCHED'].includes(data.company_scope_status)||data.row_count!==observation.record_count||['can_import_to_staging','can_review','can_create_draft','can_approve','can_post'].some(field=>data[field]!==false))return {ok:false,code:'WBS_OPERATOR_ATTESTATION_PROTOCOL',message:'The accounting API returned invalid, signed, or action-enabled operator-attested evidence.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not retain the WBS Payable observation as exception evidence; no HTTP response was produced.');}
}

const WBS_TEST_IMPORT_RESULT_FIELDS=Object.freeze(['failed_count','imported_count','posted_count','replayed_count','status','test_only']);
const wbsTestImportResult=value=>exactObjectKeys(value,WBS_TEST_IMPORT_RESULT_FIELDS)&&value.status==='WBS_TEST_PAYABLE_IMPORT_COMPLETE'&&value.test_only===true&&['failed_count','imported_count','posted_count','replayed_count'].every(field=>Number.isSafeInteger(value[field])&&value[field]>=0&&value[field]<=10)&&value.imported_count+value.replayed_count+value.failed_count<=10&&value.posted_count<=value.imported_count+value.replayed_count?Object.freeze({...value}):null;
const WBS_TEST_BANK_IMPORT_RESULT_FIELDS=Object.freeze(['bank_account_ref','bank_source_ids','idempotent','provenance_mode','reconciliation_id','statement_ending_date','status','test_only','transaction_count','wbs_controlled_test_bank_import_id']);
const wbsTestBankImportResult=value=>exactObjectKeys(value,WBS_TEST_BANK_IMPORT_RESULT_FIELDS)&&UUID.test(value.wbs_controlled_test_bank_import_id||'')&&UUID.test(value.reconciliation_id||'')&&Array.isArray(value.bank_source_ids)&&value.bank_source_ids.length>=1&&value.bank_source_ids.length<=10&&value.bank_source_ids.every(id=>UUID.test(id))&&new Set(value.bank_source_ids).size===value.bank_source_ids.length&&value.bank_account_ref==='WBS_TEST_BANK'&&validDate(value.statement_ending_date)&&Number.isSafeInteger(value.transaction_count)&&value.transaction_count===value.bank_source_ids.length&&value.status==='DRAFT'&&value.provenance_mode==='CONTROLLED_TEST_UNSIGNED'&&value.test_only===true&&typeof value.idempotent==='boolean'?Object.freeze({...value,bank_source_ids:Object.freeze([...value.bank_source_ids])}):null;
const hex=bytes=>[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');

export async function wbsTestImportIdempotencyKey({observationHash,periodId,companyCode,dateFrom,dateTo,cryptoApi=globalThis.crypto}={}){
  if(!SHA256.test(observationHash||'')||!UUID.test(periodId||'')||!wbsScopeText(companyCode,64)||!validDate(dateFrom)||!validDate(dateTo)||dateFrom>dateTo||typeof cryptoApi?.subtle?.digest!=='function')return null;
  const canonical=JSON.stringify([observationHash.toLowerCase(),periodId.toLowerCase(),companyCode,dateFrom,dateTo]);
  try{return `wbs-test-import-${hex(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))}`;}catch{return null;}
}

export async function importAuthoritativeWbsPayablesToTestAccounting({config,observation,periodId=config?.periodId,companyCode,dateFrom,dateTo,limit=10,fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
  const company=typeof companyCode==='string'?companyCode.trim():'';
  if(config?.wbsTestImportMode!=='ENABLED'||typeof fetcher!=='function'||!UUID.test(periodId||'')||!wbsLivePilotObservation(observation,{entityId:config?.entityId,tool:'list_payables',limit:10})||observation.record_count<1||!wbsScopeText(company,64)||!validDate(dateFrom)||!validDate(dateTo)||dateFrom>dateTo||observation.scope.company_codes.length!==1||observation.scope.company_codes[0]!==company||observation.scope.date_range[0]!==dateFrom||observation.scope.date_range[1]!==dateTo||!Number.isSafeInteger(limit)||limit<1||limit>10||limit<observation.record_count)return {ok:false,code:'WBS_TEST_IMPORT_COMMAND_INVALID',message:'Test import requires explicit test-import mode, one successful scoped WBS Payables observation, the configured period, and a stable command identity.'};
  const idempotencyKey=await wbsTestImportIdempotencyKey({observationHash:observation.observation_hash,periodId,companyCode:company,dateFrom,dateTo,cryptoApi});
  if(idempotencyKey===null)return {ok:false,code:'WBS_TEST_IMPORT_COMMAND_INVALID',message:'The browser could not derive the stable test-import command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const body={periodId,companyCode:company,dateFrom,dateTo,limit};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/test-import/payables`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'WBS_TEST_PAYABLE_IMPORT');const contentType=typeof response.headers?.get==='function'?String(response.headers.get('content-type')||'').toLowerCase():'';if(contentType&&!contentType.includes('application/json'))return {ok:false,code:'WBS_TEST_IMPORT_PROTOCOL',message:'The test import endpoint returned a non-JSON response.'};let envelope;try{envelope=await response.json();}catch{return {ok:false,code:'WBS_TEST_IMPORT_PROTOCOL',message:'The test import endpoint returned an unreadable response.'};}const data=wbsTestImportResult(envelope?.data);if(envelope?.ok!==true||data===null)return {ok:false,code:'WBS_TEST_IMPORT_PROTOCOL',message:'The test import endpoint returned an invalid, unbounded, or non-test result.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not run the WBS test import; no HTTP response was produced.');}
}

export async function wbsTestBankImportIdempotencyKey({observationHash,periodId,companyCode,dateFrom,dateTo,limit=10,cryptoApi=globalThis.crypto}={}){
  if(!SHA256.test(observationHash||'')||!UUID.test(periodId||'')||!wbsScopeText(companyCode,64)||!validDate(dateFrom)||!validDate(dateTo)||dateFrom>dateTo||!Number.isSafeInteger(limit)||limit<1||limit>10||typeof cryptoApi?.subtle?.digest!=='function')return null;
  const canonical=JSON.stringify(['BANK',observationHash.toLowerCase(),periodId.toLowerCase(),companyCode,dateFrom,dateTo,limit]);
  try{return `wbs-test-bank-${hex(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))}`;}catch{return null;}
}

export async function importAuthoritativeWbsBankToTestReconciliation({config,observation,periodId=config?.periodId,companyCode,dateFrom,dateTo,limit=10,fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
  const company=typeof companyCode==='string'?companyCode.trim():'';
  if(config?.wbsTestImportMode!=='ENABLED'||typeof fetcher!=='function'||!UUID.test(periodId||'')||!wbsLivePilotObservation(observation,{entityId:config?.entityId,tool:'list_bank_transactions',limit:10})||observation.record_count<1||!wbsScopeText(company,64)||!validDate(dateFrom)||!validDate(dateTo)||dateFrom>dateTo||observation.scope.company_codes.length!==1||observation.scope.company_codes[0]!==company||observation.scope.date_range[0]!==dateFrom||observation.scope.date_range[1]!==dateTo||!Number.isSafeInteger(limit)||limit<1||limit>10||limit<observation.record_count)return {ok:false,code:'WBS_TEST_BANK_IMPORT_COMMAND_INVALID',message:'Bank test import requires explicit test-import mode, one successful scoped WBS Bank observation, the configured period, and a stable command identity.'};
  const idempotencyKey=await wbsTestBankImportIdempotencyKey({observationHash:observation.observation_hash,periodId,companyCode:company,dateFrom,dateTo,limit,cryptoApi});
  if(idempotencyKey===null)return {ok:false,code:'WBS_TEST_BANK_IMPORT_COMMAND_INVALID',message:'The browser could not derive the stable Bank test-import command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const body={periodId,companyCode:company,dateFrom,dateTo,limit};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/test-import/bank-transactions`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'WBS_TEST_BANK_IMPORT');const contentType=typeof response.headers?.get==='function'?String(response.headers.get('content-type')||'').toLowerCase():'';if(contentType&&!contentType.includes('application/json'))return {ok:false,code:'WBS_TEST_BANK_IMPORT_PROTOCOL',message:'The Bank test import endpoint returned a non-JSON response.'};let envelope;try{envelope=await response.json();}catch{return {ok:false,code:'WBS_TEST_BANK_IMPORT_PROTOCOL',message:'The Bank test import endpoint returned an unreadable response.'};}const data=wbsTestBankImportResult(envelope?.data);if(envelope?.ok!==true||data===null)return {ok:false,code:'WBS_TEST_BANK_IMPORT_PROTOCOL',message:'The Bank test import endpoint returned an invalid, unbounded, or non-test result.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not run the WBS Bank test import; no HTTP response was produced.');}
}

const wbsTestMonthImportResult=value=>{
  if(!exactObjectKeys(value,['bank','date_from','date_to','page_size','payables','period_code','status','test_only'])||!['WBS_TEST_MONTH_IMPORT_COMPLETE','WBS_TEST_MONTH_IMPORT_PARTIAL'].includes(value.status)||value.test_only!==true||!/^2026-0[1-6]$/.test(value.period_code||'')||value.date_from!==`${value.period_code}-01`||value.date_to!==new Date(Date.UTC(2026,Number(value.period_code.slice(5,7)),0)).toISOString().slice(0,10)||value.page_size!==10)return null;
  const payable=value.payables,bank=value.bank;
  if(!exactObjectKeys(payable,['h1_record_count','imported_count','posted_count','provider_page_count','record_count','replayed_count'])||!['h1_record_count','imported_count','posted_count','provider_page_count','record_count','replayed_count'].every(field=>Number.isSafeInteger(payable[field])&&payable[field]>=0&&payable[field]<=10000)||payable.provider_page_count>1000||payable.record_count>payable.h1_record_count||payable.posted_count!==payable.imported_count+payable.replayed_count||payable.posted_count!==payable.record_count)return null;
  const reconciliation=bank?.reconciliation;
  const partial=value.status==='WBS_TEST_MONTH_IMPORT_PARTIAL',bankKeys=partial?['bank_source_ids','checkpoint','provider_page_count','reconciliation','record_count']:['bank_source_ids','provider_page_count','reconciliation','record_count'];
  if(!exactObjectKeys(bank,bankKeys)||!Number.isSafeInteger(bank.provider_page_count)||bank.provider_page_count<0||bank.provider_page_count>1000||!Number.isSafeInteger(bank.record_count)||bank.record_count<0||bank.record_count>10000||!Array.isArray(bank.bank_source_ids)||bank.bank_source_ids.some(id=>!UUID.test(id||''))||new Set(bank.bank_source_ids).size!==bank.bank_source_ids.length)return null;
  if(partial){const checkpoint=bank.checkpoint;if(reconciliation!==null||bank.bank_source_ids.length!==0||!exactObjectKeys(checkpoint,['chunk_count','next_chunk_index','stage_id','transaction_count'])||!UUID.test(checkpoint.stage_id||'')||checkpoint.transaction_count!==bank.record_count||!Number.isSafeInteger(checkpoint.chunk_count)||checkpoint.chunk_count!==Math.ceil(bank.record_count/100)||!Number.isSafeInteger(checkpoint.next_chunk_index)||checkpoint.next_chunk_index<1||checkpoint.next_chunk_index>=checkpoint.chunk_count)return null;}
  else if(bank.bank_source_ids.length!==bank.record_count||(bank.record_count===0?reconciliation!==null:!exactObjectKeys(reconciliation,['bank_account_ref','period_code','period_id','reconciliation_id','transaction_count'])||reconciliation.period_code!==value.period_code||reconciliation.bank_account_ref!==`WBS_TEST_BANK_${value.period_code.replace('-','_')}`||!UUID.test(reconciliation.period_id||'')||!UUID.test(reconciliation.reconciliation_id||'')||reconciliation.transaction_count!==bank.record_count))return null;
  return Object.freeze({...value,payables:Object.freeze({...payable}),bank:Object.freeze({...bank,reconciliation:reconciliation&&Object.freeze({...reconciliation}),bank_source_ids:Object.freeze([...bank.bank_source_ids])})});
};

export async function importAuthoritativeWbsTestRange({config,companyCode,dateFrom='2026-01-01',dateTo='2026-06-30',pageSize=10,maxPages=1000,fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
  const company=typeof companyCode==='string'?companyCode.trim():'';
  if(config?.wbsTestImportMode!=='ENABLED'||typeof fetcher!=='function'||!wbsScopeText(company,64)||dateFrom!=='2026-01-01'||dateTo!=='2026-06-30'||pageSize!==10||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>1000||typeof cryptoApi?.subtle?.digest!=='function')return {ok:false,code:'WBS_TEST_RANGE_IMPORT_COMMAND_INVALID',message:'Range import requires TEST_ONLY mode, the exact 2026 H1 WBS scope, and exact ten-row pages bounded to 10,000 rows per monthly source view.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const months=[];for(let month=1;month<=6;month++){const periodCode=`2026-${String(month).padStart(2,'0')}`,monthFrom=`${periodCode}-01`,monthTo=new Date(Date.UTC(2026,month,0)).toISOString().slice(0,10),canonical=JSON.stringify(['MONTH',company,monthFrom,monthTo,pageSize,maxPages]),idempotencyKey=`wbs-test-month-${hex(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))}`,body={companyCode:company,dateFrom:monthFrom,dateTo:monthTo,pageSize,maxPages};let data=null;for(let attempt=0;attempt<5;attempt++){const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/test-import/range`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'WBS_TEST_RANGE_IMPORT');const envelope=await response.json();data=wbsTestMonthImportResult(envelope?.data);if(envelope?.ok!==true||data===null||data.period_code!==periodCode)return {ok:false,code:'WBS_TEST_RANGE_IMPORT_PROTOCOL',message:'The monthly range-import endpoint returned an invalid, mismatched, or non-test result.'};if(data.status==='WBS_TEST_MONTH_IMPORT_COMPLETE')break;}if(data?.status!=='WBS_TEST_MONTH_IMPORT_COMPLETE')return {ok:false,code:'WBS_TEST_RANGE_IMPORT_INCOMPLETE',message:'The monthly Bank stage did not complete within the bounded retry window.'};months.push(data);}const h1Counts=new Set(months.map(row=>`${row.payables.provider_page_count}:${row.payables.h1_record_count}`));if(h1Counts.size!==1)return {ok:false,code:'WBS_TEST_RANGE_IMPORT_PROTOCOL',message:'The six monthly imports did not retain one exact H1 Payables population.'};const sum=(path,field)=>months.reduce((total,row)=>total+row[path][field],0),reconciliations=months.map(row=>row.bank.reconciliation).filter(Boolean),bankSourceIds=months.flatMap(row=>row.bank.bank_source_ids);if(new Set(bankSourceIds).size!==bankSourceIds.length)return {ok:false,code:'WBS_TEST_RANGE_IMPORT_PROTOCOL',message:'The six monthly imports returned duplicate Bank source identities.'};return {ok:true,data:Object.freeze({status:'WBS_TEST_H1_IMPORT_COMPLETE',date_from:dateFrom,date_to:dateTo,page_size:pageSize,payables:Object.freeze({provider_page_count:months[0].payables.provider_page_count,h1_record_count:months[0].payables.h1_record_count,record_count:sum('payables','record_count'),imported_count:sum('payables','imported_count'),replayed_count:sum('payables','replayed_count'),posted_count:sum('payables','posted_count')}),bank:Object.freeze({provider_page_count:sum('bank','provider_page_count'),record_count:sum('bank','record_count'),reconciliations:Object.freeze(reconciliations),bank_source_ids:Object.freeze(bankSourceIds)}),months:Object.freeze(months),test_only:true})};}catch{return unreachable('The browser could not run the six monthly WBS test imports; no HTTP response was produced.');}
}

const controlledTestBankWorkflowResult=value=>{
  const fields=['adjusted_count','cleared_count','idempotent','journal_entry_ids','matched_count','processed_count','provenance_mode','reconciliation_id','revision','snapshot_hash','snapshot_id','status','test_only'];
  if(!exactObjectKeys(value,fields)||value.status!=='CONTROLLED_TEST_BANK_WORKFLOW_REOPENED'||value.test_only!==true||value.provenance_mode!=='CONTROLLED_TEST_UNSIGNED'||typeof value.idempotent!=='boolean'||!UUID.test(value.reconciliation_id||'')||!UUID.test(value.snapshot_id||'')||!SHA256.test(value.snapshot_hash||'')||!['processed_count','matched_count','adjusted_count','cleared_count','revision'].every(field=>Number.isSafeInteger(value[field])&&value[field]>=0)||value.processed_count>10000||value.processed_count!==value.matched_count+value.adjusted_count||value.cleared_count!==value.processed_count||!Array.isArray(value.journal_entry_ids)||value.journal_entry_ids.length!==value.adjusted_count||value.journal_entry_ids.some(id=>!UUID.test(id))||new Set(value.journal_entry_ids).size!==value.journal_entry_ids.length)return null;
  return Object.freeze({...value,journal_entry_ids:Object.freeze([...value.journal_entry_ids])});
};
const controlledTestBankWorkflowPartialResult=value=>{
  const fields=['adjusted_count','cleared_count','idempotent','matched_count','processed_count','provenance_mode','reconciliation_id','remaining_count','revision','status','test_only','total_count'];
  if(!exactObjectKeys(value,fields)||value.status!=='CONTROLLED_TEST_BANK_WORKFLOW_PARTIAL'||value.test_only!==true||value.provenance_mode!=='CONTROLLED_TEST_UNSIGNED'||value.idempotent!==false||!UUID.test(value.reconciliation_id||'')
    ||!['total_count','processed_count','matched_count','adjusted_count','cleared_count','remaining_count','revision'].every(field=>Number.isSafeInteger(value[field])&&value[field]>=0)||value.total_count<1||value.total_count>10000||value.remaining_count<1
    ||value.remaining_count!==value.total_count-value.cleared_count||value.processed_count!==value.matched_count+value.adjusted_count||value.processed_count!==value.cleared_count)return null;
  return Object.freeze({...value});
};
const controlledTestBankRangeWorkflowResult=value=>{
  const fields=['adjusted_count','cleared_count','idempotent','matched_count','processed_count','provenance_mode','results','scope_count','status','test_only'];
  if(!exactObjectKeys(value,fields)||value.status!=='CONTROLLED_TEST_BANK_RANGE_WORKFLOW_REOPENED'||value.test_only!==true||value.provenance_mode!=='CONTROLLED_TEST_UNSIGNED'||typeof value.idempotent!=='boolean'||!Number.isSafeInteger(value.scope_count)||value.scope_count<1||value.scope_count>6||!Array.isArray(value.results)||value.results.length!==value.scope_count)return null;
  const results=value.results.map(controlledTestBankWorkflowResult);if(results.some(result=>result===null)||!['processed_count','matched_count','adjusted_count','cleared_count'].every(field=>Number.isSafeInteger(value[field])&&value[field]>=0&&value[field]<=60000&&value[field]===results.reduce((sum,result)=>sum+result[field],0)))return null;
  return Object.freeze({...value,results:Object.freeze(results)});
};

export async function runAuthoritativeWbsTestBankRangeWorkflow({config,reconciliations,reason='Complete 2026 H1 controlled Bank workflow',fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
  const rows=Array.isArray(reconciliations)?reconciliations:[];
  if(config?.wbsTestImportMode!=='ENABLED'||typeof fetcher!=='function'||rows.length<1||rows.length>6||typeof reason!=='string'||reason!==reason.trim()||reason.length<8||reason.length>1700||typeof cryptoApi?.subtle?.digest!=='function'||rows.some(row=>!row||!/^2026-0[1-6]$/.test(row.period_code||'')||row.bank_account_ref!==`WBS_TEST_BANK_${row.period_code.replace('-','_')}`||!UUID.test(row.period_id||'')||!UUID.test(row.reconciliation_id||''))||new Set(rows.map(row=>row.period_id)).size!==rows.length||new Set(rows.map(row=>row.reconciliation_id)).size!==rows.length)return {ok:false,code:'CONTROLLED_TEST_BANK_SELECTION_INVALID',message:'The Bank workflow requires one to six exact monthly H1 reconciliation scopes from the completed import.'};
  const scopes=rows.map(row=>({periodId:row.period_id,reconciliationId:row.reconciliation_id}));
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const results=[];
    for(const [index,scope] of scopes.entries()){
      let idempotencyKey;try{idempotencyKey=`wbs-test-bank-month-${hex(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['BANK_MONTH_WORKFLOW',scope,reason]))))}`;}catch{return {ok:false,code:'CONTROLLED_TEST_BANK_SELECTION_INVALID',message:'The browser could not derive the stable Bank monthly workflow identity.'};}
      let previousRemaining=Number.POSITIVE_INFINITY,final=null;
      for(let attempt=0;attempt<101;attempt++){
        const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/test-import/bank-workflow/run`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify({...scope,reason,maxItems:100})});
        if(!response.ok)return await failure(response,'CONTROLLED_TEST_BANK_WORKFLOW');
        const envelope=await response.json(),completed=controlledTestBankWorkflowResult(envelope?.data);
        if(envelope?.ok!==true)return {ok:false,code:'CONTROLLED_TEST_BANK_WORKFLOW_PROTOCOL',message:'The Bank monthly workflow returned an invalid envelope.'};
        if(completed){if(completed.reconciliation_id!==scope.reconciliationId)return {ok:false,code:'CONTROLLED_TEST_BANK_WORKFLOW_PROTOCOL',message:'The Bank monthly workflow returned a cross-scope result.'};final=completed;break;}
        const partial=controlledTestBankWorkflowPartialResult(envelope?.data);
        if(!partial||partial.reconciliation_id!==scope.reconciliationId||partial.remaining_count>=previousRemaining)return {ok:false,code:'CONTROLLED_TEST_BANK_WORKFLOW_PROTOCOL',message:'The Bank monthly workflow did not return strictly advancing progress.'};
        previousRemaining=partial.remaining_count;
      }
      if(!final)return {ok:false,code:'CONTROLLED_TEST_BANK_WORKFLOW_INCOMPLETE',message:`The Bank workflow did not complete monthly scope ${index+1} within its bounded retries.`};
      results.push(final);
    }
    const sum=field=>results.reduce((total,result)=>total+result[field],0),data=controlledTestBankRangeWorkflowResult({status:'CONTROLLED_TEST_BANK_RANGE_WORKFLOW_REOPENED',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:results.every(result=>result.idempotent),scope_count:results.length,processed_count:sum('processed_count'),matched_count:sum('matched_count'),adjusted_count:sum('adjusted_count'),cleared_count:sum('cleared_count'),results});
    if(data===null)return {ok:false,code:'CONTROLLED_TEST_BANK_RANGE_WORKFLOW_PROTOCOL',message:'The completed monthly Bank workflows did not form an exact H1 result.'};
    return {ok:true,data};
  }catch{return unreachable('The browser could not run the H1 Bank workflow; no HTTP response was produced.');}
}
const controlledTestBankMatchResult=value=>{
  const fields=['bank_account_ref','bank_match_id','bank_source_id','business_document_id','currency','idempotent','journal_entry_id','journal_line_id','ledger_line_id','payment_amount','payment_occurrence_id','period_id','provenance_mode','revision','status','test_only'];
  if(!exactObjectKeys(value,fields)||value.status!=='CONTROLLED_TEST_BANK_MATCH_ACTIVE'||value.test_only!==true||value.provenance_mode!=='CONTROLLED_TEST_UNSIGNED'||typeof value.idempotent!=='boolean'
    ||value.bank_account_ref!=='WBS_TEST_BANK'||value.currency!=='USD'||!REPORT_MONEY4.test(value.payment_amount||'')||value.payment_amount==='0.0000'||value.revision!==0
    ||!['bank_match_id','bank_source_id','business_document_id','journal_entry_id','journal_line_id','ledger_line_id','payment_occurrence_id','period_id'].every(field=>UUID.test(value[field]||'')))return null;
  return Object.freeze({...value});
};

export async function runAuthoritativeWbsTestBankMatch({config,reason='Create one isolated TEST_ONLY posted-payment Bank Match',fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
  if(config?.wbsTestImportMode!=='ENABLED'||typeof fetcher!=='function'||typeof reason!=='string'||reason!==reason.trim()||reason.length<8||reason.length>1700||typeof cryptoApi?.subtle?.digest!=='function')return {ok:false,code:'CONTROLLED_TEST_BANK_MATCH_SELECTION_INVALID',message:'The isolated Bank Match requires TEST_ONLY mode, one stable entity, and a review reason.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const canonical=JSON.stringify(['CONTROLLED_TEST_BANK_MATCH',config.entityId,reason]),idempotencyKey=`wbs-test-bank-match-${hex(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))}`;
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/test-import/bank-match/run`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:JSON.stringify({reason})});
    if(!response.ok)return await failure(response,'CONTROLLED_TEST_BANK_MATCH');
    const envelope=await response.json(),data=controlledTestBankMatchResult(envelope?.data);
    if(envelope?.ok!==true||data===null)return {ok:false,code:'CONTROLLED_TEST_BANK_MATCH_PROTOCOL',message:'The isolated Bank Match endpoint returned invalid or non-test evidence.'};
    return {ok:true,data};
  }catch{return unreachable('The browser could not run the isolated TEST_ONLY Bank Match; no HTTP response was produced.');}
}

const wbsReviewCandidate=(row,{entityId,companyKey,sourceRecordIds})=>row&&typeof row==='object'&&SHA256.test(row.review_candidate_id||'')&&row.stage==='STAGING_REVIEWED'&&['BANK_SIDE','BUSINESS_SIDE'].includes(row.side)&&wbsScopeText(row.source_type,128)&&row.entity_id===entityId&&row.company_key===companyKey&&sourceRecordIds.includes(row.source_record_id)&&/^[A-Z]{3}$/.test(row.currency||'')&&REPORT_MONEY4.test(row.amount||'')&&validDate(row.business_date)&&validDate(row.accounting_date)&&wbsScopeText(row.bank_account_ref,128)&&wbsScopeText(row.source_record_id)&&wbsScopeText(row.source_version)&&wbsScopeText(row.raw_event_id)&&wbsScopeText(row.source_document_id)&&wbsScopeText(row.staging_item_id)&&row.mapping&&wbsScopeText(row.mapping.mapping_id)&&wbsScopeText(row.mapping.version)&&SHA256.test(row.mapping.snapshot_hash||'')&&wbsEvidenceIsReadOnly(row);
const wbsReviewEvidence=(value,scope)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||value.can_dispatch!==false||value.can_create_draft!==false||value.can_post!==false||!Array.isArray(value.candidates)||!Array.isArray(value.exceptions)||!wbsEvidenceIsReadOnly(value))return false;
  if(value.status==='BLOCKED')return wbsScopeText(value.code,128)&&value.candidates.length===0;
  return value.status==='READ_ONLY_PROJECTED'&&SHA256.test(value.request_hash||'')&&typeof value.replayed==='boolean'&&value.candidates.every(row=>wbsReviewCandidate(row,scope))&&new Set(value.candidates.map(row=>row.review_candidate_id)).size===value.candidates.length&&Array.isArray(value.review_plans)&&Array.isArray(value.observed_state_evidence);
};
// The authenticated API binds tenant scope from the verified OIDC principal.
// The browser can independently bind every configured/entity/business key and
// reject extra scope fields, but it must not learn or invent another tenant.
const exactWbsControlScope=(actual,expected)=>actual&&UUID.test(actual.tenant_id||'')&&Object.keys(actual).sort().join('\u0000')===['tenant_id',...Object.keys(expected)].sort().join('\u0000')&&Object.keys(expected).every(key=>actual[key]===expected[key]);
const wbsControlEvidence=(value,{sourceType,scope})=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||value.can_create_transaction!==false||value.can_allocate!==false||value.can_create_draft!==false||value.can_post!==false||!wbsEvidenceIsReadOnly(value))return false;
  if(value.status==='BLOCKED')return wbsScopeText(value.code,128)&&Array.isArray(value.comparisons)&&value.comparisons.length===0;
  const reconciliation=value.reconciliation;
  if(!['READ_ONLY_CONTROL_RECONCILED','READ_ONLY_CONTROL_DIFFERENCE'].includes(value.status)||!SHA256.test(value.request_hash||'')||typeof value.replayed!=='boolean'||!reconciliation||reconciliation.source_type!==sourceType||!exactWbsControlScope(reconciliation.scope,scope)||!Array.isArray(reconciliation.comparisons)||!reconciliation.control_totals||!wbsEvidenceIsReadOnly(reconciliation)||!value.trace)return false;
  const totals=reconciliation.control_totals;
  return Number.isSafeInteger(totals.metric_count)&&totals.metric_count===reconciliation.comparisons.length&&Number.isSafeInteger(totals.difference_count)&&totals.difference_count>=0&&totals.difference_count<=totals.metric_count&&['source_total','target_total','difference_total'].every(field=>REPORT_MONEY4.test(totals[field]||''))&&reconciliation.comparisons.every(row=>row&&wbsScopeText(row.metric_key,96)&&['source_amount','target_amount','difference'].every(field=>REPORT_MONEY4.test(row[field]||''))&&typeof row.matched==='boolean');
};

export async function refreshAuthoritativeWbsAutoRecReview({config,companyKey,sourceRecordIds,fetcher=globalThis.fetch}={}){
  const company=typeof companyKey==='string'?companyKey.trim():'';
  const sources=Array.isArray(sourceRecordIds)?[...new Set(sourceRecordIds.map(value=>typeof value==='string'?value.trim():'').filter(Boolean))]:[];
  if(!config||typeof fetcher!=='function'||!wbsScopeText(company,128)||sources.length<1||sources.length>50||sources.some(value=>!wbsScopeText(value)))return {ok:false,code:'WBS_AUTOREC_SCOPE_INVALID',message:'WBS AutoRec review requires one company key and one to 50 immutable source record IDs.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const params=new URLSearchParams({companyKey:company});for(const source of sources)params.append('sourceRecordId',source);
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/auto-reconciliation/review-candidates?${params}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'WBS_AUTOREC_REVIEW_EVIDENCE');const body=await response.json();const scope={entityId:config.entityId,companyKey:company,sourceRecordIds:sources};if(body?.ok!==true||!wbsReviewEvidence(body.data,scope))return {ok:false,code:'WBS_AUTOREC_REVIEW_PROTOCOL',message:'The accounting API returned invalid, cross-scope, or action-enabled WBS AutoRec review evidence.'};return {ok:true,data:body.data,scope};}catch{return unreachable('The browser could not read persisted WBS AutoRec review evidence; no HTTP response was produced.');}
}

const INSURANCE_AMORTIZATION_FIELDS=['ai_amortization_schedule_id','ai_amortization_schedule_line_id','source_document_id','source_payload_hash','source_document_version','wbs_provider_signed_payable_admission_id','ai_amortization_coverage_evidence_id','coverage_hash','proposal_hash','period_id','period_status','amortization_month','amount','currency','prepaid_account_code','expense_account_code','amortization_setting_snapshot_id','amortization_setting_snapshot_hash','prepaid_mapping_snapshot_id','prepaid_mapping_snapshot_hash','capitalization_journal_entry_id','capitalization_journal_line_id','capitalization_ledger_line_id','insurance_prepaid_amortization_review_id','review_evidence_hash','reviewed_by','reviewed_at','insurance_prepaid_amortization_draft_evidence_id','draft_evidence_hash','journal_entry_id','journal_status','journal_revision','derived_source_document_id','draft_created_by','draft_created_at','readiness_status','blocked_reasons','can_independently_review','can_create_draft','can_submit','can_approve','can_post'];
const INSURANCE_AMORTIZATION_BLOCKERS=new Set(['SIGNED_ADMISSION_MISSING','COVERAGE_EVIDENCE_MISSING','APPROVED_MONTHLY_SETTING_MISSING','APPROVED_INSURANCE_PREPAID_MAPPING_MISSING','POSTED_CAPITALIZATION_MISSING','SOURCE_OR_PROPOSAL_CHAIN_MISMATCH','PERIOD_NOT_OPEN','REVIEWED_CHAIN_NOT_DRAFT_READY']);
const nullOrUuid=value=>value===null||UUID.test(value||'');
const nullOrHash=value=>value===null||SHA256.test(value||'');
const nullOrTimestamp=value=>value===null||validTimestamp(value);
const insuranceAmortizationEvidence=row=>{
  if(!exactObjectKeys(row,INSURANCE_AMORTIZATION_FIELDS)||!UUID.test(row.ai_amortization_schedule_id||'')||!UUID.test(row.ai_amortization_schedule_line_id||'')||!UUID.test(row.source_document_id||'')||!SHA256.test(row.source_payload_hash||'')||!SHA256.test(row.proposal_hash||'')||!UUID.test(row.period_id||'')||!['OPEN','CLOSED'].includes(row.period_status)||!validDate(row.amortization_month)||!/^[0-9]+\.[0-9]{4}$/.test(String(row.amount??''))||row.amount==='0.0000'||!/^[A-Z]{3}$/.test(row.currency||'')||!ACCOUNT_CODE.test(row.prepaid_account_code||'')||!ACCOUNT_CODE.test(row.expense_account_code||'')||row.prepaid_account_code===row.expense_account_code)return null;
  const version=Number(row.source_document_version),revision=row.journal_revision===null?null:Number(row.journal_revision);
  if(!UNSIGNED_INTEGER.test(String(row.source_document_version??''))||!Number.isSafeInteger(version)||version<0||revision!==null&&(!UNSIGNED_INTEGER.test(String(row.journal_revision))||!Number.isSafeInteger(revision)||revision<0))return null;
  if(![row.wbs_provider_signed_payable_admission_id,row.ai_amortization_coverage_evidence_id,row.amortization_setting_snapshot_id,row.prepaid_mapping_snapshot_id,row.capitalization_journal_entry_id,row.capitalization_journal_line_id,row.capitalization_ledger_line_id,row.insurance_prepaid_amortization_review_id,row.insurance_prepaid_amortization_draft_evidence_id,row.journal_entry_id,row.derived_source_document_id].every(nullOrUuid)||![row.coverage_hash,row.amortization_setting_snapshot_hash,row.prepaid_mapping_snapshot_hash,row.review_evidence_hash,row.draft_evidence_hash].every(nullOrHash)||![row.reviewed_at,row.draft_created_at].every(nullOrTimestamp))return null;
  if(!Array.isArray(row.blocked_reasons)||new Set(row.blocked_reasons).size!==row.blocked_reasons.length||row.blocked_reasons.some(reason=>!INSURANCE_AMORTIZATION_BLOCKERS.has(reason))||!['READY_FOR_INDEPENDENT_REVIEW','INDEPENDENTLY_REVIEWED','DRAFT_CREATED','REVIEWED_BLOCKED','BLOCKED'].includes(row.readiness_status)||typeof row.can_independently_review!=='boolean'||typeof row.can_create_draft!=='boolean'||row.can_submit!==false||row.can_approve!==false||row.can_post!==false)return null;
  const coverageComplete=(row.ai_amortization_coverage_evidence_id===null)===(row.coverage_hash===null),settingComplete=(row.amortization_setting_snapshot_id===null)===(row.amortization_setting_snapshot_hash===null),mappingComplete=(row.prepaid_mapping_snapshot_id===null)===(row.prepaid_mapping_snapshot_hash===null),capitalizationComplete=[row.capitalization_journal_entry_id,row.capitalization_journal_line_id,row.capitalization_ledger_line_id].every(Boolean)||[row.capitalization_journal_entry_id,row.capitalization_journal_line_id,row.capitalization_ledger_line_id].every(value=>value===null);
  const reviewed=row.insurance_prepaid_amortization_review_id!==null,drafted=row.insurance_prepaid_amortization_draft_evidence_id!==null;
  if(!coverageComplete||!settingComplete||!mappingComplete||!capitalizationComplete||reviewed!==Boolean(row.review_evidence_hash&&row.reviewed_by&&row.reviewed_at)||drafted!==Boolean(row.draft_evidence_hash&&row.journal_entry_id&&row.derived_source_document_id&&row.draft_created_by&&row.draft_created_at)||drafted&&!reviewed||row.can_independently_review&&row.readiness_status!=='READY_FOR_INDEPENDENT_REVIEW'||row.can_create_draft&&row.readiness_status!=='INDEPENDENTLY_REVIEWED')return null;
  if(row.readiness_status==='READY_FOR_INDEPENDENT_REVIEW'&&(reviewed||drafted||row.blocked_reasons.length)||row.readiness_status==='INDEPENDENTLY_REVIEWED'&&(!reviewed||drafted||row.blocked_reasons.length)||row.readiness_status==='DRAFT_CREATED'&&(!drafted||!['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED'].includes(row.journal_status)||revision===null))return null;
  if(!drafted&&(row.journal_status!==null||row.journal_revision!==null))return null;
  return Object.freeze({...row,source_document_version:version,journal_revision:revision,amount:String(row.amount),blocked_reasons:Object.freeze([...row.blocked_reasons])});
};

export async function refreshAuthoritativeInsurancePrepaidAmortization({config,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>100)return {ok:false,code:'INSURANCE_AMORTIZATION_SCOPE_INVALID',message:'Insurance amortization evidence requires one authoritative entity, period, and a limit from 1 to 100.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const query=new URLSearchParams({periodId:config.periodId,limit:String(limit)});
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/prepaid/amortization?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'INSURANCE_AMORTIZATION_READ');const body=await response.json();if(body?.ok!==true||!Array.isArray(body.data))return {ok:false,code:'INSURANCE_AMORTIZATION_PROTOCOL',message:'The accounting API returned an invalid insurance amortization envelope.'};const rows=body.data.map(insuranceAmortizationEvidence);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.ai_amortization_schedule_line_id)).size!==rows.length||rows.some(row=>row.period_id!==config.periodId))return {ok:false,code:'INSURANCE_AMORTIZATION_PROTOCOL',message:'The accounting API returned duplicate, cross-period, malformed, or action-inconsistent insurance amortization evidence.'};return {ok:true,rows,scope:{entityId:config.entityId,periodId:config.periodId}};}catch{return unreachable('The browser could not read authoritative insurance amortization evidence; no HTTP response was produced.');}
}

const validInsuranceCommand=(config,evidence,reason,idempotencyKey)=>config&&evidence&&typeof reason==='string'&&reason===reason.trim()&&reason.length>=8&&reason.length<=2000&&!/[\u0000-\u001f\u007f]/.test(reason)&&typeof idempotencyKey==='string'&&idempotencyKey.length>=8&&idempotencyKey.length<=200;

export async function reviewAuthoritativeInsurancePrepaidAmortization({config,evidence,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  if(typeof fetcher!=='function'||!validInsuranceCommand(config,evidence,reason,idempotencyKey)||evidence.period_id!==config.periodId||evidence.readiness_status!=='READY_FOR_INDEPENDENT_REVIEW'||evidence.can_independently_review!==true)return {ok:false,code:'INSURANCE_AMORTIZATION_REVIEW_INVALID',message:'Independent review requires one exact ready, entity-period-scoped evidence row and a canonical reason.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const body={admissionId:evidence.wbs_provider_signed_payable_admission_id,scheduleId:evidence.ai_amortization_schedule_id,scheduleLineId:evidence.ai_amortization_schedule_line_id,periodId:evidence.period_id,settingSnapshotId:evidence.amortization_setting_snapshot_id,mappingSnapshotId:evidence.prepaid_mapping_snapshot_id,capitalizationJournalEntryId:evidence.capitalization_journal_entry_id,capitalizationLedgerLineId:evidence.capitalization_ledger_line_id,expectedSourceHash:evidence.source_payload_hash,expectedProposalHash:evidence.proposal_hash,expectedCoverageHash:evidence.coverage_hash,reason};
  if(Object.values(body).some(value=>value===null||value===undefined))return {ok:false,code:'INSURANCE_AMORTIZATION_REVIEW_INVALID',message:'Independent review requires every exact retained ID and hash.'};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/prepaid/amortization/reviews`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,'if-match':`"${evidence.source_document_version}"`,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'INSURANCE_AMORTIZATION_REVIEW');const envelope=await response.json(),data=envelope?.data;if(envelope?.ok!==true||!data||data.status!=='INDEPENDENTLY_REVIEWED'||!UUID.test(data.insurance_prepaid_amortization_review_id||'')||data.source_document_id!==evidence.source_document_id||data.schedule_line_id!==evidence.ai_amortization_schedule_line_id||data.period_id!==config.periodId||!MONEY4.test(String(data.amount??''))||!SHA256.test(data.evidence_hash||'')||['can_create_draft','can_submit','can_approve','can_post'].some(field=>data[field]!==false))return {ok:false,code:'INSURANCE_AMORTIZATION_REVIEW_PROTOCOL',message:'The accounting API returned an invalid independent review receipt.'};return {ok:true,data:{...data,amount:String(data.amount)},idempotent:response.status===200};}catch{return unreachable('The browser could not complete the independent insurance amortization review; no HTTP response was produced.');}
}

export async function createAuthoritativeInsuranceAmortizationDraft({config,evidence,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  if(typeof fetcher!=='function'||!validInsuranceCommand(config,evidence,reason,idempotencyKey)||evidence.period_id!==config.periodId||evidence.readiness_status!=='INDEPENDENTLY_REVIEWED'||evidence.can_create_draft!==true||!UUID.test(evidence.insurance_prepaid_amortization_review_id||'')||!SHA256.test(evidence.review_evidence_hash||''))return {ok:false,code:'INSURANCE_AMORTIZATION_DRAFT_INVALID',message:'Draft creation requires exact independently reviewed evidence, separate maker authority, and a canonical reason.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/prepaid/amortization/reviews/${evidence.insurance_prepaid_amortization_review_id}/drafts`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,'if-match':'"0"',...authorization},body:JSON.stringify({expectedEvidenceHash:evidence.review_evidence_hash,reason})});if(!response.ok)return await failure(response,'INSURANCE_AMORTIZATION_DRAFT');const envelope=await response.json(),data=envelope?.data;if(envelope?.ok!==true||!data||data.status!=='DRAFT'||data.journal_type!=='AUTO'||data.revision!==0||data.insurance_prepaid_amortization_review_id!==evidence.insurance_prepaid_amortization_review_id||data.source_document_id!==evidence.source_document_id||!UUID.test(data.insurance_prepaid_amortization_draft_evidence_id||'')||!UUID.test(data.derived_source_document_id||'')||!UUID.test(data.derived_staging_item_id||'')||!UUID.test(data.journal_entry_id||'')||!MONEY4.test(String(data.amount??''))||!SHA256.test(data.evidence_hash||'')||['can_create_draft','can_submit','can_review','can_approve','can_post'].some(field=>data[field]!==false))return {ok:false,code:'INSURANCE_AMORTIZATION_DRAFT_PROTOCOL',message:'The accounting API returned an invalid or action-enabled amortization Draft receipt.'};return {ok:true,data:{...data,amount:String(data.amount)},idempotent:response.status===200};}catch{return unreachable('The browser could not create the reviewed monthly amortization Draft; no HTTP response was produced.');}
}

const wbsAutoRecMatchReview=(value,{entityId,reviewId})=>value&&typeof value==='object'&&!Array.isArray(value)&&value.entity_id===entityId&&value.wbs_autorec_match_review_id===reviewId&&UUID.test(value.tenant_id||'')&&UUID.test(value.bank_match_id||'')&&SHA256.test(value.review_candidate_id||'')&&SHA256.test(value.candidate_hash||'')&&SHA256.test(value.evidence_hash||'')&&UUID.test(value.candidate_execution_receipt_id||'')&&Number.isSafeInteger(value.candidate_execution_version)&&value.candidate_execution_version>=1&&Number.isSafeInteger(value.bank_match_revision)&&value.bank_match_revision>=0&&['ACCEPTED','REJECTED'].includes(value.decision)&&wbsScopeText(value.decision_reason,2000)&&wbsScopeText(value.candidate_prepared_by,200)&&wbsScopeText(value.matched_by,200)&&wbsScopeText(value.reviewed_by,200)&&validTimestamp(value.reviewed_at)&&typeof value.sod_verified==='boolean'&&typeof value.g11_linked==='boolean'&&typeof value.incurred==='boolean'&&value.g11_linked===value.incurred;

export async function refreshAuthoritativeWbsAutoRecMatchReview({config,reviewId,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(reviewId||''))return {ok:false,code:'WBS_AUTOREC_MATCH_REVIEW_SCOPE_INVALID',message:'AutoRec Match Review evidence requires one authoritative entity and review ID.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/auto-reconciliation/match-reviews/${reviewId}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'WBS_AUTOREC_MATCH_REVIEW');const body=await response.json();if(body?.ok!==true||!wbsAutoRecMatchReview(body.data,{entityId:config.entityId,reviewId}))return {ok:false,code:'WBS_AUTOREC_MATCH_REVIEW_PROTOCOL',message:'The accounting API returned invalid or cross-scope AutoRec Match Review evidence.'};return {ok:true,data:body.data};}catch{return unreachable('The browser could not read persisted AutoRec Match Review evidence; no HTTP response was produced.');}
}

const wbsAutoRecG11Evidence=(value,{entityId,reviewId})=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||value.g11_linked!==true||value.incurred!==true||!wbsAutoRecMatchReview({...value.review,g11_linked:true,incurred:true},{entityId,reviewId})||!value.completion||!value.released_candidate||!value.incur_event||!Array.isArray(value.accounting_events)||!Array.isArray(value.lines)||value.accounting_events.length!==2||value.lines.length!==4)return false;
  const completion=value.completion,candidate=value.released_candidate,incur=value.incur_event;
  if(completion.wbs_autorec_match_review_id!==reviewId||completion.entity_id!==entityId||!UUID.test(completion.wbs_autorec_g11_completion_id||'')||!SHA256.test(completion.evidence_hash||'')||!REPORT_MONEY4.test(candidate.allocated_amount||'')||incur.command!=='INCUR'||incur.current_state!=='RELEASED'||incur.next_state!=='INCURRED')return false;
  const events=new Map(value.accounting_events.map(row=>[row.event_type,row]));
  if(events.size!==2||!events.has('PAYABLE_INCUR')||!events.has('AUTOC')||new Set(value.accounting_events.map(row=>row.accounting_event_id)).size!==2||!value.accounting_events.every(row=>UUID.test(row.accounting_event_id||'')&&REPORT_MONEY4.test(row.amount||'')&&SHA256.test(row.evidence_hash||'')))return false;
  const combinations=new Set(value.lines.map(row=>`${row.event_type}:${row.line_role}`)),journals=new Map();
  if(combinations.size!==4||!['PAYABLE_INCUR:CLEARING','PAYABLE_INCUR:OFFSET','AUTOC:CLEARING','AUTOC:OFFSET'].every(key=>combinations.has(key))||new Set(value.lines.map(row=>row.ledger_line_id)).size!==4)return false;
  for(const row of value.lines){if(row.accounting_event_id!==events.get(row.event_type)?.accounting_event_id||!UUID.test(row.journal_entry_id||'')||!UUID.test(row.journal_line_id||'')||!UUID.test(row.ledger_line_id||'')||!REPORT_MONEY4.test(row.debit_amount||'')||!REPORT_MONEY4.test(row.credit_amount||'')||!wbsScopeText(row.account_code,64))return false;if(journals.has(row.event_type)&&journals.get(row.event_type)!==row.journal_entry_id)return false;journals.set(row.event_type,row.journal_entry_id);}
  return journals.size===2&&new Set(journals.values()).size===2;
};

export async function refreshAuthoritativeWbsAutoRecG11Evidence({config,reviewId,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(reviewId||''))return {ok:false,code:'WBS_AUTOREC_G11_SCOPE_INVALID',message:'G11 evidence requires one authoritative entity and Match Review ID.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/auto-reconciliation/match-reviews/${reviewId}/g11-evidence`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'WBS_AUTOREC_G11_EVIDENCE');const body=await response.json();if(body?.ok!==true||!wbsAutoRecG11Evidence(body.data,{entityId:config.entityId,reviewId}))return {ok:false,code:'WBS_AUTOREC_G11_PROTOCOL',message:'The accounting API returned incomplete, non-MONEY4, or cross-scope G11 evidence.'};return {ok:true,data:body.data};}catch{return unreachable('The browser could not read persisted G11 evidence; no HTTP response was produced.');}
}

const WBS_PAYABLE_READINESS=new Set(['READY_FOR_AP_DRAFT','ALREADY_DRAFTED','MAKER_PERMISSION_REQUIRED','MAKER_REVIEWER_SOD','PERIOD_NOT_OPEN','ATTACHMENT_EVIDENCE_CHANGED','EVIDENCE_REVALIDATION_FAILED']);
const WBS_PAYABLE_REVIEW_READINESS=new Set(['ALREADY_REVIEWED','ENTITY_SCOPE_MISMATCH','PAYABLE_FACTS_INCOMPLETE','OPEN_PERIOD_REQUIRED','APPROVED_SETTING_REQUIRED','APPROVED_MAPPING_REQUIRED','MAPPING_SCOPE_MISMATCH','LOCAL_MASTER_DATA_REQUIRED','REVIEWER_SOD_BLOCKED','VERIFIED_ATTACHMENT_REQUIRED','READY_FOR_REVIEW']);
const WBS_PAYABLE_REVIEW_CANDIDATE_FIELDS=['wbs_inbound_row_id','source_version','receipt_hash','evidence_hash','revision','period_id','document_number','invoice_date','due_date','accounting_date','currency','gross_amount','vendor_name','offset_account_code','setting_snapshot_id','mapping_snapshot_id','attachment_choices','review_readiness','can_review'];
const wbsPayableReviewCandidateRow=row=>{
  if(!exactObjectKeys(row,WBS_PAYABLE_REVIEW_CANDIDATE_FIELDS)||!UUID.test(row.wbs_inbound_row_id||'')||!TEXT_TOKEN.test(row.source_version||'')||!SHA256.test(row.receipt_hash||'')||!SHA256.test(row.evidence_hash||'')||!UNSIGNED_INTEGER.test(String(row.revision??''))||!WBS_PAYABLE_REVIEW_READINESS.has(row.review_readiness)||typeof row.can_review!=='boolean'||!Array.isArray(row.attachment_choices)||row.attachment_choices.length>25)return null;
  const revision=Number(row.revision),choices=[];
  for(const choice of row.attachment_choices){if(!exactObjectKeys(choice,['attachment_id','name','media_type','verified_at'])||!UUID.test(choice.attachment_id||'')||!TEXT_TOKEN.test(choice.name||'')||!TEXT_TOKEN.test(choice.media_type||'')||!validTimestamp(choice.verified_at))return null;choices.push({...choice});}
  if(!Number.isSafeInteger(revision)||revision<0||new Set(choices.map(choice=>choice.attachment_id)).size!==choices.length)return null;
  const ready=row.review_readiness==='READY_FOR_REVIEW';
  if(row.can_review!==ready)return null;
  if(ready&&(!UUID.test(row.period_id||'')||!validDate(row.invoice_date)||row.due_date!==null&&!validDate(row.due_date)||row.due_date!==null&&row.due_date<row.invoice_date||!validDate(row.accounting_date)||!CURRENCY3.test(row.currency||'')||!MONEY4.test(String(row.gross_amount??''))||!TEXT_TOKEN.test(row.vendor_name||'')||!ACCOUNT_CODE.test(row.offset_account_code||'')||!UUID.test(row.setting_snapshot_id||'')||!UUID.test(row.mapping_snapshot_id||'')||choices.length<1))return null;
  if(!ready&&(!nullableUuid(row.period_id)||row.document_number!==null&&row.document_number!==undefined&&!TEXT_TOKEN.test(row.document_number)||row.invoice_date!==null&&row.invoice_date!==undefined&&!validDate(row.invoice_date)||row.due_date!==null&&row.due_date!==undefined&&!validDate(row.due_date)||row.accounting_date!==null&&row.accounting_date!==undefined&&!validDate(row.accounting_date)||row.currency!==null&&row.currency!==undefined&&!CURRENCY3.test(row.currency)||row.gross_amount!==null&&row.gross_amount!==undefined&&!MONEY4.test(String(row.gross_amount))||row.vendor_name!==null&&row.vendor_name!==undefined&&!TEXT_TOKEN.test(row.vendor_name)||row.offset_account_code!==null&&row.offset_account_code!==undefined&&!ACCOUNT_CODE.test(row.offset_account_code)||!nullableUuid(row.setting_snapshot_id)||!nullableUuid(row.mapping_snapshot_id)))return null;
  return {...row,revision,gross_amount:row.gross_amount===null||row.gross_amount===undefined?null:String(row.gross_amount),attachment_choices:choices};
};

export async function refreshAuthoritativeWbsPayableReviewCandidates({config,wbsInboundRowId=null,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||wbsInboundRowId!==null&&!UUID.test(wbsInboundRowId)||!Number.isSafeInteger(limit)||limit<1||limit>50)return {ok:false,code:'WBS_PAYABLE_REVIEW_CANDIDATE_SCOPE_INVALID',message:'WBS Payable review candidates require one authoritative entity, optional row ID, and a limit from 1 to 50.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const suffix=wbsInboundRowId?`/${wbsInboundRowId}`:`?limit=${limit}`;
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/inbound/payables/review-candidates${suffix}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'WBS_PAYABLE_REVIEW_CANDIDATE');const body=await response.json();const values=wbsInboundRowId?[body?.data]:body?.data;if(body?.ok!==true||!Array.isArray(values)||wbsInboundRowId&&values[0]===undefined)return {ok:false,code:'WBS_PAYABLE_REVIEW_CANDIDATE_PROTOCOL',message:'The accounting API returned an invalid WBS Payable review-candidate envelope.'};const rows=values.map(wbsPayableReviewCandidateRow);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.wbs_inbound_row_id)).size!==rows.length)return {ok:false,code:'WBS_PAYABLE_REVIEW_CANDIDATE_PROTOCOL',message:'The accounting API returned invalid, duplicate, raw, or action-enabled WBS Payable review candidates.'};return wbsInboundRowId?{ok:true,row:rows[0]}:{ok:true,rows};}catch{return unreachable('The browser could not read admitted WBS Payable review candidates; no HTTP response was produced.');}
}

const wbsPayableAttachmentUploadState=value=>{
  if(!value||!exactObjectKeys(value,['entity_id','wbs_inbound_row_id','can_upload','can_bind','attachments'])||!UUID.test(value.entity_id||'')||!UUID.test(value.wbs_inbound_row_id||'')||typeof value.can_upload!=='boolean'||typeof value.can_bind!=='boolean'||!Array.isArray(value.attachments)||value.attachments.length>25)return null;
  const rows=[];for(const row of value.attachments){if(!exactObjectKeys(row,['attachment_id','name','media_type','status','verified_at','can_bind'])||!UUID.test(row.attachment_id||'')||!TEXT_TOKEN.test(row.name||'')||!TEXT_TOKEN.test(row.media_type||'')||!['PENDING','VERIFIED_CLEAN','REJECTED','BOUND'].includes(row.status)||row.verified_at!==null&&!validTimestamp(row.verified_at)||typeof row.can_bind!=='boolean'||row.can_bind&&(!value.can_bind||row.status!=='VERIFIED_CLEAN'))return null;rows.push({...row});}
  if(new Set(rows.map(row=>row.attachment_id)).size!==rows.length)return null;return {...value,attachments:rows};
};

export async function refreshAuthoritativeWbsPayableAttachmentUploads({config,wbsInboundRowId,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!UUID.test(wbsInboundRowId||''))return {ok:false,code:'WBS_PAYABLE_ATTACHMENT_SCOPE_INVALID',message:'Attachment status requires one authoritative WBS Payable row.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/inbound/payables/${wbsInboundRowId}/attachments/uploads`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'WBS_PAYABLE_ATTACHMENT_UPLOAD');const body=await response.json(),data=wbsPayableAttachmentUploadState(body?.data);if(body?.ok!==true||!data||data.entity_id!==config.entityId||data.wbs_inbound_row_id!==wbsInboundRowId)return {ok:false,code:'WBS_PAYABLE_ATTACHMENT_UPLOAD_PROTOCOL',message:'The accounting API returned invalid or cross-scope row-bound attachment status.'};return {ok:true,data};}catch{return unreachable('The browser could not read row-bound attachment status; no HTTP response was produced.');}
}

export async function bindAuthoritativeWbsPayableUploadedAttachment({config,candidate,attachmentId,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  const approvedReason=typeof reason==='string'?reason.trim():'';
  if(!config||typeof fetcher!=='function'||!candidate||!UUID.test(candidate.wbs_inbound_row_id||'')||!Number.isSafeInteger(candidate.revision)||!UUID.test(attachmentId||'')||approvedReason.length<8||approvedReason.length>2000||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'WBS_PAYABLE_ATTACHMENT_BIND_INVALID',message:'Binding requires one server-listed attachment, candidate revision, reason, and stable command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/inbound/payables/${candidate.wbs_inbound_row_id}/attachments/bindings/from-upload`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,'if-match':`"${candidate.revision}"`,...authorization},body:JSON.stringify({attachmentId,reason:approvedReason})});if(!response.ok)return await failure(response,'WBS_PAYABLE_ATTACHMENT_BIND');const body=await response.json(),data=body?.data;if(body?.ok!==true||!data||data.status!=='BOUND_EVIDENCE_ONLY'||data.wbs_inbound_row_id!==candidate.wbs_inbound_row_id||data.attachment_id!==attachmentId||['can_review','can_create_draft','can_approve','can_post'].some(field=>data[field]!==false))return {ok:false,code:'WBS_PAYABLE_ATTACHMENT_BIND_PROTOCOL',message:'The accounting API returned invalid or action-enabled binding evidence.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not bind the row-scoped attachment; no HTTP response was produced.');}
}

export async function reviewAuthoritativeWbsPayable({config,candidate,attachmentIds,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  const approvedReason=typeof reason==='string'?reason.trim():'',selected=Array.isArray(attachmentIds)?[...attachmentIds]:[];
  if(!config||typeof fetcher!=='function'||!candidate||candidate.can_review!==true||candidate.review_readiness!=='READY_FOR_REVIEW'||!UUID.test(candidate.wbs_inbound_row_id||'')||!Number.isSafeInteger(candidate.revision)||!UUID.test(candidate.period_id||'')||!TEXT_TOKEN.test(candidate.source_version||'')||!SHA256.test(candidate.receipt_hash||'')||!SHA256.test(candidate.evidence_hash||'')||!UUID.test(candidate.setting_snapshot_id||'')||!UUID.test(candidate.mapping_snapshot_id||'')||selected.length<1||selected.length>25||selected.some(id=>!UUID.test(id||''))||new Set(selected).size!==selected.length||selected.some(id=>!candidate.attachment_choices.some(choice=>choice.attachment_id===id))||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200||approvedReason.length<8||approvedReason.length>2000)return {ok:false,code:'WBS_PAYABLE_REVIEW_COMMAND_INVALID',message:'Review requires one server-derived ready candidate, selected verified attachments, reviewer reason, CAS revision, and stable command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const body={periodId:candidate.period_id,expectedSourceVersion:candidate.source_version,expectedReceiptHash:candidate.receipt_hash,expectedEvidenceHash:candidate.evidence_hash,settingSnapshotId:candidate.setting_snapshot_id,mappingSnapshotId:candidate.mapping_snapshot_id,attachmentIds:selected,reason:approvedReason};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/inbound/payables/${candidate.wbs_inbound_row_id}/reviews`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,'if-match':`"${candidate.revision}"`,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'WBS_PAYABLE_REVIEW');const result=await response.json(),data=result?.data;if(result?.ok!==true||!data||data.status!=='READY_FOR_DRAFT_EVIDENCE_ONLY'||data.revision!==0||['can_create_draft','can_approve','can_post'].some(field=>data[field]!==false)||!UUID.test(data.wbs_payable_review_evidence_id||'')||data.wbs_inbound_row_id!==candidate.wbs_inbound_row_id)return {ok:false,code:'WBS_PAYABLE_REVIEW_PROTOCOL',message:'The accounting API returned an invalid or action-enabled WBS Payable review result.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not review the admitted WBS Payable candidate; no HTTP response was produced.');}
}

const wbsPayableReviewEvidenceRow=row=>{
  if(!row||!UUID.test(row.wbs_payable_review_evidence_id||'')||!UUID.test(row.wbs_inbound_row_id||'')||!UUID.test(row.source_document_id||'')||!UUID.test(row.staging_item_id||'')||!UUID.test(row.period_id||'')||!TEXT_TOKEN.test(row.document_number||'')||!validDate(row.invoice_date)||row.due_date!==null&&!validDate(row.due_date)||row.due_date!==null&&row.due_date<row.invoice_date||!validDate(row.accounting_date)||!CURRENCY3.test(row.currency||'')||!MONEY4.test(String(row.gross_amount??''))||!TEXT_TOKEN.test(row.vendor_ref||'')||!TEXT_TOKEN.test(row.vendor_name||'')||!ACCOUNT_CODE.test(row.offset_account_code||'')||!UUID.test(row.mapping_snapshot_id||'')||!Array.isArray(row.attachment_ids)||!row.attachment_ids.length||row.attachment_ids.length>25||row.attachment_ids.some(id=>!UUID.test(id||''))||new Set(row.attachment_ids).size!==row.attachment_ids.length||!SHA256.test(row.evidence_hash||'')||typeof row.review_reason!=='string'||row.review_reason.length<8||row.review_reason.length>2000||!TEXT_TOKEN.test(row.reviewed_by||'')||!validTimestamp(row.reviewed_at)||!UNSIGNED_INTEGER.test(String(row.revision??''))||!['READY_FOR_DRAFT_EVIDENCE_ONLY','DRAFT_CREATED'].includes(row.evidence_status)||!WBS_PAYABLE_READINESS.has(row.draft_readiness)||typeof row.can_create_draft!=='boolean'||!nullableUuid(row.business_document_id)||!nullableUuid(row.journal_entry_id))return null;
  const revision=Number(row.revision),ready=row.draft_readiness==='READY_FOR_AP_DRAFT';
  if(!Number.isSafeInteger(revision)||revision<0||row.can_create_draft!==ready||(row.evidence_status==='DRAFT_CREATED')!==(row.business_document_id!==null&&row.journal_entry_id!==null)||row.evidence_status==='DRAFT_CREATED'&&row.draft_readiness!=='ALREADY_DRAFTED')return null;
  return {...row,gross_amount:String(row.gross_amount),revision,attachment_ids:[...row.attachment_ids]};
};

export async function refreshAuthoritativeWbsPayableReviewEvidence({config,reviewEvidenceId=null,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||reviewEvidenceId!==null&&!UUID.test(reviewEvidenceId)||!Number.isSafeInteger(limit)||limit<1||limit>50)return {ok:false,code:'WBS_PAYABLE_EVIDENCE_SCOPE_INVALID',message:'WBS Payable evidence requires one authoritative entity, optional evidence ID, and a limit from 1 to 50.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const suffix=reviewEvidenceId?`/${reviewEvidenceId}`:`?limit=${limit}`;
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/inbound/payables/reviews${suffix}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'WBS_PAYABLE_EVIDENCE');const body=await response.json();const values=reviewEvidenceId?[body?.data]:body?.data;if(body?.ok!==true||!Array.isArray(values)||reviewEvidenceId&&values[0]===undefined)return {ok:false,code:'WBS_PAYABLE_EVIDENCE_PROTOCOL',message:'The accounting API returned an invalid WBS Payable evidence envelope.'};const rows=values.map(wbsPayableReviewEvidenceRow);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.wbs_payable_review_evidence_id)).size!==rows.length)return {ok:false,code:'WBS_PAYABLE_EVIDENCE_PROTOCOL',message:'The accounting API returned invalid, duplicate, or action-enabled WBS Payable evidence.'};return reviewEvidenceId?{ok:true,row:rows[0]}:{ok:true,rows};}catch{return unreachable('The browser could not read reviewed WBS Payable evidence; no HTTP response was produced.');}
}

export async function createAuthoritativeWbsPayableApDraft({config,evidence,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  const approvedReason=typeof reason==='string'?reason.trim():'';
  if(!config||typeof fetcher!=='function'||!evidence||evidence.can_create_draft!==true||evidence.draft_readiness!=='READY_FOR_AP_DRAFT'||!UUID.test(evidence.wbs_inbound_row_id||'')||!UUID.test(evidence.wbs_payable_review_evidence_id||'')||!Number.isSafeInteger(evidence.revision)||!SHA256.test(evidence.evidence_hash||'')||!UUID.test(evidence.mapping_snapshot_id||'')||!Array.isArray(evidence.attachment_ids)||!evidence.attachment_ids.length||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200||approvedReason.length<8||approvedReason.length>2000)return {ok:false,code:'WBS_PAYABLE_AP_DRAFT_COMMAND_INVALID',message:'AP Draft creation requires one server-revalidated ready evidence row, maker reason, CAS revision, and stable command identity.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const body={reviewEvidenceId:evidence.wbs_payable_review_evidence_id,expectedEvidenceHash:evidence.evidence_hash,mappingSnapshotId:evidence.mapping_snapshot_id,attachmentIds:evidence.attachment_ids,reason:approvedReason};
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/inbound/payables/${evidence.wbs_inbound_row_id}/drafts`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,'if-match':`"${evidence.revision}"`,...authorization},body:JSON.stringify(body)});if(!response.ok)return await failure(response,'WBS_PAYABLE_AP_DRAFT');const result=await response.json();const data=result?.data;if(result?.ok!==true||!data||data.status!=='DRAFT'||data.journal_type!=='AUTO'||['can_create_draft','can_submit','can_review','can_approve','can_post'].some(field=>data[field]!==false)||!UUID.test(data.business_document_id||'')||!UUID.test(data.journal_entry_id||''))return {ok:false,code:'WBS_PAYABLE_AP_DRAFT_PROTOCOL',message:'The accounting API returned an invalid or action-enabled WBS Payable Draft response.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not create the reviewed WBS Payable AP Draft; no HTTP response was produced.');}
}

export async function activateAuthoritativeWbsReadAccess({config,fetcher=globalThis.fetch,idempotencyKey}={}){
  if(!config||typeof fetcher!=='function'||typeof idempotencyKey!=='string'||idempotencyKey.length<8)return {ok:false,code:'WBS_READ_ACCESS_SCOPE_INVALID',message:'WBS evidence reader activation requires an authoritative scope.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/access/self-service-wbs-read-grant/upgrade`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:'{}'});
    if(!response.ok)return await failure(response,'WBS_READ_ACCESS');
    const body=await response.json();
    return body?.ok===true&&body?.data?.upgraded===true&&body.data.permission_count===6?{ok:true,idempotent:body.data.idempotent===true}:{ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'WBS evidence reader activation returned an invalid response.'};
  }catch{return unreachable('The browser could not complete the WBS evidence reader activation; no HTTP response was produced.');}
}

export async function activateAuthoritativeWbsOperatorAccess({config,fetcher=globalThis.fetch,idempotencyKey}={}){
  if(!config||typeof fetcher!=='function'||typeof idempotencyKey!=='string'||idempotencyKey.length<8)return {ok:false,code:'WBS_OPERATOR_ACCESS_SCOPE_INVALID',message:'WBS exception-evidence activation requires an authoritative scope.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/access/self-service-wbs-operator-grant/upgrade`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:'{}'});
    if(!response.ok)return await failure(response,'WBS_OPERATOR_ACCESS');
    const body=await response.json();
    return body?.ok===true&&body?.data?.upgraded===true&&body.data.permission_count===7?{ok:true,idempotent:body.data.idempotent===true}:{ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'WBS exception-evidence activation returned an invalid response.'};
  }catch{return unreachable('The browser could not complete WBS exception-evidence activation; no HTTP response was produced.');}
}

export async function activateControlledTestWorkflowAccess({config,fetcher=globalThis.fetch,idempotencyKey='controlled-test-workflow-access-v4'}={}){
  if(config?.wbsTestImportMode!=='ENABLED'||typeof fetcher!=='function'||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)return {ok:false,code:'CONTROLLED_TEST_ACCESS_SCOPE_INVALID',message:'Controlled test workflow activation requires the enabled fixed staging test scope.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/access/self-service-controlled-test-workflow-grant/upgrade`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,...authorization},body:'{}'});
    if(!response.ok)return await failure(response,'CONTROLLED_TEST_ACCESS');
    const body=await response.json(),data=body?.data;
    return body?.ok===true&&data?.upgraded===true&&data?.test_only===true&&data?.permission_count===22&&typeof data.idempotent==='boolean'?{ok:true,idempotent:data.idempotent}:{ok:false,code:'ACCOUNTING_API_PROTOCOL',message:'Controlled test workflow activation returned an invalid response.'};
  }catch{return unreachable('The browser could not enable the controlled test workflow; no HTTP response was produced.');}
}

export async function refreshAuthoritativeWbsControlReconciliation({config,sourceType,companyKey,period=null,currency,propertyRef=null,periodStart=null,periodEnd=null,bankAccountRef=null,fetcher=globalThis.fetch}={}){
  const type=String(sourceType||''),company=typeof companyKey==='string'?companyKey.trim():'',unit=String(currency||'').trim().toUpperCase(),propertyKey=typeof propertyRef==='string'?propertyRef.trim():'',bankKey=typeof bankAccountRef==='string'?bankAccountRef.trim():'';
  const cost=type==='COST_GENERAL_LEDGER',property=type==='PROPERTY_COMPARISON';
  const costScope=cost&&PERIOD_CODE.test(String(period||''));
  const propertyScope=property&&wbsScopeText(propertyKey,128)&&validDate(periodStart)&&validDate(periodEnd)&&periodStart<=periodEnd&&wbsScopeText(bankKey,128);
  if(!config||typeof fetcher!=='function'||!wbsScopeText(company,128)||!/^[A-Z]{3}$/.test(unit)||!costScope&&!propertyScope)return {ok:false,code:'WBS_CONTROL_SCOPE_INVALID',message:'WBS control reconciliation requires an exact Cost GL period or Property/date/bank scope.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  const params=new URLSearchParams({sourceType:type,companyKey:company,currency:unit});
  const scope={company_key:company,currency:unit};
  if(cost){params.set('period',period);scope.period=period;}else{params.set('propertyRef',propertyKey);params.set('periodStart',periodStart);params.set('periodEnd',periodEnd);params.set('bankAccountRef',bankKey);Object.assign(scope,{property_ref:propertyKey,period_start:periodStart,period_end:periodEnd,bank_account_ref:bankKey});}
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/control-reconciliation?${params}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'WBS_CONTROL_RECONCILIATION');const body=await response.json();if(body?.ok!==true||!wbsControlEvidence(body.data,{sourceType:type,scope:{entity_id:config.entityId,...scope}}))return {ok:false,code:'WBS_CONTROL_RECONCILIATION_PROTOCOL',message:'The accounting API returned invalid, entity/business-scope-mismatched, or action-enabled WBS control evidence.'};return {ok:true,data:body.data,scope:{entityId:config.entityId,sourceType:type,...scope}};}catch{return unreachable('The browser could not read persisted WBS control reconciliation evidence; no HTTP response was produced.');}
}

export async function verifyAuthoritativeWbsTransitionContract({config,contract,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function')return notConfigured();
  if(!contract||typeof contract!=='object'||Array.isArray(contract))return {ok:false,code:'WBS_TRANSITION_CONTRACT_INVALID',message:'A signed WBS transition-contract JSON object is required.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/auto-reconciliation/transition-contracts/verify`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json',...authorization},body:JSON.stringify({contract})});if(!response.ok)return await failure(response,'WBS_TRANSITION_CONTRACT_EVIDENCE');const body=await response.json();if(body?.ok!==true||!wbsTransitionEvidence(body.data))return {ok:false,code:'WBS_TRANSITION_CONTRACT_PROTOCOL',message:'The accounting API returned transition evidence that was incomplete or offered REFS action authority.'};return {ok:true,data:body.data};}catch{return unreachable('The browser could not verify the signed WBS transition contract; no HTTP response was produced.');}
}

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

const PROPERTY_RENT_FIELDS=['wbs_property_rent_source_admission_id','wbs_property_rent_review_evidence_id','wbs_property_rent_draft_evidence_id','source_document_id','staging_item_id','business_document_id','journal_entry_id','period_id','mapping_snapshot_id','mapping_snapshot_hash','mapping_version','source_version','receipt_hash','evidence_hash','property_ref','unit_ref','lease_ref','tenant_ref','document_number','accounting_date','due_date','currency','gross_amount','workflow_status','revision','admitted_by','reviewed_by','drafted_by','reviewed_at','drafted_at','posted_at','can_review','can_create_draft','can_post'];
const PROPERTY_RENT_STATUSES=new Set(['PENDING_REVIEW','READY_FOR_DRAFT','DRAFT','PENDING_APPROVAL','APPROVED','POSTED']);
const propertyRentPickupEvidence=row=>{
  if(!exactObjectKeys(row,PROPERTY_RENT_FIELDS)||!UUID.test(row.wbs_property_rent_source_admission_id||'')||!UUID.test(row.source_document_id||'')||!UUID.test(row.staging_item_id||'')||!SHA256.test(row.receipt_hash||'')||!SHA256.test(row.evidence_hash||'')||![row.source_version,row.property_ref,row.unit_ref,row.lease_ref,row.tenant_ref,row.document_number,row.admitted_by].every(value=>TEXT_TOKEN.test(value||''))||!validDate(row.accounting_date)||row.due_date!==null&&!validDate(row.due_date)||!/^[A-Z]{3}$/.test(row.currency||'')||!REPORT_MONEY4.test(String(row.gross_amount??''))||row.gross_amount==='0.0000'||!PROPERTY_RENT_STATUSES.has(row.workflow_status)||!UNSIGNED_INTEGER.test(String(row.revision??''))||!Number.isSafeInteger(Number(row.revision))||typeof row.can_review!=='boolean'||typeof row.can_create_draft!=='boolean'||row.can_post!==false)return null;
  if(![row.wbs_property_rent_review_evidence_id,row.wbs_property_rent_draft_evidence_id,row.business_document_id,row.journal_entry_id,row.period_id,row.mapping_snapshot_id].every(value=>value===null||UUID.test(value||''))||row.mapping_snapshot_hash!==null&&!SHA256.test(row.mapping_snapshot_hash||'')||row.mapping_version!==null&&(!UNSIGNED_INTEGER.test(String(row.mapping_version))||!Number.isSafeInteger(Number(row.mapping_version)))||[row.reviewed_at,row.drafted_at,row.posted_at].some(value=>value!==null&&!validTimestamp(value))||[row.reviewed_by,row.drafted_by].some(value=>value!==null&&!TEXT_TOKEN.test(value||'')))return null;
  const reviewed=row.wbs_property_rent_review_evidence_id!==null,drafted=row.wbs_property_rent_draft_evidence_id!==null;
  if(reviewed!==Boolean(row.period_id&&row.mapping_snapshot_id&&row.mapping_snapshot_hash&&row.reviewed_by&&row.reviewed_at)||drafted!==Boolean(row.business_document_id&&row.journal_entry_id&&row.drafted_by&&row.drafted_at)||drafted&&!reviewed||!reviewed&&row.workflow_status!=='PENDING_REVIEW'||reviewed&&!drafted&&row.workflow_status!=='READY_FOR_DRAFT'||drafted&&!['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED'].includes(row.workflow_status)||(row.workflow_status==='POSTED')!==Boolean(row.posted_at)||row.can_review&&reviewed||row.can_create_draft&&(!reviewed||drafted))return null;
  return Object.freeze({...row,gross_amount:String(row.gross_amount),revision:Number(row.revision),mapping_version:row.mapping_version===null?null:Number(row.mapping_version)});
};

export async function refreshAuthoritativeWbsPropertyRentPickup({config,limit=50,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>50)return {ok:false,code:'PROPERTY_RENT_PICKUP_SCOPE_INVALID',message:'Property Rent pickup requires one authoritative entity and a limit from 1 to 50.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/property-rent-pickup?periodId=${config.periodId}&limit=${limit}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});if(!response.ok)return await failure(response,'PROPERTY_RENT_PICKUP_READ');const envelope=await response.json();if(envelope?.ok!==true||!Array.isArray(envelope.data))return {ok:false,code:'PROPERTY_RENT_PICKUP_PROTOCOL',message:'The accounting API returned an invalid Property Rent pickup envelope.'};const rows=envelope.data.map(propertyRentPickupEvidence);if(rows.some(row=>row===null)||new Set(rows.map(row=>row.wbs_property_rent_source_admission_id)).size!==rows.length||rows.some(row=>row.wbs_property_rent_review_evidence_id!==null&&row.period_id!==config.periodId))return {ok:false,code:'PROPERTY_RENT_PICKUP_PROTOCOL',message:'The accounting API returned duplicate, cross-period, or malformed Property Rent evidence.'};return {ok:true,rows};}catch{return unreachable('The browser could not read authoritative Property Rent pickup evidence; no HTTP response was produced.');}
}

const validPropertyRentCommand=(config,evidence,reason,idempotencyKey)=>config&&evidence&&typeof reason==='string'&&reason===reason.trim()&&reason.length>=8&&reason.length<=2000&&!/[\u0000-\u001f\u007f]/.test(reason)&&typeof idempotencyKey==='string'&&idempotencyKey.length>=8&&idempotencyKey.length<=200&&SHA256.test(evidence.evidence_hash||'')&&Number.isSafeInteger(evidence.revision)&&evidence.revision>=0;
export async function reviewAuthoritativeWbsPropertyRent({config,evidence,periodId,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  if(typeof fetcher!=='function'||!validPropertyRentCommand(config,evidence,reason,idempotencyKey)||evidence.can_review!==true||evidence.workflow_status!=='PENDING_REVIEW'||!UUID.test(evidence.wbs_property_rent_source_admission_id||'')||periodId!==config.periodId||!UUID.test(periodId||''))return {ok:false,code:'PROPERTY_RENT_REVIEW_INVALID',message:'Property Rent review requires exact current evidence, period, revision, capability, and rationale.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/property-rent-pickup/${evidence.wbs_property_rent_source_admission_id}/reviews`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,'if-match':`"${evidence.revision}"`,...authorization},body:JSON.stringify({periodId,expectedEvidenceHash:evidence.evidence_hash,reason})});if(!response.ok)return await failure(response,'PROPERTY_RENT_REVIEW');const envelope=await response.json(),data=envelope?.data;if(envelope?.ok!==true||!data||data.status!=='READY_FOR_DRAFT'||data.revision!==evidence.revision+1||data.source_document_id!==evidence.source_document_id||data.staging_item_id!==evidence.staging_item_id||data.period_id!==periodId||!UUID.test(data.review_evidence_id||'')||!UUID.test(data.mapping_snapshot_id||'')||typeof data.can_create_draft!=='boolean'||data.can_post!==false)return {ok:false,code:'PROPERTY_RENT_REVIEW_PROTOCOL',message:'The accounting API returned an invalid Property Rent review receipt.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not complete Property Rent review; no HTTP response was produced.');}
}

export async function createAuthoritativeWbsPropertyRentDraft({config,evidence,reason,idempotencyKey,fetcher=globalThis.fetch}={}){
  if(typeof fetcher!=='function'||!validPropertyRentCommand(config,evidence,reason,idempotencyKey)||evidence.period_id!==config.periodId||evidence.can_create_draft!==true||evidence.workflow_status!=='READY_FOR_DRAFT'||!UUID.test(evidence.wbs_property_rent_review_evidence_id||''))return {ok:false,code:'PROPERTY_RENT_DRAFT_INVALID',message:'Property Rent Draft creation requires exact independently reviewed same-period evidence, revision, capability, and rationale.'};
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return authenticationRequired();
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/wbs/property-rent-pickup/reviews/${evidence.wbs_property_rent_review_evidence_id}/drafts`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':idempotencyKey,'if-match':`"${evidence.revision}"`,...authorization},body:JSON.stringify({expectedEvidenceHash:evidence.evidence_hash,reason})});if(!response.ok)return await failure(response,'PROPERTY_RENT_DRAFT');const envelope=await response.json(),data=envelope?.data;if(envelope?.ok!==true||!data||data.status!=='DRAFT'||data.revision!==0||data.staging_version!==evidence.revision+1||data.review_evidence_id!==evidence.wbs_property_rent_review_evidence_id||data.source_document_id!==evidence.source_document_id||data.staging_item_id!==evidence.staging_item_id||data.mapping_snapshot_id!==evidence.mapping_snapshot_id||![data.draft_evidence_id,data.business_document_id,data.journal_entry_id].every(value=>UUID.test(value||''))||typeof data.can_submit!=='boolean'||['can_review','can_approve','can_post'].some(field=>data[field]!==false))return {ok:false,code:'PROPERTY_RENT_DRAFT_PROTOCOL',message:'The accounting API returned an invalid Property Rent Draft receipt.'};return {ok:true,data,idempotent:response.status===200};}catch{return unreachable('The browser could not create the reviewed Property Rent Draft; no HTTP response was produced.');}
}
