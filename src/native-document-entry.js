import {accountingApiConfig,authoritativeBearerHeaders,createAuthoritativeBusinessDocument,refreshAuthoritativeChartOfAccounts,refreshAuthoritativeScope,refreshCurrentActorAccess} from './accounting-api.js';
import {uploadVerifiedAttachment,validateAttachmentFile} from './attachment-api.js';

const fail=(code,message)=>({ok:false,code,message});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text=(value,max,empty=false)=>typeof value==='string'&&value===value.trim()&&value.length<=max&&(empty||value.length>0)&&!/[\u0000-\u001f\u007f]/.test(value);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const kindValid=kind=>['AP_BILL','AR_INVOICE'].includes(kind);
const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key));
const compare=(a,b)=>{const left=Array.from(a),right=Array.from(b);for(let i=0;i<Math.min(left.length,right.length);i++){const delta=left[i].codePointAt(0)-right[i].codePointAt(0);if(delta)return delta;}return left.length-right.length;};
const hash=async(value,cryptoApi)=>Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)),byte=>byte.toString(16).padStart(2,'0')).join('');
const normalizeConfig=config=>accountingApiConfig({__REFS_ACCOUNTING_API__:config});

export const nativeDocumentEntryAccess=(config,kind,access)=>kindValid(kind)&&access?.entity_id===config?.entityId&&text(access?.actor_id,200)&&access?.session_refresh_required===false
  &&Array.isArray(access.permissions)&&access.permissions.includes(kind==='AP_BILL'?'AP.BILL.CREATE':'AR.INVOICE.CREATE')&&access.permissions.includes('ATTACHMENT.CREATE');

export async function readNativeDocumentCounterparties({config,kind,query='',afterRef=null,limit=50,fetcher=globalThis.fetch}={}){
  if(!normalizeConfig(config)||!kindValid(kind)||!text(query,128,true)||afterRef!==null&&!text(afterRef,128)||!Number.isInteger(limit)||limit<1||limit>100||typeof fetcher!=='function')return fail('COUNTERPARTY_SEARCH_INVALID','Choose a valid company and counterparty search.');
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('AUTHENTICATION_REQUIRED','Sign in to search counterparties.');
  const params=new URLSearchParams({kind,query,limit:String(limit)});if(afterRef!==null)params.set('afterRef',afterRef);
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/business-documents/draft-counterparties?${params}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return fail(response.status===403?'AUTHORIZATION_DENIED':'COUNTERPARTY_SEARCH_UNAVAILABLE','Counterparty search is unavailable for this company and access.');
    const body=await response.json(),value=body?.data;
    if(body?.ok!==true||!exact(value,['schema_version','entity_id','document_kind','query','after_ref','limit','rows','next_ref'])||value.schema_version!=='BUSINESS_DOCUMENT_COUNTERPARTIES_V1'||value.entity_id!==config.entityId||value.document_kind!==kind||value.query!==query||value.after_ref!==afterRef||value.limit!==limit||!Array.isArray(value.rows)||value.rows.length>limit)throw Error('page');
    let previous=afterRef;
    for(const row of value.rows){if(!exact(row,['member_ref','member_type','display_name'])||!text(row.member_ref,128)||!text(row.display_name,10000)||!(kind==='AP_BILL'?['VENDOR']:['CUSTOMER','AFFILIATE']).includes(row.member_type)||previous!==null&&compare(previous,row.member_ref)>=0)throw Error('row');previous=row.member_ref;}
    if(value.next_ref!==null&&(value.rows.length!==limit||value.next_ref!==previous))throw Error('cursor');
    return {ok:true,data:value};
  }catch{return fail('COUNTERPARTY_SEARCH_UNCONFIRMED','Counterparty results could not be confirmed. Retry the search.');}
}

