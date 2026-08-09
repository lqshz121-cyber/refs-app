import {createWbsInboundAutoRecReadComposition} from './wbs-inbound-autorec-read-composition.mjs';

const REQUIRED=Object.freeze(['readPersistedWbsInboundRows','readPersistedWbsControlRows','readApprovedWbsAutoRecMappings','readWbsAutoRecObservedStateEvidence']);
const freeze=value=>Object.freeze(value);

// Binds the authenticated Postgres kernel read capabilities to the pure
// projection composition. It exposes one read method only and cannot reach a
// WBS endpoint or any JE create/approve/post command.
export function createPostgresWbsInboundAutoRecReader({kernel}={}){
  if(!kernel||REQUIRED.some(name=>typeof kernel[name]!=='function'))return createWbsInboundAutoRecReadComposition({});
  const repository=freeze(Object.fromEntries(REQUIRED.map(name=>[name,selection=>kernel[name](freeze({...selection,read_only:true}))])));
  return createWbsInboundAutoRecReadComposition({repository});
}
