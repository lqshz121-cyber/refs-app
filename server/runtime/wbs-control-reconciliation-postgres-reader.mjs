import {createWbsControlReconciliationReadComposition} from './wbs-control-reconciliation.mjs';

const REQUIRED=Object.freeze(['readPersistedWbsControlSnapshot','readPersistedRefsControlMetricSnapshot','readApprovedWbsControlReconciliationMapping']);
const freeze=value=>Object.freeze(value);

// Adapter-only seam for the authenticated REFS kernel. It intentionally
// exposes no WBS client, SQL string, or accounting command: the composition
// remains a receipt-backed, read-only control comparison.
export function createPostgresWbsControlReconciliationReader({kernel}={}){
  if(!kernel||REQUIRED.some(name=>typeof kernel[name]!=='function'))return createWbsControlReconciliationReadComposition({});
  const repository=freeze(Object.fromEntries(REQUIRED.map(name=>[name,selection=>kernel[name](freeze({...selection,read_only:true}))])));
  return createWbsControlReconciliationReadComposition({repository});
}
