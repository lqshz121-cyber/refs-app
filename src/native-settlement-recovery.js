// Unconfirmed transport requests only; never a source of accounting balances.
const pending=new Map();
const key=({config,kind,businessDocumentId,actorId})=>JSON.stringify([config?.baseUrl,config?.entityId,config?.periodId,kind,businessDocumentId,actorId]);
const warn=event=>{if(pending.size){event.preventDefault();event.returnValue='';}};
export function recoverNativeSettlement(scope){const value=pending.get(key(scope));return value?structuredClone(value):null;}
export function retainNativeSettlement(scope,command,{uncertain=true}={}){
  if(command?.baseUrl!==scope.config?.baseUrl||command?.entityId!==scope.config?.entityId||command?.periodId!==scope.config?.periodId||command?.kind!==scope.kind||command?.businessDocumentId!==scope.businessDocumentId||command?.actorId!==scope.actorId||!['AP_PAYMENT','AR_RECEIPT'].includes(command.kind))throw Error('Settlement recovery scope mismatch');
  const previous=pending.get(key(scope));if(previous&&previous.command.idempotencyKey!==command.idempotencyKey)throw Error('Resolve the retained settlement before preparing another');
  pending.set(key(scope),{command:structuredClone(command),uncertain:uncertain||previous?.uncertain===true});globalThis.addEventListener?.('beforeunload',warn);
}
export function releaseNativeSettlement(scope,command){const id=key(scope);if(pending.get(id)?.command.idempotencyKey===command?.idempotencyKey)pending.delete(id);if(!pending.size)globalThis.removeEventListener?.('beforeunload',warn);}
