// Page-session transport recovery; never an accounting record or token store.
const pending=new Map();
const key=({config,kind,actorId})=>JSON.stringify([config?.baseUrl,config?.entityId,config?.periodId,kind,actorId]);
const warn=event=>{if(pending.size){event.preventDefault();event.returnValue='';}};
export function recoverNativeDocument(scope){const value=pending.get(key(scope));return value?structuredClone(value):null;}
export function retainNativeDocument(scope,command){
  if(!['AP_BILL','AR_INVOICE'].includes(command?.kind)||command.baseUrl!==scope.config?.baseUrl||command.entityId!==scope.config?.entityId||command.periodId!==scope.config?.periodId||command.kind!==scope.kind||command.actorId!==scope.actorId)throw Error('Document recovery scope mismatch');
  const previous=pending.get(key(scope));if(previous&&previous.idempotencyKey!==command.idempotencyKey)throw Error('Resolve the pending document before starting another');
  pending.set(key(scope),structuredClone(command));globalThis.addEventListener?.('beforeunload',warn);
}
export function releaseNativeDocument(scope,command){if(pending.get(key(scope))?.idempotencyKey===command?.idempotencyKey)pending.delete(key(scope));if(!pending.size)globalThis.removeEventListener?.('beforeunload',warn);}
