import {createAccountingHttpServer} from '../api/accounting-http.mjs';
import {PostgresContextIssuer} from './context-issuer.mjs';
import {PostgresAccountingKernel} from './kernel-repository.mjs';
import {AttachmentEvidenceService} from './attachment-storage.mjs';

export function createProductionAccountingServer({runtimePool,issuerPool,authenticator,attachmentStorage,virusScanner,scannerServiceActorId,wbsSnapshotVerifier,runtimeLoginAllowlist=['refs_runtime'],maxBodyBytes,allowedOrigins=[]}={}){
  if(!runtimePool||!issuerPool||typeof authenticator?.authenticate!=='function')throw new Error('Production accounting server requires runtime pool, isolated issuer pool and authenticator');
  const attachmentEnabled=Boolean(attachmentStorage||virusScanner||scannerServiceActorId);
  if(attachmentEnabled&&(!attachmentStorage||!virusScanner||!scannerServiceActorId))throw new Error('Attachment integration requires object storage, virus scanner and scanner identity together');
  if(wbsSnapshotVerifier!=null&&typeof wbsSnapshotVerifier!=='function')throw new Error('WBS snapshot verifier must be a function when configured');
  const kernelFor=principal=>{const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>principal});return new PostgresAccountingKernel(runtimePool,{runtimeLoginAllowlist,wbsSnapshotVerifier,sessionProvider:()=>issuer.issue({tenantId:principal.tenantId})});};
  return createAccountingHttpServer({
    maxBodyBytes,
    healthCheck:async()=>{try{const checks=[runtimePool.query('SELECT 1 AS ready'),issuerPool.query('SELECT 1 AS ready')];if(attachmentEnabled)checks.push(attachmentStorage.probe(),virusScanner.probe());const [runtime,issuer]=await Promise.all(checks);return runtime.rowCount===1&&issuer.rowCount===1;}catch{return false;}},
    authenticate:request=>authenticator.authenticate(request),
    kernelFactory:kernelFor,
    allowedOrigins,attachmentServiceFactory:attachmentEnabled?principal=>new AttachmentEvidenceService({storage:attachmentStorage,scanner:virusScanner,uploaderKernelFactory:kernelFor,
      scannerKernelFactory:()=>kernelFor({trusted:true,tenantId:principal.tenantId,actorId:scannerServiceActorId})})
      :undefined
  });
}
