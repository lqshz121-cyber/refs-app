export async function bootstrapInternalTestCashTransferEvidence({makerKernel,tenantId,entityId}={}){
  if(!makerKernel||typeof makerKernel.ensureInternalTestCashTransferEvidence!=='function')throw new Error('Internal-test cash-transfer evidence bootstrap kernel is unavailable');
  return makerKernel.ensureInternalTestCashTransferEvidence({tenantId,entityId,idempotencyKey:`internal-test-cash-transfer-evidence-v1-${entityId}`});
}
