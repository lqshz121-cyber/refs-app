import {createAccountingHttpServer} from '../api/accounting-http.mjs';
import {PostgresContextIssuer} from './context-issuer.mjs';
import {PostgresAccountingKernel} from './kernel-repository.mjs';
import {AttachmentEvidenceService} from './attachment-storage.mjs';
import {createWbsInboundAutoRecHttpReadService} from './wbs-inbound-autorec-http-read-service.mjs';
import {grantStage1ReadAccess,upgradeStage1WbsReadAccess} from './stage1-bootstrap.mjs';
import {createWbsLivePilotReadService} from './wbs-live-pilot-read-service.mjs';
import {createWbsOperatorAttestedPayableService} from './wbs-operator-attested-payable.mjs';
import {createWbsAdmittedPayableIngestion} from './wbs-admitted-payable-ingestion.mjs';

export function createProductionAccountingServer({runtimePool,issuerPool,grantSyncPool,stage1SelfGrant,stage1SelfWbsReadUpgrade,authenticator,attachmentStorage,virusScanner,scannerServiceActorId,wbsSnapshotVerifier,wbsSignedBankAdmissionVerifier,wbsAutoRecTransitionContractVerifier,wbsLivePilotClient,runtimeLoginAllowlist=['refs_runtime'],maxBodyBytes,allowedOrigins=[]}={}){
  if(!runtimePool||!issuerPool||typeof authenticator?.authenticate!=='function')throw new Error('Production accounting server requires runtime pool, isolated issuer pool and authenticator');
  const attachmentEnabled=Boolean(attachmentStorage||virusScanner||scannerServiceActorId);
  if(attachmentEnabled&&(!attachmentStorage||!virusScanner||!scannerServiceActorId))throw new Error('Attachment integration requires object storage, virus scanner and scanner identity together');
  if(wbsSnapshotVerifier!=null&&typeof wbsSnapshotVerifier!=='function')throw new Error('WBS snapshot verifier must be a function when configured');
  if(wbsSignedBankAdmissionVerifier!=null&&typeof wbsSignedBankAdmissionVerifier!=='function')throw new Error('WBS signed bank admission verifier must be a function when configured');
  if(wbsAutoRecTransitionContractVerifier!=null&&typeof wbsAutoRecTransitionContractVerifier!=='function')throw new Error('WBS AutoRec transition-contract verifier must be a function when configured');
  if((stage1SelfGrant!=null||stage1SelfWbsReadUpgrade!=null)&&!grantSyncPool)throw new Error('Stage 1 self-grant requires the isolated grant-sync pool');
  const kernelFor=principal=>{const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>principal});return new PostgresAccountingKernel(runtimePool,{runtimeLoginAllowlist,wbsSnapshotVerifier,wbsSignedBankAdmissionVerifier,wbsAutoRecTransitionContractVerifier,sessionProvider:()=>issuer.issue({tenantId:principal.tenantId})});};
  return createAccountingHttpServer({
    maxBodyBytes,
    healthCheck:async()=>{try{const checks=[runtimePool.query('SELECT 1 AS ready'),issuerPool.query('SELECT 1 AS ready')];if(attachmentEnabled)checks.push(attachmentStorage.probe(),virusScanner.probe());const [runtime,issuer]=await Promise.all(checks);return runtime.rowCount===1&&issuer.rowCount===1;}catch{return false;}},
    authenticate:request=>authenticator.authenticate(request),
    kernelFactory:kernelFor,
    stage1SelfGrantServiceFactory:stage1SelfGrant?principal=>({
      grant:async({entityId,idempotencyKey})=>{
        if(principal.tenantId!==stage1SelfGrant.tenantId||entityId!==stage1SelfGrant.entityId){
          const error=new Error('This signed-in identity is not configured for the Stage 1 read scope');error.code='42501';throw error;
        }
        return grantStage1ReadAccess(grantSyncPool,{...stage1SelfGrant,actorId:principal.actorId,idempotencyKey});
      }
    }):undefined,
    stage1SelfWbsReadUpgradeServiceFactory:stage1SelfWbsReadUpgrade?principal=>({
      upgrade:async({entityId,idempotencyKey})=>{
        if(principal.tenantId!==stage1SelfWbsReadUpgrade.tenantId||entityId!==stage1SelfWbsReadUpgrade.entityId){
          const error=new Error('This signed-in identity is not configured for the Stage 1 WBS read scope');error.code='42501';throw error;
        }
        return upgradeStage1WbsReadAccess(grantSyncPool,{...stage1SelfWbsReadUpgrade,actorId:principal.actorId,idempotencyKey});
      }
    }):undefined,
    wbsReadServiceFactory:principal=>createWbsInboundAutoRecHttpReadService({kernel:kernelFor(principal)}),
    wbsLivePilotServiceFactory:wbsLivePilotClient?principal=>createWbsLivePilotReadService({client:wbsLivePilotClient,authorize:scope=>kernelFor(principal).assertWbsAutoRecView(scope)}):undefined,
    wbsOperatorAttestedPayableServiceFactory:wbsLivePilotClient?principal=>createWbsOperatorAttestedPayableService({client:wbsLivePilotClient,kernel:kernelFor(principal)}):undefined,
    wbsAdmittedPayableServiceFactory:wbsSnapshotVerifier?principal=>createWbsAdmittedPayableIngestion({kernel:kernelFor(principal),signatureVerifier:wbsSnapshotVerifier}):undefined,
    allowedOrigins,attachmentServiceFactory:attachmentEnabled?principal=>new AttachmentEvidenceService({storage:attachmentStorage,scanner:virusScanner,uploaderKernelFactory:kernelFor,
      scannerKernelFactory:()=>kernelFor({trusted:true,tenantId:principal.tenantId,actorId:scannerServiceActorId})})
      :undefined
  });
}
