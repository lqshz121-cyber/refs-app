import {KernelError,requireRow,withSerializableRetry} from './db.mjs';
import {PostgresGrantSync} from './grant-sync.mjs';
import {canonicalRequestHash} from './request-hash.mjs';
import {RemoteJwksResolver,OidcJwtAuthenticator} from '../api/oidc-authenticator.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE=/^[A-Z0-9_-]{2,32}$/;
const ENTITY_CODE=/^[A-Z0-9_-]{1,64}$/;
const ACCOUNT_CODE=/^[A-Z0-9._-]{1,32}$/;
const IDEMPOTENCY=/^[A-Za-z0-9._:-]{8,128}$/;
const SUBJECT=/^[^\u0000-\u001f\u007f]{1,200}$/;
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const UTC_TIMESTAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const STAGE1_READ_PERMISSIONS=Object.freeze(['AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW']);
// This is an upgrade of the fixed Stage 1 reader set, not a general WBS
// permission bundle.  It adds one evidence-only capability and deliberately
// excludes WBS.SNAPSHOT.IMPORT and every REFS command permission.
export const STAGE1_WBS_READ_PERMISSIONS=Object.freeze([...STAGE1_READ_PERMISSIONS,'WBS.AUTOREC.VIEW']);
export const STAGE1_WBS_OPERATOR_PERMISSIONS=Object.freeze([...STAGE1_WBS_READ_PERMISSIONS,'WBS.PAYABLE.OPERATOR_ATTEST']);
export const STAGE1_CONTROLLED_TEST_WORKFLOW_PERMISSIONS=Object.freeze([
  'AP.VIEW','AR.VIEW','BANK.MATCH.CREATE','BANK.MATCH.REVIEW','BANK.MATCH.UNMATCH',
  'BANK.RECONCILIATION.ADJUSTMENT_DRAFT','BANK.RECONCILIATION.CLEAR','BANK.RECONCILIATION.REOPEN',
  'BANK.RECONCILIATION.REVIEW','BANK.RECONCILIATION.SIGN_OFF','BANK.RECONCILIATION.START','BANK.VIEW',
  'GL.JE.APPROVE','GL.JE.CREATE','GL.JE.POST','GL.JE.REVIEW','GL.JE.SUBMIT','GL.JE.VIEW','GL.REPORT.VIEW',
  'WBS.AUTOREC.VIEW','WBS.PAYABLE.OPERATOR_ATTEST','WBS.TEST.IMPORT'
]);
export const STAGE1_ACCOUNTING_CODES=Object.freeze({payable:'291001',receivable:'120200'});

const required=(environment,key)=>{
  const value=String(environment[key]??'').trim();
  if(!value)throw new KernelError('STAGE1_BOOTSTRAP_CONFIG_MISSING',`${key} is required`);
  return value;
};

const exactStaging=environment=>{
  if(environment.NODE_ENV!=='production'||environment.REFS_DEPLOYMENT_ENV!=='staging'||environment.REFS_STAGE1_BOOTSTRAP_CONFIRM!=='STAGE1_AUTHORITATIVE_ONLY'){
    throw new KernelError('STAGE1_BOOTSTRAP_ENV_DENIED','Stage 1 bootstrap requires an explicit production-process staging confirmation');
  }
};

const uuid=(value,key)=>{
  if(!UUID.test(value))throw new KernelError('STAGE1_BOOTSTRAP_CONFIG_INVALID',`${key} must be a UUID`);
  return value.toLowerCase();
};

const text=(value,key,{max=200,pattern}={})=>{
  if(value!==value.trim()||value.length<1||value.length>max||/[\u0000-\u001f\u007f]/.test(value)||(pattern&&!pattern.test(value))){
    throw new KernelError('STAGE1_BOOTSTRAP_CONFIG_INVALID',`${key} is invalid`);
  }
  return value;
};

