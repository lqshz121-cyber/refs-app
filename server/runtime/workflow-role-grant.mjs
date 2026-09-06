import {KernelError} from './db.mjs';
import {PostgresGrantSync} from './grant-sync.mjs';
import {RemoteJwksResolver,OidcJwtAuthenticator} from '../api/oidc-authenticator.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY=/^[A-Za-z0-9._:-]{8,128}$/;
const UTC_TIMESTAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const READ=Object.freeze(['AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW','WBS.AUTOREC.VIEW']);
const SERVICE_ONLY=Object.freeze(new Set(['OUTBOX.DISPATCH','BANK.AUTOREC.SYNC','WBS.SNAPSHOT.IMPORT','WBS.BANK.ADMIT','WBS.TEST.IMPORT','AI.PROPOSAL.CREATE','AI.TEST.WORKFLOW','ATTACHMENT.FINALIZE','ATTACHMENT.CLEANUP']));
const role=(authorityClass,permissions,{principalKind='HUMAN'}={})=>Object.freeze({authorityClass,principalKind,permissions:Object.freeze([...permissions])});

// Each authenticated subject receives one frozen bundle. Write authority
// stages never mix Draft, Submit, Review, Approve, or Post.
export const AUTHORITATIVE_WORKFLOW_ROLES=Object.freeze({
  WBS_SNAPSHOT_IMPORTER_SERVICE:role('SERVICE',['WBS.SNAPSHOT.IMPORT'],{principalKind:'SERVICE'}),
  ATTACHMENT_SCANNER_SERVICE:role('SERVICE',['ATTACHMENT.FINALIZE'],{principalKind:'SERVICE'}),
  ATTACHMENT_CLEANUP_SERVICE:role('SERVICE',['ATTACHMENT.CLEANUP'],{principalKind:'SERVICE'}),
  OUTBOX_DISPATCHER_SERVICE:role('SERVICE',['OUTBOX.DISPATCH'],{principalKind:'SERVICE'}),
  AUDIT_READER:role('ANALYSIS',['AUDIT.VIEW']),
  WBS_OPERATOR_ATTESTER:role('ATTEST',['WBS.AUTOREC.VIEW','WBS.PAYABLE.OPERATOR_ATTEST']),
  AI_CONTROLLER_REVIEWER:role('ANALYSIS',[...READ,'AI.ANALYSIS.EXPLAIN','AI.AMORTIZATION.VIEW','AI.ACCOUNTING.SETTINGS.VIEW']),
  AI_FINDING_ASSIGNER:role('ASSIGN',[...READ,'AI.FINDING.ASSIGN']),
  AI_FINDING_RESOLVER:role('RESOLVE',[...READ,'AI.FINDING.RESOLVE']),
  AI_AMORTIZATION_PREPARER:role('PREPARE',[...READ,'AI.AMORTIZATION.VIEW','AI.AMORTIZATION.PROPOSE','AI.ACCOUNTING.SETTINGS.VIEW']),
  AI_AMORTIZATION_DRAFT_MAKER:role('DRAFT',[...READ,'AI.AMORTIZATION.VIEW','AI.AMORTIZATION.DRAFT','GL.JE.CREATE']),
  AI_ACCOUNTING_DECISION_MAKER:role('DRAFT',[...READ,'GL.JE.CREATE']),
  INSURANCE_PREPAID_REVIEWER:role('REVIEW',[...READ,'PREPAID.AMORTIZATION.REVIEW']),
  INSURANCE_PREPAID_DRAFT_MAKER:role('DRAFT',[...READ,'PREPAID.AMORTIZATION.DRAFT','GL.JE.AUTO.CREATE']),
  JE_SUBMITTER:role('SUBMIT',[...READ,'GL.JE.SUBMIT']),
  WBS_PAYABLE_REVIEWER:role('REVIEW',[...READ,'WBS.PAYABLE.REVIEW']),
  WBS_PAYABLE_MAKER:role('DRAFT',[...READ,'AP.BILL.CREATE']),
  WBS_H1_PAYABLE_DRAFT_MAKER:role('DRAFT',[...READ,'WBS.H1.PAYABLE.DRAFT','GL.JE.CREATE']),
  WBS_H1_ACCOUNTING_RECONCILER:role('RECONCILE',[...READ,'WBS.H1.ACCOUNTING.RECONCILE']),
  AP_PAYMENT_MAKER:role('PAYMENT',[...READ,'AP.PAYMENT.CREATE']),
  AP_PAYMENT_REVERSAL_MAKER:role('REVERSAL',[...READ,'AP.PAYMENT.REVERSE']),
  AP_VENDOR_CREDIT_MAKER:role('ADJUSTMENT',[...READ,'AP.VENDOR_CREDIT.CREATE']),
  AP_VENDOR_CREDIT_ALLOCATOR:role('ALLOCATION',[...READ,'AP.VENDOR_CREDIT.APPLY']),
  AR_INVOICE_MAKER:role('DRAFT',[...READ,'AR.INVOICE.CREATE']),
  AR_RECEIPT_MAKER:role('RECEIPT',[...READ,'AR.RECEIPT.CREATE']),
  AR_RECEIPT_REVERSAL_MAKER:role('REVERSAL',[...READ,'AR.RECEIPT.REVERSE']),
  AR_CREDIT_MEMO_MAKER:role('ADJUSTMENT',[...READ,'AR.CREDIT_MEMO.CREATE']),
  AR_CREDIT_MEMO_ALLOCATOR:role('ALLOCATION',[...READ,'AR.CREDIT_MEMO.APPLY']),
  AR_REFUND_MAKER:role('REFUND',[...READ,'AR.REFUND.CREATE']),
  JE_REVIEWER:role('REVIEW',[...READ,'GL.JE.REVIEW']),
  JE_APPROVER:role('APPROVE',[...READ,'GL.JE.APPROVE']),
  JE_POSTER:role('POST',[...READ,'GL.JE.POST']),
  BANK_MATCH_MAKER:role('DRAFT',[...READ,'BANK.MATCH.CREATE']),
  BANK_MATCH_REVIEWER:role('REVIEW',[...READ,'BANK.MATCH.REVIEW']),
  BANK_MATCH_UNMATCHER:role('UNMATCH',[...READ,'BANK.MATCH.UNMATCH']),
  BANK_RECONCILIATION_MAKER:role('DRAFT',[...READ,'BANK.RECONCILIATION.START','BANK.RECONCILIATION.CLEAR','BANK.RECONCILIATION.ADJUSTMENT_DRAFT','GL.JE.CREATE']),
  BANK_RECONCILIATION_REVIEWER:role('REVIEW',[...READ,'BANK.RECONCILIATION.REVIEW','GL.JE.REVIEW']),
  BANK_RECONCILIATION_APPROVER:role('APPROVE',[...READ,'BANK.RECONCILIATION.SIGN_OFF','GL.JE.APPROVE']),
  BANK_RECONCILIATION_REOPENER:role('REOPEN',[...READ,'BANK.RECONCILIATION.REOPEN']),
  GL_REPORT_SNAPSHOT_PREPARER:role('PREPARE',[...READ,'GL.REPORT.SNAPSHOT.PREPARE']),
  GL_REPORT_SNAPSHOT_APPROVER:role('APPROVE',[...READ,'GL.REPORT.SNAPSHOT.APPROVE']),
  GL_PERIOD_CLOSER:role('CLOSE',[...READ,'AI.ACCOUNTING.SETTINGS.VIEW','GL.PERIOD.CLOSE']),
  GL_PERIOD_REOPENER:role('REOPEN',[...READ,'GL.PERIOD.REOPEN']),
});

