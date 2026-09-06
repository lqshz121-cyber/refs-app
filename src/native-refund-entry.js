import {accountingApiConfig,authoritativeBearerHeaders,refreshCurrentActorAccess,refreshAuthoritativeChartOfAccounts} from './accounting-api.js';
import {uploadVerifiedAttachment,validateAttachmentFile} from './attachment-api.js';
import {validRefundKind,validRefundBankKind,validRefundBankPage,validRefundContext,refundContextAvailable} from './native-refund-contract.js';

const fail=(code,message)=>({ok:false,code,message});
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const text=(value,max,min=1)=>typeof value==='string'&&value===value.trim()&&value.length>=min&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const configured=config=>!!accountingApiConfig({__REFS_ACCOUNTING_API__:config});
const hash=async(value,cryptoApi)=>Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)),byte=>byte.toString(16).padStart(2,'0')).join('');
const units=value=>{const [a,b='']=value.split('.');return BigInt(a)*10000n+BigInt(b.padEnd(4,'0'));};
export const nativeRefundAccess=(config,kind,access)=>validRefundKind(kind)&&access?.entity_id===config?.entityId&&text(access?.actor_id,200)&&access?.session_refresh_required===false&&Array.isArray(access.permissions)&&access.permissions.includes('AR.REFUND.CREATE')&&access.permissions.includes('ATTACHMENT.CREATE');

