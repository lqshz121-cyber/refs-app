import {accountingApiConfig,authoritativeBearerHeaders,refreshCurrentActorAccess,applyAuthoritativeCredit} from './accounting-api.js';
import {validCreditTargetSelection,validCreditTargets} from './native-credit-targets-contract.js';
const fail=(code,message)=>({ok:false,code,message});
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const text=(v,min,max)=>typeof v==='string'&&v===v.trim()&&v.length>=min&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const configured=config=>!!accountingApiConfig({__REFS_ACCOUNTING_API__:config});
const action=kind=>kind==='AP_VENDOR_CREDIT'?'AP_CREDIT_APPLY':kind==='AR_CREDIT_MEMO'?'AR_CREDIT_APPLY':null;
const permission=kind=>kind==='AP_VENDOR_CREDIT'?'AP.VENDOR_CREDIT.APPLY':kind==='AR_CREDIT_MEMO'?'AR.CREDIT_MEMO.APPLY':null;
const units=v=>{const [whole,fraction='']=v.split('.');return BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));};
export const nativeCreditAllocationAccess=(config,kind,access)=>!!permission(kind)&&access?.entity_id===config?.entityId&&text(access?.actor_id,1,200)&&access?.session_refresh_required===false&&Array.isArray(access.permissions)&&access.permissions.includes(permission(kind));
export async function readNativeCreditTargets({config,kind,sourceAdjustmentId,query='',afterId=null,limit=50,fetcher=globalThis.fetch}={}){
  const selection={entityId:config?.entityId,periodId:config?.periodId,businessAdjustmentId:sourceAdjustmentId,action:action(kind),query,afterId,limit};
  if(!configured(config)||!uuid(sourceAdjustmentId)||!validCreditTargetSelection(selection))return fail('CREDIT_TARGETS_INVALID','Choose a company, credit and valid search.');
  const auth=await authoritativeBearerHeaders(config);if(!auth)return fail('AUTHENTICATION_REQUIRED','Sign in to continue.');
  const params=new URLSearchParams({action:selection.action,periodId:config.periodId,query,limit:String(limit)});if(afterId)params.set('afterId',afterId);
  try{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/business-adjustments/${sourceAdjustmentId}/allocation-targets?${params}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...auth}});
    if(!response.ok)return fail('CREDIT_TARGETS_UNAVAILABLE','The available documents could not be loaded. Retry.');
    const result=await response.json();if(result?.ok!==true||!validCreditTargets(result.data,selection))throw Error('scope');return {ok:true,data:result.data};
  }catch{return fail('CREDIT_TARGETS_UNCONFIRMED','The document balances could not be confirmed. Retry.');}
}
export function validateNativeCreditAllocation({config,kind,sourceAdjustmentId,page,targetId,amount,reason}={}){
  const selection={entityId:config?.entityId,periodId:config?.periodId,businessAdjustmentId:sourceAdjustmentId,action:action(kind),query:page?.query,afterId:page?.after_id,limit:page?.limit};
  if(!configured(config)||!validCreditTargets(page,selection))return fail('CREDIT_SCOPE_INVALID','Refresh the available documents.');
  if(page.context.period.status!=='OPEN')return fail('CREDIT_PERIOD_CLOSED','Select an open working period before preparing an allocation.');
  const target=page.rows.find(row=>row.business_document_id===targetId);
  if(!target)return fail('CREDIT_TARGET_REQUIRED','Choose a document from the current search.');
  if(typeof amount!=='string'||!/^(0|[1-9]\d{0,15})(\.\d{1,4})?$/.test(amount)||units(amount)<=0n||units(amount)>units(target.available_amount)||!/^\d+\.\d{4}$/.test(page.context.available_amount)||units(amount)>units(page.context.available_amount))return fail('CREDIT_AMOUNT_INVALID','Enter a positive amount within both available balances, with up to four decimal places.');
  if(!text(reason,8,2000))return fail('CREDIT_REASON_REQUIRED','Describe the allocation in at least eight characters.');
  return {ok:true,body:{businessDocumentId:targetId,amount,reason},target};
}
async function actor(config,kind,expectedActorId,fetcher){
  const result=await refreshCurrentActorAccess({config,fetcher});if(!result.ok)return result;
  if(!nativeCreditAllocationAccess(config,kind,result.row)||result.row.actor_id!==expectedActorId)return fail('CREDIT_ACCESS_CHANGED','Your identity or access changed. Return to the credit and check its allocations.');
  return {ok:true,actorId:result.row.actor_id};
}
export async function prepareNativeCreditAllocation({config,kind,sourceAdjustmentId,page,targetId,amount,reason,expectedActorId,intentId,fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
  if(!configured(config)||!cryptoApi?.subtle)return fail('CREDIT_INVALID','The allocation cannot be prepared.');
  const identity=await actor(config,kind,expectedActorId,fetcher);if(!identity.ok)return identity;
  const read=await readNativeCreditTargets({config,kind,sourceAdjustmentId,query:page?.query,afterId:page?.after_id,limit:page?.limit,fetcher});if(!read.ok)return read;
  const valid=validateNativeCreditAllocation({config,kind,sourceAdjustmentId,page:read.data,targetId,amount,reason});if(!valid.ok)return valid;
  const nonce=intentId??cryptoApi.randomUUID?.();if(!uuid(nonce))return fail('CREDIT_INVALID','The allocation request identity could not be created.');
  const bytes=new TextEncoder().encode(JSON.stringify([config.baseUrl,config.entityId,identity.actorId,kind,sourceAdjustmentId,nonce,valid.body]));
  const digest=Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  return {ok:true,command:{baseUrl:config.baseUrl,entityId:config.entityId,periodId:config.periodId,actorId:identity.actorId,kind,sourceAdjustmentId,body:valid.body,idempotencyKey:`native-credit-${digest}`,targetNumber:valid.target.document_number,currency:valid.target.currency}};
}
export async function sendNativeCreditAllocation({config,command,fetcher=globalThis.fetch}={}){
  if(!configured(config)||command?.baseUrl!==config.baseUrl||command?.entityId!==config.entityId||command?.periodId!==config.periodId||!action(command?.kind)||!uuid(command?.sourceAdjustmentId))return fail('CREDIT_SCOPE_CHANGED','The selected company or credit changed.');
  const identity=await actor(config,command.kind,command.actorId,fetcher);if(!identity.ok)return identity;
  let attempted=false,status=null;
  const transport=async(url,options)=>{if(options?.method==='POST')attempted=true;const response=await fetcher(url,options);status=response.status;return response;};
  const result=await applyAuthoritativeCredit({config,kind:command.kind,businessAdjustmentId:command.sourceAdjustmentId,...command.body,idempotencyKey:command.idempotencyKey,fetcher:transport});
  return {...result,attempted,unconfirmed:!result.ok&&attempted&&(status===null||status>=500||['ACCOUNTING_API_PROTOCOL','ACCOUNTING_API_UNREACHABLE'].includes(result.code))};
}