// Migration 274 installs the equivalent pairwise database matrix.
export const WORKFLOW_SOD_GROUPS=Object.freeze([
  Object.freeze(['GL.JE.CREATE','GL.JE.AUTO.CREATE','AP.BILL.CREATE','AR.INVOICE.CREATE','AP.PAYMENT.CREATE','AP.PAYMENT.REVERSE','AP.VENDOR_CREDIT.CREATE','AP.VENDOR_CREDIT.APPLY','AR.RECEIPT.CREATE','AR.RECEIPT.REVERSE','AR.CREDIT_MEMO.CREATE','AR.CREDIT_MEMO.APPLY','AR.REFUND.CREATE','AI.AMORTIZATION.DRAFT','PREPAID.AMORTIZATION.DRAFT','WBS.COST.CWIP.DRAFT','WBS.PROPERTY.RENT.DRAFT','WBS.H1.PAYABLE.DRAFT','BANK.RECONCILIATION.START','BANK.RECONCILIATION.CLEAR','BANK.RECONCILIATION.ADJUSTMENT_DRAFT','BANK.MATCH.CREATE']),
  Object.freeze(['GL.JE.SUBMIT']),
  Object.freeze(['GL.JE.REVIEW','BANK.MATCH.REVIEW','BANK.RECONCILIATION.REVIEW','PREPAID.AMORTIZATION.REVIEW']),
  Object.freeze(['GL.JE.APPROVE','BANK.RECONCILIATION.SIGN_OFF','GL.REPORT.SNAPSHOT.APPROVE']),
  Object.freeze(['GL.JE.POST']),
  Object.freeze(['BANK.MATCH.UNMATCH']),
  Object.freeze(['GL.PERIOD.CLOSE']),
  Object.freeze(['BANK.RECONCILIATION.REOPEN','GL.PERIOD.REOPEN']),
]);
const stageByPermission=new Map(WORKFLOW_SOD_GROUPS.flatMap((group,index)=>group.map(permission=>[permission,index])));