export function validateNativeDocumentDraft({config,kind,draft,counterparty,attachmentId,scope,accounts=[]}={}){
  if(!kindValid(kind)||!scope||scope.entity_id!==config?.entityId||scope.period_id!==config?.periodId||scope.period_status!=='OPEN'||!validDate(scope.period_start)||!validDate(scope.period_end))return fail('PERIOD_NOT_OPEN','Select an open accounting period.');
  if(!draft||!text(draft.documentNumber,128))return fail('DOCUMENT_NUMBER_REQUIRED','Enter a document number.');
  if(!counterparty||!text(counterparty.member_ref,128)||!text(counterparty.display_name,255)||!(kind==='AP_BILL'?['VENDOR']:['CUSTOMER','AFFILIATE']).includes(counterparty.member_type))return fail('COUNTERPARTY_REQUIRED','Choose a counterparty from the company search.');
  if(!validDate(draft.accountingDate)||draft.accountingDate<scope.period_start||draft.accountingDate>scope.period_end)return fail('DOCUMENT_DATE_INVALID','Enter an accounting date within the selected period.');
  if(draft.dueDate&&(!validDate(draft.dueDate)||draft.dueDate<draft.accountingDate))return fail('DUE_DATE_INVALID','The due date must be on or after the accounting date.');
  if(typeof draft.amount!=='string'||!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/.test(draft.amount)||!/[1-9]/.test(draft.amount))return fail('AMOUNT_INVALID','Enter a positive amount with up to four decimal places.');
  if(!/^[A-Z]{3}$/.test(draft.currency||''))return fail('CURRENCY_INVALID','Enter a three-letter currency code.');
  if(!accounts.some(row=>row.account_code===draft.offsetAccountCode&&row.active===true&&row.requires_member===false&&row.period_id===config.periodId&&(!row.entity_id||row.entity_id===config.entityId)))return fail('ACCOUNT_REQUIRED','Choose an active category account that does not require a separate member.');
  if(!UUID.test(attachmentId||''))return fail('ATTACHMENT_REQUIRED','Upload and verify a supporting document first.');
  if(!text(draft.description??'',2000,true))return fail('DESCRIPTION_INVALID','Use a description of at most 2,000 characters.');
  return {ok:true,document:{documentNumber:draft.documentNumber,counterpartyRef:counterparty.member_ref,counterpartyName:counterparty.display_name,currency:draft.currency,accountingDate:draft.accountingDate,...(draft.dueDate?{dueDate:draft.dueDate}:{}),amount:draft.amount,offsetAccountCode:draft.offsetAccountCode,description:draft.description||null,attachmentIds:[attachmentId]}};
}

async function currentEntryContext(config,kind,fetcher,expectedActorId){
  const [access,scope]=await Promise.all([refreshCurrentActorAccess({config,fetcher}),refreshAuthoritativeScope({config,fetcher})]);
  if(!access.ok)return access;if(!scope.ok)return scope;
  if(!nativeDocumentEntryAccess(config,kind,access.row))return fail('DOCUMENT_ENTRY_ACCESS_REQUIRED','Document entry and support upload access are required.');
  if(expectedActorId&&access.row.actor_id!==expectedActorId)return fail('DOCUMENT_ENTRY_IDENTITY_CHANGED','Your sign-in changed. Return to the document list and check saved drafts before starting again.');
  if(scope.row.period_status!=='OPEN')return fail('PERIOD_NOT_OPEN','The selected accounting period is no longer open.');
  return {ok:true,access:access.row,scope:scope.row};
}

export async function uploadNativeDocumentSupport({config,kind,file,expectedActorId,fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
  const metadata=validateAttachmentFile(file);if(!normalizeConfig(config)||!kindValid(kind)||!metadata||!cryptoApi?.subtle)return fail('ATTACHMENT_UPLOAD_INVALID','Choose a supported file and company.');
  const context=await currentEntryContext(config,kind,fetcher,expectedActorId);if(!context.ok)return context;
  try{
    const bytes=await file.arrayBuffer();if(bytes.byteLength!==metadata.sizeBytes)return fail('ATTACHMENT_SIZE_MISMATCH','The selected file changed. Select it again.');
    const contentHash=await hash(bytes,cryptoApi),identity=JSON.stringify(['NATIVE_SUPPORT_V1',config.entityId,context.access.actor_id,metadata,contentHash]);
    const idempotencyKey=`native-support-${await hash(identity,cryptoApi)}`;
    return await uploadVerifiedAttachment({config,file,idempotencyKey,fetcher,cryptoApi});
  }catch{return fail('ATTACHMENT_UPLOAD_UNCONFIRMED','The supporting document could not be confirmed. Retry the same file.');}
}

export async function createNativeDocumentDraft({config,kind,draft,counterparty,attachmentId,expectedActorId,fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
  if(!normalizeConfig(config)||!kindValid(kind)||!cryptoApi?.subtle)return fail('DOCUMENT_ENTRY_INVALID','Document entry is not configured.');
  const context=await currentEntryContext(config,kind,fetcher,expectedActorId);if(!context.ok)return context;
  const accounts=await refreshAuthoritativeChartOfAccounts({config,fetcher});if(!accounts.ok)return accounts;
  const validated=validateNativeDocumentDraft({config,kind,draft,counterparty,attachmentId,scope:context.scope,accounts:accounts.rows});if(!validated.ok)return validated;
  let attempted=false,responseStatus=null;
  try{
    const identity=JSON.stringify(['NATIVE_DOCUMENT_V1',config.entityId,config.periodId,kind,context.access.actor_id,validated.document]);
    const idempotencyKey=`native-document-${await hash(identity,cryptoApi)}`;
    attempted=true;
    const result=await createAuthoritativeBusinessDocument({config,kind,document:validated.document,idempotencyKey,fetcher:async(...request)=>{const response=await fetcher(...request);responseStatus=response.status;return response;}});
    return {...result,attempted:true,unconfirmed:!result.ok&&!(Number.isInteger(responseStatus)&&responseStatus>=400&&responseStatus<500)};
  }catch{return {...fail('DOCUMENT_CREATE_UNCONFIRMED','Creation could not be confirmed. Retry the same document before changing its details.'),attempted,unconfirmed:attempted};}
}
