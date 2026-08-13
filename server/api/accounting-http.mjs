import {createServer} from 'node:http';
import {WbsReadContractError,assertWbsControlReadOnlyResult,assertWbsReadOnlyResult,parseWbsAutoRecReviewSelection,parseWbsControlReconciliationSelection} from './wbs-read-contract.mjs';
import {WbsLivePilotError,assertWbsLivePilotResult,parseWbsLivePilotSelection} from '../runtime/wbs-live-pilot-read-service.mjs';
import {WbsAdmittedPayableIngestionError} from '../runtime/wbs-admitted-payable-ingestion.mjs';
import {WbsOperatorAttestedPayableError} from '../runtime/wbs-operator-attested-payable.mjs';
import {WbsSignedBankAdmissionError} from '../runtime/wbs-signed-bank-admission.mjs';
import {WbsProviderSignedPayableAdmissionError} from '../runtime/wbs-provider-signed-payable-admission.mjs';

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
const requireAccountCode=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','accountCode must be a canonical account code of 1-64 letters, digits, dot, underscore, or hyphen');return value;};
const optionalAccountCode=value=>value==null||value===''?null:requireAccountCode(value);
const optionalLedgerQuery=value=>{if(value==null||value==='')return null;if(typeof value!=='string'||value!==value.trim()||value.length>160||/[\u0000-\u001f\u007f]/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','query must be a canonical trimmed value of 1-160 printable characters');return value;};
const optionalReadOffset=value=>{if(value==null||value==='')return 0;if(!/^\d{1,7}$/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','offset must be a non-negative integer');return Number(value);};
const requireDimensionType=value=>{if(!['PROPERTY','PROJECT','UNIT'].includes(value||''))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','dimensionType must be PROPERTY, PROJECT, or UNIT');return value;};
const requireDimensionRef=value=>{if(typeof value!=='string'||!value||value!==value.trim()||value.length>160||/[\u0000-\u001f\u007f]/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','dimensionRef must be a canonical trimmed value of 1-160 printable characters');return value;};
const optionalReadLimit=value=>{if(value==null||value==='')return 100;if(!/^[1-9]\d{0,2}$/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 200');const limit=Number(value);if(limit>200)throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 200');return limit;};
const optionalAdmittedStatementLimit=value=>{if(value==null||value==='')return 50;if(!/^[1-9]\d?$/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 50');const limit=Number(value);if(limit>50)throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 50');return limit;};
const requireExactQuery=(searchParams,allowed)=>{const permitted=new Set(allowed);for(const key of searchParams.keys())if(!permitted.has(key))throw new AccountingApiError(400,'UNEXPECTED_QUERY_PARAMETER',`Unexpected query parameter: ${key}`);for(const key of allowed)if(searchParams.getAll(key).length>1)throw new AccountingApiError(400,'DUPLICATE_QUERY_PARAMETER',`Query parameter must not be repeated: ${key}`);};
const requireIdempotency=headers=>{const value=header(headers,'idempotency-key');if(typeof value!=='string'||value.length<8||value.length>200)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_REQUIRED','Idempotency-Key must be 8-200 characters');return value;};
const requireRevision=headers=>{const raw=header(headers,'if-match');if(raw==null)throw new AccountingApiError(428,'IF_MATCH_REQUIRED','If-Match is required');const value=String(raw).trim();if(value.startsWith('W/'))throw new AccountingApiError(412,'WEAK_IF_MATCH_REJECTED','If-Match must use a strong revision validator');const match=/^"(\d+)"$/.exec(value);if(!match)throw new AccountingApiError(400,'INVALID_IF_MATCH','If-Match must be a quoted non-negative strong revision');const revision=Number(match[1]);if(!Number.isSafeInteger(revision))throw new AccountingApiError(400,'INVALID_IF_MATCH','If-Match must contain a safe non-negative revision');return revision;};
const requireReviewReason=value=>{if(typeof value!=='string'||value!==value.trim()||value.length<8||value.length>2000||/[\u0000-\u001f\u007f]/.test(value))throw new AccountingApiError(400,'INVALID_REASON','reason must be a canonical 8-2000 character review explanation');return value;};
const requireDecimalAmount=(value,name)=>{if(typeof value!=='string'||!/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/.test(value))throw new AccountingApiError(400,'INVALID_AMOUNT',`${name} must be a canonical decimal string with at most four fractional digits`);return value;};
const requireSha256=(value,name)=>{if(typeof value!=='string'||!/^sha256:[0-9a-f]{64}$/.test(value))throw new AccountingApiError(400,'INVALID_EVIDENCE_HASH',`${name} must be a canonical sha256 evidence hash`);return value;};
const requireBareSha256=(value,name)=>{if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))throw new AccountingApiError(400,'INVALID_EVIDENCE_HASH',`${name} must be a canonical provider sha256 digest`);return value;};
const requireSourceVersion=(value,name)=>{if(typeof value!=='string'||value!==value.trim()||value.length<1||value.length>128||/[\u0000-\u001f\u007f]/.test(value))throw new AccountingApiError(400,'INVALID_SOURCE_VERSION',`${name} must be a canonical 1-128 character source version`);return value;};
const requireStorageVersion=(value,name)=>{if(typeof value!=='string'||value!==value.trim()||value.length<1||value.length>512||value.startsWith('pending:')||/[\u0000-\u001f\u007f]/.test(value))throw new AccountingApiError(400,'INVALID_STORAGE_VERSION',`${name} must be a canonical finalized storage version of 1-512 printable characters`);return value;};
const requireAttachmentIds=value=>{if(!Array.isArray(value)||value.length<1||value.length>25||value.some(item=>!UUID.test(item||''))||new Set(value).size!==value.length)throw new AccountingApiError(400,'INVALID_ATTACHMENT_IDS','attachmentIds must contain 1-25 unique UUIDs');return value;};
const validateBody=body=>{if(!body||typeof body!=='object'||Array.isArray(body))throw new AccountingApiError(400,'JSON_OBJECT_REQUIRED','Request body must be a JSON object');for(const key of Object.keys(body))if(FORBIDDEN_BODY_KEYS.has(key))throw new AccountingApiError(400,'IDENTITY_FIELD_FORBIDDEN',`${key} must come from authenticated context`);return body;};
const allowOnly=(body,allowed)=>{const unexpected=Object.keys(body).filter(key=>!allowed.includes(key));if(unexpected.length)throw new AccountingApiError(400,'UNEXPECTED_FIELD',`Unexpected request field: ${unexpected[0]}`);return body;};

const isRevisionPrecondition=error=>error?.code==='40001'&&/(revision conflict|version conflict|period changed during transition|staging source changed during journal creation|lease is absent, stale, or owned)/i.test(String(error.message||''));
function statusFor(error){
  if(error instanceof WbsProviderSignedPayableAdmissionError)return /PERSISTENCE_REQUIRED|TRUST_REQUIRED/.test(error.code)?503:/SERVICE_IDENTITY_DENIED/.test(error.code)?403:error.code==='WBS_PROVIDER_SIGNED_RESULT_INVALID'?500:422;
  if(error instanceof WbsOperatorAttestedPayableError)return error.code==='WBS_OPERATOR_ATTEST_PROVIDER_UNAVAILABLE'?503:error.code==='WBS_OPERATOR_ATTEST_STALE_OBSERVATION'?412:error.code==='WBS_OPERATOR_ATTEST_RESULT_INVALID'?500:422;
  if(error instanceof WbsAdmittedPayableIngestionError)return /PERSISTENCE_REQUIRED|VERIFIER_REQUIRED|PERSISTENCE_FAILED/.test(error.code)?503:error.code==='WBS_PAYABLE_ADMISSION_IDEMPOTENCY_CONFLICT'?409:422;
  if(error instanceof WbsSignedBankAdmissionError)return 422;
  if(error instanceof WbsLivePilotError)return error.code==='WBS_LIVE_PILOT_PROVIDER_UNAVAILABLE'?503:error.code==='WBS_LIVE_PILOT_RESULT_INVALID'?500:400;
  if(error instanceof WbsReadContractError)return error.status;
  if(error instanceof AccountingApiError)return error.status;
  if(error?.code==='42501')return 403;if(error?.code==='P0002')return 404;
  if(error?.code==='WBS_SNAPSHOT_SIGNATURE_REQUIRED')return 503;
  if(error?.code==='WBS_SNAPSHOT_SIGNATURE_INVALID')return 422;
  if(error?.code==='WBS_BANK_ADMISSION_SIGNATURE_REQUIRED')return 503;
  if(error?.code==='WBS_BANK_ADMISSION_SIGNATURE_INVALID')return 422;
  if(error?.code==='40001')return isRevisionPrecondition(error)?412:503;
  if(error?.code==='23505')return 409;if(error?.code==='55000')return 423;
  if(['22023','23503','23514'].includes(error?.code))return 422;return 500;
}
  const problemFor=error=>{const status=statusFor(error);const code=isRevisionPrecondition(error)?'PRECONDITION_FAILED':error?.code==='WBS_SNAPSHOT_SIGNATURE_REQUIRED'?'WBS_SNAPSHOT_SIGNATURE_REQUIRED':error?.code==='WBS_BANK_ADMISSION_SIGNATURE_REQUIRED'?'WBS_BANK_ADMISSION_SIGNATURE_REQUIRED':error?.code==='WBS_READ_SERVICE_UNAVAILABLE'?'WBS_READ_SERVICE_UNAVAILABLE':error?.code==='WBS_PAYABLE_ADMISSION_UNAVAILABLE'?'WBS_PAYABLE_ADMISSION_UNAVAILABLE':error?.code==='WBS_OPERATOR_ATTEST_UNAVAILABLE'?'WBS_OPERATOR_ATTEST_UNAVAILABLE':error instanceof WbsProviderSignedPayableAdmissionError?error.code:error instanceof WbsOperatorAttestedPayableError?error.code:error instanceof WbsSignedBankAdmissionError?error.code:error instanceof WbsAdmittedPayableIngestionError?error.code:error instanceof WbsLivePilotError?error.code:error instanceof WbsReadContractError?error.code:status===503?'SERIALIZATION_RETRY_EXHAUSTED':error.code||'INTERNAL_ERROR';const message=status>=500?'Internal server error':status===403?'Forbidden':error.message;const headers={'content-type':'application/problem+json','cache-control':'no-store'};if(status===503)headers['retry-after']='1';return {status,headers,body:{ok:false,code,message}};};

export function createAccountingApi({authenticate,kernelFactory,attachmentServiceFactory,wbsReadServiceFactory,wbsLivePilotServiceFactory,wbsAdmittedPayableServiceFactory,wbsProviderSignedPayableServiceFactory,wbsOperatorAttestedPayableServiceFactory,stage1SelfGrantServiceFactory,stage1SelfWbsReadUpgradeServiceFactory,stage1SelfWbsOperatorUpgradeServiceFactory}={}){
  if(typeof authenticate!=='function'||typeof kernelFactory!=='function')throw new Error('Accounting API requires authenticate and kernelFactory');
  return async function dispatch({method,url,headers={},body=null}){
    try{
      const principal=await authenticate({method,url,headers});
      if(!principal||principal.trusted!==true||!UUID.test(principal.tenantId||'')||!principal.actorId)throw new AccountingApiError(401,'AUTHENTICATION_REQUIRED','Authenticated principal is required');
      const parsedUrl=new URL(url,'http://refs.local');const pathname=parsedUrl.pathname;const parts=pathname.split('/').filter(Boolean);
      if(parts[0]!=='api'||parts[1]!=='v1'||parts[2]!=='entities')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
      const entityId=requireUuid(parts[3],'entityId');const payload=method==='GET'&&body==null?{}:validateBody(body);
      let result;
      if(method==='POST'&&parts.length===7&&parts[4]==='access'&&parts[5]==='self-service-read-grant'&&parts[6]==='activate'){
        requireExactQuery(parsedUrl.searchParams,[]);
        if(Object.keys(payload).length)throw new AccountingApiError(400,'UNEXPECTED_FIELD','Self-service reader activation accepts no request fields');
        if(typeof stage1SelfGrantServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        const service=await stage1SelfGrantServiceFactory(principal);
        if(!service||typeof service.grant!=='function')throw new Error('Self-service reader activation is unavailable');
        result=await service.grant({entityId,idempotencyKey:requireIdempotency(headers)});
        return {status:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:{activated:true,idempotent:result.idempotent===true,permission_count:result.permissionCount}}};
      }
      if(method==='POST'&&parts.length===7&&parts[4]==='access'&&parts[5]==='self-service-wbs-read-grant'&&parts[6]==='upgrade'){
        requireExactQuery(parsedUrl.searchParams,[]);
        if(Object.keys(payload).length)throw new AccountingApiError(400,'UNEXPECTED_FIELD','Self-service WBS reader upgrade accepts no request fields');
        if(typeof stage1SelfWbsReadUpgradeServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        const service=await stage1SelfWbsReadUpgradeServiceFactory(principal);
        if(!service||typeof service.upgrade!=='function')throw new Error('Self-service WBS reader upgrade is unavailable');
        result=await service.upgrade({entityId,idempotencyKey:requireIdempotency(headers)});
        return {status:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:{upgraded:true,idempotent:result.idempotent===true,permission_count:result.permissionCount}}};
      }
      if(method==='POST'&&parts.length===7&&parts[4]==='access'&&parts[5]==='self-service-wbs-operator-grant'&&parts[6]==='upgrade'){
        requireExactQuery(parsedUrl.searchParams,[]);
        if(Object.keys(payload).length)throw new AccountingApiError(400,'UNEXPECTED_FIELD','Self-service WBS operator upgrade accepts no request fields');
        if(typeof stage1SelfWbsOperatorUpgradeServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        const service=await stage1SelfWbsOperatorUpgradeServiceFactory(principal);
        if(!service||typeof service.upgrade!=='function')throw new Error('Self-service WBS operator upgrade is unavailable');
        result=await service.upgrade({entityId,idempotencyKey:requireIdempotency(headers)});
        return {status:result.idempotent===true?200:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:{upgraded:true,idempotent:result.idempotent===true,permission_count:result.permissionCount}}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='wbs'&&parts[5]==='live-pilot'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        if(typeof wbsLivePilotServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        const selection=parseWbsLivePilotSelection(parsedUrl.searchParams),service=await wbsLivePilotServiceFactory(principal);
        if(!service||typeof service.readObservation!=='function')throw new WbsLivePilotError('WBS_LIVE_PILOT_PROVIDER_UNAVAILABLE','WBS live pilot service is unavailable.');
        const scopedSelection={tenantId:principal.tenantId,entityId,tool:selection.tool,limit:selection.limit};
        if(selection.company_code)scopedSelection.company_code=selection.company_code;
        if(selection.date_from){scopedSelection.date_from=selection.date_from;scopedSelection.date_to=selection.date_to;}
        result=await service.readObservation(scopedSelection);
        assertWbsLivePilotResult(result,{entityId,tool:selection.tool,limit:selection.limit});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[7]==='reviews'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','WBS Payable evidence reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listWbsPayableReviewEvidence!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_EVIDENCE_READ_UNAVAILABLE','WBS Payable evidence read is unavailable');
        result=await kernel.listWbsPayableReviewEvidence({tenantId:principal.tenantId,entityId,limit:optionalAdmittedStatementLimit(parsedUrl.searchParams.get('limit'))});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[7]==='review-candidates'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','WBS Payable review-candidate reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listWbsPayableReviewCandidates!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_REVIEW_CANDIDATE_READ_UNAVAILABLE','WBS Payable review-candidate read is unavailable');
        result=await kernel.listWbsPayableReviewCandidates({tenantId:principal.tenantId,entityId,limit:optionalAdmittedStatementLimit(parsedUrl.searchParams.get('limit'))});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===9&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[7]==='review-candidates'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','WBS Payable review-candidate reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.getWbsPayableReviewCandidate!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_REVIEW_CANDIDATE_READ_UNAVAILABLE','WBS Payable review-candidate read is unavailable');
        result=await kernel.getWbsPayableReviewCandidate({tenantId:principal.tenantId,entityId,wbsInboundRowId:requireUuid(parts[8],'wbsInboundRowId')});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result[0]}};
      }
      if(method==='GET'&&parts.length===9&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[7]==='reviews'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','WBS Payable evidence reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.getWbsPayableReviewEvidence!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_EVIDENCE_READ_UNAVAILABLE','WBS Payable evidence read is unavailable');
        result=await kernel.getWbsPayableReviewEvidence({tenantId:principal.tenantId,entityId,reviewEvidenceId:requireUuid(parts[8],'reviewEvidenceId')});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result[0]}};
      }
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
      if(method==='GET'&&parts.length===6&&parts[4]==='journal-workflow'&&parts[5]==='capabilities'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.getJournalWorkflowCapabilities!=='function')throw new AccountingApiError(503,'JOURNAL_WORKFLOW_CAPABILITIES_UNAVAILABLE','Journal workflow capabilities are unavailable');
        result=await kernel.getJournalWorkflowCapabilities({tenantId:principal.tenantId,entityId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='journal-entries'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const journalEntryId=requireUuid(parts[5],'journalEntryId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        try{result=await kernel.getJournalEntryDetail({tenantId:principal.tenantId,entityId,periodId,journalEntryId});}
        catch(error){if(error?.code==='P0002')throw new AccountingApiError(404,'JOURNAL_ENTRY_NOT_FOUND','Journal entry was not found');throw error;}
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===5&&parts[4]==='source-documents'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listSourceDocuments({tenantId:principal.tenantId,entityId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='source-documents'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getSourceDocumentDetail({tenantId:principal.tenantId,entityId,sourceDocumentId:requireUuid(parts[5],'sourceDocumentId')});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='general-ledger'&&parts[5]==='chart-of-accounts'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listChartOfAccounts({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='general-ledger'&&parts[5]==='account-register'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','accountCode']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const accountCode=requireAccountCode(parsedUrl.searchParams.get('accountCode'));
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listAccountRegister({tenantId:principal.tenantId,entityId,periodId,accountCode});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='general-ledger'&&parts[5]==='entries'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','accountCode','query','limit','offset']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listGeneralLedger({tenantId:principal.tenantId,entityId,periodId,accountCode:optionalAccountCode(parsedUrl.searchParams.get('accountCode')),query:optionalLedgerQuery(parsedUrl.searchParams.get('query')),limit:optionalReadLimit(parsedUrl.searchParams.get('limit')),offset:optionalReadOffset(parsedUrl.searchParams.get('offset'))});
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
      if(method==='GET'&&parts.length===8&&parts[4]==='bank'&&parts[5]==='transactions'&&parts[7]==='match-candidates'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listBankMatchCandidates({tenantId:principal.tenantId,entityId,bankSourceId:requireUuid(parts[6],'bankSourceId')});
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
      if(method==='GET'&&parts.length===7&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[6]==='admitted-statements'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['bankAccountRef','limit']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listAdmittedWbsBankStatementReceipts!=='function')throw new AccountingApiError(503,'ADMITTED_STATEMENT_READ_UNAVAILABLE','Admitted statement read service is unavailable');
        result=await kernel.listAdmittedWbsBankStatementReceipts({tenantId:principal.tenantId,entityId,bankAccountRef:requireBankAccountRef(parsedUrl.searchParams.get('bankAccountRef')),limit:optionalAdmittedStatementLimit(parsedUrl.searchParams.get('limit'))});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[6]==='admitted-statements'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.getAdmittedWbsBankStatementReceipt!=='function')throw new AccountingApiError(503,'ADMITTED_STATEMENT_READ_UNAVAILABLE','Admitted statement read service is unavailable');
        result=await kernel.getAdmittedWbsBankStatementReceipt({tenantId:principal.tenantId,entityId,statementReceiptId:requireUuid(parts[7],'statementReceiptId')});
        if(!Array.isArray(result)||result.length!==1)throw new AccountingApiError(404,'ADMITTED_STATEMENT_NOT_FOUND','Admitted statement receipt was not found in this entity');
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result[0]}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[7]==='worksheet'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listReconciliationWorksheet({tenantId:principal.tenantId,entityId,reconciliationId:requireUuid(parts[6],'reconciliationId')});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='financial-statements'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getFinancialStatements({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='consolidation'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','groupRef']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const groupRef=requireDimensionRef(parsedUrl.searchParams.get('groupRef'));
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getConsolidation({tenantId:principal.tenantId,entityId,periodId,groupRef});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='financial-statement-period-comparison'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['currentPeriodId','priorPeriodId']);
        const currentPeriodId=requireUuid(parsedUrl.searchParams.get('currentPeriodId'),'currentPeriodId');
        const priorPeriodId=requireUuid(parsedUrl.searchParams.get('priorPeriodId'),'priorPeriodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getFinancialStatementPeriodComparison({tenantId:principal.tenantId,entityId,currentPeriodId,priorPeriodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='dimension-profitability'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','dimensionType','dimensionRef']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const dimensionType=requireDimensionType(parsedUrl.searchParams.get('dimensionType'));
        const dimensionRef=requireDimensionRef(parsedUrl.searchParams.get('dimensionRef'));
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getDimensionProfitability({tenantId:principal.tenantId,entityId,periodId,dimensionType,dimensionRef});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='cash-flow-classification'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getCashFlowClassification({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='cwip-rollforward'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getCwipRollforward({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='construction-loan-rollforward'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getConstructionLoanRollforward({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='prepaid-rollforward'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getPrepaidRollforward({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='intercompany-reconciliation'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','counterpartyEntityId','counterpartyPeriodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const counterpartyEntityId=requireUuid(parsedUrl.searchParams.get('counterpartyEntityId'),'counterpartyEntityId');
        const counterpartyPeriodId=requireUuid(parsedUrl.searchParams.get('counterpartyPeriodId'),'counterpartyPeriodId');
        if(counterpartyEntityId===entityId)throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','counterpartyEntityId must differ from entityId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getIntercompanyReconciliation({tenantId:principal.tenantId,entityId,periodId,counterpartyEntityId,counterpartyPeriodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='budget-vs-actual'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getBudgetVsActual({tenantId:principal.tenantId,entityId,periodId});
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
      if(method==='GET'&&parts.length===7&&parts[4]==='wbs'&&parts[5]==='operator-attested'&&parts[6]==='payables'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','Operator-attested evidence reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?50:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 50');
        const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.listWbsOperatorPayableAttestations!=='function')throw new AccountingApiError(503,'WBS_OPERATOR_ATTEST_UNAVAILABLE','Operator-attested WBS Payable evidence is unavailable');
        result=await kernel.listWbsOperatorPayableAttestations({tenantId:principal.tenantId,entityId,limit});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===10&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[8]==='attachments'&&parts[9]==='uploads'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','Attachment upload reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.listWbsPayableAttachmentUploads!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_ATTACHMENT_UPLOAD_READ_UNAVAILABLE','Row-bound attachment status is unavailable');
        result=await kernel.listWbsPayableAttachmentUploads({tenantId:principal.tenantId,entityId,wbsInboundRowId:requireUuid(parts[7],'wbsInboundRowId')});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='wbs'&&parts[5]==='control-reconciliation'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        if(typeof wbsReadServiceFactory!=='function')throw new AccountingApiError(503,'WBS_READ_SERVICE_UNAVAILABLE','WBS read service is unavailable');
        const selection=parseWbsControlReconciliationSelection(parsedUrl.searchParams);
        const service=await wbsReadServiceFactory(principal);
        if(!service||typeof service.readControlReconciliation!=='function')throw new AccountingApiError(503,'WBS_READ_SERVICE_UNAVAILABLE','WBS read service is unavailable');
        result=assertWbsControlReadOnlyResult(await service.readControlReconciliation({tenantId:principal.tenantId,entityId,sourceType:selection.sourceType,scope:selection.scope}));
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='POST'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='auto-reconciliation'&&parts[6]==='transition-contracts'&&parts[7]==='verify'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'WBS_AUTOREC_TRANSITION_CONTRACT_VERIFY_HEADERS_FORBIDDEN','Signed transition-contract verification is a read-only evidence operation and does not accept command headers');
        allowOnly(payload,['contract']);const contract=payload.contract;if(!contract||typeof contract!=='object'||Array.isArray(contract))throw new AccountingApiError(400,'WBS_AUTOREC_TRANSITION_CONTRACT_INVALID','contract must be a JSON object');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.verifyWbsAutoRecTransitionContract!=='function')throw new AccountingApiError(503,'WBS_AUTOREC_TRANSITION_CONTRACT_UNAVAILABLE','WBS AutoRec transition-contract verification is unavailable');
        result=await kernel.verifyWbsAutoRecTransitionContract({tenantId:principal.tenantId,entityId,contract});
        if(!result||result.signature_verified!==true||result.can_transition_refs!==false||result.can_release!==false||result.can_incur!==false||result.can_reverse!==false||result.can_create_draft!==false||result.can_post!==false)throw new AccountingApiError(422,'WBS_AUTOREC_TRANSITION_CONTRACT_RESPONSE_INVALID','Verified WBS transition-contract evidence must not grant REFS action authority');
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
      }else if(parts.length===10&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[8]==='attachments'&&parts[9]==='reservations'){
        if(typeof attachmentServiceFactory!=='function')throw new AccountingApiError(503,'ATTACHMENT_SERVICE_UNAVAILABLE','Attachment service is unavailable');
        allowOnly(payload,['name','mediaType','sizeBytes','contentHash']);const service=await attachmentServiceFactory(principal);
        if(!service||typeof service.reserveWbsPayable!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_ATTACHMENT_RESERVE_UNAVAILABLE','Row-bound attachment reservation is unavailable');
        result=await service.reserveWbsPayable(principal,{...payload,tenantId:principal.tenantId,entityId,wbsInboundRowId:requireUuid(parts[7],'wbsInboundRowId'),idempotencyKey});
      }else if(parts.length===7&&parts[4]==='attachments'&&parts[6]==='finalize'){
        if(typeof attachmentServiceFactory!=='function')throw new AccountingApiError(503,'ATTACHMENT_SERVICE_UNAVAILABLE','Attachment service is unavailable');
        allowOnly(payload,[]);const service=await attachmentServiceFactory(principal);
        try{result=await service.finalize(principal,{tenantId:principal.tenantId,entityId,attachmentId:requireUuid(parts[5],'attachmentId'),idempotencyKey});}
        catch(error){if(['42501','P0002','ATTACHMENT_NOT_FOUND'].includes(error?.code))throw new AccountingApiError(404,'ATTACHMENT_NOT_FOUND','Attachment was not found');throw error;}
      }else if(parts.length===6&&parts[4]==='wbs'&&parts[5]==='snapshots'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['snapshot']);
        result=await kernel.recordWbsSnapshot({tenantId:principal.tenantId,entityId,snapshot:payload.snapshot,idempotencyKey});
      }else if(parts.length===7&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'){
        if(typeof wbsAdmittedPayableServiceFactory!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_ADMISSION_UNAVAILABLE','Admitted WBS payable ingestion is unavailable');
        allowOnly(payload,['snapshot']);const service=await wbsAdmittedPayableServiceFactory(principal);
        if(!service||typeof service.ingest!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_ADMISSION_UNAVAILABLE','Admitted WBS payable ingestion is unavailable');
        result=await service.ingest({tenantId:principal.tenantId,entityId,snapshot:payload.snapshot,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='wbs'&&parts[5]==='provider-signed'&&parts[6]==='payables'&&parts[7]==='admissions'){
        requireExactQuery(parsedUrl.searchParams,[]);
        allowOnly(payload,['receipt','requestRawBase64','responseRawBase64','packageRawBase64']);
        if(typeof wbsProviderSignedPayableServiceFactory!=='function')throw new AccountingApiError(503,'WBS_PROVIDER_SIGNED_ADMISSION_UNAVAILABLE','Provider-signed WBS Payable admission is unavailable');
        const service=await wbsProviderSignedPayableServiceFactory(principal);
        if(!service||typeof service.admit!=='function')throw new AccountingApiError(503,'WBS_PROVIDER_SIGNED_ADMISSION_UNAVAILABLE','Provider-signed WBS Payable admission is unavailable');
        result=await service.admit({tenantId:principal.tenantId,entityId,receipt:payload.receipt,requestRawBase64:payload.requestRawBase64,responseRawBase64:payload.responseRawBase64,packageRawBase64:payload.packageRawBase64,idempotencyKey});
      }else if(parts.length===7&&parts[4]==='wbs'&&parts[5]==='operator-attested'&&parts[6]==='payables'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['expectedObservationHash','expectedProviderContentSha256','expectedCompanyCode','dateFrom','dateTo','reason','limit']);
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','Operator attestation uses exact observation hashes, not If-Match');
        if(typeof wbsOperatorAttestedPayableServiceFactory!=='function')throw new AccountingApiError(503,'WBS_OPERATOR_ATTEST_UNAVAILABLE','Operator-attested WBS Payable persistence is unavailable');
        const service=await wbsOperatorAttestedPayableServiceFactory(principal);
        if(!service||typeof service.attest!=='function')throw new AccountingApiError(503,'WBS_OPERATOR_ATTEST_UNAVAILABLE','Operator-attested WBS Payable persistence is unavailable');
        const expectedCompanyCode=payload.expectedCompanyCode==null?null:requireDimensionRef(payload.expectedCompanyCode),hasDates=payload.dateFrom!=null||payload.dateTo!=null;
        if(expectedCompanyCode!==null&&!/^[A-Za-z0-9][A-Za-z0-9_:-]{0,63}$/.test(expectedCompanyCode))throw new AccountingApiError(400,'INVALID_COMPANY_SCOPE','expectedCompanyCode must be one canonical WBS company code');
        if(hasDates&&(payload.dateFrom==null||payload.dateTo==null))throw new AccountingApiError(400,'INVALID_DATE_SCOPE','dateFrom and dateTo must be supplied together');
        result=await service.attest({tenantId:principal.tenantId,entityId,expectedObservationHash:requireSha256(payload.expectedObservationHash,'expectedObservationHash'),expectedProviderContentSha256:requireBareSha256(payload.expectedProviderContentSha256,'expectedProviderContentSha256'),expectedCompanyCode,dateFrom:hasDates?requireIsoDate(payload.dateFrom,'dateFrom'):null,dateTo:hasDates?requireIsoDate(payload.dateTo,'dateTo'):null,reason:requireReviewReason(payload.reason),limit:Number.isSafeInteger(payload.limit)&&payload.limit>=1&&payload.limit<=10?payload.limit:(()=>{throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 10');})(),idempotencyKey});
      }else if(parts.length===10&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[8]==='attachments'&&parts[9]==='bindings'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['attachmentId','expectedSourceVersion','expectedReceiptHash','expectedProviderReceiptHash','expectedEvidenceHash','expectedAttachmentContentHash','expectedAttachmentStorageVersion','reason']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.bindWbsPayableAttachment!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_ATTACHMENT_BIND_UNAVAILABLE','WBS Payable attachment binding is unavailable');
        const bound=await kernel.bindWbsPayableAttachment({tenantId:principal.tenantId,entityId,wbsInboundRowId:requireUuid(parts[7],'wbsInboundRowId'),attachmentId:requireUuid(payload.attachmentId,'attachmentId'),expectedRevision:requireRevision(headers),expectedSourceVersion:requireSourceVersion(payload.expectedSourceVersion,'expectedSourceVersion'),expectedReceiptHash:requireSha256(payload.expectedReceiptHash,'expectedReceiptHash'),expectedProviderReceiptHash:requireSha256(payload.expectedProviderReceiptHash,'expectedProviderReceiptHash'),expectedEvidenceHash:requireSha256(payload.expectedEvidenceHash,'expectedEvidenceHash'),expectedAttachmentContentHash:requireSha256(payload.expectedAttachmentContentHash,'expectedAttachmentContentHash'),expectedAttachmentStorageVersion:requireStorageVersion(payload.expectedAttachmentStorageVersion,'expectedAttachmentStorageVersion'),reason:requireReviewReason(payload.reason),idempotencyKey});
        if(!bound||bound.status!=='BOUND_EVIDENCE_ONLY'||bound.can_review!==false||bound.can_create_draft!==false||bound.can_approve!==false||bound.can_post!==false)throw new AccountingApiError(500,'WBS_PAYABLE_ATTACHMENT_BIND_RESULT_INVALID','WBS Payable attachment binding must remain evidence-only');
        result=bound;
      }else if(parts.length===11&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[8]==='attachments'&&parts[9]==='bindings'&&parts[10]==='from-upload'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['attachmentId','reason']);const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.bindWbsPayableUploadedAttachment!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_ATTACHMENT_BIND_UNAVAILABLE','Safe row-bound attachment binding is unavailable');
        const bound=await kernel.bindWbsPayableUploadedAttachment({tenantId:principal.tenantId,entityId,
          wbsInboundRowId:requireUuid(parts[7],'wbsInboundRowId'),attachmentId:requireUuid(payload.attachmentId,'attachmentId'),
          expectedRevision:requireRevision(headers),reason:requireReviewReason(payload.reason),idempotencyKey});
        if(!bound||bound.status!=='BOUND_EVIDENCE_ONLY'||bound.can_review!==false||bound.can_create_draft!==false||bound.can_approve!==false||bound.can_post!==false)throw new AccountingApiError(500,'WBS_PAYABLE_ATTACHMENT_BIND_RESULT_INVALID','WBS Payable attachment binding must remain evidence-only');
        result=bound;
      }else if(parts.length===9&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[8]==='reviews'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['periodId','expectedSourceVersion','expectedReceiptHash','expectedEvidenceHash','settingSnapshotId','mappingSnapshotId','attachmentIds','reason']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.reviewWbsPayable!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_REVIEW_UNAVAILABLE','WBS payable review is unavailable');
        const reviewed=await kernel.reviewWbsPayable({tenantId:principal.tenantId,entityId,wbsInboundRowId:requireUuid(parts[7],'wbsInboundRowId'),periodId:requireUuid(payload.periodId,'periodId'),expectedRevision:requireRevision(headers),expectedSourceVersion:requireSourceVersion(payload.expectedSourceVersion,'expectedSourceVersion'),expectedReceiptHash:requireSha256(payload.expectedReceiptHash,'expectedReceiptHash'),expectedEvidenceHash:requireSha256(payload.expectedEvidenceHash,'expectedEvidenceHash'),settingSnapshotId:requireUuid(payload.settingSnapshotId,'settingSnapshotId'),mappingSnapshotId:requireUuid(payload.mappingSnapshotId,'mappingSnapshotId'),attachmentIds:requireAttachmentIds(payload.attachmentIds),reason:requireReviewReason(payload.reason),idempotencyKey});
        if(!reviewed||reviewed.can_create_draft!==false||reviewed.can_approve!==false||reviewed.can_post!==false)throw new AccountingApiError(500,'WBS_PAYABLE_REVIEW_RESULT_INVALID','WBS payable review must remain evidence-only');
        result=reviewed;
      }else if(parts.length===9&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[8]==='drafts'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['reviewEvidenceId','expectedEvidenceHash','mappingSnapshotId','attachmentIds','reason']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.createWbsPayableApDraft!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_AP_DRAFT_UNAVAILABLE','WBS Payable AP Draft creation is unavailable');
        const drafted=await kernel.createWbsPayableApDraft({tenantId:principal.tenantId,entityId,wbsInboundRowId:requireUuid(parts[7],'wbsInboundRowId'),reviewEvidenceId:requireUuid(payload.reviewEvidenceId,'reviewEvidenceId'),expectedRevision:requireRevision(headers),expectedEvidenceHash:requireSha256(payload.expectedEvidenceHash,'expectedEvidenceHash'),mappingSnapshotId:requireUuid(payload.mappingSnapshotId,'mappingSnapshotId'),attachmentIds:requireAttachmentIds(payload.attachmentIds),reason:requireReviewReason(payload.reason),idempotencyKey});
        if(!drafted||drafted.status!=='DRAFT'||drafted.journal_type!=='AUTO'||drafted.can_create_draft!==false||drafted.can_submit!==false||drafted.can_review!==false||drafted.can_approve!==false||drafted.can_post!==false)throw new AccountingApiError(500,'WBS_PAYABLE_AP_DRAFT_RESULT_INVALID','WBS Payable AP Draft creation must stop at an unsubmitted AUTO Draft');
        result=drafted;
      }else if(parts.length===7&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='bank-statements'){
        requireExactQuery(parsedUrl.searchParams,[]);
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by signed WBS bank admission');
        allowOnly(payload,['admission']);const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.admitWbsSignedBankStatement!=='function')throw new AccountingApiError(503,'WBS_BANK_ADMISSION_UNAVAILABLE','Signed WBS bank admission is unavailable');
        const admitted=await kernel.admitWbsSignedBankStatement({tenantId:principal.tenantId,entityId,admission:payload.admission,idempotencyKey});
        result={...admitted,can_match:false,can_reconcile:false,can_create_draft:false,can_post:false};
      }else if(parts.length===6&&parts[4]==='journal-entries'&&parts[5]==='manual'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.createManualJournal({...payload,tenantId:principal.tenantId,entityId,idempotencyKey});
      }else if(parts.length===6&&parts[4]==='journal-entries'&&parts[5]==='auto'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.createAutoJournal({...payload,tenantId:principal.tenantId,entityId,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='bank'&&parts[5]==='transactions'&&parts[7]==='matches'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['paymentOccurrenceId','expectedOccurrenceRevision','reason']);
        if(!Number.isSafeInteger(payload.expectedOccurrenceRevision)||payload.expectedOccurrenceRevision<0)throw new AccountingApiError(400,'INVALID_REVISION','expectedOccurrenceRevision must be a non-negative safe integer');
        result=await kernel.createBankPaymentMatch({tenantId:principal.tenantId,entityId,bankSourceId:requireUuid(parts[6],'bankSourceId'),paymentOccurrenceId:requireUuid(payload.paymentOccurrenceId,'paymentOccurrenceId'),expectedBankVersion:requireRevision(headers),expectedOccurrenceVersion:payload.expectedOccurrenceRevision,reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===10&&parts[4]==='bank'&&parts[5]==='transactions'&&parts[7]==='matches'&&parts[9]==='unmatch'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['reason']);
        result=await kernel.unmatchBankPayment({tenantId:principal.tenantId,entityId,bankSourceId:requireUuid(parts[6],'bankSourceId'),bankMatchId:requireUuid(parts[8],'bankMatchId'),expectedMatchVersion:requireRevision(headers),reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===6&&parts[4]==='bank'&&parts[5]==='reconciliations'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['bankAccountRef','statementEndingDate','statementOpeningBalance','statementEndingBalance','reason']);
        result=await kernel.startReconciliation({tenantId:principal.tenantId,entityId,bankAccountRef:requireBankAccountRef(payload.bankAccountRef),statementEndingDate:requireIsoDate(payload.statementEndingDate,'statementEndingDate'),statementOpeningBalance:requireDecimalAmount(payload.statementOpeningBalance,'statementOpeningBalance'),statementEndingBalance:requireDecimalAmount(payload.statementEndingBalance,'statementEndingBalance'),reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===7&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[6]==='from-admitted-statement'){
        requireExactQuery(parsedUrl.searchParams,[]);
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used when starting from an immutable admitted statement');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.startReconciliationFromAdmittedWbsStatement!=='function')throw new AccountingApiError(503,'WBS_STATEMENT_RECONCILIATION_UNAVAILABLE','Admitted statement reconciliation is unavailable');
        allowOnly(payload,['statementReceiptId','reason']);
        result=await kernel.startReconciliationFromAdmittedWbsStatement({tenantId:principal.tenantId,entityId,statementReceiptId:requireUuid(payload.statementReceiptId,'statementReceiptId'),reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===10&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[7]==='items'&&parts[9]==='clearance'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['clear','expectedBankRevision','reason']);
        if(typeof payload.clear!=='boolean')throw new AccountingApiError(400,'INVALID_CLEARANCE_STATE','clear must be an explicit boolean');
        if(!Number.isSafeInteger(payload.expectedBankRevision)||payload.expectedBankRevision<0)throw new AccountingApiError(400,'INVALID_REVISION','expectedBankRevision must be a non-negative safe integer');
        result=await kernel.setReconciliationClearance({tenantId:principal.tenantId,entityId,reconciliationId:requireUuid(parts[6],'reconciliationId'),bankSourceId:requireUuid(parts[8],'bankSourceId'),expectedReconciliationVersion:requireRevision(headers),expectedBankVersion:payload.expectedBankRevision,clear:payload.clear,reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===10&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[7]==='adjustment-items'&&parts[9]==='clearance'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['clear','expectedBankRevision','reason']);
        if(typeof payload.clear!=='boolean')throw new AccountingApiError(400,'INVALID_CLEARANCE_STATE','clear must be an explicit boolean');
        if(!Number.isSafeInteger(payload.expectedBankRevision)||payload.expectedBankRevision<0)throw new AccountingApiError(400,'INVALID_REVISION','expectedBankRevision must be a non-negative safe integer');
        result=await kernel.setReconciliationAdjustmentClearance({tenantId:principal.tenantId,entityId,reconciliationId:requireUuid(parts[6],'reconciliationId'),bankSourceId:requireUuid(parts[8],'bankSourceId'),expectedReconciliationVersion:requireRevision(headers),expectedBankVersion:payload.expectedBankRevision,clear:payload.clear,reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===9&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[7]==='transitions'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['reason']);
        const action=parts[8].toUpperCase();if(!['REVIEW','SIGN_OFF','REOPEN'].includes(action))throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        result=await kernel.transitionReconciliation({tenantId:principal.tenantId,entityId,reconciliationId:requireUuid(parts[6],'reconciliationId'),action,expectedVersion:requireRevision(headers),reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===8&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[7]==='adjustment-drafts'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['bankSourceId','periodId','journalNumber','journalDate','currency','description','lines','attachmentIds','reason']);
        result=await kernel.createReconciliationAdjustmentDraft({
          tenantId:principal.tenantId,entityId,reconciliationId:requireUuid(parts[6],'reconciliationId'),expectedReconciliationVersion:requireRevision(headers),
          bankSourceId:requireUuid(payload.bankSourceId,'bankSourceId'),periodId:requireUuid(payload.periodId,'periodId'),journalNumber:payload.journalNumber,journalDate:requireIsoDate(payload.journalDate,'journalDate'),
          currency:payload.currency,description:payload.description??null,lines:payload.lines,attachmentIds:payload.attachmentIds,
          reason:requireReviewReason(payload.reason),idempotencyKey
        });
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

const corsHeaders=(origin,allowedOrigins)=>origin&&allowedOrigins.has(origin)?{'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'authorization, content-type, idempotency-key, if-match','access-control-max-age':'600','vary':'Origin'}:{};

export function createAccountingHttpServer({authenticate,kernelFactory,attachmentServiceFactory,wbsReadServiceFactory,wbsLivePilotServiceFactory,wbsAdmittedPayableServiceFactory,wbsProviderSignedPayableServiceFactory,wbsOperatorAttestedPayableServiceFactory,stage1SelfGrantServiceFactory,stage1SelfWbsReadUpgradeServiceFactory,stage1SelfWbsOperatorUpgradeServiceFactory,maxBodyBytes=1024*1024,healthCheck,allowedOrigins=[]}={}){
  const allowed=new Set(allowedOrigins);
  const dispatch=createAccountingApi({authenticate,kernelFactory,attachmentServiceFactory,wbsReadServiceFactory,wbsLivePilotServiceFactory,wbsAdmittedPayableServiceFactory,wbsProviderSignedPayableServiceFactory,wbsOperatorAttestedPayableServiceFactory,stage1SelfGrantServiceFactory,stage1SelfWbsReadUpgradeServiceFactory,stage1SelfWbsOperatorUpgradeServiceFactory});
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
      let body=null;if(chunks.length){try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AccountingApiError(400,'INVALID_JSON','Request body is not valid JSON');}}
      const response=await dispatch({method:req.method,url:req.url,headers:req.headers,body});res.writeHead(response.status,{...response.headers,...cors});res.end(JSON.stringify(response.body));
    }catch(error){const problem=problemFor(error);res.writeHead(problem.status,problem.headers);res.end(JSON.stringify(problem.body));}
  });
}
