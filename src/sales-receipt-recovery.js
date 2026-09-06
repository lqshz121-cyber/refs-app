const pending=new Map(),key=({config,actorId})=>JSON.stringify([config?.baseUrl,config?.entityId,config?.periodId,actorId]);
const attempts=new Map();
const warn=event=>{if(pending.size){event.preventDefault();event.returnValue='';}};
export function recoverSalesReceipt(scope){const value=pending.get(key(scope));return value?structuredClone(value):null;}
export function retainSalesReceipt(scope,command){
 if(command?.baseUrl!==scope.config?.baseUrl||command.entityId!==scope.config?.entityId||command.periodId!==scope.config?.periodId||command.actorId!==scope.actorId)throw Error('Sales receipt recovery scope mismatch');
 const previous=pending.get(key(scope));if(previous&&previous.idempotencyKey!==command.idempotencyKey)throw Error('Confirm the pending receipt first');
 pending.set(key(scope),structuredClone(command));globalThis.addEventListener?.('beforeunload',warn);
}
export function beginSalesReceiptAttempt(scope,command){const identity=key(scope);if(pending.get(identity)?.idempotencyKey!==command?.idempotencyKey)throw Error('Receipt request was not retained');const attempt=(attempts.get(identity)||0)+1;attempts.set(identity,attempt);return attempt;}
export function currentSalesReceiptAttempt(scope,attempt){return attempts.get(key(scope))===attempt;}
export function releaseSalesReceipt(scope,command){if(pending.get(key(scope))?.idempotencyKey===command?.idempotencyKey){pending.delete(key(scope));attempts.delete(key(scope));}if(!pending.size)globalThis.removeEventListener?.('beforeunload',warn);}