export function assertWorkflowRoleSafety(definition){
  if(!definition||typeof definition.authorityClass!=='string'||!['HUMAN','SERVICE'].includes(definition.principalKind)||!Array.isArray(definition.permissions)||definition.permissions.length===0)throw new KernelError('WORKFLOW_ROLE_SCOPE_DENIED','Workflow role definition is incomplete');
  if(new Set(definition.permissions).size!==definition.permissions.length)throw new KernelError('WORKFLOW_ROLE_SCOPE_DENIED','Workflow role contains duplicate permissions');
  if(definition.principalKind==='SERVICE'){
    if(definition.authorityClass!=='SERVICE'||definition.permissions.some(permission=>!SERVICE_ONLY.has(permission)))throw new KernelError('WORKFLOW_ROLE_SCOPE_DENIED','Service workflow roles must contain only frozen service permissions');
    return definition;
  }
  if(definition.authorityClass==='SERVICE'||definition.permissions.some(permission=>SERVICE_ONLY.has(permission)))throw new KernelError('WORKFLOW_ROLE_SCOPE_DENIED','Human workflow roles cannot contain service-only permissions');
  const stages=new Set(definition.permissions.map(permission=>stageByPermission.get(permission)).filter(stage=>stage!==undefined));
  if(stages.size>1)throw new KernelError('WORKFLOW_ROLE_SCOPE_DENIED','Workflow role combines mutually exclusive authority stages');
  return definition;
}
for(const definition of Object.values(AUTHORITATIVE_WORKFLOW_ROLES))assertWorkflowRoleSafety(definition);

const required=(environment,key)=>{const value=String(environment[key]??'').trim();if(!value)throw new KernelError('WORKFLOW_ROLE_CONFIG_MISSING',`${key} is required`);return value;};
const validUtc=value=>{if(!UTC_TIMESTAMP.test(value))return false;const parsed=new Date(value);return Number.isFinite(parsed.valueOf())&&parsed.toISOString()===value;};

