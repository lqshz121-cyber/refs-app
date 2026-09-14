import {KernelError} from './db.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES=Object.freeze(['reader','maker','submitter','reviewer','approver','poster','reconciliationStarter','clearer','reopener']);
const READ=Object.freeze(['AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW','WBS.AUTOREC.VIEW']);

// These grants are only for the isolated internal-test deployment.  The
// browser never receives the actor IDs; its server routes each command to the
// smallest pre-provisioned workflow identity that can perform it.
export const INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES=Object.freeze({
  reader:READ,
  maker:Object.freeze([...READ,'AP.BILL.CREATE','AR.INVOICE.CREATE','GL.JE.CREATE','BANK.RECONCILIATION.ADJUSTMENT_DRAFT','BANK.MATCH.CREATE','CASH.TRANSFER.VIEW','CASH.TRANSFER.CREATE']),
  submitter:Object.freeze([...READ,'GL.JE.SUBMIT','CASH.TRANSFER.VIEW','CASH.TRANSFER.SUBMIT']),
  reviewer:Object.freeze([...READ,'GL.JE.REVIEW','BANK.RECONCILIATION.REVIEW','BANK.MATCH.REVIEW','CASH.TRANSFER.VIEW','CASH.TRANSFER.REVIEW']),
  approver:Object.freeze([...READ,'GL.JE.APPROVE','BANK.RECONCILIATION.SIGN_OFF','CASH.TRANSFER.VIEW','CASH.TRANSFER.APPROVE']),
  poster:Object.freeze([...READ,'GL.JE.POST','CASH.TRANSFER.VIEW','CASH.TRANSFER.POST']),
  reconciliationStarter:Object.freeze([...READ,'BANK.RECONCILIATION.START']),
  clearer:Object.freeze([...READ,'BANK.RECONCILIATION.CLEAR']),
  reopener:Object.freeze([...READ,'BANK.RECONCILIATION.REOPEN'])
});

const AUTHORITY=Object.freeze({reader:'READ',maker:'DRAFT',submitter:'SUBMIT',reviewer:'REVIEW',approver:'APPROVE',poster:'POST',reconciliationStarter:'DRAFT',clearer:'DRAFT',reopener:'REOPEN'});

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
        await grantSync.reconcile({tenantId:scope.tenantId,entityId:scope.entityId,actorId,permissions:INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES[role],authorityClass:AUTHORITY[role],validUntil,expectedVersion,idempotencyKey:`internal-test-${role}-grant-v1-${expectedVersion}`});
        break;
      }catch(error){if(error?.code!=='40001'||attempt===1)throw error;}
    }
  }
}
