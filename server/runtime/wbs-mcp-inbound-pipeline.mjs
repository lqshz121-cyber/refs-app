// Production composition for one direction only:
// WBS read-only MCP -> verified immutable snapshot -> REFS Raw/Normalized/
// Staging. The injected components make the security boundary explicit and
// keep all journal/release/post operations outside this pipeline.
export class WbsMcpInboundPipelineError extends Error {
  constructor(code,message){super(message);this.name='WbsMcpInboundPipelineError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsMcpInboundPipelineError(code,message);};

export function createWbsMcpInboundPipeline({pullService,signatureVerifier,inboundAdapter,inboundOrchestrator}={}){
  // Production snapshots must pass the adapter's asynchronous verified path
  // as well as the pipeline verifier. Calling the legacy synchronous prepare
  // seam here would permit a miswired composition to bypass the adapter's
  // pinned-key admission guard.
  if(!pullService||typeof pullService.pullTransactionSnapshot!=='function'||typeof signatureVerifier!=='function'||!inboundAdapter||typeof inboundAdapter.prepareVerified!=='function'||!inboundOrchestrator||typeof inboundOrchestrator.persist!=='function')fail('WBS_MCP_PIPELINE_DEPENDENCY_REQUIRED','Read-only pull, signature verification, verified inbound preparation, and inbound orchestration are required.');
  return Object.freeze({
    read_only_wbs:true,
    async ingest({pull,tenantId,entityId,importBatchId,idempotencyKey}={}){
      let pulled;try{pulled=await pullService.pullTransactionSnapshot(pull);}catch(cause){throw new WbsMcpInboundPipelineError('WBS_MCP_PULL_FAILED','WBS read-only pull failed before REFS persistence.');}
      if(!pulled?.snapshot||pulled.can_persist!==false||pulled.can_allocate!==false||pulled.can_create_draft!==false||pulled.can_post!==false)fail('WBS_MCP_PULL_CONTRACT_INVALID','WBS pull did not return the required non-dispatchable snapshot contract.');
      let verified=false;try{verified=await signatureVerifier(pulled.snapshot);}catch{verified=false;}
      if(verified!==true)fail('WBS_MCP_SNAPSHOT_SIGNATURE_INVALID','WBS snapshot signature verification failed before REFS persistence.');
      let prepared;try{prepared=await inboundAdapter.prepareVerified(pulled.snapshot);}catch{fail('WBS_MCP_ADMISSION_FAILED','WBS snapshot did not meet verified Raw/Normalized/Staging admission rules.');}
      let persisted;try{persisted=await inboundOrchestrator.persist({snapshot:pulled.snapshot,prepared,tenantId,entityId,importBatchId,idempotencyKey});}catch(cause){throw cause;}
      if(!persisted||persisted.can_dispatch_draft!==false||persisted.can_dispatch_autorec!==false||persisted.can_post!==false)fail('WBS_MCP_PERSISTENCE_CONTRACT_INVALID','REFS inbound persistence returned an unsafe dispatch contract.');
      return Object.freeze({status:'WBS_MCP_INGESTED_STAGING_REVIEW_REQUIRED',snapshot_id:prepared.snapshot_id,plan_fingerprint:persisted.plan_fingerprint,receipt_persistence:persisted.receipt_persistence,row_persistence:persisted.row_persistence,can_dispatch_draft:false,can_dispatch_autorec:false,can_post:false,required_next_controls:Object.freeze(['human staging review','approved mapping','authoritative AutoRec allocation/release','standard REFS JE workflow'])});
    }
  });
}