export function authoritativeWorkflowRoleGrantConfig(environment=process.env){
  if(environment.NODE_ENV!=='production'||environment.REFS_DEPLOYMENT_ENV!=='staging'||environment.REFS_WORKFLOW_ROLE_CONFIRM!=='AUTHORITATIVE_WORKFLOW_ROLE_ONLY')throw new KernelError('WORKFLOW_ROLE_ENV_DENIED','Workflow role grants require the explicit staging confirmation');
  return workflowRolePolicyConfig(environment);
}

export async function grantStagingWorkflowRole(pool,config,{installationId=null,expectedDatabase=null,...options}={}){
  await assertStagingDeploymentTarget(pool,{installationId,expectedDatabase});
  const guarded={...options,transactionGuard:client=>assertStagingDeploymentTarget(client,{installationId,expectedDatabase})};
  return config.principalKind==='SERVICE'?grantConfiguredServiceWorkflowRole(pool,config,guarded):grantAuthenticatedWorkflowRole(pool,config,guarded);
}

export async function assertStagingDeploymentTarget(pool,{installationId=null,expectedDatabase=null}={}){
  const result=await pool.query('SELECT refs_assert_staging_deployment_target($1,$2) AS asserted',[installationId,expectedDatabase]);
  if(result.rows?.[0]?.asserted!==true)throw new KernelError('DEPLOYMENT_IDENTITY_DENIED','Staging database target assertion failed');
}

// Shared policy parsing does not establish deployment authorization.
export function workflowRolePolicyConfig(environment){
  const tenantId=required(environment,'REFS_STAGE1_TENANT_ID').toLowerCase(),entityId=required(environment,'REFS_STAGE1_ENTITY_ID').toLowerCase();
  if(!UUID.test(tenantId)||!UUID.test(entityId))throw new KernelError('WORKFLOW_ROLE_CONFIG_INVALID','Workflow role scope must use UUIDs');
  const roleName=required(environment,'REFS_WORKFLOW_ROLE'),definition=AUTHORITATIVE_WORKFLOW_ROLES[roleName];
  if(!definition)throw new KernelError('WORKFLOW_ROLE_CONFIG_INVALID','Workflow role is not approved');
  assertWorkflowRoleSafety(definition);
  const expectedVersion=Number(required(environment,'REFS_WORKFLOW_GRANT_EXPECTED_VERSION'));
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw new KernelError('WORKFLOW_ROLE_CONFIG_INVALID','Expected grant version is invalid');
  const idempotencyKey=required(environment,'REFS_WORKFLOW_GRANT_IDEMPOTENCY_KEY');
  if(!IDEMPOTENCY.test(idempotencyKey))throw new KernelError('WORKFLOW_ROLE_CONFIG_INVALID','Idempotency key is invalid');
  const validUntil=required(environment,'REFS_WORKFLOW_GRANT_VALID_UNTIL');
  if(!validUtc(validUntil))throw new KernelError('WORKFLOW_ROLE_CONFIG_INVALID','Workflow role grant expiry must be a canonical UTC timestamp');
  const common={tenantId,entityId,role:roleName,principalKind:definition.principalKind,authorityClass:definition.authorityClass,permissions:[...definition.permissions],validUntil,expectedVersion,idempotencyKey};
  if(definition.principalKind==='SERVICE'){
    const actorKey=roleName==='OUTBOX_DISPATCHER_SERVICE'?'OUTBOX_DISPATCH_ACTOR_ID':'WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID';
    return Object.freeze({...common,serviceActorId:required(environment,actorKey)});
  }
  return Object.freeze({...common,accessToken:required(environment,'REFS_AUTHENTICATED_ACCESS_TOKEN'),issuer:required(environment,'OIDC_ISSUER'),audience:required(environment,'OIDC_AUDIENCE'),jwksUri:required(environment,'OIDC_JWKS_URI')});
}