const calendarDate=(value,key)=>{
  if(!ISO_DATE.test(value))throw new KernelError('STAGE1_BOOTSTRAP_CONFIG_INVALID',`${key} must be YYYY-MM-DD`);
  const date=new Date(`${value}T00:00:00Z`);
  if(Number.isNaN(date.valueOf())||date.toISOString().slice(0,10)!==value)throw new KernelError('STAGE1_BOOTSTRAP_CONFIG_INVALID',`${key} is not a calendar date`);
  return value;
};
const grantExpiry=(environment)=>{const value=required(environment,'REFS_STAGE1_GRANT_VALID_UNTIL'),parsed=new Date(value);if(!UTC_TIMESTAMP.test(value)||!Number.isFinite(parsed.valueOf())||parsed.toISOString()!==value)throw new KernelError('STAGE1_BOOTSTRAP_CONFIG_INVALID','REFS_STAGE1_GRANT_VALID_UNTIL must be a canonical UTC timestamp');return value;};

const period=(environment)=>{
  const periodCode=required(environment,'REFS_STAGE1_PERIOD_CODE');
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodCode))throw new KernelError('STAGE1_BOOTSTRAP_CONFIG_INVALID','REFS_STAGE1_PERIOD_CODE must be YYYY-MM');
  const startsOn=calendarDate(required(environment,'REFS_STAGE1_PERIOD_START'),'REFS_STAGE1_PERIOD_START');
  const endsOn=calendarDate(required(environment,'REFS_STAGE1_PERIOD_END'),'REFS_STAGE1_PERIOD_END');
  const [year,month]=periodCode.split('-').map(Number);
  const expectedStart=`${periodCode}-01`;
  const expectedEnd=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
  if(startsOn!==expectedStart||endsOn!==expectedEnd)throw new KernelError('STAGE1_BOOTSTRAP_CONFIG_INVALID','Stage 1 period must cover one complete calendar month');
  return {periodCode,startsOn,endsOn};
};

export function stage1ProvisionConfig(environment=process.env){
  exactStaging(environment);
  const tenantId=uuid(required(environment,'REFS_STAGE1_TENANT_ID'),'REFS_STAGE1_TENANT_ID');
  const entityId=uuid(required(environment,'REFS_STAGE1_ENTITY_ID'),'REFS_STAGE1_ENTITY_ID');
  const periodId=uuid(required(environment,'REFS_STAGE1_PERIOD_ID'),'REFS_STAGE1_PERIOD_ID');
  const tenantCode=text(required(environment,'REFS_STAGE1_TENANT_CODE'),'REFS_STAGE1_TENANT_CODE',{pattern:CODE,max:32});
  const entityCode=text(required(environment,'REFS_STAGE1_ENTITY_CODE'),'REFS_STAGE1_ENTITY_CODE',{pattern:ENTITY_CODE,max:64});
  const tenantName=text(required(environment,'REFS_STAGE1_TENANT_NAME'),'REFS_STAGE1_TENANT_NAME');
  const entityName=text(required(environment,'REFS_STAGE1_ENTITY_NAME'),'REFS_STAGE1_ENTITY_NAME');
  const baseCurrency=text(required(environment,'REFS_STAGE1_BASE_CURRENCY'),'REFS_STAGE1_BASE_CURRENCY',{pattern:/^[A-Z]{3}$/,max:3});
  const cashAccountCode=text(required(environment,'REFS_STAGE1_CASH_ACCOUNT_CODE'),'REFS_STAGE1_CASH_ACCOUNT_CODE',{pattern:ACCOUNT_CODE,max:32});
  const idempotencyKey=text(required(environment,'REFS_STAGE1_PROVISION_IDEMPOTENCY_KEY'),'REFS_STAGE1_PROVISION_IDEMPOTENCY_KEY',{pattern:IDEMPOTENCY,max:128});
  const {periodCode,startsOn,endsOn}=period(environment);
  const accounts=[
    {accountCode:cashAccountCode,accountName:'Cash'},
    {accountCode:STAGE1_ACCOUNTING_CODES.payable,accountName:'Accounts Payable'},
    {accountCode:STAGE1_ACCOUNTING_CODES.receivable,accountName:'Accounts Receivable'},
  ].sort((left,right)=>left.accountCode.localeCompare(right.accountCode));
  if(new Set(accounts.map(row=>row.accountCode)).size!==accounts.length)throw new KernelError('STAGE1_BOOTSTRAP_CONFIG_INVALID','Stage 1 account codes must be distinct');
  return Object.freeze({tenantId,tenantCode,tenantName,entityId,entityCode,entityName,periodId,periodCode,startsOn,endsOn,baseCurrency,cashAccountCode,idempotencyKey,accounts});
}

