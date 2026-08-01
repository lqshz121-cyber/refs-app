import {createAccountingHttpServer} from '../api/accounting-http.mjs';
import {PostgresContextIssuer} from './context-issuer.mjs';
import {PostgresAccountingKernel} from './kernel-repository.mjs';
import {AttachmentEvidenceService} from './attachment-storage.mjs';

export function createProductionAccountingServer({runtimePool,issuerPool,authenticator,attachmentStorage,virusScanner,scannerServiceActorId,runtimeLoginAllowlist=['refs_runtime'],maxBodyBytes}={}){
  if(!runtimePool||!issuerPool||typeof authenticator?.authenticate!=='function'||!attachmentStorage||!virusScanner||!scannerServiceActorId)throw new Error('Production accounting server requires runtime pool, isolated issuer pool, authenticator, object storage and scanner identity');
  const kernelFor=principal=>{const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>principal});return new PostgresAccountingKernel(runtimePool,{runtimeLoginAllowlist,sessionProvider:()=>issuer.issue({tenantId:principal.tenantId})});};
  return createAccountingHttpServer({
    maxBodyBytes,
    healthCheck:async()=>{
      const [runtime,issuer]=await Promise.all([runtimePool.query('SELECT 1 AS ready'),issuerPool.query('SELECT 1 AS ready')]);
      return runtime.rowCount===1&&issuer.rowCount===1;
    },
    authenticate:request=>authenticator.authenticate(request),
    kernelFactory:kernelFor,
    attachmentServiceFactory:principal=>new AttachmentEvidenceService({storage:attachmentStorage,scanner:virusScanner,uploaderKernelFactory:kernelFor,
      scannerKernelFactory:()=>kernelFor({trusted:true,tenantId:principal.tenantId,actorId:scannerServiceActorId})})
  });
}