export async function grantAuthenticatedWorkflowRole(pool,config,{authenticator,transactionGuard}={}){
  const expected=AUTHORITATIVE_WORKFLOW_ROLES[config.role];
  if(!expected||expected.principalKind!=='HUMAN'||config.principalKind!=='HUMAN'||config.authorityClass!==expected.authorityClass||config.permissions.length!==expected.permissions.length||config.permissions.some((value,index)=>value!==expected.permissions[index]))throw new KernelError('WORKFLOW_ROLE_SCOPE_DENIED','Workflow role grant does not match its frozen human permission bundle');
  assertWorkflowRoleSafety(expected);
  const verified=authenticator||new OidcJwtAuthenticator({issuer:config.issuer,audience:config.audience,keyResolver:new RemoteJwksResolver({jwksUri:config.jwksUri})});
  const principal=await verified.authenticate({headers:{authorization:`Bearer ${config.accessToken}`}});
  if(principal.tenantId!==config.tenantId)throw new KernelError('WORKFLOW_ROLE_TENANT_DENIED','Authenticated token tenant does not match the configured tenant');
  const sync=new PostgresGrantSync(pool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'}),transactionGuard});
  const result=await sync.reconcile({tenantId:config.tenantId,entityId:config.entityId,actorId:principal.actorId,permissions:config.permissions,authorityClass:config.authorityClass,validUntil:config.validUntil,expectedVersion:config.expectedVersion,idempotencyKey:config.idempotencyKey});
  const returned=[...(result.permissions||[])].sort(),expectedSorted=[...expected.permissions].sort();
  if(returned.length!==expectedSorted.length||returned.some((value,index)=>value!==expectedSorted[index])||result.authority_class!==config.authorityClass||result.valid_until!==config.validUntil)throw new KernelError('WORKFLOW_ROLE_RESULT_INVALID','Grant sync returned an unexpected workflow role');
  return {role:config.role,authorityClass:config.authorityClass,validUntil:config.validUntil,idempotent:result.idempotent===true,version:result.version,permissionCount:returned.length};
}

export async function grantConfiguredServiceWorkflowRole(pool,config,{principalProvider=async()=>({trusted:true,serviceId:'platform-iam-sync'}),transactionGuard}={}){
  const expected=AUTHORITATIVE_WORKFLOW_ROLES[config.role];
  if(!expected||expected.principalKind!=='SERVICE'||config.principalKind!=='SERVICE'||config.authorityClass!=='SERVICE'||config.permissions.length!==expected.permissions.length||config.permissions.some((value,index)=>value!==expected.permissions[index]))throw new KernelError('WORKFLOW_ROLE_SCOPE_DENIED','Service role grant does not match its frozen permission bundle');
  assertWorkflowRoleSafety(expected);
  if(typeof config.serviceActorId!=='string'||config.serviceActorId.trim().length<8)throw new KernelError('WORKFLOW_ROLE_SERVICE_PRINCIPAL_DENIED','Service role requires the configured provider service actor');
  const sync=new PostgresGrantSync(pool,{principalProvider,transactionGuard});
  const result=await sync.reconcile({tenantId:config.tenantId,entityId:config.entityId,actorId:config.serviceActorId,permissions:config.permissions,authorityClass:'SERVICE',validUntil:config.validUntil,expectedVersion:config.expectedVersion,idempotencyKey:config.idempotencyKey});
  const returned=[...(result.permissions||[])].sort(),expectedSorted=[...expected.permissions].sort();
  if(returned.length!==expectedSorted.length||returned.some((value,index)=>value!==expectedSorted[index])||result.authority_class!=='SERVICE'||result.valid_until!==config.validUntil)throw new KernelError('WORKFLOW_ROLE_RESULT_INVALID','Grant sync returned an unexpected service role');
  return {role:config.role,authorityClass:'SERVICE',validUntil:config.validUntil,idempotent:result.idempotent===true,version:result.version,permissionCount:returned.length};
}