export function stage1GrantConfig(environment=process.env){
  exactStaging(environment);
  const expectedVersion=Number(required(environment,'REFS_STAGE1_GRANT_EXPECTED_VERSION'));
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw new KernelError('STAGE1_BOOTSTRAP_CONFIG_INVALID','REFS_STAGE1_GRANT_EXPECTED_VERSION must be a non-negative safe integer');
  const actorId=text(required(environment,'REFS_STAGE1_OIDC_SUBJECT'),'REFS_STAGE1_OIDC_SUBJECT',{pattern:SUBJECT,max:200});
  return Object.freeze({
    tenantId:uuid(required(environment,'REFS_STAGE1_TENANT_ID'),'REFS_STAGE1_TENANT_ID'),
    entityId:uuid(required(environment,'REFS_STAGE1_ENTITY_ID'),'REFS_STAGE1_ENTITY_ID'),
    actorId,
    expectedVersion,
    authorityClass:'ANALYSIS',validUntil:grantExpiry(environment),
    idempotencyKey:text(required(environment,'REFS_STAGE1_GRANT_IDEMPOTENCY_KEY'),'REFS_STAGE1_GRANT_IDEMPOTENCY_KEY',{pattern:IDEMPOTENCY,max:128}),
    permissions:[...STAGE1_READ_PERMISSIONS],
  });
}

export function stage1AuthenticatedGrantConfig(environment=process.env){
  exactStaging(environment);
  const expectedVersion=Number(required(environment,'REFS_STAGE1_GRANT_EXPECTED_VERSION'));
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw new KernelError('STAGE1_BOOTSTRAP_CONFIG_INVALID','REFS_STAGE1_GRANT_EXPECTED_VERSION must be a non-negative safe integer');
  return Object.freeze({
    tenantId:uuid(required(environment,'REFS_STAGE1_TENANT_ID'),'REFS_STAGE1_TENANT_ID'),
    entityId:uuid(required(environment,'REFS_STAGE1_ENTITY_ID'),'REFS_STAGE1_ENTITY_ID'),
    expectedVersion,
    authorityClass:'ANALYSIS',validUntil:grantExpiry(environment),
    idempotencyKey:text(required(environment,'REFS_STAGE1_GRANT_IDEMPOTENCY_KEY'),'REFS_STAGE1_GRANT_IDEMPOTENCY_KEY',{pattern:IDEMPOTENCY,max:128}),
    accessToken:required(environment,'REFS_AUTHENTICATED_ACCESS_TOKEN'),
    issuer:required(environment,'OIDC_ISSUER'),audience:required(environment,'OIDC_AUDIENCE'),jwksUri:required(environment,'OIDC_JWKS_URI'),
    permissions:[...STAGE1_READ_PERMISSIONS],
  });
}

// Opt-in configuration for the authoritative site's one-click Stage 1 reader
// activation.  It intentionally contains no user identity: the API derives
// that exclusively from the OIDC-authenticated request.
export function stage1SelfGrantConfig(environment=process.env){
  if(String(environment.REFS_STAGE1_SELF_GRANT_ENABLED||'')!=='STAGE1_AUTHORITATIVE_ONLY')return null;
  exactStaging(environment);
  return Object.freeze({
    tenantId:uuid(required(environment,'REFS_STAGE1_TENANT_ID'),'REFS_STAGE1_TENANT_ID'),
    entityId:uuid(required(environment,'REFS_STAGE1_ENTITY_ID'),'REFS_STAGE1_ENTITY_ID'),
    expectedVersion:0,
    authorityClass:'ANALYSIS',validUntil:grantExpiry(environment),
    permissions:[...STAGE1_READ_PERMISSIONS],
  });
}

// Legacy self-upgrades are permanently retired. Elevated WBS access must be
// issued as finite, single-authority roles through the controlled grant flow.
export function stage1SelfWbsReadUpgradeConfig(environment=process.env){
  return null;
}

export function stage1SelfWbsOperatorUpgradeConfig(environment=process.env){
  return null;
}

