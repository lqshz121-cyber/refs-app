import {accountingApiConfig,authoritativeBearerHeaders,refreshCurrentActorAccess,refreshAuthoritativeScope} from './accounting-api.js';
import {uploadVerifiedAttachment,validateAttachmentFile} from './attachment-api.js';
import {validSalesReceiptOptionSelection,validSalesReceiptOptions} from './sales-receipt-option-contract.js';
const fail=(code,message)=>({ok:false,code,message}),uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const text=(v,max)=>typeof v==='string'&&v===v.trim()&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const configured=config=>accountingApiConfig({__REFS_ACCOUNTING_API__:config});
const hash=async(v,cryptoApi)=>Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',typeof v==='string'?new TextEncoder().encode(v):v)),b=>b.toString(16).padStart(2,'0')).join('');
export const salesReceiptEntryAccess=(config,access)=>access?.entity_id===config?.entityId&&text(access?.actor_id,200)&&access.session_refresh_required===false&&access.permissions?.includes('AR.SALES_RECEIPT.CREATE')&&access.permissions.includes('ATTACHMENT.CREATE');
export async function readSalesReceiptOptions({config,optionKind,query='',afterRef=null,limit=25,fetcher=globalThis.fetch}={}){
 if(!configured(config)||!validSalesReceiptOptionSelection({optionKind,query,afterRef,limit}))return fail('OPTIONS_INVALID','Choose a valid company and search.');
 const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('AUTHENTICATION_REQUIRED','Sign in to search receipt options.');
 const params=new URLSearchParams({optionKind,query,limit:String(limit)});if(afterRef!==null)params.set('afterRef',afterRef);
 try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ar/sales-receipt-options?${params}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
  if(!response.ok)return fail('OPTIONS_UNAVAILABLE','Receipt choices could not be loaded for this company.');
  const body=await response.json();if(body?.ok!==true||!validSalesReceiptOptions(body.data,{entityId:config.entityId,optionKind,query,afterRef,limit}))return fail('OPTIONS_UNCONFIRMED','Receipt choices could not be confirmed. Retry the search.');
  return {ok:true,data:body.data};
 }catch{return fail('OPTIONS_UNAVAILABLE','Receipt choices could not be loaded. Retry.');}
}
export function validateSalesReceiptDraft({config,scope,draft,choices,attachmentId}={}){
 if(scope?.entity_id!==config?.entityId||scope?.period_id!==config?.periodId||scope?.period_status!=='OPEN'||!validDate(scope.period_start)||!validDate(scope.period_end))return fail('PERIOD_NOT_OPEN','Select an open accounting period.');
 if(!text(draft?.number,128))return fail('NUMBER_REQUIRED','Enter a receipt number.');
 if(!validDate(draft.date)||draft.date<scope.period_start||draft.date>scope.period_end)return fail('DATE_INVALID','Enter a date within the selected accounting period.');
 if(typeof draft.amount!=='string'||!/^(0|[1-9]\d{0,15})(\.\d{1,4})?$/.test(draft.amount)||!/[1-9]/.test(draft.amount))return fail('AMOUNT_INVALID','Enter a positive amount with up to four decimal places.');
 if(typeof draft.currency!=='string'||!/^[A-Z]{3}$/.test(draft.currency))return fail('CURRENCY_INVALID','Enter a three-letter currency code.');
 if(!text(draft.reason,2000)||draft.reason.length<8)return fail('REASON_REQUIRED','Enter a description of 8 to 2,000 characters.');
 for(const kind of ['CUSTOMER','BANK','CASH_ACCOUNT','CATEGORY_ACCOUNT']){const row=choices?.[kind];if(!row||!text(row.ref,kind.endsWith('_ACCOUNT')?64:128)||!text(row.label,Infinity)||!(kind==='CUSTOMER'?['CUSTOMER','AFFILIATE']:[kind]).includes(row.kind))return fail('CHOICE_REQUIRED','Choose the customer, bank, cash account and category from the company searches.');}
 if(choices.CASH_ACCOUNT.ref===choices.CATEGORY_ACCOUNT.ref)return fail('ACCOUNTS_INVALID','Cash and category accounts must differ.');
 if(!uuid(attachmentId))return fail('ATTACHMENT_REQUIRED','Select a supporting document.');
 return {ok:true,body:{periodId:config.periodId,number:draft.number,customerRef:choices.CUSTOMER.ref,bankMemberRef:choices.BANK.ref,cashAccountCode:choices.CASH_ACCOUNT.ref,categoryAccountCode:choices.CATEGORY_ACCOUNT.ref,date:draft.date,currency:draft.currency,amount:draft.amount,reason:draft.reason,attachmentIds:[attachmentId]}};
}
async function context(config,expectedActorId,fetcher){
 const [access,scope]=await Promise.all([refreshCurrentActorAccess({config,fetcher}),refreshAuthoritativeScope({config,fetcher})]);
 if(!access.ok)return access;if(!scope.ok)return scope;
 if(!salesReceiptEntryAccess(config,access.row)||access.row.actor_id!==expectedActorId)return fail('ENTRY_ACCESS_CHANGED','Restore the original sign-in and sales receipt entry access.');
 if(scope.row.period_status!=='OPEN')return fail('PERIOD_NOT_OPEN','The selected accounting period is no longer open.');
 return {ok:true,access:access.row,scope:scope.row};
}
export async function uploadSalesReceiptSupport({config,file,expectedActorId,uploadAttempt=0,fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
 const metadata=validateAttachmentFile(file);if(!configured(config)||!metadata||!cryptoApi?.subtle||!Number.isSafeInteger(uploadAttempt)||uploadAttempt<0||uploadAttempt>100)return fail('UPLOAD_INVALID','Select a supported document.');
 const current=await context(config,expectedActorId,fetcher);if(!current.ok)return current;
 try{const bytes=await file.arrayBuffer();if(bytes.byteLength!==metadata.sizeBytes)return fail('FILE_CHANGED','Select the supporting document again.');
  const identity=JSON.stringify(['SALES_RECEIPT_SUPPORT_V1',config.baseUrl,config.entityId,expectedActorId,metadata,await hash(bytes,cryptoApi),uploadAttempt]);
  return await uploadVerifiedAttachment({config,file,idempotencyKey:'sale-support-'+await hash(identity,cryptoApi),fetcher,cryptoApi});
 }catch{return fail('UPLOAD_UNCONFIRMED','The supporting document could not be confirmed. Retry the same file.');}
}
export async function prepareSalesReceipt({config,draft,choices,attachmentId,expectedActorId,fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
 if(!configured(config)||!cryptoApi?.subtle)return fail('ENTRY_INVALID','Sales receipt entry is not configured.');
 const current=await context(config,expectedActorId,fetcher);if(!current.ok)return current;
 const validated=validateSalesReceiptDraft({config,scope:current.scope,draft,choices,attachmentId});if(!validated.ok)return validated;
 const idempotencyKey='sales-receipt-'+await hash(JSON.stringify(['SALES_RECEIPT_V1',config.baseUrl,config.entityId,config.periodId,expectedActorId,validated.body]),cryptoApi);
 return {ok:true,command:{baseUrl:config.baseUrl,entityId:config.entityId,periodId:config.periodId,actorId:expectedActorId,idempotencyKey,body:validated.body,draft:structuredClone(draft),choices:structuredClone(choices),attachmentId}};
}
export async function sendSalesReceipt({config,command,fetcher=globalThis.fetch}={}){
 if(!configured(config)||command?.baseUrl!==config.baseUrl||command.entityId!==config.entityId||command.periodId!==config.periodId||command.body?.periodId!==config.periodId)return fail('ENTRY_SCOPE_CHANGED','The retained receipt belongs to another company, period or API.');
 const access=await refreshCurrentActorAccess({config,fetcher});if(!access.ok)return access;
 if(!salesReceiptEntryAccess(config,access.row)||access.row.actor_id!==command.actorId)return fail('ENTRY_ACCESS_CHANGED','Restore the original sign-in and receipt entry access to confirm this request.');
 const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('AUTHENTICATION_REQUIRED','Sign in to confirm this receipt.');
 try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ar/sales-receipts`,{method:'POST',credentials:'include',cache:'no-store',headers:{'content-type':'application/json',accept:'application/json',...authorization,'idempotency-key':command.idempotencyKey},body:JSON.stringify(command.body)});
  if(!response.ok)return {...fail('RECEIPT_CREATE_FAILED',response.status>=500?'The receipt could not be confirmed. Retry the same request.':'The receipt was not accepted. Check access, period and selected details.'),attempted:true,unconfirmed:response.status>=500};
  const body=await response.json(),r=body?.data;
  if(![200,201].includes(response.status)||body?.ok!==true||!r||Object.keys(r).length!==5||!uuid(r.sales_receipt_id)||!uuid(r.journal_entry_id)||r.status!=='DRAFT'||r.revision!==0||r.idempotent!==(response.status===200))return {...fail('RECEIPT_UNCONFIRMED','The saved receipt could not be confirmed. Retry the same request.'),attempted:true,unconfirmed:true};
  return {ok:true,data:r,attempted:true};
 }catch{return {...fail('RECEIPT_UNCONFIRMED','The receipt could not be confirmed. Retry the same request.'),attempted:true,unconfirmed:true};}
}
