import {KernelError} from './db.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES=Object.freeze(['reader','maker','expenseMaker','paymentMaker','receiptMaker','salesReceiptMaker','reversalMaker','adjustmentMaker','refundMaker','allocator','submitter','reviewer','approver','poster','reconciliationStarter','clearer','unmatcher','reopener','periodCloser','periodReopener','cashTransferReconciler','recurringRunner']);
const READ=Object.freeze(['AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW','WBS.AUTOREC.VIEW']);

// These bundles must conform to the live database authority matrix.  The
// browser is frictionless, but every command remains executed by a separate,
// finite actor whose authority is exact and non-overlapping.
export const INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES=Object.freeze({
  reader:READ,
  maker:Object.freeze([...READ,'AP.BILL.CREATE','AR.INVOICE.CREATE','GL.JE.CREATE','BANK.RECONCILIATION.ADJUSTMENT_DRAFT','BANK.MATCH.CREATE','CASH.TRANSFER.VIEW','CASH.TRANSFER.CREATE','CASH.TRANSFER.CONFIGURE','REPORT.FORECAST.CREATE','RECURRING.SCHEDULE.CREATE','REPORT.SAVED_VIEW.CREATE','REPORT.SAVED_VIEW.UPDATE']),
  expenseMaker:Object.freeze([...READ,'AP.EXPENSE.CREATE']),
  paymentMaker:Object.freeze([...READ,'AP.PAYMENT.CREATE']),
  receiptMaker:Object.freeze([...READ,'AR.RECEIPT.CREATE']),
  salesReceiptMaker:Object.freeze([...READ,'AR.SALES_RECEIPT.CREATE']),
  reversalMaker:Object.freeze([...READ,'AP.PAYMENT.REVERSE','AR.RECEIPT.REVERSE']),
  adjustmentMaker:Object.freeze([...READ,'AP.VENDOR_CREDIT.CREATE','AR.CREDIT_MEMO.CREATE']),
  refundMaker:Object.freeze([...READ,'AR.REFUND.CREATE']),
  allocator:Object.freeze([...READ,'AP.VENDOR_CREDIT.APPLY','AR.CREDIT_MEMO.APPLY']),
  submitter:Object.freeze([...READ,'GL.JE.SUBMIT','CASH.TRANSFER.VIEW','CASH.TRANSFER.SUBMIT','REPORT.FORECAST.SUBMIT','RECURRING.SCHEDULE.SUBMIT']),
  reviewer:Object.freeze([...READ,'GL.JE.REVIEW','BANK.RECONCILIATION.REVIEW','BANK.MATCH.REVIEW','CASH.TRANSFER.VIEW','CASH.TRANSFER.REVIEW','RECURRING.SCHEDULE.MANAGE','REPORT.SAVED_VIEW.SHARE']),
  approver:Object.freeze([...READ,'GL.JE.APPROVE','BANK.RECONCILIATION.SIGN_OFF','CASH.TRANSFER.VIEW','CASH.TRANSFER.APPROVE','CASH.TRANSFER.CONFIGURE.APPROVE','REPORT.FORECAST.APPROVE','RECURRING.SCHEDULE.APPROVE']),
  poster:Object.freeze([...READ,'GL.JE.POST','CASH.TRANSFER.VIEW','CASH.TRANSFER.POST']),
  reconciliationStarter:Object.freeze([...READ,'BANK.RECONCILIATION.START']),
  clearer:Object.freeze([...READ,'BANK.RECONCILIATION.CLEAR']),
  unmatcher:Object.freeze([...READ,'BANK.MATCH.UNMATCH']),
  reopener:Object.freeze([...READ,'BANK.RECONCILIATION.REOPEN','GL.PERIOD.REOPEN']),
  periodCloser:Object.freeze([...READ,'GL.PERIOD.CLOSE']),
  periodReopener:Object.freeze([...READ,'GL.PERIOD.REOPEN']),
  cashTransferReconciler:Object.freeze([...READ,'CASH.TRANSFER.VIEW','CASH.TRANSFER.RECONCILE']),
  recurringRunner:Object.freeze([...READ,'RECURRING.SCHEDULE.RUN'])
});

const AUTHORITY=Object.freeze({reader:'READ',maker:'DRAFT',expenseMaker:'DRAFT',paymentMaker:'PAYMENT',receiptMaker:'RECEIPT',salesReceiptMaker:'DRAFT',reversalMaker:'REVERSAL',adjustmentMaker:'ADJUSTMENT',refundMaker:'REFUND',allocator:'ALLOCATION',submitter:'SUBMIT',reviewer:'REVIEW',approver:'APPROVE',poster:'POST',reconciliationStarter:'DRAFT',clearer:'DRAFT',unmatcher:'UNMATCH',reopener:'REOPEN',periodCloser:'CLOSE',periodReopener:'REOPEN',cashTransferReconciler:'JE_REVIEW',recurringRunner:'SCHEDULE'});

function assertScope(scope){
  if(!UUID.test(scope?.tenantId||'')||!UUID.test(scope?.entityId||''))throw new KernelError('INTERNAL_TEST_GRANT_CONFIG_INVALID','Internal-test scope must use canonical UUIDs');
  if(!scope?.actors||typeof scope.actors!=='object'||Object.keys(scope.actors).sort().join('\0')!==[...ROLES].sort().join('\0')||ROLES.some(role=>typeof scope.actors[role]!=='string'||scope.actors[role].trim().length<3)||new Set(ROLES.map(role=>scope.actors[role].trim())).size!==ROLES.length)throw new KernelError('INTERNAL_TEST_GRANT_CONFIG_INVALID','Internal-test workflow actors must be complete and distinct');
}

export async function reconcileInternalTestWorkflowActorGrants({grantSync,scope}={}){
  if(typeof grantSync?.currentVersion!=='function'||typeof grantSync?.reconcile!=='function')throw new KernelError('INTERNAL_TEST_GRANT_CONFIG_INVALID','Internal-test grant synchronization is unavailable');
  assertScope(scope);
  const validUntil=new Date(Date.now()+23*60*60*1000).toISOString();
  for(const role of ROLES){
    const actorId=scope.actors[role].trim();
    for(let attempt=0;attempt<2;attempt++){
      const expectedVersion=await grantSync.currentVersion({tenantId:scope.tenantId,entityId:scope.entityId,actorId});
      try{
        await grantSync.reconcile({tenantId:scope.tenantId,entityId:scope.entityId,actorId,permissions:INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES[role],authorityClass:AUTHORITY[role],validUntil,expectedVersion,idempotencyKey:`internal-test-${role}-grant-v4-${expectedVersion}`});
        break;
      }catch(error){if(error?.code!=='40001'||attempt===1)throw error;}
    }
  }
}
