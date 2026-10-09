import {KernelError} from './db.mjs';
import {PostgresGrantSync} from './grant-sync.mjs';
import {BANK_REQUEST_ACCOUNTING_VIEW_ROLE} from './bank-request-settings-role.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=()=>{throw new KernelError('PREAUTHORIZED_ACCESS_DENIED','An exact finite administrator-approved staging grant is required');};
export async function assertPreauthorizedStagingTarget(pool,{installationId,expectedDatabase}={}){
  if(!UUID.test(installationId||'')||typeof expectedDatabase!=='string'||!expectedDatabase.trim())deny();
  const result=await pool.query('SELECT refs_assert_deployment_identity($1,$2,$3) AS asserted',[installationId,'staging',expectedDatabase]);
  if(result.rows?.[0]?.asserted!==true)throw new KernelError('DEPLOYMENT_IDENTITY_DENIED','Registered staging database identity is required');
}
export function preauthorizedBankAccessConfig(env,now=Date.now()){
  const mode=env.REFS_PREAUTHORIZED_BANK_ACCESS_MODE||'DISABLED';
  if(mode==='DISABLED')return null;
  if(mode!=='ENABLED'||env.NODE_ENV!=='production'||env.REFS_DEPLOYMENT_ENV!=='staging'||env.REFS_PREAUTHORIZED_BANK_ACCESS_CONFIRM!=='FIXED_HUMAN_BANK_REQUEST_AND_READ_ONLY')deny();
  const scope={tenantId:env.REFS_PREAUTHORIZED_BANK_ACCESS_TENANT_ID,entityId:env.REFS_PREAUTHORIZED_BANK_ACCESS_ENTITY_ID,actorId:env.REFS_PREAUTHORIZED_BANK_ACCESS_ACTOR_ID,expectedVersion:Number(env.REFS_PREAUTHORIZED_BANK_ACCESS_EXPECTED_VERSION),validUntil:env.REFS_PREAUTHORIZED_BANK_ACCESS_VALID_UNTIL,installationId:env.REFS_EXPECTED_INSTALLATION_ID,expectedDatabase:env.REFS_EXPECTED_DATABASE_NAME};
  if(![scope.tenantId,scope.entityId,scope.installationId].every(v=>UUID.test(v||''))||typeof scope.actorId!=='string'||!scope.actorId.trim()||scope.actorId!==scope.actorId.trim()||scope.actorId.length>200||/[\u0000-\u001f\u007f]/.test(scope.actorId)||!scope.expectedDatabase||!/^\d+$/.test(env.REFS_PREAUTHORIZED_BANK_ACCESS_EXPECTED_VERSION||'')||!Number.isSafeInteger(scope.expectedVersion))deny();
  const until=Date.parse(scope.validUntil);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(scope.validUntil||'')||!Number.isFinite(until)||new Date(until).toISOString()!==scope.validUntil||until<=now||until-now>23*60*60*1000)deny();
  return Object.freeze(scope);
}

// Disabled by default; deployment requires independent verification.
// Deployment configuration is the administrator's fixed authorization; the
// authenticated request may activate only its own approved bundle, never name
// an actor, a permission, a role, an expiry or another company in a body.
export function createPreauthorizedBankAccess({pool,config,principal,clock=()=>Date.now(),assertTarget=assertPreauthorizedStagingTarget,syncFactory=(p,o)=>new PostgresGrantSync(p,o)}={}){
  if(!config||principal?.trusted!==true||principal.internalTest===true||principal.actorId!==config.actorId||principal.tenantId!==config.tenantId)deny();
  const captured=Object.freeze({...config});
  const actorId=principal.actorId;
  const expiry=Date.parse(captured.validUntil);
  if(![captured.tenantId,captured.entityId,captured.installationId].every(v=>UUID.test(v||''))||!Number.isSafeInteger(captured.expectedVersion)||captured.expectedVersion<0||typeof captured.expectedDatabase!=='string'||!captured.expectedDatabase.trim()||!Number.isFinite(expiry)||new Date(expiry).toISOString()!==captured.validUntil)deny();
  return Object.freeze({describe:async({entityId}={})=>{
    const currentTime=clock();
    if(entityId!==captured.entityId||!Number.isFinite(currentTime)||expiry<=currentTime||expiry-currentTime>23*60*60*1000)deny();
    await assertTarget(pool,{installationId:captured.installationId,expectedDatabase:captured.expectedDatabase});
    return {role:'WBS_BANK_IMPORT_REQUESTER_ACCOUNTING_VIEWER',entityId:captured.entityId,expectedVersion:captured.expectedVersion,validUntil:captured.validUntil,permissionCount:BANK_REQUEST_ACCOUNTING_VIEW_ROLE.permissions.length};
  },activate:async({entityId,idempotencyKey}={})=>{
    const currentTime=clock();
    if(entityId!==captured.entityId||typeof idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)||!Number.isFinite(currentTime)||expiry<=currentTime||expiry-currentTime>23*60*60*1000)deny();
    const target={installationId:captured.installationId,expectedDatabase:captured.expectedDatabase};
    // Recheck target inside the same serializable grant transaction, not only
    // at startup. The database controls concurrency, replay and authority SoD.
    await assertTarget(pool,target);
    const sync=syncFactory(pool,{principalProvider:async()=>{await assertTarget(pool,target);return {trusted:true,serviceId:'platform-iam-sync'};},transactionGuard:client=>assertTarget(client,target)});
    const result=await sync.reconcile({tenantId:captured.tenantId,entityId:captured.entityId,actorId,permissions:[...BANK_REQUEST_ACCOUNTING_VIEW_ROLE.permissions],authorityClass:BANK_REQUEST_ACCOUNTING_VIEW_ROLE.authorityClass,validUntil:captured.validUntil,expectedVersion:captured.expectedVersion,idempotencyKey});
    const actual=[...(result?.permissions||[])].sort(),expected=[...BANK_REQUEST_ACCOUNTING_VIEW_ROLE.permissions].sort();
    if(!Number.isSafeInteger(result?.version)||result.version!==captured.expectedVersion+1||result?.authority_class!==BANK_REQUEST_ACCOUNTING_VIEW_ROLE.authorityClass||result?.valid_until!==captured.validUntil||actual.length!==expected.length||actual.some((p,i)=>p!==expected[i]))throw new KernelError('PREAUTHORIZED_ACCESS_RESULT_INVALID','Grant receipt differs from the approved bundle');
    return {role:'WBS_BANK_IMPORT_REQUESTER_ACCOUNTING_VIEWER',version:result.version,validUntil:captured.validUntil,permissionCount:actual.length,idempotent:result.idempotent===true};
  }});
}
