import {prepareCounterpartyCommand} from './counterparty-maintenance-api.js';
const memory=new Map();
const key=({config,actorId})=>'refs-counterparty-pending-v1:'+JSON.stringify([config?.baseUrl,config?.tenantId,config?.entityId,actorId]);
export function recoverCounterpartyCommand(scope){
 const identity=key(scope);let value=memory.get(identity);
 if(!value){try{value=JSON.parse(globalThis.sessionStorage?.getItem(identity)||'null');}catch{return null;}}
 if(!value||value.actorId!==scope.actorId||value.tenantId!==scope.config?.tenantId||value.entityId!==scope.config?.entityId||value.baseUrl!==scope.config?.baseUrl||!prepareCounterpartyCommand({...value,config:scope.config}).ok)return null;
 memory.set(identity,value);return structuredClone(value);
}
export function retainCounterpartyCommand(scope,command){
 const prepared=prepareCounterpartyCommand({...command,config:scope.config});
 if(!prepared.ok||command.actorId!==scope.actorId||command.tenantId!==scope.config?.tenantId||command.entityId!==scope.config?.entityId||command.baseUrl!==scope.config?.baseUrl)throw Error('Pending request scope mismatch');
 const previous=recoverCounterpartyCommand(scope);if(previous&&previous.idempotencyKey!==command.idempotencyKey)throw Error('Confirm the earlier request first');
 // Persist only the closed command, never access tokens or accounting balances.
 globalThis.sessionStorage.setItem(key(scope),JSON.stringify(prepared.command));
 memory.set(key(scope),structuredClone(prepared.command));
}
export function releaseCounterpartyCommand(scope,command){
 if(recoverCounterpartyCommand(scope)?.idempotencyKey!==command.idempotencyKey)return;
 globalThis.sessionStorage.removeItem(key(scope));memory.delete(key(scope));
}
