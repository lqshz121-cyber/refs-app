// Session-only transport recovery. These are unconfirmed requests, never books
// or successful receipts. Every replay still requires server authorization.
const pending=new Map();
const warn=event=>{if(pending.size){event.preventDefault();event.returnValue='';}};
const key=({config,kind,sourceAdjustmentId,actorId})=>JSON.stringify([config?.baseUrl,config?.entityId,config?.periodId,kind,sourceAdjustmentId,actorId]);
export function recoverNativeCreditAllocation(scope){const value=pending.get(key(scope));return value?structuredClone(value):null;}
export function retainNativeCreditAllocation(scope,command,{uncertain=false}={}){
  if(command?.baseUrl!==scope.config?.baseUrl||command?.entityId!==scope.config?.entityId||command?.periodId!==scope.config?.periodId||command?.sourceAdjustmentId!==scope.sourceAdjustmentId||command?.actorId!==scope.actorId||command.kind!==scope.kind||!['AP_VENDOR_CREDIT','AR_CREDIT_MEMO'].includes(command.kind))throw Error('Credit allocation recovery scope mismatch');
  const previous=pending.get(key(scope));
  if(previous&&previous.command.idempotencyKey!==command.idempotencyKey)throw Error('Resolve the retained allocation before preparing another');
  pending.set(key(scope),{command:structuredClone(command),uncertain:uncertain||previous?.uncertain===true});
  globalThis.addEventListener?.('beforeunload',warn);
}
export function releaseNativeCreditAllocation(scope,command){
  const id=key(scope);if(pending.get(id)?.command.idempotencyKey===command?.idempotencyKey)pending.delete(id);
  if(!pending.size)globalThis.removeEventListener?.('beforeunload',warn);
}
