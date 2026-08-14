import {canonicalRequestHash} from './request-hash.mjs';
import {validateWbsSnapshotPackage} from './wbs-snapshot-package.mjs';
import {createWbsMcpInboundPipeline} from './wbs-mcp-inbound-pipeline.mjs';
import {createWbsInboundDataAdapter,createWbsInboundOrchestrator} from './wbs-inbound-data-adapter.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text=value=>value==null?'':String(value).trim();
const freeze=value=>Object.freeze(value);

export class WbsAdmittedCostCwipIngestionError extends Error{
  constructor(code,message){super(message);this.name='WbsAdmittedCostCwipIngestionError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsAdmittedCostCwipIngestionError(code,message);};

// Cost GL control snapshots remain control-only.  This boundary accepts only
// the separate, row-level Cost General Ledger export defined in the V2
// snapshot policy; it can propose a standard JE only after a human review and
// approved mapping, never from an aggregate control metric.
export function assertCostCwipBoundary(snapshot){
  if(snapshot?.status==='NOT_ADMITTED'||snapshot?.signature_verified===false||snapshot?.can_persist===false)fail('WBS_COST_CWIP_ADMISSION_UNSIGNED_PILOT_FORBIDDEN','Unsigned pilot observations can never enter Cost-to-CWIP ingestion.');
  let validated;
  try{validated=validateWbsSnapshotPackage(snapshot);}catch{fail('WBS_COST_CWIP_ADMISSION_PACKAGE_INVALID','A valid immutable WBS snapshot package is required.');}
  if(validated.environment!=='PRODUCTION'||snapshot.schema_version!=='WBS_READONLY_SNAPSHOT_V2')fail('WBS_COST_CWIP_ADMISSION_PRODUCTION_REQUIRED','Only a production V2 WBS signed snapshot package may enter Cost-to-CWIP ingestion.');
  if(snapshot.views.length!==1||snapshot.views[0]?.name!=='BGDATA.cost_general_ledger')fail('WBS_COST_CWIP_ADMISSION_SCOPE_INVALID','The admitted Cost-to-CWIP flow accepts exactly one row-level WBS Cost General Ledger view.');
  if(!snapshot.views[0].rows.length)fail('WBS_COST_CWIP_ADMISSION_EMPTY','The admitted Cost-to-CWIP flow requires at least one receipt-backed cost row.');
  const currencies=new Set(snapshot.views[0].rows.map(row=>text(row?.currency)));
  if(currencies.size!==1||![...currencies].every(currency=>/^[A-Z]{3}$/.test(currency)))fail('WBS_COST_CWIP_ADMISSION_CURRENCY_INVALID','Every Cost-to-CWIP row must retain one exact uppercase ISO currency scope.');
  if(text(snapshot.delivery?.snapshot_token)===''||text(snapshot.views[0]?.company_key)===''||text(snapshot.views[0]?.rows[0]?.currency)==='')fail('WBS_COST_CWIP_ADMISSION_SCOPE_INVALID','Signed Cost-to-CWIP evidence must explicitly carry company, currency, and provider snapshot-token scope.');
  return freeze({validated,currency:[...currencies][0]});
}

export function assertPreparedCostCwipBoundary(prepared,boundary){
  if(!prepared||prepared.company_key!==boundary.validated.company_key||prepared.snapshot_id!==boundary.validated.snapshot_id||prepared.package_hash!==boundary.validated.package_hash)fail('WBS_COST_CWIP_ADMISSION_LINEAGE_INVALID','Prepared Cost-to-CWIP evidence must retain the exact signed snapshot, company, and package hash.');
  if(prepared.controls.length!==0||prepared.normalized.length!==boundary.validated.receipt_count||prepared.normalized.some(row=>row.source_type!=='COST_CWIP'||row.company_key!==boundary.validated.company_key||row.currency!==boundary.currency))fail('WBS_COST_CWIP_ADMISSION_SCOPE_INVALID','Prepared Cost-to-CWIP evidence crossed its signed company, currency, or source-type scope.');
  if(prepared.staging.length+prepared.exceptions.length!==prepared.normalized.length)fail('WBS_COST_CWIP_ADMISSION_OUTCOME_INVALID','Every normalized Cost-to-CWIP row requires exactly one Staging or Exception outcome.');
}

export function createWbsAdmittedCostCwipIngestion({kernel,signatureVerifier}={}){
  if(!kernel||typeof kernel.recordWbsSnapshot!=='function'||typeof kernel.persistWbsInboundRows!=='function')throw new WbsAdmittedCostCwipIngestionError('WBS_COST_CWIP_ADMISSION_PERSISTENCE_REQUIRED','The production WBS snapshot and inbound persistence kernel is required.');
  if(typeof signatureVerifier!=='function')throw new WbsAdmittedCostCwipIngestionError('WBS_COST_CWIP_ADMISSION_VERIFIER_REQUIRED','A pinned production WBS signature verifier is required.');
  const snapshotReader=freeze({readOnly:true,async readSnapshot(){fail('WBS_COST_CWIP_ADMISSION_DIRECT_SNAPSHOT_REQUIRED','The admitted snapshot must be supplied by the authenticated ingestion request.');}});
  const adapter=createWbsInboundDataAdapter({snapshotReader,verifyProductionSnapshot:signatureVerifier});
  const orchestrator=createWbsInboundOrchestrator({adapter,kernel});
  const replay=new Map();
  return freeze({
    mode:'WBS_ADMITTED_COST_CWIP_INGESTION_V1',
    async ingest({tenantId,entityId,snapshot,idempotencyKey}={}){
      if(!UUID.test(text(tenantId))||!UUID.test(text(entityId)))fail('WBS_COST_CWIP_ADMISSION_IDENTITY_INVALID','Authenticated tenant and entity UUIDs are required.');
      if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,255}$/.test(text(idempotencyKey)))fail('WBS_COST_CWIP_ADMISSION_IDEMPOTENCY_REQUIRED','A stable Cost-to-CWIP ingestion idempotency key is required.');
      const boundary=assertCostCwipBoundary(snapshot);
      const requestFingerprint=canonicalRequestHash({tenant_id:tenantId,entity_id:entityId,snapshot_id:boundary.validated.snapshot_id,package_hash:boundary.validated.package_hash,company_key:boundary.validated.company_key,currency:boundary.currency});
      const prior=replay.get(idempotencyKey);
      if(prior){
        if(prior.request_fingerprint!==requestFingerprint)fail('WBS_COST_CWIP_ADMISSION_IDEMPOTENCY_CONFLICT','The idempotency key was already used for different Cost-to-CWIP evidence.');
        return freeze({...await prior.promise,idempotent:true});
      }
      const promise=(async()=>{
        let prepared;
        try{prepared=await adapter.prepareVerified(snapshot);}catch{fail('WBS_COST_CWIP_ADMISSION_SIGNATURE_INVALID','The production Cost-to-CWIP snapshot did not pass pinned-key signature admission.');}
        assertPreparedCostCwipBoundary(prepared,boundary);
        const pullService=freeze({async pullTransactionSnapshot(){return freeze({snapshot,can_persist:false,can_allocate:false,can_create_draft:false,can_post:false});}});
        const pipeline=createWbsMcpInboundPipeline({pullService,signatureVerifier,inboundAdapter:adapter,inboundOrchestrator:orchestrator});
        let persisted;
        try{persisted=await pipeline.ingest({pull:freeze({kind:'ADMITTED_COST_CWIP_SNAPSHOT'}),tenantId,entityId,idempotencyKey});}
        catch(cause){if(cause instanceof WbsAdmittedCostCwipIngestionError)throw cause;throw new WbsAdmittedCostCwipIngestionError(cause?.code||'WBS_COST_CWIP_ADMISSION_PERSISTENCE_FAILED','Admitted Cost-to-CWIP evidence could not be persisted safely.');}
        const rowPersistence=Array.isArray(persisted?.row_persistence)?persisted.row_persistence:null;
        if(!persisted||persisted.can_dispatch_draft!==false||persisted.can_dispatch_autorec!==false||persisted.can_post!==false||!persisted.receipt_persistence||!rowPersistence)fail('WBS_COST_CWIP_ADMISSION_PERSISTENCE_INVALID','Cost-to-CWIP persistence did not return the required non-dispatchable evidence contract.');
        return freeze({status:'PERSISTED_COST_CWIP_STAGING_REVIEW_REQUIRED',idempotent:false,snapshot_id:boundary.validated.snapshot_id,package_hash:boundary.validated.package_hash,company_key:boundary.validated.company_key,currency:boundary.currency,normalized_count:prepared.normalized.length,staging_count:prepared.staging.length,exception_count:prepared.exceptions.length,receipt_persistence:persisted.receipt_persistence,row_persistence:rowPersistence,can_write_wbs:false,can_create_draft:false,can_approve:false,can_post:false,required_next_controls:freeze(['human staging review','approved CWIP mapping','separate standard REFS JE workflow'])});
      })();
      replay.set(idempotencyKey,freeze({request_fingerprint:requestFingerprint,promise}));
      try{return await promise;}catch(error){replay.delete(idempotencyKey);throw error;}
    }
  });
}
