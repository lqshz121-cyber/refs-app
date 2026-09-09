import {accountingApiConfig,authoritativeBearerHeaders,refreshCurrentActorAccess} from './accounting-api.js';
import {validCounterpartyProposal,validCounterpartyReview,validCounterpartyChangeReceipt} from './counterparty-maintenance-contract.js';
import {validCounterpartyDetailSelection,validCounterpartyDetail,validCounterpartyChangesSelection,validCounterpartyChangesPage} from './counterparty-maintenance-read-contract.js';
const configured=config=>!!accountingApiConfig({__REFS_ACCOUNTING_API__:config});
const fail=(message,extra={})=>({ok:false,message,...extra});
export async function readCounterpartyMaintenance({config,memberRef=null,kind,status='PENDING',afterId=null,limit=25,detail=false,fetcher=globalThis.fetch,signal}={}){
 const selection=detail?{kind,memberRef}:{kind,status,memberRef,afterId,limit};
 if(!configured(config)||!(detail?validCounterpartyDetailSelection(selection):validCounterpartyChangesSelection(selection)))return fail('Choose a company and a valid contact.');
 try{
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('Your session could not be confirmed. Please retry.');
  const params=new URLSearchParams();for(const [key,value] of Object.entries(selection))if(value!==null)params.set(key,String(value));
  const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/${detail?'counterparties/detail':'counterparty-changes'}?${params}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization},signal});
  if(!response.ok)return fail(response.status===403?'You do not have access to these contacts.':'Contact details could not be loaded. Please retry.');
  const body=await response.json();if(body?.ok!==true||!(detail?validCounterpartyDetail(body.data,{entityId:config.entityId,...selection}):validCounterpartyChangesPage(body.data,{entityId:config.entityId,...selection})))return fail('Contact details did not match the selected company. Please refresh.');
  return {ok:true,data:body.data};
 }catch{return fail('Contact details could not be loaded. Please retry.');}
}
export async function readCounterpartyAccess({config,fetcher=globalThis.fetch}={}){
 if(!configured(config))return fail('Choose a company first.');
 const result=await refreshCurrentActorAccess({config,fetcher});
 if(!result.ok||result.row.tenant_id!==config.tenantId||result.row.session_refresh_required)return fail('Your current access could not be confirmed. Please refresh.');
 return result;
}
export function prepareCounterpartyCommand({config,actorId,body,expectedVersion=0,changeId=null,idempotencyKey=globalThis.crypto?.randomUUID?.()}={}){
 const reviewing=changeId!==null;
 if(!configured(config)||typeof actorId!=='string'||!actorId||!(reviewing?validCounterpartyReview(body):validCounterpartyProposal(body))
  ||!Number.isSafeInteger(expectedVersion)||expectedVersion<0||(reviewing||body.changeType==='CREATE')&&expectedVersion!==0
  ||reviewing&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(changeId)
  ||typeof idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey))return fail('Check the contact fields and reason before saving.');
 return {ok:true,command:{baseUrl:config.baseUrl,tenantId:config.tenantId,entityId:config.entityId,actorId,body:{...body},expectedVersion,changeId,idempotencyKey}};
}
export async function sendCounterpartyCommand({config,command,fetcher=globalThis.fetch}={}){
 if(!command||command.baseUrl!==config?.baseUrl||command.tenantId!==config?.tenantId||command.entityId!==config?.entityId
  ||!prepareCounterpartyCommand({...command,config}).ok)return fail('This request belongs to a different company or session.');
 const access=await readCounterpartyAccess({config,fetcher});
 const reviewing=command.changeId!==null,permission=reviewing?'MASTER.COUNTERPARTY.APPROVE':'MASTER.COUNTERPARTY.PROPOSE';
 if(!access.ok||access.row.actor_id!==command.actorId||!access.row.permissions.includes(permission))return fail('Your current access does not allow this change.');
 let attempted=false;
 try{
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('Your session could not be confirmed. Please retry.');
  const headers={accept:'application/json','content-type':'application/json',...authorization,'idempotency-key':command.idempotencyKey};
  if(reviewing||command.body.changeType==='UPDATE')headers['if-match']=`"${command.expectedVersion}"`;
  attempted=true;
  const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/counterparty-changes${reviewing?`/${command.changeId}/review`:''}`,{method:'POST',credentials:'include',cache:'no-store',headers,body:JSON.stringify(command.body)});
  if(!response.ok)return fail(response.status===403?'Your access no longer allows this change.':response.status===409||response.status===412?'This contact or request has changed. Refresh before making a new change.':'The change could not be confirmed. Retry the same request.',{unconfirmed:response.status>=500||response.status===408||response.status===429});
  const body=await response.json();
  if(body?.ok!==true||!validCounterpartyChangeReceipt(body.data,{entityId:config.entityId,...(reviewing?{changeId:command.changeId,decision:command.body.decision}:{kind:command.body.kind,memberRef:command.body.memberRef})}))return fail('The result could not be confirmed. Retry the same request.',{unconfirmed:true});
  return {ok:true,data:body.data};
 }catch{return fail('The result could not be confirmed. Retry the same request.',{unconfirmed:attempted});}
}
