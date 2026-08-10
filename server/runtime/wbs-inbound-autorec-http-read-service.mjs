import {canonicalRequestHash} from './request-hash.mjs';
import {createPostgresWbsInboundAutoRecReader} from './wbs-inbound-autorec-postgres-reader.mjs';
import {createPostgresWbsControlReconciliationReader} from './wbs-control-reconciliation-postgres-reader.mjs';

const freeze=value=>Object.freeze(value);

// Production-facing adapter for the accounting HTTP layer.  It binds only
// the kernel's receipt-backed read methods and derives its replay identity
// from the authenticated HTTP selection.  No provider client or accounting
// command is reachable from this service.
export function createWbsInboundAutoRecHttpReadService({kernel}={}){
  const reader=createPostgresWbsInboundAutoRecReader({kernel});
  const controlReader=createPostgresWbsControlReconciliationReader({kernel});
  return freeze({
    async readAutoRecReview({tenantId,entityId,companyKey,sourceRecordIds}={}){
      const replayKey=canonicalRequestHash({tenantId,entityId,companyKey,sourceRecordIds});
      return reader.read({tenantId,entityId,companyKey,sourceRecordIds,replayKey});
    },
    async readControlReconciliation({tenantId,entityId,sourceType,scope}={}){
      const replayKey=canonicalRequestHash({tenantId,entityId,sourceType,scope});
      return controlReader.read({tenantId,entityId,sourceType,scope:{...scope,tenant_id:tenantId,entity_id:entityId},replayKey});
    }
  });
}