export function stage1SelfControlledTestWorkflowUpgradeConfig(environment=process.env){
  // The former one-click bundle mixed service-only import, bank maker/reviewer,
  // reconciliation reviewer/sign-off, and every JE lifecycle permission on one
  // actor. Migration 274 retires that grant boundary. Controlled tests must use
  // separately configured finite workflow roles and a distinct SERVICE actor.
  return null;
}

const normalizedRow=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString().slice(0,10):value]));
const same=(actual,expected)=>canonicalRequestHash(normalizedRow(actual))===canonicalRequestHash(expected);
const conflict=(label)=>{throw new KernelError('STAGE1_BOOTSTRAP_STATE_CONFLICT',`${label} conflicts with the requested immutable staging scope`);};

async function assertMigrationIdentity(client,{allowTestIdentity=false}={}){
  const identity=requireRow(await client.query('SELECT session_user,current_user,current_database()'),'STAGE1_BOOTSTRAP_IDENTITY_MISSING','Bootstrap DB identity missing');
  const allowed=identity.session_user==='refs_migration_owner'&&identity.current_user==='refs_migration_owner';
  const testAllowed=allowTestIdentity&&identity.session_user==='refs_migrator'&&identity.current_user==='refs_migrator'&&String(identity.current_database).endsWith('_test');
  if(!allowed&&!testAllowed)throw new KernelError('STAGE1_BOOTSTRAP_DB_IDENTITY_DENIED','Stage 1 provisioning requires the isolated migration owner identity');
}

async function assertProvisionedState(client,config){
  const tenant=requireRow(await client.query('SELECT tenant_id::text,tenant_code,name FROM tenant WHERE tenant_id=$1',[config.tenantId]),'STAGE1_BOOTSTRAP_TENANT_MISSING','Stage 1 tenant missing');
  if(!same(tenant,{tenant_id:config.tenantId,tenant_code:config.tenantCode,name:config.tenantName}))conflict('tenant');
  const entity=requireRow(await client.query('SELECT entity_id::text,tenant_id::text,entity_code,source_system,source_entity_id,name,base_currency,active FROM entity WHERE entity_id=$1',[config.entityId]),'STAGE1_BOOTSTRAP_ENTITY_MISSING','Stage 1 entity missing');
  if(!same(entity,{entity_id:config.entityId,tenant_id:config.tenantId,entity_code:config.entityCode,source_system:'REFS_STAGE1',source_entity_id:config.entityCode,name:config.entityName,base_currency:config.baseCurrency,active:true}))conflict('entity');
  const periodRow=requireRow(await client.query('SELECT period_id::text,tenant_id::text,entity_id::text,ledger_code,period_code,starts_on::text,ends_on::text,status::text,version::text FROM accounting_period WHERE period_id=$1',[config.periodId]),'STAGE1_BOOTSTRAP_PERIOD_MISSING','Stage 1 period missing');
  if(!same(periodRow,{period_id:config.periodId,tenant_id:config.tenantId,entity_id:config.entityId,ledger_code:'PRIMARY',period_code:config.periodCode,starts_on:config.startsOn,ends_on:config.endsOn,status:'OPEN',version:'0'}))conflict('period');
  const accountRows=(await client.query('SELECT account_code,account_name,requires_member,required_member_type,active FROM account_master WHERE tenant_id=$1 AND entity_id=$2 AND account_code=ANY($3::text[]) ORDER BY account_code',[config.tenantId,config.entityId,config.accounts.map(row=>row.accountCode)])).rows;
  const expected=config.accounts.map(row=>({...row,requires_member:false,required_member_type:null,active:true})).map(row=>({account_code:row.accountCode,account_name:row.accountName,requires_member:row.requires_member,required_member_type:row.required_member_type,active:row.active}));
  if(accountRows.length!==expected.length||!same({rows:accountRows},{rows:expected}))conflict('accounts');
}

