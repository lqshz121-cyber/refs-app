import {createAccountingHttpServer} from '../api/accounting-http.mjs';
import {PostgresContextIssuer} from './context-issuer.mjs';
import {PostgresAccountingKernel} from './kernel-repository.mjs';

export function createProductionAccountingServer({runtimePool,issuerPool,authenticator,runtimeLoginAllowlist=['refs_runtime'],maxBodyBytes}={}){
  if(!runtimePool||!issuerPool||typeof authenticator?.authenticate!=='function')throw new Error('Production accounting server requires runtime pool, isolated issuer pool and authenticator');
  return createAccountingHttpServer({
    maxBodyBytes,
    authenticate:request=>authenticator.authenticate(request),
    kernelFactory:principal=>{
      const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>principal});
      return new PostgresAccountingKernel(runtimePool,{runtimeLoginAllowlist,sessionProvider:()=>issuer.issue({tenantId:principal.tenantId})});
    }
  });
}
