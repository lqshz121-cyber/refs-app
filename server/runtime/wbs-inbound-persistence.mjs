// Kernel seam only: callers supply a database transaction implementation. It
// persists receipt evidence and intake records; it cannot create or transition JEs.
export class WbsInboundPersistenceError extends Error { constructor(code,message){super(message);this.code=code;} }
const fail=(code,message)=>{throw new WbsInboundPersistenceError(code,message);};

export async function persistWbsInboundRows({repository,tenantId,entityId,idempotencyKey,receipt,rawRows,normalizedRows,stagingOrExceptionRows}={}) {
  if(!repository||typeof repository.transaction!=='function') fail('WBS_INBOUND_REPOSITORY_REQUIRED','A transactional WBS inbound repository is required');
  if(!tenantId||!entityId||!idempotencyKey||!receipt?.payload_hash||!receipt?.payload_ref) fail('WBS_INBOUND_INPUT_INVALID','Scoped immutable receipt and idempotency key are required');
  if(!Array.isArray(rawRows)||!Array.isArray(normalizedRows)||!Array.isArray(stagingOrExceptionRows)||rawRows.length!==normalizedRows.length||normalizedRows.length!==stagingOrExceptionRows.length) fail('WBS_INBOUND_ROW_SET_INVALID','Raw, normalized and staging-or-exception rows must be aligned');
  return repository.transaction(async tx=>{
    const prior=await tx.getInboundIdempotency({tenantId,entityId,idempotencyKey});
    if(prior){
      if(prior.receipt_hash!==receipt.payload_hash) fail('WBS_INBOUND_IDEMPOTENCY_CONFLICT','Idempotency key cannot be reused for a different immutable receipt');
      return {...prior.result,idempotent:true};
    }
    const receiptRow=await tx.insertReceipt({tenantId,entityId,receipt});
    const raw=await tx.insertRawRows({tenantId,entityId,receiptId:receiptRow.receipt_id,rows:rawRows});
    const normalized=await tx.insertNormalizedRows({tenantId,entityId,rawRows:raw,rows:normalizedRows});
    const outcome=await tx.insertStagingOrExceptions({tenantId,entityId,normalizedRows:normalized,rows:stagingOrExceptionRows});
    const result=Object.freeze({receipt_id:receiptRow.receipt_id,raw_count:raw.length,normalized_count:normalized.length,staging_or_exception_count:outcome.length,can_create_draft:false,can_approve:false,can_post:false});
    await tx.insertInboundAudit({tenantId,entityId,receiptId:receiptRow.receipt_id,idempotencyKey,result});
    await tx.putInboundIdempotency({tenantId,entityId,idempotencyKey,receipt_hash:receipt.payload_hash,result});
    return result;
  });
}
