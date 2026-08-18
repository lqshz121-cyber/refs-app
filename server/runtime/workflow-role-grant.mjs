import {KernelError} from './db.mjs';
import {PostgresGrantSync} from './grant-sync.mjs';
import {RemoteJwksResolver,OidcJwtAuthenticator} from '../api/oidc-authenticator.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY=/^[A-Za-z0-9._:-]{8,128}$/;

const READ=Object.freeze(['AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW','WBS.AUTOREC.VIEW']);

// Each authenticated subject receives exactly one complete role bundle. A
// second invocation replaces the prior grant set; it cannot accumulate maker,
// reviewer, approver, and poster authority on one identity.
export const AUTHORITATIVE_WORKFLOW_ROLES=Object.freeze({
  WBS_OPERATOR_ATTESTER:Object.freeze(['WBS.AUTOREC.VIEW','WBS.PAYABLE.OPERATOR_ATTEST']),
  AI_CONTROLLER_REVIEWER:Object.freeze([...READ,'AI.ANALYSIS.EXPLAIN','AI.AMORTIZATION.VIEW']),
  AI_AMORTIZATION_PREPARER:Object.freeze([...READ,'AI.AMORTIZATION.VIEW','AI.AMORTIZATION.PROPOSE']),
  AI_AMORTIZATION_DRAFT_MAKER:Object.freeze([...READ,'AI.AMORTIZATION.VIEW','AI.AMORTIZATION.DRAFT','GL.JE.CREATE']),
  JE_SUBMITTER:Object.freeze([...READ,'GL.JE.SUBMIT']),
  WBS_PAYABLE_REVIEWER:Object.freeze([...READ,'WBS.PAYABLE.REVIEW']),
  WBS_PAYABLE_MAKER:Object.freeze([...READ,'AP.BILL.CREATE','GL.JE.SUBMIT']),
  JE_REVIEWER:Object.freeze([...READ,'GL.JE.REVIEW']),
  JE_APPROVER:Object.freeze([...READ,'GL.JE.APPROVE']),
  JE_POSTER:Object.freeze([...READ,'GL.JE.POST']),
  BANK_MATCH_MAKER:Object.freeze([...READ,'BANK.MATCH.CREATE']),
  BANK_MATCH_REVIEWER:Object.freeze([...READ,'BANK.MATCH.REVIEW','BANK.MATCH.UNMATCH']),
  BANK_RECONCILIATION_MAKER:Object.freeze([...READ,'BANK.RECONCILIATION.START','BANK.RECONCILIATION.CLEAR','BANK.RECONCILIATION.ADJUSTMENT_DRAFT','GL.JE.CREATE','GL.JE.SUBMIT']),
  BANK_RECONCILIATION_REVIEWER:Object.freeze([...READ,'BANK.RECONCILIATION.REVIEW','GL.JE.REVIEW']),
  BANK_RECONCILIATION_APPROVER:Object.freeze([...READ,'BANK.RECONCILIATION.SIGN_OFF','GL.JE.APPROVE']),
  BANK_RECONCILIATION_REOPENER:Object.freeze([...READ,'BANK.RECONCILIATION.REOPEN']),
});

const required=(environment,key)=>{
  const value=String(environment[key]??'').trim();
  if(!value)throw new KernelError('WORKFLOW_ROLE_CONFIG_MISSING',`${key} is required`);
  return value;
};

export function authoritativeWorkflowRoleGrantConfig(environment=process.env){
  if(environment.NODE_ENV!=='production'||environment.REFS_DEPLOYMENT_ENV!=='staging'||environment.REFS_WORKFLOW_ROLE_CONFIRM!=='AUTHORITATIVE_WORKFLOW_ROLE_ONLY'){
    throw new KernelError('WORKFLOW_ROLE_ENV_DENIED','Workflow role grants require the explicit staging confirmation');
  }
  const tenantId=required(environment,'REFS_STAGE1_TENANT_ID').toLowerCase();
  const entityId=required(environment,'REFS_STAGE1_ENTITY_ID').toLowerCase();
  if(!UUID.test(tenantId)||!UUID.test(entityId))throw new KernelError('WORKFLOW_ROLE_CONFIG_INVALID','Workflow role scope must use UUIDs');
  const role=required(environment,'REFS_WORKFLOW_ROLE');
  const permissions=AUTHORITATIVE_WORKFLOW_ROLES[role];
  if(!permissions)throw new KernelError('WORKFLOW_ROLE_CONFIG_INVALID','Workflow role is not approved');
  const expectedVersion=Number(required(environment,'REFS_WORKFLOW_GRANT_EXPECTED_VERSION'));
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw new KernelError('WORKFLOW_ROLE_CONFIG_INVALID','Expected grant version is invalid');
  const idempotencyKey=required(environment,'REFS_WORKFLOW_GRANT_IDEMPOTENCY_KEY');
  if(!IDEMPOTENCY.test(idempotencyKey))throw new KernelError('WORKFLOW_ROLE_CONFIG_INVALID','Idempotency key is invalid');
  return Object.freeze({
    tenantId,entityId,role,permissions:[...permissions],expectedVersion,idempotencyKey,
    accessToken:required(environment,'REFS_AUTHENTICATED_ACCESS_TOKEN'),
    issuer:required(environment,'OIDC_ISSUER'),audience:required(environment,'OIDC_AUDIENCE'),jwksUri:required(environment,'OIDC_JWKS_URI'),
  });
}

export async function grantAuthenticatedWorkflowRole(pool,config,{authenticator}={}){
  const expected=AUTHORITATIVE_WORKFLOW_ROLES[config.role];
  if(!expected||config.permissions.length!==expected.length||config.permissions.some((value,index)=>value!==expected[index])){
    throw new KernelError('WORKFLOW_ROLE_SCOPE_DENIED','Workflow role grant does not match its frozen permission bundle');
  }
  const verified=authenticator||new OidcJwtAuthenticator({issuer:config.issuer,audience:config.audience,keyResolver:new RemoteJwksResolver({jwksUri:config.jwksUri})});
  const principal=await verified.authenticate({headers:{authorization:`Bearer ${config.accessToken}`}});
  if(principal.tenantId!==config.tenantId)throw new KernelError('WORKFLOW_ROLE_TENANT_DENIED','Authenticated token tenant does not match the configured tenant');
  const sync=new PostgresGrantSync(pool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
  const result=await sync.reconcile({tenantId:config.tenantId,entityId:config.entityId,actorId:principal.actorId,permissions:config.permissions,expectedVersion:config.expectedVersion,idempotencyKey:config.idempotencyKey});
  const returned=[...(result.permissions||[])].sort(),expectedSorted=[...expected].sort();
  if(returned.length!==expectedSorted.length||returned.some((value,index)=>value!==expectedSorted[index]))throw new KernelError('WORKFLOW_ROLE_RESULT_INVALID','Grant sync returned an unexpected workflow role');
  return {role:config.role,idempotent:result.idempotent===true,version:result.version,permissionCount:returned.length};
}