export async function provisionStage1Scope(pool,config,{allowTestIdentity=false}={}){
  const requestHash=canonicalRequestHash({...config,accounts:config.accounts});
  return withSerializableRetry(pool,async client=>{
    await assertMigrationIdentity(client,{allowTestIdentity});
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`refs-stage1:${config.tenantId}:${config.entityId}`]);
    const prior=(await client.query("SELECT after_hash FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='STAGE1_SCOPE_PROVISIONED' AND idempotency_key=$3 ORDER BY occurred_at,audit_event_id",[config.tenantId,config.entityId,config.idempotencyKey])).rows;
    if(prior.length>1)conflict('provisioning audit history');
    if(prior.length===1){
      if(prior[0].after_hash!==requestHash)throw new KernelError('STAGE1_BOOTSTRAP_IDEMPOTENCY_CONFLICT','Provisioning idempotency key was reused with a different request');
      await assertProvisionedState(client,config);
      return {idempotent:true,tenantCount:1,entityCount:1,periodCount:1,accountCount:config.accounts.length,auditCount:1};
    }
    await client.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[config.tenantId,config.tenantCode,config.tenantName]);
    await client.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency,active) VALUES($1,$2,$3,'REFS_STAGE1',$3,$4,$5,true) ON CONFLICT DO NOTHING",[config.entityId,config.tenantId,config.entityCode,config.entityName,config.baseCurrency]);
    await client.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,ledger_code,period_code,starts_on,ends_on,status,version) VALUES($1,$2,$3,'PRIMARY',$4,$5,$6,'OPEN',0) ON CONFLICT DO NOTHING",[config.periodId,config.tenantId,config.entityId,config.periodCode,config.startsOn,config.endsOn]);
    for(const account of config.accounts)await client.query('INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type,active) VALUES($1,$2,$3,$4,false,NULL,true) ON CONFLICT DO NOTHING',[config.tenantId,config.entityId,account.accountCode,account.accountName]);
    await assertProvisionedState(client,config);
    await client.query("INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES($1,$2,'STAGE1_SCOPE_PROVISIONED','ENTITY',$2,'PROVISION','stage1-bootstrap-cli','SERVICE_ACCOUNT',$3,$3,$3,$4,'Minimal authoritative read scope for Stage 1',jsonb_build_object('schema','refs.stage1-bootstrap/v1','period_id',$5::uuid,'account_codes',$6::jsonb))",[config.tenantId,config.entityId,config.idempotencyKey,requestHash,config.periodId,JSON.stringify(config.accounts.map(row=>row.accountCode))]);
    return {idempotent:false,tenantCount:1,entityCount:1,periodCount:1,accountCount:config.accounts.length,auditCount:1};
  });
}

export async function grantStage1ReadAccess(pool,config,{principalProvider=async()=>({trusted:true,serviceId:'platform-iam-sync'})}={}){
  if(config.permissions.length!==STAGE1_READ_PERMISSIONS.length||config.permissions.some((value,index)=>value!==STAGE1_READ_PERMISSIONS[index])){
    throw new KernelError('STAGE1_GRANT_SCOPE_DENIED','Stage 1 grant must contain exactly the approved read permissions');
  }
  const sync=new PostgresGrantSync(pool,{principalProvider});
  const result=await sync.reconcile(config);
  const returned=[...(result.permissions||[])].sort();
  if(returned.length!==STAGE1_READ_PERMISSIONS.length||returned.some((value,index)=>value!==STAGE1_READ_PERMISSIONS[index]))throw new KernelError('STAGE1_GRANT_RESULT_INVALID','Grant sync returned an unexpected permission set');
  return {idempotent:result.idempotent===true,version:result.version,permissionCount:returned.length};
}

export async function grantStage1SelfReadAccess(pool,config,{principalProvider=async()=>({trusted:true,serviceId:'platform-iam-sync'}),clock=()=>Date.now(),syncFactory=(targetPool,options)=>new PostgresGrantSync(targetPool,options)}={}){
  if(config.permissions.length!==STAGE1_READ_PERMISSIONS.length||config.permissions.some((value,index)=>value!==STAGE1_READ_PERMISSIONS[index])){
    throw new KernelError('STAGE1_GRANT_SCOPE_DENIED','Stage 1 grant must contain exactly the approved read permissions');
  }
  const now=Number(clock());
  if(!Number.isFinite(now))throw new KernelError('STAGE1_GRANT_CLOCK_INVALID','Stage 1 self-service grant clock is invalid');
  const sync=syncFactory(pool,{principalProvider});
  const expectedVersion=await sync.currentVersion({tenantId:config.tenantId,actorId:config.actorId,entityId:config.entityId});
  const validUntil=new Date(now+23*60*60*1000).toISOString();
  const result=await sync.reconcile({...config,expectedVersion,validUntil});
  const returned=[...(result.permissions||[])].sort();
  if(returned.length!==STAGE1_READ_PERMISSIONS.length||returned.some((value,index)=>value!==STAGE1_READ_PERMISSIONS[index]))throw new KernelError('STAGE1_GRANT_RESULT_INVALID','Grant sync returned an unexpected permission set');
  return {idempotent:result.idempotent===true,version:result.version,permissionCount:returned.length};
}

