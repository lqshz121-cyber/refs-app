import {createServer} from 'node:http';
import {WbsReadContractError,assertWbsReadOnlyResult,parseWbsAutoRecReviewSelection} from './wbs-read-contract.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_BODY_KEYS=new Set(['actor','actorId','actor_id','tenantId','tenant_id','entityId','entity_id','requestHash','request_hash']);

export class AccountingApiError extends Error{
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}

const header=(headers,name)=>{
  if(typeof headers?.get==='function')return headers.get(name);
  const key=Object.keys(headers||{}).find(candidate=>candidate.toLowerCase()===name.toLowerCase());
  const value=key?headers[key]:null;return Array.isArray(value)?value[0]:value;
};
const requireUuid=(value,name)=>{if(!UUID.test(value||''))throw new AccountingApiError(400,'INVALID_PATH_PARAMETER',`${name} must be a UUID`);return value;};
const requireIsoDate=(value,name)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER',`${name} must be an ISO calendar date`);const date=new Date(`${value}T00:00:00.000Z`);if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER',`${name} must be an ISO calendar date`);return value;};
const optionalIsoDate=(value,name)=>value==null?null:requireIsoDate(value,name);
const requireBankAccountRef=value=>{if(typeof value!=='string'||!value||value!==value.trim()||value.length>128||/[\u0000-\u001f\u007f]/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','bankAccountRef must be a canonical trimmed value of 1-128 printable characters');return value;};
const optionalReadLimit=value=>{if(value==null||value==='')return 100;if(!/^[1-9]\d{0,2}$/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 200');const limit=Number(value);if(limit>200)throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 200');return limit;};
const requireExactQuery=(searchParams,allowed)=>{const permitted=new Set(allowed);for(const key of searchParams.keys())if(!permitted.has(key))throw new AccountingApiError(400,'UNEXPECTED_QUERY_PARAMETER',`Unexpected query parameter: ${key}`);for(const key of allowed)if(searchParams.getAll(key).length>1)throw new AccountingApiError(400,'DUPLICATE_QUERY_PARAMETER',`Query parameter must not be repeated: ${key}`);};
const requireIdempotency=headers=>{const value=header(headers,'idempotency-key');if(typeof value!=='string'||value.length<8||value.length>200)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_REQUIRED','Idempotency-Key must be 8-200 characters');return value;};
const requireRevision=headers=>{const raw=header(headers,'if-match');if(raw==null)throw new AccountingApiError(428,'IF_MATCH_REQUIRED','If-Match is required');const value=String(raw).trim();if(value.startsWith('W/'))throw new AccountingApiError(412,'WEAK_IF_MATCH_REJECTED','If-Match must use a strong revision validator');const match=/^"(\d+)"$/.exec(value);if(!match)throw new AccountingApiError(400,'INVALID_IF_MATCH','If-Match must be a quoted non-negative strong revision');const revision=Number(match[1]);if(!Number.isSafeInteger(revision))throw new AccountingApiError(400,'INVALID_IF_MATCH','If-Match must contain a safe non-negative revision');return revision;};
const validateBody=body=>{if(!body||typeof body!=='object'||Array.isArray(body))throw new AccountingApiError(400,'JSON_OBJECT_REQUIRED','Request body must be a JSON object');for(const key of Object.keys(body))if(FORBIDDEN_BODY_KEYS.has(key))throw new AccountingApiError(400,'IDENTITY_FIELD_FORBIDDEN',`${key} must come from authenticated context`);return body;};
const allowOnly=(body,allowed)=>{const unexpected=Object.keys(body).filter(key=>!allowed.includes(key));if(unexpected.length)throw new AccountingApiError(400,'UNEXPECTED_FIELD',`Unexpected request field: ${unexpected[0]}`);return body;};

const isRevisionPrecondition=error=>error?.code==='40001'&&/(revision conflict|version conflict|period changed during transition|staging source changed during journal creation|lease is absent, stale, or owned)/i.test(String(error.message||''));
function statusFor(error){
  if(error instanceof WbsReadContractError)return error.status;
  if(error instanceof AccountingApiError)return error.status;
  if(error?.code==='42501')return 403;if(error?.code==='P0002')return 404;
  if(error?.code==='WBS_SNAPSHOT_SIGNATURE_REQUIRED')return 503;
  if(error?.code==='WBS_SNAPSHOT_SIGNATURE_INVALID')return 422;
  if(error?.code==='40001')return isRevisionPrecondition(error)?412:503;
  if(error?.code==='23505')return 409;if(error?.code==='55000')return 423;
  if(['22023','23503','23514'].includes(error?.code))return 422;return 500;
}
const problemFor=error=>{const status=statusFor(error);const code=isRevisionPrecondition(error)?'PRECONDITION_FAILED':error?.code==='WBS_SNAPSHOT_SIGNATURE_REQUIRED'?'WBS_SNAPSHOT_SIGNATURE_REQUIRED':error?.code==='WBS_READ_SERVICE_UNAVAILABLE'?'WBS_READ_SERVICE_UNAVAILABLE':error instanceof WbsReadContractError?error.code:status===503?'SERIALIZATION_RETRY_EXHAUSTED':error.code||'INTERNAL_ERROR';const message=status>=500?'Internal server error':error.message;const headers={'content-type':'application/problem+json','cache-control':'no-store'};if(status===503)headers['retry-after']='1';return {status,headers,body:{ok:false,code,message}};};

export function createAccountingApi({authenticate,kernelFactory,attachmentServiceFactory,wbsReadServiceFactory}={}){
  if(typeof authenticate!=='function'||typeof kernelFactory!=='function')throw new Error('Accounting API requires authenticate and kernelFactory');
  return async function dispatch({method,url,headers={},body=null}){
    try{
      const principal=await authenticate({method,url,headers});
      if(!principal||principal.trusted!==true||!UUID.test(principal.tenantId||'')||!principal.actorId)throw new AccountingApiError(401,'AUTHENTICATION_REQUIRED','Authenticated principal is required');
      const parsedUrl=new URL(url,'http://refs.local');const pathname=parsedUrl.pathname;const parts=pathname.split('/').filter(Boolean);
      if(parts[0]!=='api'||parts[1]!=='v1'||parts[2]!=='entities')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
      const entityId=requireUuid(parts[3],'entityId');const payload=method==='GET'&&body==null?{}:validateBody(body);
      let result;
      if(method==='GET'&&parts.length===6&&((parts[4]==='ap'&&parts[5]==='bills')||(parts[4]==='ar'&&parts[5]==='invoices'))){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(Object.keys(payload).length)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listBusinessDocuments({tenantId:principal.tenantId,entityId,documentKind:parts[4]==='ap'?'AP_BILL':'AR_INVOICE'});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===5&&parts[4]==='journal-entries'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(Object.keys(payload).length)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listJournalEntries({tenantId:principal.tenantId,entityId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='bank'&&parts[5]==='transactions'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['bankAccountRef','from','through','limit']);
        const bankAccountRef=requireBankAccountRef(parsedUrl.searchParams.get('bankAccountRef'));
        const fromDate=optionalIsoDate(parsedUrl.searchParams.get('from'),'from');
        const throughDate=optionalIsoDate(parsedUrl.searchParams.get('through'),'through');
        if(fromDate&&throughDate&&fromDate>throughDate)throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','from must not be later than through');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listBankTransactions({tenantId:principal.tenantId,entityId,bankAccountRef,fromDate,throughDate,limit:optionalReadLimit(parsedUrl.searchParams.get('limit'))});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='bank'&&parts[5]==='reconciliation'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['bankAccountRef','statementEndingDate']);
        const bankAccountRef=requireBankAccountRef(parsedUrl.searchParams.get('bankAccountRef'));
        const statementEndingDate=requireIsoDate(parsedUrl.searchParams.get('statementEndingDate'),'statementEndingDate');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getReconciliationSummary({tenantId:principal.tenantId,entityId,bankAccountRef,statementEndingDate});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='wbs'&&parts[5]==='auto-reconciliation'&&parts[6]==='review-candidates'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        if(typeof wbsReadServiceFactory!=='function')throw new AccountingApiError(503,'WBS_READ_SERVICE_UNAVAILABLE','WBS read service is unavailable');
        const selection=parseWbsAutoRecReviewSelection(parsedUrl.searchParams);
        const service=await wbsReadServiceFactory(principal);
        if(!service||typeof service.readAutoRecReview!=='function')throw new AccountingApiError(503,'WBS_READ_SERVICE_UNAVAILABLE','WBS read service is unavailable');
        result=assertWbsReadOnlyResult(await service.readAutoRecReview({tenantId:principal.tenantId,entityId,companyKey:selection.companyKey,sourceRecordIds:selection.sourceRecordIds}));
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&['ap','ar'].includes(parts[4])&&parts[5]==='adjustments'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(Object.keys(payload).length)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listBusinessAdjustments({tenantId:principal.tenantId,entityId,module:parts[4].toUpperCase()});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&['ap','ar'].includes(parts[4])&&['aging','control-totals'].includes(parts[5])){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(Object.keys(payload).length)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        if(parts[5]==='aging'){
          const args={tenantId:principal.tenantId,entityId,asOfDate:requireIsoDate(parsedUrl.searchParams.get('asOf'),'asOf')};
          result=await (parts[4]==='ap'?kernel.getApAging(args):kernel.getArAging(args));
        }else result=await (parts[4]==='ap'?kernel.getApControlTotal({tenantId:principal.tenantId,entityId}):kernel.getArControlTotal({tenantId:principal.tenantId,entityId}));
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method!=='POST')throw new AccountingApiError(405,'METHOD_NOT_ALLOWED','Only POST commands and supported GET reads are available');
      const idempotencyKey=requireIdempotency(headers);
      if(parts.length===6&&parts[4]==='attachments'&&parts[5]==='reservations'){
        if(typeof attachmentServiceFactory!=='function')throw new AccountingApiError(503,'ATTACHMENT_SERVICE_UNAVAILABLE','Attachment service is unavailable');
        allowOnly(payload,['name','mediaType','sizeBytes','contentHash']);const service=await attachmentServiceFactory(principal);result=await service.reserve(principal,{...payload,tenantId:principal.tenantId,entityId,idempotencyKey});
      }else if(parts.length===7&&parts[4]==='attachments'&&parts[6]==='finalize'){
        if(typeof attachmentServiceFactory!=='function')throw new AccountingApiError(503,'ATTACHMENT_SERVICE_UNAVAILABLE','Attachment service is unavailable');
        allowOnly(payload,[]);const service=await attachmentServiceFactory(principal);
        try{result=await service.finalize(principal,{tenantId:principal.tenantId,entityId,attachmentId:requireUuid(parts[5],'attachmentId'),idempotencyKey});}
        catch(error){if(['42501','P0002','ATTACHMENT_NOT_FOUND'].includes(error?.code))throw new AccountingApiError(404,'ATTACHMENT_NOT_FOUND','Attachment was not found');throw error;}
      }else if(parts.length===6&&parts[4]==='wbs'&&parts[5]==='snapshots'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['snapshot']);
        result=await kernel.recordWbsSnapshot({tenantId:principal.tenantId,entityId,snapshot:payload.snapshot,idempotencyKey});
      }else if(parts.length===6&&parts[4]==='journal-entries'&&parts[5]==='manual'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.createManualJournal({...payload,tenantId:principal.tenantId,entityId,idempotencyKey});
      }else if(parts.length===6&&parts[4]==='journal-entries'&&parts[5]==='auto'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.createAutoJournal({...payload,tenantId:principal.tenantId,entityId,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='journal-entries'&&parts[6]==='transitions'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.transitionJournal({tenantId:principal.tenantId,entityId,journalEntryId:requireUuid(parts[5],'journalEntryId'),action:parts[7].toUpperCase(),expectedRevision:requireRevision(headers),reason:payload.reason??null,idempotencyKey});
      }else if(parts.length===7&&parts[4]==='journal-entries'&&parts[6]==='post'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.postJournal({tenantId:principal.tenantId,entityId,journalEntryId:requireUuid(parts[5],'journalEntryId'),periodId:requireUuid(payload.periodId,'periodId'),expectedRevision:requireRevision(headers),idempotencyKey});
      }else if(parts.length===8&&parts[4]==='journal-entries'&&parts[6]==='adjustments'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.createJournalAdjustment({...payload,action:parts[7].toUpperCase(),tenantId:principal.tenantId,entityId,originalJournalEntryId:requireUuid(parts[5],'journalEntryId'),idempotencyKey});
      }else if(parts.length===6&&((parts[4]==='ap'&&parts[5]==='bills')||(parts[4]==='ar'&&parts[5]==='invoices'))){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','documentNumber','counterpartyRef','counterpartyName','currency','accountingDate','dueDate','amount','offsetAccountCode','description','attachmentIds']);
        result=await kernel.createBusinessDocument({tenantId:principal.tenantId,entityId,documentKind:parts[4]==='ap'?'AP_BILL':'AR_INVOICE',periodId:requireUuid(payload.periodId,'periodId'),documentNumber:payload.documentNumber,counterpartyRef:payload.counterpartyRef,counterpartyName:payload.counterpartyName,currency:payload.currency,accountingDate:payload.accountingDate,dueDate:payload.dueDate??null,amount:payload.amount,offsetAccountCode:payload.offsetAccountCode,description:payload.description??null,attachmentIds:payload.attachmentIds,idempotencyKey});
      }else if(parts.length===7&&parts[4]==='ap'&&parts[5]==='bills'&&parts[6].length>0&&parts[6]!=='voids'){
        throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
      }else if(parts.length===8&&parts[4]==='ap'&&parts[5]==='bills'&&parts[7]==='voids'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','journalNumber','journalDate','reason']);
        result=await kernel.createApBillVoid({tenantId:principal.tenantId,entityId,businessDocumentId:requireUuid(parts[6],'businessDocumentId'),periodId:requireUuid(payload.periodId,'periodId'),expectedVersion:requireRevision(headers),journalNumber:payload.journalNumber,journalDate:payload.journalDate,reason:payload.reason,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='ap'&&parts[5]==='bills'&&parts[7]==='payments'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','paymentNumber','paymentDate','cashAccountCode','bankMemberRef','amount','reason']);
        result=await kernel.createApPayment({tenantId:principal.tenantId,entityId,businessDocumentId:requireUuid(parts[6],'businessDocumentId'),periodId:requireUuid(payload.periodId,'periodId'),paymentNumber:payload.paymentNumber,paymentDate:payload.paymentDate,cashAccountCode:payload.cashAccountCode,bankMemberRef:payload.bankMemberRef??null,amount:payload.amount,reason:payload.reason,idempotencyKey});
      }else if(parts.length===6&&parts[4]==='ap'&&parts[5]==='vendor-credits'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','creditNumber','creditDate','vendorRef','vendorName','amount','lines','reason']);
        result=await kernel.createApVendorCredit({tenantId:principal.tenantId,entityId,periodId:requireUuid(payload.periodId,'periodId'),creditNumber:payload.creditNumber,creditDate:payload.creditDate,vendorRef:payload.vendorRef,vendorName:payload.vendorName,amount:payload.amount,lines:payload.lines,reason:payload.reason,idempotencyKey});
      }else if(parts.length===7&&parts[4]==='ap'&&parts[5]==='vendor-credits'&&parts[6].length>0){
        throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
      }else if(parts.length===8&&parts[4]==='ap'&&parts[5]==='vendor-credits'&&parts[7]==='allocations'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['businessDocumentId','amount','reason']);
        result=await kernel.applyApVendorCredit({tenantId:principal.tenantId,entityId,businessAdjustmentId:requireUuid(parts[6],'businessAdjustmentId'),businessDocumentId:requireUuid(payload.businessDocumentId,'businessDocumentId'),amount:payload.amount,reason:payload.reason,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='ar'&&parts[5]==='invoices'&&parts[7]==='receipts'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','receiptNumber','receiptDate','cashAccountCode','bankMemberRef','amount','reason']);
        result=await kernel.createArReceipt({tenantId:principal.tenantId,entityId,businessDocumentId:requireUuid(parts[6],'businessDocumentId'),periodId:requireUuid(payload.periodId,'periodId'),receiptNumber:payload.receiptNumber,receiptDate:payload.receiptDate,cashAccountCode:payload.cashAccountCode,bankMemberRef:payload.bankMemberRef??null,amount:payload.amount,reason:payload.reason,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='ar'&&parts[5]==='receipts'&&parts[7]==='reversals'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','journalNumber','journalDate','reason']);
        result=await kernel.createArReceiptReversal({tenantId:principal.tenantId,entityId,sourceOccurrenceId:requireUuid(parts[6],'sourceOccurrenceId'),periodId:requireUuid(payload.periodId,'periodId'),journalNumber:payload.journalNumber,journalDate:payload.journalDate,reason:payload.reason,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='ar'&&parts[5]==='credit-memos'&&parts[7]==='allocations'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['businessDocumentId','amount','reason']);
        result=await kernel.applyArCreditMemo({tenantId:principal.tenantId,entityId,businessAdjustmentId:requireUuid(parts[6],'businessAdjustmentId'),businessDocumentId:requireUuid(payload.businessDocumentId,'businessDocumentId'),amount:payload.amount,reason:payload.reason,idempotencyKey});
      }else if(parts.length===6&&parts[4]==='ar'&&parts[5]==='refunds'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','sourceAdjustmentId','refundNumber','refundDate','cashAccountCode','amount','reason']);
        result=await kernel.createArRefund({tenantId:principal.tenantId,entityId,periodId:requireUuid(payload.periodId,'periodId'),sourceAdjustmentId:requireUuid(payload.sourceAdjustmentId,'sourceAdjustmentId'),refundNumber:payload.refundNumber,refundDate:payload.refundDate,cashAccountCode:payload.cashAccountCode,amount:payload.amount,reason:payload.reason,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='ap'&&parts[5]==='payments'&&parts[7]==='reversals'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','journalNumber','journalDate','reason']);
        result=await kernel.createApPaymentReversal({tenantId:principal.tenantId,entityId,sourceOccurrenceId:requireUuid(parts[6],'sourceOccurrenceId'),periodId:requireUuid(payload.periodId,'periodId'),journalNumber:payload.journalNumber,journalDate:payload.journalDate,reason:payload.reason,idempotencyKey});
      }else if(parts.length===6&&parts[4]==='ar'&&parts[5]==='credit-memos'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','memoNumber','memoDate','customerRef','customerName','amount','lines','reason']);
        result=await kernel.createArCreditMemo({tenantId:principal.tenantId,entityId,periodId:requireUuid(payload.periodId,'periodId'),memoNumber:payload.memoNumber,memoDate:payload.memoDate,customerRef:payload.customerRef,customerName:payload.customerName,amount:payload.amount,lines:payload.lines,reason:payload.reason,idempotencyKey});
      }else throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
      const responseHeaders={'content-type':'application/json','cache-control':'no-store'};
      if(Number.isSafeInteger(result?.revision)&&result.revision>=0)responseHeaders.etag=`"${result.revision}"`;
      return {status:result?.idempotent?200:201,headers:responseHeaders,body:{ok:true,data:result}};
    }catch(error){return problemFor(error);}
  };
}

const corsHeaders=(origin,allowedOrigins)=>origin&&allowedOrigins.has(origin)?{'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type, idempotency-key, if-match','access-control-max-age':'600','vary':'Origin'}:{};

export function createAccountingHttpServer({authenticate,kernelFactory,attachmentServiceFactory,wbsReadServiceFactory,maxBodyBytes=1024*1024,healthCheck,allowedOrigins=[]}={}){
  const allowed=new Set(allowedOrigins);
  const dispatch=createAccountingApi({authenticate,kernelFactory,attachmentServiceFactory,wbsReadServiceFactory});
  return createServer(async(req,res)=>{
    const chunks=[];let size=0;
    try{
      const pathname=new URL(req.url,'http://refs.local').pathname;
      const origin=typeof req.headers.origin==='string'?req.headers.origin:null;
      if(origin&& !allowed.has(origin))throw new AccountingApiError(403,'CORS_ORIGIN_FORBIDDEN','Origin is not allowed');
      const cors=corsHeaders(origin,allowed);
      if(req.method==='OPTIONS'){
        if(!origin)throw new AccountingApiError(400,'CORS_ORIGIN_REQUIRED','Origin is required for CORS preflight');
        res.writeHead(204,cors);res.end();return;
      }
      if(req.method==='GET'&&pathname==='/health/live'){
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store',...cors});res.end('{"ok":true,"status":"live"}');return;
      }
      if(req.method==='GET'&&pathname==='/health/ready'){
        let ready=false;try{ready=typeof healthCheck==='function'&&await healthCheck()===true;}catch{}
        res.writeHead(ready?200:503,{'content-type':'application/json','cache-control':'no-store',...cors});res.end(JSON.stringify({ok:ready,status:ready?'ready':'not_ready'}));return;
      }
      for await(const chunk of req){size+=chunk.length;if(size>maxBodyBytes)throw new AccountingApiError(413,'BODY_TOO_LARGE','Request body exceeds limit');chunks.push(chunk);}
      let body={};if(chunks.length){try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AccountingApiError(400,'INVALID_JSON','Request body is not valid JSON');}}
      const response=await dispatch({method:req.method,url:req.url,headers:req.headers,body});res.writeHead(response.status,{...response.headers,...cors});res.end(JSON.stringify(response.body));
    }catch(error){const problem=problemFor(error);res.writeHead(problem.status,problem.headers);res.end(JSON.stringify(problem.body));}
  });
}