async function read(config,path,validate,fetcher){
  const auth=await authoritativeBearerHeaders(config);if(!auth)return fail('AUTHENTICATION_REQUIRED','Sign in to continue.');
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...auth}});
    if(!response.ok)return fail('REFUND_READ_UNAVAILABLE','Refund details could not be loaded for this company. Retry.');
    const body=await response.json();if(body?.ok!==true||!validate(body.data))throw Error('invalid');return {ok:true,data:body.data};
  }catch{return fail('REFUND_READ_UNCONFIRMED','Refund details could not be confirmed. Retry.');}
}
export function readNativeRefundContext({config,kind,sourceAdjustmentId,fetcher=globalThis.fetch}={}){
  if(!configured(config)||!validRefundKind(kind)||!uuid(sourceAdjustmentId))return Promise.resolve(fail('REFUND_INVALID','Select a company and document.'));
  return read(config,`/business-adjustments/${sourceAdjustmentId}/usage-context?${new URLSearchParams({action:kind,periodId:config.periodId})}`,value=>validRefundContext(value,{entityId:config.entityId,periodId:config.periodId,settlementKind:kind,sourceAdjustmentId}),fetcher);
}
export function readNativeRefundBanks({config,kind,query='',afterRef=null,limit=50,fetcher=globalThis.fetch}={}){
  if(!configured(config)||!validRefundBankKind(kind)||!text(query,128,0)||afterRef!==null&&!text(afterRef,128)||!Number.isInteger(limit)||limit<1||limit>100)return Promise.resolve(fail('BANK_SEARCH_INVALID','Enter a valid bank search.'));
  const params=new URLSearchParams({kind,query,limit:String(limit)});if(afterRef!==null)params.set('afterRef',afterRef);
  return read(config,`/settlements/draft-bank-members?${params}`,value=>validRefundBankPage(value,{entityId:config.entityId,settlementKind:kind,query,afterRef,limit}),fetcher);
}
export function validateNativeRefundDraft({config,kind,sourceAdjustmentId,draft,context,accounts=[],bank}={}){
  if(!configured(config)||!validRefundContext(context,{entityId:config.entityId,periodId:config.periodId,settlementKind:kind,sourceAdjustmentId})||!refundContextAvailable(context))return fail('REFUND_NOT_AVAILABLE','This document has no available balance in the selected open period.');
  if(!text(draft?.number,128))return fail('NUMBER_REQUIRED','Enter a refund number.');
  if(typeof draft.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)||!Number.isFinite(Date.parse(draft.date))||new Date(draft.date).toISOString().slice(0,10)!==draft.date||draft.date<context.period.starts_on||draft.date>context.period.ends_on)return fail('DATE_INVALID','Choose a date in the selected accounting period.');
  if(typeof draft.amount!=='string'||!/^(0|[1-9]\d{0,15})(\.\d{1,4})?$/.test(draft.amount)||units(draft.amount)<=0n||units(draft.amount)>units(context.available_amount))return fail('AMOUNT_INVALID','Enter a positive amount no greater than the available balance.');
  if(!accounts.some(row=>row.account_code===draft.cashAccountCode&&row.active===true&&row.requires_member===true&&row.required_member_type==='BANK'&&row.period_id===config.periodId&&(!row.entity_id||row.entity_id===config.entityId)))return fail('BANK_ACCOUNT_REQUIRED','Choose an active bank ledger account.');
  if(bank?.member_type!=='BANK'||!text(bank?.member_ref,128))return fail('BANK_REQUIRED','Choose a bank from the company search.');
  if(!text(draft.reason,2000,8))return fail('REASON_REQUIRED','Enter a description of at least eight characters.');
  return {ok:true,body:{periodId:config.periodId,number:draft.number,date:draft.date,cashAccountCode:draft.cashAccountCode,bankMemberRef:bank.member_ref,amount:draft.amount,reason:draft.reason}};
}
async function actorContext(config,kind,expectedActorId,fetcher){
  const result=await refreshCurrentActorAccess({config,fetcher});if(!result.ok)return result;
  if(!nativeRefundAccess(config,kind,result.row)||result.row.actor_id!==expectedActorId)return fail('REFUND_ACCESS_CHANGED','Your sign-in or access changed. Return to the list and check saved drafts.');
  return {ok:true,actorId:result.row.actor_id};
}
export async function uploadNativeRefundSupport({config,kind,file,expectedActorId,uploadAttempt=0,fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
  const metadata=validateAttachmentFile(file);if(!configured(config)||!metadata||!cryptoApi?.subtle||!Number.isSafeInteger(uploadAttempt)||uploadAttempt<0||uploadAttempt>100)return fail('SUPPORT_REQUIRED','Choose a supported document.');
  const actor=await actorContext(config,kind,expectedActorId,fetcher);if(!actor.ok)return actor;
  try{const bytes=await file.arrayBuffer();if(bytes.byteLength!==metadata.sizeBytes)throw Error('size');const identity=JSON.stringify(['NATIVE_REFUND_SUPPORT_V1',config.entityId,actor.actorId,metadata,await hash(bytes,cryptoApi),uploadAttempt]);return await uploadVerifiedAttachment({config,file,idempotencyKey:`refund-support-${await hash(identity,cryptoApi)}`,fetcher,cryptoApi});}
  catch{return fail('SUPPORT_UNCONFIRMED','The supporting document could not be confirmed. Retry the same file.');}
}
// Keep a prepared command when the HTTP outcome is unknown. Replay must not be
// prevented by a balance reservation or period closure caused after the request.
export async function prepareNativeRefund({config,kind,sourceAdjustmentId,draft,bank,attachmentId,expectedActorId,fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
  if(!configured(config)||!uuid(attachmentId)||!cryptoApi?.subtle)return fail('SUPPORT_REQUIRED','Choose a supporting document.');
  const actor=await actorContext(config,kind,expectedActorId,fetcher);if(!actor.ok)return actor;
  const [context,accounts]=await Promise.all([readNativeRefundContext({config,kind,sourceAdjustmentId,fetcher}),refreshAuthoritativeChartOfAccounts({config,fetcher})]);
  if(!context.ok)return context;if(!accounts.ok)return accounts;
  const valid=validateNativeRefundDraft({config,kind,sourceAdjustmentId,draft,bank,context:context.data,accounts:accounts.rows});if(!valid.ok)return valid;
  const body={...valid.body,attachmentIds:[attachmentId]};const idempotencyKey=`native-refund-${await hash(JSON.stringify([config.entityId,kind,sourceAdjustmentId,actor.actorId,body]),cryptoApi)}`;
  return {ok:true,command:{entityId:config.entityId,periodId:config.periodId,actorId:actor.actorId,kind,sourceAdjustmentId,body,idempotencyKey}};
}
export async function sendNativeRefund({config,command,fetcher=globalThis.fetch}={}){
  if(!configured(config)||command?.entityId!==config.entityId||command?.periodId!==config.periodId||!validRefundKind(command?.kind)||!uuid(command.sourceAdjustmentId))return fail('REFUND_INVALID','The selected company changed. Return to the document list.');
  const actor=await actorContext(config,command.kind,command.actorId,fetcher);if(!actor.ok)return actor;
  const auth=await authoritativeBearerHeaders(config);if(!auth)return fail('AUTHENTICATION_REQUIRED','Sign in to continue.');
  const path=`ar/credit-memos/${command.sourceAdjustmentId}/native-refunds`;
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/${path}`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.idempotencyKey,...auth},body:JSON.stringify(command.body)});
    if(!response.ok)return {...fail('REFUND_SAVE_FAILED','The draft was not confirmed. Retry, or refresh the document to check its current balance.'),unconfirmed:response.status>=500,attempted:true};
    const body=await response.json(),r=body?.data;
    if(![200,201].includes(response.status)||body?.ok!==true||!r||Object.keys(r).length!==6||!['business_adjustment_id','journal_entry_id'].every(k=>uuid(r[k]))||r.source_adjustment_id!==command.sourceAdjustmentId||r.status!=='DRAFT'||r.revision!==0||r.idempotent!==(response.status===200))throw Error('receipt');
    return {ok:true,data:r,attempted:true};
  }catch{return {...fail('REFUND_UNCONFIRMED','Keep these details and retry the same draft. Check saved drafts before leaving.'),unconfirmed:true,attempted:true};}
}