export async function upgradeStage1WbsReadAccess(pool,config,{principalProvider=async()=>({trusted:true,serviceId:'platform-iam-sync'})}={}){
  if(config.expectedVersion!==1||config.authorityClass!=='ANALYSIS'||!UTC_TIMESTAMP.test(config.validUntil||'')||config.permissions.length!==STAGE1_WBS_READ_PERMISSIONS.length||config.permissions.some((value,index)=>value!==STAGE1_WBS_READ_PERMISSIONS[index])){
    throw new KernelError('STAGE1_WBS_READ_UPGRADE_SCOPE_DENIED','Stage 1 WBS upgrade must contain exactly the approved evidence-only read permissions');
  }
  throw new KernelError('STAGE1_WBS_READ_UPGRADE_RETIRED','Self-service grant upgrades are retired; assign the finite ANALYSIS role through workflow:grant');
}

export async function upgradeStage1WbsOperatorAccess(pool,config,{principalProvider=async()=>({trusted:true,serviceId:'platform-iam-sync'})}={}){
  if(config.expectedVersion!==2||config.authorityClass!=='ATTEST'||!UTC_TIMESTAMP.test(config.validUntil||'')||config.permissions.length!==STAGE1_WBS_OPERATOR_PERMISSIONS.length||config.permissions.some((value,index)=>value!==STAGE1_WBS_OPERATOR_PERMISSIONS[index])){
    throw new KernelError('STAGE1_WBS_OPERATOR_UPGRADE_SCOPE_DENIED','Stage 1 WBS operator upgrade must contain exactly the approved read and exception-evidence permissions');
  }
  throw new KernelError('STAGE1_WBS_OPERATOR_UPGRADE_RETIRED','Self-service grant upgrades are retired; assign the finite ATTEST role through workflow:grant');
}

export async function upgradeStage1ControlledTestWorkflowAccess(pool,config,{principalProvider=async()=>({trusted:true,serviceId:'platform-iam-sync'})}={}){
  if(config.expectedVersion!==3||config.permissions.length!==STAGE1_CONTROLLED_TEST_WORKFLOW_PERMISSIONS.length||config.permissions.some((value,index)=>value!==STAGE1_CONTROLLED_TEST_WORKFLOW_PERMISSIONS[index])){
    throw new KernelError('STAGE1_CONTROLLED_TEST_UPGRADE_SCOPE_DENIED','Controlled test workflow upgrade must contain exactly the approved staging test permissions');
  }
  throw new KernelError('STAGE1_CONTROLLED_TEST_UPGRADE_RETIRED','The single-actor controlled test upgrade is retired; grant separate finite maker, reviewer, approver, poster, and service roles through workflow:grant');
}

export async function grantStage1AuthenticatedReadAccess(pool,config,{authenticator}={}){
  const verified=authenticator||new OidcJwtAuthenticator({issuer:config.issuer,audience:config.audience,keyResolver:new RemoteJwksResolver({jwksUri:config.jwksUri})});
  const principal=await verified.authenticate({headers:{authorization:`Bearer ${config.accessToken}`}});
  if(principal.tenantId!==config.tenantId)throw new KernelError('STAGE1_GRANT_TENANT_DENIED','Authenticated token tenant does not match the configured Stage 1 tenant');
  return grantStage1ReadAccess(pool,{tenantId:config.tenantId,entityId:config.entityId,actorId:principal.actorId,expectedVersion:config.expectedVersion,authorityClass:config.authorityClass,validUntil:config.validUntil,idempotencyKey:config.idempotencyKey,permissions:config.permissions});
}
